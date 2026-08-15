import { spawnSync } from 'node:child_process';
/** Pull the logged-in account out of `gh auth status` output, tolerant of gh version wording
 *  ("… account <login>" on newer gh, "… as <login>" on older). Returns null when absent. */
function parseGhAccount(output) {
    const m = output.match(/Logged in to \S+ (?:account|as) (\S+)/);
    return m ? (m[1] ?? null) : null;
}
/** Probe the local GitHub auth posture. `tokenSet` is whether an Elowen-stored token exists (its value is
 *  never needed here). Runs as the daemon's service user, so it reflects exactly what a push would use.
 *  Pure of config: detection only — callers combine it with `ready`/`method` to drive UX. */
export function detectGithubAuth(tokenSet) {
    let ghInstalled = false;
    let ghAuthenticated = false;
    let account = null;
    if (spawnSync('which', ['gh'], { timeout: 5000 }).status === 0) {
        ghInstalled = true;
        const r = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', timeout: 5000 });
        ghAuthenticated = r.status === 0;
        account = parseGhAccount((r.stdout ?? '') + (r.stderr ?? ''));
    }
    const method = tokenSet ? 'token' : ghAuthenticated ? 'gh' : 'none';
    return { ghInstalled, ghAuthenticated, account, tokenSet, ready: tokenSet || ghAuthenticated, method };
}
