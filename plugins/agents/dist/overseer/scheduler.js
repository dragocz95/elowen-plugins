import { KeyedMutex } from '../lib/keyedMutex.js';
import { resolveExecutor } from './routing.js';
import { parseResumeLabel } from '../spawn/resume/index.js';
import { checkoutBusy, checkoutOf } from './checkout.js';
import { snapshotTaskChanges } from './taskSnapshot.js';
import { resolveOwnerId } from '../lib/owner.js';
import { logger } from '../lib/logger.js';
const log = logger('scheduler');
/** Launches open, autostart tasks whose scheduled_at has arrived, then clears the schedule.
 *  Scheduled tasks without autostart are due-date markers only — never auto-launched.
 *  Runs across every registered project. */
export class Scheduler {
    d;
    gitLock;
    constructor(d) {
        this.d = d;
        this.gitLock = d.gitLock ?? new KeyedMutex();
    }
    async tick() {
        const now = this.d.clock.now();
        const resolver = { projectPath: (id) => this.d.projects.get(id)?.path ?? '', worktreeFor: this.d.worktreeFor };
        for (const project of this.d.projects.list()) {
            // Compare as epochs (#39): `scheduled_at` is stored as the client sent it, which may carry a
            // non-UTC zone (e.g. `+02:00`). A lexical string compare against a UTC ISO `now` would then
            // misjudge the same instant. `Date.parse` collapses both to absolute time.
            const due = this.d.tasks
                .list({ project_id: project.id, status: 'open' })
                .filter((t) => t.autostart && t.scheduled_at != null && Date.parse(t.scheduled_at) <= now);
            for (const task of due) {
                const cwd = checkoutOf(resolver, task); // a standalone task's checkout is the shared project path
                // Shared (non-PR) checkouts are single-writer: at most one agent edits a project's tree at a
                // time, so each task's committed delta stays cleanly attributable. Read the occupied set FRESH
                // here (not a tick-start snapshot): the scheduler and the mission engine tick concurrently, so a
                // stale snapshot could miss a launch another tick made into this checkout during one of our
                // awaits. This is also the burst cap — co-scheduled tasks sharing a checkout fire one per tick.
                if (checkoutBusy(resolver, this.d.tasks.list({ status: 'in_progress' }), cwd))
                    continue;
                const spec = resolveExecutor(task.labels, this.d.fallback);
                const named = task.labels.find((l) => l.startsWith('agent:'))?.slice('agent:'.length);
                const agentName = named || this.d.nameAgent();
                const originalSchedule = task.scheduled_at;
                // Everything from the fresh check above through setStatus runs synchronously (no await between),
                // so the check-and-claim is atomic: a concurrent tick that re-reads in_progress sees this task
                // the instant we yield at the gitLock await below, and can't double-occupy the checkout.
                this.d.tasks.update(task.id, { scheduled_at: null }); // consume so it fires once
                this.d.tasks.setAgent(task.id, agentName); // link task → session for run controls
                this.d.tasks.markStarted(task.id, now); // precise spawn time → correct usage attribution under concurrency
                this.d.tasks.setStatus(task.id, 'in_progress');
                // Read HEAD + stamp the baseline under the checkout lock, so it lands AFTER any in-flight
                // commit on this checkout (a just-closed task still committing) and the snapshot range is exact.
                await this.gitLock.run(cwd, async () => this.d.tasks.markBase(task.id, await this.d.git.projectHead(cwd)));
                try {
                    await this.d.spawn.launch({
                        projectId: project.id, projectPath: cwd, taskId: task.id,
                        agentName, spec, taskTitle: task.title, taskDescription: task.description,
                        resumeNote: task.resume_note ?? undefined,
                        epicId: task.parent_id ?? undefined,
                        resume: parseResumeLabel(task.labels),
                        ownerId: resolveOwnerId(this.d, { taskId: task.id }),
                    });
                }
                catch (e) {
                    // Spawn failed (tmux down, bin missing): roll back so the schedule isn't silently lost (O9).
                    // Restore status to open and the original scheduled_at so the next tick retries it.
                    this.d.tasks.update(task.id, { scheduled_at: originalSchedule });
                    this.d.tasks.setStatus(task.id, 'open');
                    this.d.bus.publish({ type: 'task', taskId: task.id, status: 'open' });
                    log.error(`spawn failed for task ${task.id} — schedule restored`, e);
                    continue;
                }
                this.d.bus.publish({ type: 'task', taskId: task.id, status: 'in_progress' });
            }
        }
        await this.syncRunningChanges(resolver);
    }
    /** Live git history: detect new commits in each running task's checkout and refresh its frozen
     *  change snapshot, emitting a `change` ping so the detail pane's history/changes update live
     *  instead of only freezing at close. Best-effort per task — a git failure on one must not stall
     *  the rest. Snapshots only when HEAD actually advanced past the last recorded `head_sha`, so a quiet
     *  agent costs one cheap `git rev-parse` per tick and never republishes. */
    async syncRunningChanges(resolver) {
        for (const task of this.d.tasks.list({ status: 'in_progress' })) {
            const cwd = checkoutOf(resolver, task);
            if (!cwd)
                continue;
            try {
                const advanced = await this.gitLock.run(cwd, async () => {
                    const head = await this.d.git.projectHead(cwd);
                    if (!head || head === task.head_sha)
                        return false;
                    await snapshotTaskChanges(this.d.git, this.d.tasks, task.id, cwd);
                    // Publish only when the snapshot actually STAMPED the new head. A task with no `base:` label
                    // (empty repo at spawn, or a pre-existing in_progress task) makes snapshotTaskChanges a no-op,
                    // leaving head_sha null forever — without this re-read the raw HEAD-vs-null compare would
                    // re-publish `change` every tick and thrash every client's refetch.
                    return this.d.tasks.get(task.id)?.head_sha === head;
                });
                if (advanced)
                    this.d.bus.publish({ type: 'change', taskId: task.id });
            }
            catch (e) {
                log.error(`change sync failed for task ${task.id}`, e);
            }
        }
    }
}
