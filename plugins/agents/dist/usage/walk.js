import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION_MATCH_SKEW_MS } from './types.js';
/**
 * From a set of session candidates `{path, start}`, pick the nth one that started within the spawn
 * window (`start >= sinceMs - SESSION_MATCH_SKEW_MS`), ordered by start time. `nth` lets concurrent
 * agents in the same project map to distinct sessions instead of colliding. Returns null when no
 * candidate qualifies or `nth` is out of range. Single source of truth for the claude/codex
 * session-select logic (opencode selects via SQL).
 */
export function pickNthSession(candidates, sinceMs, nth) {
    const inWindow = candidates
        .filter((c) => c.start >= sinceMs - SESSION_MATCH_SKEW_MS)
        .sort((a, b) => a.start - b.start);
    return inWindow[nth]?.path ?? null;
}
/** Recursively yield every file path under `dir` (depth-limited). Returns [] if dir is missing. */
export function walkFiles(dir, maxDepth = 4) {
    const out = [];
    const visit = (d, depth) => {
        let entries;
        try {
            entries = readdirSync(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            const p = join(d, e.name);
            if (e.isDirectory()) {
                if (depth < maxDepth)
                    visit(p, depth + 1);
            }
            else
                out.push(p);
        }
    };
    visit(dir, 0);
    return out;
}
