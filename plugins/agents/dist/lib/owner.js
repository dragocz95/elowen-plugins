/** Resolve which user "owns" a spawned agent, so its prompts render from that user's overrides (else
 *  the file defaults). Attribution is best-effort with an admin fallback: the daemon already runs every
 *  agent under the first/admin user's service token, so an unattributed spawn resolving to that same
 *  user keeps today's behaviour while attributed work (a task/mission/plan a specific user triggered)
 *  picks up that user's prompts. Single source of truth for the attribution chain. */
/** Walk the attribution chain, first non-null wins; admin (service principal) is the final fallback.
 *  Returns null only when there is no user at all (empty DB) — callers then render the file default. */
export function resolveOwnerId(d, ref) {
    if (ref.advisorUserId != null)
        return ref.advisorUserId;
    if (ref.taskId) {
        const task = d.tasks.get(ref.taskId);
        if (task) {
            if (task.created_by != null)
                return task.created_by;
            // A phase task carries no owner of its own; inherit its mission's owner (mission id is `m-<epicId>`,
            // and a phase's parent_id IS that epic id).
            if (task.parent_id) {
                const owner = d.missions?.get(`m-${task.parent_id}`)?.created_by;
                if (owner != null)
                    return owner;
            }
        }
    }
    if (ref.planJob?.createdBy != null)
        return ref.planJob.createdBy;
    return d.users?.list()[0]?.id ?? null;
}
