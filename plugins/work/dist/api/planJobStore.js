import { randomBytes } from 'node:crypto';
/** In-memory registry of async planning jobs. Ephemeral by design: a daemon restart drops jobs,
 *  which the API surfaces as failed (the user retries). Persistence is unnecessary — a plan job
 *  lives seconds (relay) to minutes (agent). */
/** How long a finished (done/failed) job is kept so the client can still read its result before it's
 *  pruned. An in-flight job is prunable only once its planning window (below) has elapsed. 10 min
 *  covers the slowest agent plan. */
const TERMINAL_TTL_MS = 10 * 60_000;
/** Hard cap on an in-flight job. Nothing settles a job whose Pilot died (crashed pane, killed session):
 *  only the Pilot's own `plan submit` does, so without a cap the client polls a job that will never
 *  answer and the map keeps it for the daemon's lifetime. Far above any real plan (seconds for relay,
 *  minutes for an agent), so it can only ever fire on a Pilot that is gone. */
const PLANNING_MAX_MS = 60 * 60_000;
export class PlanJobStore {
    now;
    jobs = new Map();
    /** Insertion time per job — used to prune long-finished jobs so the Map can't grow unbounded over
     *  a long-running daemon (a plan job is read once, then never again). */
    created = new Map();
    constructor(now = Date.now) {
        this.now = now;
    }
    create(input) {
        this.prune();
        const job = { id: `pj-${randomBytes(5).toString('hex')}`, status: 'planning', phases: [], ...input };
        this.jobs.set(job.id, job);
        this.created.set(job.id, this.now());
        return job;
    }
    /** Settle a job whose planning window has elapsed — its Pilot is gone and will never submit, so the
     *  caller must read a definite failure instead of a perpetual 'planning'. No-op within the window. */
    expireStale(id, job) {
        if (job.status === 'planning' && (this.created.get(id) ?? 0) <= this.now() - PLANNING_MAX_MS) {
            job.status = 'failed';
            job.error = 'plan_timed_out';
        }
        return job;
    }
    /** Drop done/failed jobs older than the TTL. An in-flight job is kept until its planning window
     *  elapses, at which point it settles as failed and becomes prunable like any other. */
    prune() {
        const cutoff = this.now() - TERMINAL_TTL_MS;
        for (const [id, job] of this.jobs) {
            if (this.expireStale(id, job).status === 'planning')
                continue;
            if ((this.created.get(id) ?? 0) <= cutoff) {
                this.jobs.delete(id);
                this.created.delete(id);
            }
        }
    }
    get(id) {
        const job = this.jobs.get(id);
        return job ? this.expireStale(id, job) : null;
    }
    /** Record the Pilot's tmux session once it's spawned (agent-mode planning only). */
    setSession(id, sessionName) {
        const j = this.jobs.get(id);
        if (!j)
            return null;
        j.sessionName = sessionName;
        return j;
    }
    setPhases(id, phases) {
        const j = this.jobs.get(id);
        if (!j)
            return null;
        j.phases = phases;
        j.status = 'done';
        return j;
    }
    fail(id, error) {
        const j = this.jobs.get(id);
        if (!j)
            return null;
        j.status = 'failed';
        j.error = error;
        return j;
    }
}
