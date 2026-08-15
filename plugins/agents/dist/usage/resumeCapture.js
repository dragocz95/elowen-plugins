import { detectSessionId } from './sessionId.js';
/** Detect the CLI session a task's agent just ran under and stamp it as the task's `resume:` label, so
 *  a later re-spawn can `--resume` it (full context) instead of cold-starting. Single source shared by
 *  the usage recorder (at close/cancel) and the stuck detector (when it reverts a dead agent to open) —
 *  the two moments a task stops running and its session settles on disk. No-op when no session matches
 *  (CLI unused, not persisted, unsupported program). `siblings` may be passed to avoid a re-list. */
export function captureResumeLabel(d, task, siblings) {
    const detect = d.detect ?? detectSessionId;
    const sibs = siblings ?? d.tasks.list({ project_id: task.project_id });
    const detected = detect(task, sibs, d.pathFor(task), d.fallback);
    if (detected)
        d.tasks.setResumeLabel(task.id, detected.program, detected.sessionId);
}
