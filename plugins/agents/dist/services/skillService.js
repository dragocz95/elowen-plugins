import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AGENTS_PROMPTS_DIR } from '../promptCatalog.js';
import { logger } from '../lib/logger.js';
const log = logger('skills');
/** The agent CLIs Elowen spawns, each reading `skills/<name>/SKILL.md` under its config dir. Verified on
 *  a live box: all three share the same SKILL.md format, so one master file installs natively into all
 *  of them. `configDir` resolves that dir from the provider's own env override (so a box that relocates
 *  its config is honoured) and falls back to the conventional HOME-relative default. */
const PROVIDERS = [
    { id: 'claude-code', configDir: (home, env) => env.CLAUDE_CONFIG_DIR || join(home, '.claude') },
    { id: 'codex', configDir: (home, env) => env.CODEX_HOME || join(home, '.codex') },
    { id: 'opencode', configDir: (home, env) => join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode') },
];
const SKILL_NAME = 'elowen-workflow';
// The bundled master ships with THIS plugin (plugins/agents/prompts/skills/…), beside its templates.
const MASTER_REL = `skills/${SKILL_NAME}/SKILL.md`;
// Leading `---` fenced frontmatter block (mirror of src/shared/frontmatter.ts — this plugin imports
// no core VALUES): BOM/CRLF tolerant, the block ends at the FIRST `---` line.
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*(?:\r?\n)([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
/** Parse `version:` from a SKILL.md's frontmatter (`metadata.version`). Scoped to the leading `---`
 *  fenced block so a `version:` mentioned in the body can't be mistaken for the real one; returns null
 *  when the file has no frontmatter. The master file is the single source of truth for the version;
 *  both the bundled master and an installed copy are parsed the same way. */
function parseVersion(text) {
    const frontmatter = FRONTMATTER_RE.exec(text)?.[1];
    if (!frontmatter)
        return null;
    const m = /version:\s*(\d+)/.exec(frontmatter);
    return m ? Number(m[1]) : null;
}
export function createSkillService(opts = {}) {
    const home = opts.home ?? homedir();
    const env = opts.env ?? process.env;
    const readMaster = opts.readMaster ?? (() => readFileSync(join(AGENTS_PROMPTS_DIR, MASTER_REL), 'utf-8'));
    const configDirOf = (p) => p.configDir(home, env);
    const targetFor = (configDir) => join(configDir, 'skills', SKILL_NAME, 'SKILL.md');
    function status() {
        let masterVersion = null;
        try {
            masterVersion = parseVersion(readMaster());
        }
        catch { /* master unreadable → nothing up to date */ }
        return PROVIDERS.map((p) => {
            const configDir = configDirOf(p);
            const present = existsSync(configDir);
            const target = targetFor(configDir);
            const installed = existsSync(target);
            let version = null;
            if (installed) {
                try {
                    version = parseVersion(readFileSync(target, 'utf-8'));
                }
                catch { /* leave null */ }
            }
            return { provider: p.id, present, installed, version, upToDate: installed && version !== null && version === masterVersion };
        });
    }
    function installAll() {
        let master;
        try {
            master = readMaster();
        }
        catch (e) {
            log.warn(`skill master unreadable, skipping install: ${e.message}`);
            return PROVIDERS.map(({ id }) => ({ provider: id, installed: false, skipped: false, error: 'master unreadable' }));
        }
        return PROVIDERS.map((p) => {
            const configDir = configDirOf(p);
            if (!existsSync(configDir))
                return { provider: p.id, installed: false, skipped: true };
            const target = targetFor(configDir);
            try {
                mkdirSync(dirname(target), { recursive: true });
                // Atomic replace: write a sibling temp then rename over the target so a reader never sees a
                // half-written file. Temp lives in the same dir to keep the rename on one filesystem; the
                // random suffix keeps concurrent installs (even same-pid) from colliding on the temp name.
                const tmp = `${target}.tmp-${randomBytes(6).toString('hex')}`;
                writeFileSync(tmp, master, 'utf-8');
                renameSync(tmp, target);
                return { provider: p.id, installed: true, skipped: false };
            }
            catch (e) {
                log.warn(`skill install failed for ${p.id}: ${e.message}`);
                return { provider: p.id, installed: false, skipped: false, error: e.message };
            }
        });
    }
    return { status, installAll };
}
