import { claudeResume } from './claude.js';
import { codexResume } from './codex.js';
import { opencodeResume } from './opencode.js';
import { kiloResume } from './kilo.js';
import { piResume } from './pi.js';
import { ompResume } from './omp.js';
/** Per-program resume strategies. Add a provider by dropping a module here + a detector next to its
 *  usage parser — no other call site changes. */
const RESUME_PROVIDERS = {
    'claude-code': claudeResume,
    'codex': codexResume,
    'opencode': opencodeResume,
    'kilo': kiloResume,
    'pi': piResume,
    'omp': ompResume,
    // The embedded brain doesn't splice CLI flags — a relaunch on the same `brain-task-<id>` session
    // rehydrates the full history from SQLite, so there is nothing to resume at the command level.
    'elowen': { program: 'elowen', resumeArgs: () => null },
};
/** The resume strategy for a program id ('opencode…' variants normalize to 'opencode'), or undefined. */
export function resumeProviderFor(program) {
    const key = program.startsWith('opencode') ? 'opencode' : program;
    return RESUME_PROVIDERS[key];
}
/** Parse a task's `resume:<program>:<sessionId>` label into its parts, or undefined when absent or
 *  malformed. Written by the usage recorder at close; read at the next spawn to decide whether to
 *  resume. The program must be a known resume provider, else the label is ignored (cold start). */
export function parseResumeLabel(labels) {
    const label = labels.find((l) => l.startsWith('resume:'));
    if (!label)
        return undefined;
    const rest = label.slice('resume:'.length);
    const sep = rest.indexOf(':');
    if (sep <= 0)
        return undefined;
    const program = rest.slice(0, sep);
    const sessionId = rest.slice(sep + 1);
    if (!sessionId || !(program in RESUME_PROVIDERS))
        return undefined;
    return { program: program, sessionId };
}
