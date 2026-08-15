// @vitest-environment node
// Re-homed from the Elowen package together with the agents plugin. Carries, verbatim:
//   tests/plugins/agents/advisor/mcpConfig.test.ts
//   tests/plugins/agents/advisor/service.test.ts
//   tests/plugins/agents/skillService.test.ts
//   tests/plugins/agents/askService.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from 'elowen/dist/store/db.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { FakeTmuxDriver } from 'elowen/dist/tmux/fakeDriver.js';
import { render } from 'elowen/dist/prompts/index.js';
import { resolveBrand } from 'elowen/dist/shared/brand.js';
import { personalityText } from 'elowen/dist/brain/personality.js';
import type { PluginHostConfig } from 'elowen/dist/plugins/api.js';
import { writeMcpConfig } from '../plugins/agents/dist/advisor/mcpConfig.js';
import { codexMcpArgs } from '../plugins/agents/dist/lib/mcpArgs.js';
import { AdvisorService } from '../plugins/agents/dist/advisor/service.js';
import { createSkillService } from '../plugins/agents/dist/services/skillService.js';
import { DecisionQueue } from '../plugins/agents/dist/overseer/decisionQueue.js';
import { createAskService, ASK_SENTINEL } from '../plugins/agents/dist/api/askService.js';

// ---- from tests/plugins/agents/advisor/mcpConfig.test.ts ----

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'elowen-mcp-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('writeMcpConfig', () => {
  it('claude → .mcp.json with an http elowen server and bearer header', () => {
    writeMcpConfig('claude-code', dir, 'tok', 'http://localhost:4600/mcp');
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    expect(cfg.mcpServers.elowen.url).toBe('http://localhost:4600/mcp');
    expect(cfg.mcpServers.elowen.headers.Authorization).toBe('Bearer tok');
  });

  it('opencode → opencode.json with a remote mcp server', () => {
    writeMcpConfig('opencode', dir, 'tok', 'http://localhost:4600/mcp');
    const cfg = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
    expect(cfg.mcp.elowen.type).toBe('remote');
    expect(cfg.mcp.elowen.url).toBe('http://localhost:4600/mcp');
    expect(cfg.mcp.elowen.headers.Authorization).toBe('Bearer tok');
    expect(cfg.mcp.elowen.enabled).toBe(true);
  });

  it('codex → writes NO project-local file (codex only reads $CODEX_HOME/config.toml)', () => {
    // codex-cli 0.98 ignores any project-local config, so a dropped file would be dead. Its MCP server
    // is wired at launch via codexMcpArgs instead — see the codexMcpArgs cases below.
    writeMcpConfig('codex', dir, 'tok', 'http://localhost:4600/mcp');
    expect(existsSync(join(dir, '.codex-mcp.toml'))).toBe(false);
    expect(existsSync(join(dir, 'config.toml'))).toBe(false);
  });

  it('an unknown program writes nothing', () => {
    writeMcpConfig('something-else', dir, 'tok', 'http://x/mcp');
    expect(existsSync(join(dir, '.mcp.json'))).toBe(false);
    expect(existsSync(join(dir, 'opencode.json'))).toBe(false);
  });
});

describe('codexMcpArgs', () => {
  it('codex → `-c` overrides for url and a bearer-token env var (no secret on the command line)', () => {
    const args = codexMcpArgs('codex', 'http://localhost:4600/mcp');
    // Values are parsed as TOML by codex, hence the inner quotes. Verified against codex-cli 0.98:
    // `codex -c 'mcp_servers.elowen.url=…' -c 'mcp_servers.elowen.bearer_token_env_var="ELOWEN_TOKEN"' mcp list`
    // lists elowen as an enabled streamable_http server.
    expect(args).toEqual([
      '-c', 'mcp_servers.elowen.url="http://localhost:4600/mcp"',
      '-c', 'mcp_servers.elowen.bearer_token_env_var="ELOWEN_TOKEN"',
    ]);
  });

  it('non-codex programs get no launch args (they use a config file instead)', () => {
    expect(codexMcpArgs('claude-code', 'http://x/mcp')).toEqual([]);
    expect(codexMcpArgs('opencode', 'http://x/mcp')).toEqual([]);
    expect(codexMcpArgs('something-else', 'http://x/mcp')).toEqual([]);
  });
});

// ---- from tests/plugins/agents/advisor/service.test.ts ----

// The plugin-owned advisor service over a REAL host-collaborator seam (the same shape bootstrap
// wires): user prefs/token from the UserStore, personality/brand resolved the core way.
function makeAdvisor(opts: { allowed: string[]; spawnFails?: boolean }) {
  const db = openDb(':memory:');
  const users = new UserStore(db);
  const u = users.create('amy', 'pw'); // first user → admin (fine; exec gate still bounded by config)
  const config = new ConfigStore(db);
  config.update({ allowedExecs: opts.allowed });
  const tmux = new FakeTmuxDriver();
  const spawnCalls: { agentName: string; extraEnv?: Record<string, string>; rawPrompt?: string; mcpUrl?: string }[] = [];
  const spawn = {
    launch: async (input: { agentName: string; projectPath: string; extraEnv?: Record<string, string>; rawPrompt?: string; mcpUrl?: string }) => {
      if (opts.spawnFails) throw new Error('tmux: failed to create session');
      spawnCalls.push({ agentName: input.agentName, extraEnv: input.extraEnv, rawPrompt: input.rawPrompt, mcpUrl: input.mcpUrl });
      await tmux.spawn(`elowen-${input.agentName}`, { cwd: input.projectPath, command: '' });
      return { session: `elowen-${input.agentName}` };
    },
  };
  const svc = new AdvisorService({
    spawn: () => spawn as never, tmux,
    host: {
      users: {
        get: (id) => {
          const row = users.get(id);
          return row ? { name: row.name, username: row.username, isAdmin: row.is_admin, allowedExecs: row.allowed_execs, advisorExec: row.advisor_exec ?? '', advisorAutostart: row.advisor_autostart ?? false } : null;
        },
        setExec: (id, exec) => { users.setAdvisorExec(id, exec); },
        setAutostart: (id, on) => { users.setAdvisorAutostart(id, on); },
        ensureToken: (id) => users.ensureAdvisorToken(id),
      },
      dir: () => '/tmp/advisor',
      personality: () => personalityText(''),
      brand: () => resolveBrand(config.get(), null, null),
    },
    config: config as unknown as PluginHostConfig,
    prompts: { render: (n, v) => render(n, v ?? {}), rawTemplate: () => '' },
    fallback: { program: 'claude-code', model: 'sonnet' },
    url: 'http://localhost:4400',
    mcpUrl: 'http://localhost:4400/mcp',
    prepareMcp: () => {}, // no FS writes in the unit test
  });
  return { svc, spawnCalls, users, u, tmux, config };
}

describe('AdvisorService (agents plugin)', () => {
  it('start spawns elowen-advisor-<id>, persists exec, is idempotent', async () => {
    const { svc, spawnCalls, users, u } = makeAdvisor({ allowed: ['sonnet'] });
    const r = await svc.start(u.id, 'sonnet');
    expect(r.session).toBe(`elowen-advisor-${u.id}`);
    expect(users.get(u.id)?.advisor_exec).toBe('sonnet');
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].agentName).toBe(`advisor-${u.id}`);
    expect(spawnCalls[0].extraEnv?.ELOWEN_TOKEN).toBeTruthy(); // full advisor token injected
    expect(spawnCalls[0].mcpUrl).toBe('http://localhost:4400/mcp'); // MCP server URL passed for codex `-c` wiring
    await svc.start(u.id, 'sonnet'); // already live
    expect(spawnCalls).toHaveLength(1); // not respawned
  });

  it('substitutes the configured agentName into the advisor prompt', async () => {
    const { svc, spawnCalls, u, config } = makeAdvisor({ allowed: ['sonnet'] });
    config.update({ brain: { agentName: 'Jarvis' } });
    await svc.start(u.id, 'sonnet');
    const prompt = spawnCalls[0].rawPrompt ?? '';
    expect(prompt).toContain('<name>Jarvis</name>');
    expect(prompt).not.toContain('{{agentName}}'); // token fully resolved
  });

  it('rejects an exec not in the allow-list', async () => {
    const { svc, u } = makeAdvisor({ allowed: ['sonnet'] });
    await expect(svc.start(u.id, 'opus')).rejects.toThrow(/not allowed/);
  });

  it('propagates a spawn/tmux failure (the route maps it to 500, not 403)', async () => {
    const { svc, u } = makeAdvisor({ allowed: ['sonnet'], spawnFails: true });
    await expect(svc.start(u.id, 'sonnet')).rejects.toThrow(/failed to create session/);
  });

  it('status reflects running state, remembered exec and autostart', async () => {
    const { svc, u } = makeAdvisor({ allowed: ['sonnet'] });
    expect(await svc.status(u.id)).toEqual({ running: false, exec: '', session: null, autostart: true });
    await svc.start(u.id, 'sonnet');
    expect(await svc.status(u.id)).toEqual({ running: true, exec: 'sonnet', session: `elowen-advisor-${u.id}`, autostart: true });
  });

  it('stop kills the session, keeps the exec, and turns autostart OFF (stays off)', async () => {
    const { svc, users, u } = makeAdvisor({ allowed: ['sonnet'] });
    await svc.start(u.id, 'sonnet');
    await svc.stop(u.id);
    const s = await svc.status(u.id);
    expect(s.running).toBe(false);
    expect(s.exec).toBe('sonnet'); // remembered for a future explicit start
    expect(s.autostart).toBe(false); // explicit stop means "don't bring it back on login"
    expect(users.get(u.id)?.advisor_autostart).toBe(false);
  });

  it('start (re-)enables autostart so a later login brings the advisor back', async () => {
    const { svc, users, u } = makeAdvisor({ allowed: ['sonnet'] });
    await svc.start(u.id, 'sonnet');
    await svc.stop(u.id); // autostart off
    expect(users.get(u.id)?.advisor_autostart).toBe(false);
    await svc.start(u.id, 'sonnet'); // explicit restart re-arms autostart
    expect(users.get(u.id)?.advisor_autostart).toBe(true);
  });

  it('ensureOnLogin does not restart after an explicit stop (the auto-enable bug)', async () => {
    const { svc, spawnCalls, users, u } = makeAdvisor({ allowed: ['sonnet'] });
    await svc.ensureOnLogin(u.id);
    expect(spawnCalls).toHaveLength(0); // no remembered exec yet
    users.setAdvisorExec(u.id, 'sonnet');
    await svc.ensureOnLogin(u.id);
    expect(spawnCalls).toHaveLength(1);
    await svc.stop(u.id); // stop alone must disable autostart now
    await svc.ensureOnLogin(u.id);
    expect(spawnCalls).toHaveLength(1); // not restarted — stop stuck
  });
});

// ---- from tests/plugins/agents/skillService.test.ts ----

const MASTER_V2 = `---\nname: elowen-workflow\ndescription: test\nmetadata:\n  version: 2\n---\n\nbody\n`;
const target = (home: string, root: string) => join(home, root, 'skills', 'elowen-workflow', 'SKILL.md');

describe('skillService', () => {
  let home: string;
  // Empty env so the provider config-dir overrides don't leak in from the test runner's environment.
  const svc = () => createSkillService({ home, env: {}, readMaster: () => MASTER_V2 });

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'elowen-skill-'));
    // claude-code + codex are "present" (config root exists); opencode is absent.
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(home, '.codex'), { recursive: true });
  });
  afterEach(() => { rmSync(home, { recursive: true, force: true }); });

  it('reports present providers as not-installed before install', () => {
    const byId = Object.fromEntries(svc().status().map((s) => [s.provider, s]));
    expect(byId['claude-code']).toMatchObject({ present: true, installed: false, upToDate: false });
    expect(byId['codex']).toMatchObject({ present: true, installed: false });
    expect(byId['opencode']).toMatchObject({ present: false, installed: false });
  });

  it('installs into present providers and skips absent ones', () => {
    const results = Object.fromEntries(svc().installAll().map((r) => [r.provider, r]));
    expect(results['claude-code']).toMatchObject({ installed: true, skipped: false });
    expect(results['codex']).toMatchObject({ installed: true, skipped: false });
    expect(results['opencode']).toMatchObject({ installed: false, skipped: true });
    expect(existsSync(target(home, '.claude'))).toBe(true);
    expect(existsSync(target(home, '.codex'))).toBe(true);
    expect(existsSync(target(home, '.config/opencode'))).toBe(false);
    // status now reflects up-to-date for the present providers.
    const byId = Object.fromEntries(svc().status().map((s) => [s.provider, s]));
    expect(byId['claude-code']).toMatchObject({ installed: true, version: 2, upToDate: true });
    expect(byId['codex']).toMatchObject({ installed: true, version: 2, upToDate: true });
  });

  it('is idempotent — re-install leaves the same content', () => {
    svc().installAll();
    const first = readFileSync(target(home, '.claude'), 'utf-8');
    svc().installAll();
    expect(readFileSync(target(home, '.claude'), 'utf-8')).toBe(first);
    expect(first).toBe(MASTER_V2);
  });

  it('detects an outdated install and refreshes it on install', () => {
    // Pre-seed an old version (1) into claude-code's skills dir.
    const t = target(home, '.claude');
    mkdirSync(join(home, '.claude', 'skills', 'elowen-workflow'), { recursive: true });
    writeFileSync(t, MASTER_V2.replace('version: 2', 'version: 1'), 'utf-8');
    const before = svc().status().find((s) => s.provider === 'claude-code')!;
    expect(before).toMatchObject({ installed: true, version: 1, upToDate: false });
    svc().installAll();
    const after = svc().status().find((s) => s.provider === 'claude-code')!;
    expect(after).toMatchObject({ version: 2, upToDate: true });
  });

  it('never touches a foreign skill in the same providers dir', () => {
    const foreign = join(home, '.claude', 'skills', 'other', 'SKILL.md');
    mkdirSync(join(home, '.claude', 'skills', 'other'), { recursive: true });
    writeFileSync(foreign, 'do not touch', 'utf-8');
    svc().installAll();
    expect(readFileSync(foreign, 'utf-8')).toBe('do not touch');
  });

  it('honours provider config-dir env overrides for status + install', () => {
    // Relocate codex and opencode away from the HOME-relative defaults; claude-code stays default.
    const codexHome = join(home, 'xdg-codex');
    const xdgHome = join(home, 'xdg-config');
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(join(xdgHome, 'opencode'), { recursive: true });
    const svc2 = () => createSkillService({ home, env: { CODEX_HOME: codexHome, XDG_CONFIG_HOME: xdgHome }, readMaster: () => MASTER_V2 });

    const before = Object.fromEntries(svc2().status().map((s) => [s.provider, s]));
    expect(before['codex']).toMatchObject({ present: true, installed: false });
    expect(before['opencode']).toMatchObject({ present: true, installed: false });

    svc2().installAll();
    // Written under the overridden dirs, NOT the HOME-relative defaults.
    expect(existsSync(join(codexHome, 'skills', 'elowen-workflow', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(xdgHome, 'opencode', 'skills', 'elowen-workflow', 'SKILL.md'))).toBe(true);
    expect(existsSync(target(home, '.codex'))).toBe(false);
    expect(existsSync(target(home, '.config/opencode'))).toBe(false);

    const after = Object.fromEntries(svc2().status().map((s) => [s.provider, s]));
    expect(after['codex']).toMatchObject({ installed: true, version: 2, upToDate: true });
    expect(after['opencode']).toMatchObject({ installed: true, version: 2, upToDate: true });
  });

  it('fails soft for every provider when the master is unreadable', () => {
    const broken = createSkillService({ home, readMaster: () => { throw new Error('boom'); } });
    const results = broken.installAll();
    expect(results.every((r) => !r.installed)).toBe(true);
    expect(existsSync(target(home, '.claude'))).toBe(false);
  });

  it('parses the version from a CRLF master and a CRLF installed copy', () => {
    const CRLF_MASTER = '---\r\nname: elowen-workflow\r\ndescription: test\r\nmetadata:\r\n  version: 3\r\n---\r\n\r\nbody\r\n';
    const crlf = () => createSkillService({ home, env: {}, readMaster: () => CRLF_MASTER });
    crlf().installAll();
    const byId = Object.fromEntries(crlf().status().map((s) => [s.provider, s]));
    expect(byId['claude-code']).toMatchObject({ installed: true, version: 3, upToDate: true });
  });
});

// ---- from tests/plugins/agents/askService.test.ts ----

/** Minimal deps for the ask exchange: a task under an active mission, a parked overseer (overseerExec
 *  set), an in-memory event recorder doubling as the message-history source. */
function setup(opts: { overseerExec?: string; mission?: boolean; askHistoryTurns?: number } = {}) {
  const recorded: { type: string; taskId: string; role: string; text: string }[] = [];
  const dq = new DecisionQueue();
  const d = {
    tasks: { get: (id: string) => (id === 't1' ? { id, parent_id: 'e1' } : undefined) },
    missions: { activeForEpic: (epicId: string) => (opts.mission === false ? null : (epicId === 'e1' ? { id: 'm-e1', epic_id: 'e1' } : null)) },
    config: { get: () => ({ brain: { limits: { askHistoryTurns: opts.askHistoryTurns ?? 30 } } }) },
    pluginConfig: () => ({ overseerExec: opts.overseerExec ?? 'sonnet' }),
    now: () => 1000,
    publishEvent: (e: { type: string; taskId: string; role: string; text: string }) => { if (e.type === 'message') recorded.push(e); },
    eventsRead: { list: (q: { target?: string }) => recorded.filter((e) => e.taskId === q.target).map((e) => ({ detail: JSON.stringify({ role: e.role, text: e.text }) })) },
    decisionQueue: dq,
  } as never;
  return { svc: createAskService(d), dq, recorded };
}

describe('askService', () => {
  it('routes the question to the parked overseer and returns its reply, recording both turns', async () => {
    const { svc, dq, recorded } = setup();
    const { askId } = svc.start('t1', 'A or B?');
    const req = await dq.next('m-e1');
    expect(req!.kind).toBe('message');
    expect(req!.context).toMatchObject({ question: 'A or B?', taskId: 't1' });
    // The overseer is handed the whole thread (its last entry is the just-asked question).
    expect((req!.context.history as { role: string; text: string }[]).at(-1)).toMatchObject({ role: 'agent', text: 'A or B?' });
    dq.resolve('m-e1', req!.id, { approve: false, confidence: 0, rationale: '', message: 'use A' });
    await expect(svc.poll(askId, 1000)).resolves.toBe('use A');
    expect(recorded.map((e) => [e.role, e.text])).toEqual([['agent', 'A or B?'], ['autopilot', 'use A']]);
  });

  it('hands the overseer the MOST RECENT turns (the just-asked question is always included)', async () => {
    const { svc, dq, recorded } = setup();
    // Pre-load a long backlog so a naive oldest-first cap would drop the new question.
    for (let i = 0; i < 40; i++) recorded.push({ type: 'message', taskId: 't1', role: 'agent', text: `old ${i}` });
    const { askId } = svc.start('t1', 'the latest question');
    const req = await dq.next('m-e1');
    const hist = req!.context.history as { role: string; text: string }[];
    expect(hist.length).toBeLessThanOrEqual(30); // bounded
    expect(hist.at(-1)).toMatchObject({ role: 'agent', text: 'the latest question' }); // newest kept, not dropped
    expect(hist.some((h) => h.text === 'old 0')).toBe(false); // the oldest backlog fell out of the window
    dq.resolve('m-e1', req!.id, { approve: false, confidence: 0, rationale: '', message: 'ok' });
    await svc.poll(askId, 1000);
  });

  // The window is an operator setting (Settings → Elowen AI → Limits), not a constant: the service must
  // read the CONFIGURED value, and still keep the just-asked question as the last entry.
  it('sizes the overseer context to the CONFIGURED window', async () => {
    const { svc, dq, recorded } = setup({ askHistoryTurns: 5 });
    for (let i = 0; i < 40; i++) recorded.push({ type: 'message', taskId: 't1', role: 'agent', text: `old ${i}` });
    const { askId } = svc.start('t1', 'the latest question');
    const req = await dq.next('m-e1');
    const hist = req!.context.history as { role: string; text: string }[];
    expect(hist).toHaveLength(5);
    expect(hist.at(-1)).toMatchObject({ text: 'the latest question' });
    expect(hist.at(0)).toMatchObject({ text: 'old 36' }); // exactly the newest five, oldest-first
    dq.resolve('m-e1', req!.id, { approve: false, confidence: 0, rationale: '', message: 'ok' });
    await svc.poll(askId, 1000);
  });

  it('opens a human window when the overseer escalates, and delivers a human reply', async () => {
    const { svc, dq, recorded } = setup();
    const { askId } = svc.start('t1', '?');
    const req = await dq.next('m-e1');
    dq.resolve('m-e1', req!.id, { approve: false, confidence: 0, rationale: 'needs a human' }); // no message ⇒ escalate
    await new Promise((r) => setTimeout(r, 0)); // let resolveExchange open the window
    expect(svc.reply(askId, 'go with A')).toBe(true);
    await expect(svc.poll(askId, 1000)).resolves.toBe('go with A');
    expect(recorded.at(-1)).toMatchObject({ role: 'human', text: 'go with A' });
  });

  it('escalates to a human and STAYS pending — never auto-proceeds — when no overseer can answer', async () => {
    const { svc } = setup({ mission: false }); // no mission ⇒ straight to the human escalation
    const { askId } = svc.start('t1', 'which one?');
    await new Promise((r) => setTimeout(r, 0)); // let resolveExchange escalate
    expect(svc.pending()).toEqual([{ askId, taskId: 't1', question: 'which one?', since: 1000 }]);
    // it does not settle on its own — only a human reply resolves it, and then it clears
    expect(svc.reply(askId, 'this one')).toBe(true);
    await expect(svc.poll(askId, 1000)).resolves.toBe('this one');
    expect(svc.pending()).toEqual([]);
  });

  it('rejects a reply once the exchange is already answered', async () => {
    const { svc, dq } = setup();
    const { askId } = svc.start('t1', '?');
    const req = await dq.next('m-e1');
    dq.resolve('m-e1', req!.id, { approve: false, confidence: 0, rationale: '', message: 'done' });
    await svc.poll(askId, 1000);
    expect(svc.reply(askId, 'late')).toBe(false);
  });

  it('unblocks with the sentinel when polled with an unknown ask id', async () => {
    await expect(setup().svc.poll('nope', 10)).resolves.toBe(ASK_SENTINEL);
  });
});
