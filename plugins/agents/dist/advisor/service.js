import { resolveExecutor } from '../overseer/routing.js';
import { writeMcpConfig } from './mcpConfig.js';
import { logger } from '../lib/logger.js';
const log = logger('advisor');
/** Per-user advisor lifecycle: a persistent `elowen-advisor-<userId>` agent session that controls Elowen
 *  on the user's behalf with a full-scope token. Chosen exec is remembered and auto-started on login.
 *  Plugin-owned since the tmux advisor cannot exist without the spawn subsystem; the embedded-brain
 *  advisor is a separate core engine and is untouched by this service. */
export class AdvisorService {
    d;
    constructor(d) {
        this.d = d;
    }
    session(userId) { return `elowen-advisor-${userId}`; }
    /** An exec must be globally allowed AND (for a restricted non-admin) on the user's own allow-list. */
    execAllowed(userId, exec) {
        const u = this.d.host.users.get(userId);
        if (!u)
            return false;
        if (!this.d.config.get().allowedExecs.includes(exec))
            return false;
        if (u.isAdmin || u.allowedExecs.length === 0)
            return true;
        return u.allowedExecs.includes(exec);
    }
    async status(userId) {
        const u = this.d.host.users.get(userId);
        const name = this.session(userId);
        const running = (await this.d.tmux.list()).includes(name);
        return { running, exec: u?.advisorExec ?? '', session: running ? name : null, autostart: u?.advisorAutostart ?? false };
    }
    async start(userId, exec) {
        if (!this.execAllowed(userId, exec))
            throw new Error('exec not allowed for user');
        const name = this.session(userId);
        if ((await this.d.tmux.list()).includes(name))
            return { session: name }; // already live — idempotent
        this.d.host.users.setExec(userId, exec); // remember the choice for autostart
        this.d.host.users.setAutostart(userId, true); // an explicit start re-arms login autostart
        const spec = resolveExecutor([`exec:${exec}`], this.d.fallback);
        const token = this.d.host.users.ensureToken(userId); // full-scope, reused across restarts
        const cwd = this.d.host.dir(userId);
        await (this.d.prepareMcp ?? writeMcpConfig)(spec.program, cwd, token, this.d.mcpUrl);
        const u = this.d.host.users.get(userId);
        // The instance brand so {{agentName}}/{{productName}} in the prompt resolve — the same resolver the
        // brain spawner uses, so the tmux advisor and the embedded brain never disagree on the identity.
        const { agentName, productName } = this.d.host.brand();
        const vars = { userName: u.name || u.username, personality: this.d.host.personality(userId), agentName, productName };
        const rawPrompt = this.d.prompts.render('elowen', vars, userId);
        // agentName `advisor-<id>` → SpawnService names the tmux session `elowen-advisor-<id>`. The full
        // advisor token overrides the daemon's agent service token via extraEnv, so the advisor acts with
        // the user's own rights. The cwd is a neutral per-user dir, not a project checkout.
        await this.d.spawn().launch({
            projectId: this.d.projectId ?? 0,
            projectPath: cwd,
            taskId: name,
            agentName: `advisor-${userId}`,
            spec,
            rawPrompt,
            extraEnv: { ELOWEN_TOKEN: token, ELOWEN_URL: this.d.url },
            mcpUrl: this.d.mcpUrl,
        });
        log.info(`advisor started for user ${userId} (${spec.program}/${spec.model})`);
        return { session: name };
    }
    async stop(userId) {
        // Turn autostart OFF so the advisor stays down: ensureOnLogin would otherwise bring it back on the
        // next login (the "advisor re-enables itself after I turned it off" bug). An explicit start re-arms it.
        this.d.host.users.setAutostart(userId, false);
        await this.d.tmux.kill(this.session(userId));
    }
    /** Bring the user's advisor back up after login, if they set one up and left autostart on. Never
     *  throws — a spawn failure must not block the login response. */
    async ensureOnLogin(userId) {
        const u = this.d.host.users.get(userId);
        if (!u || !u.advisorExec || !u.advisorAutostart)
            return;
        try {
            await this.start(userId, u.advisorExec);
        }
        catch (e) {
            log.error(`advisor autostart failed for user ${userId}`, e);
        }
    }
}
