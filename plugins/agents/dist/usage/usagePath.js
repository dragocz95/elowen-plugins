/** Where a task's agent actually ran — the cwd its CLI logged token usage under. For a PR-native
 *  mission that's the isolated worktree (a phase's mission is `m-<epicId>`, and its epic is the
 *  task's parent); otherwise the project checkout. Single source for both the live usage endpoint
 *  and the snapshot recorder so they resolve the same path. */
export function usagePath(task, projectPath, worktreeFor) {
    if (task.parent_id) {
        const wt = worktreeFor?.(`m-${task.parent_id}`);
        if (wt)
            return wt;
    }
    return projectPath(task.project_id);
}
