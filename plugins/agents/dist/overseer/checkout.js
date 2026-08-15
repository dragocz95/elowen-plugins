import { usagePath } from '../usage/usagePath.js';
/** The checkout a task's agent edits — its cwd (mirrors usagePath): a PR mission's isolated worktree,
 *  else the shared project path. */
export function checkoutOf(r, task) {
    return usagePath(task, r.projectPath, r.worktreeFor);
}
/** The set of SHARED project checkouts currently occupied by an in-progress task. A shared (non-PR)
 *  checkout is single-writer: only one agent may edit it at a time, so each task's committed delta
 *  stays cleanly attributable (base..HEAD never straddles another agent's commit, and `git add -A`
 *  never sweeps in a neighbour's edits). Isolated PR worktrees are deliberately excluded — they're
 *  per-mission, so a different mission/standalone task never collides with them. */
export function busySharedCheckouts(r, inProgress) {
    const busy = new Set();
    for (const t of inProgress) {
        const cwd = checkoutOf(r, t);
        if (cwd === r.projectPath(t.project_id))
            busy.add(cwd); // shared checkout only; skip isolated worktrees
    }
    return busy;
}
/** Whether `cwd` is a SHARED checkout already occupied by a live agent, judged from the in-progress
 *  list passed in. MUST be read FRESH (re-list in_progress) and called SYNCHRONOUSLY immediately before
 *  flipping a task to in_progress — with no await between the check and the flip — so check-and-claim is
 *  atomic. The scheduler and every mission-engine tick run interleaved; a stale (tick-start) snapshot
 *  would miss a launch another tick made into this checkout during an await, double-occupying it. PR
 *  worktrees are isolated, so they are never busy. */
export function checkoutBusy(r, inProgress, cwd) {
    return busySharedCheckouts(r, inProgress).has(cwd);
}
