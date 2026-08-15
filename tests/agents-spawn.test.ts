// @vitest-environment node
// Re-homed from the Elowen package with the agents plugin: tests/plugins/agents/spawn/spawn.test.ts,
// tests/plugins/agents/spawn/commandBuilder.test.ts, tests/plugins/agents/spawn/resume/providers.test.ts.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { render, setPluginPromptSources } from 'elowen/dist/prompts/index.js';
import { FakeTmuxDriver } from 'elowen/dist/tmux/fakeDriver.js';
import { SpawnService } from '../plugins/agents/dist/spawn/spawn.js';
import { AgentStore } from '../plugins/agents/dist/store/agentStore.js';
import { AGENTS_PROMPTS, AGENTS_PROMPTS_DIR } from '../plugins/agents/dist/promptCatalog.js';
import { buildAgentCommand as buildRaw, type AgentSpec, type SpawnCtx, type RenderPrompt } from '../plugins/agents/dist/spawn/commandBuilder.js';
import { parseResumeLabel, resumeProviderFor } from '../plugins/agents/dist/spawn/resume/index.js';
import { claudeResume } from '../plugins/agents/dist/spawn/resume/claude.js';
import { codexResume } from '../plugins/agents/dist/spawn/resume/codex.js';
import { opencodeResume } from '../plugins/agents/dist/spawn/resume/opencode.js';
import { kiloResume } from '../plugins/agents/dist/spawn/resume/kilo.js';
import { piResume } from '../plugins/agents/dist/spawn/resume/pi.js';
import { ompResume } from '../plugins/agents/dist/spawn/resume/omp.js';
import { openAgentsDb } from './helpers/pluginTablesDb.js';

// The worker/guide templates are PLUGIN-owned (plugins/agents/prompts), so the daemon's file renderer
// cannot resolve them on its own — production installs the plugin overlay right after loading the
// plugin. These suites hand the bare core renderer in as the host prompt seam, so they install the same
// overlay here. (The Elowen package did it once for every suite in tests/setup/pluginPromptOverlay.ts;
// this repo's vitest setup is the UI one and carries no equivalent.)
setPluginPromptSources(new Map(AGENTS_PROMPTS.map((p: { name: string }) => [p.name, join(AGENTS_PROMPTS_DIR, `${p.name}.md`)])));

// ---- from tests/plugins/agents/spawn/spawn.test.ts ----

// The plugin SpawnService REQUIRES the host prompt seam (no file-render fallback). The core file
// renderer stands in — the exact default the pre-extraction core service used.
const prompts = { render: (n: string, v?: Record<string, string>) => render(n, v), rawTemplate: () => '' };

describe('SpawnService', () => {
  it('registers the agent and spawns an elowen- session', async () => {
    const db = openAgentsDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, prompts });
    const { session } = await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'SwiftLake', spec: { program: 'opencode', model: 'ollama-cloud/deepseek-v4-flash' } });
    expect(session).toBe('elowen-SwiftLake');
    expect(await tmux.list()).toContain('elowen-SwiftLake');
    expect(agents.programFor('SwiftLake')).toBe('opencode');
  });

  it('delivers ELOWEN_URL/TOKEN/TASK as tmux session env, never as an `export` in the pane command', async () => {
    const db = openAgentsDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, prompts, elowen: { cli: 'elowen', url: 'http://localhost:4400', token: 's3cr3t-tok' } });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-7', agentName: 'Nova', spec: { program: 'opencode', model: 'm' } });
    // Env reaches the process out-of-band (tmux -e), so the worker can run `elowen ask`/`close`…
    expect(tmux.spawnEnvFor('elowen-Nova')).toMatchObject({ ELOWEN_URL: 'http://localhost:4400', ELOWEN_TOKEN: 's3cr3t-tok', ELOWEN_TASK: 'elowen-7' });
    // …but the token (and any env) is NEVER typed into the pane, where capturePane could surface it (N1).
    expect(tmux.commandFor('elowen-Nova')).not.toContain('export ELOWEN_');
    expect(tmux.commandFor('elowen-Nova')).not.toContain('s3cr3t-tok');
  });

  it('hands a worker the token minted for ITS task, and a reasoning agent the shared one', async () => {
    const db = openAgentsDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    // Only real task ids bind; an overseer/pilot id has no task row, so the resolver returns undefined.
    const tokenForTask = (taskId: string) => taskId === 'elowen-7' ? 'tok-for-7' : undefined;
    const svc = new SpawnService({ tmux, agents, prompts, elowen: { cli: 'elowen', url: 'http://x', token: 'shared-tok', tokenForTask } });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-7', agentName: 'Nova', spec: { program: 'opencode', model: 'm' } });
    expect(tmux.spawnEnvFor('elowen-Nova')?.ELOWEN_TOKEN).toBe('tok-for-7');
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'overseer-m1', agentName: 'overseer-m1', spec: { program: 'claude-code', model: 'opus' }, rawPrompt: 'WATCH' });
    expect(tmux.spawnEnvFor('elowen-overseer-m1')?.ELOWEN_TOKEN).toBe('shared-tok');
  });

  it('merges caller extraEnv into the tmux session env (reasoning agents: ELOWEN_PLAN_JOB etc.)', async () => {
    const db = openAgentsDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, prompts, elowen: { cli: 'elowen', url: 'http://x', token: 'tok' } });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'pj-1', agentName: 'Pilot', spec: { program: 'claude-code', model: 'opus' }, rawPrompt: 'PLAN', extraEnv: { ELOWEN_PLAN_JOB: 'pj-1' } });
    expect(tmux.spawnEnvFor('elowen-Pilot')?.ELOWEN_PLAN_JOB).toBe('pj-1');
  });

  it('scrubs the token from a tmux spawn failure and re-throws a sanitized error', async () => {
    const db = openAgentsDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    tmux.failSpawn = true; // a real tmux failure embeds `-e ELOWEN_TOKEN=<token>` in its error message
    const svc = new SpawnService({ tmux, agents, prompts, elowen: { cli: 'elowen', url: 'http://x', token: 'sup3r-s3cret' } });
    await expect(svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'opencode', model: 'm' } }))
      .rejects.toThrow(/agent spawn failed/);
    await expect(svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'opencode', model: 'm' } }))
      .rejects.not.toThrow(/sup3r-s3cret/); // the raw token never rides out in the thrown error
  });

  it('applies the provider resolver binary + args to the spawned command', async () => {
    const db = openAgentsDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, prompts, providers: (program) => program === 'opencode' ? { bin: '/usr/bin/oc', args: '--pure' } : undefined });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'opencode', model: 'm' } });
    expect(tmux.commandFor('elowen-Nova')).toContain("/usr/bin/oc --model 'm' --pure --prompt");
  });

  it('resumes the prior session when its program matches the spawn', async () => {
    const db = openAgentsDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, prompts });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' }, resume: { program: 'claude-code', sessionId: 'sess-7' } });
    expect(tmux.commandFor('elowen-Nova')).toContain("--resume 'sess-7'");
  });

  it('ignores a resume whose program no longer matches the task exec (cold start)', async () => {
    const db = openAgentsDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, prompts });
    // recorded a claude session, but the operator switched the task's exec to codex since
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'codex', model: 'gpt-5.5' }, resume: { program: 'claude-code', sessionId: 'sess-7' } });
    expect(tmux.commandFor('elowen-Nova')).not.toContain('resume');
  });

  it('ignores resume when the provider has it disabled', async () => {
    const db = openAgentsDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, prompts, providers: () => ({ resume: false }) });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' }, resume: { program: 'claude-code', sessionId: 'sess-7' } });
    expect(tmux.commandFor('elowen-Nova')).not.toContain('--resume');
  });
});

describe('SpawnService elowen seam', () => {
  const mk = () => {
    const db = openAgentsDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    return { agents: new AgentStore(db), tmux: new FakeTmuxDriver() };
  };

  it('routes program elowen to the brain worker — tmux never spawns', async () => {
    const { agents, tmux } = mk();
    const launched: unknown[] = [];
    const svc = new SpawnService({ tmux, agents, prompts, brainWorker: { launch: async (i) => { launched.push(i); return { session: `elowen-${i.agentName}` }; } } });
    const res = await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'T-1', agentName: 'a9', spec: { program: 'elowen', model: 'relay/kimi' } });
    expect(res.session).toBe('elowen-a9');
    expect(launched).toHaveLength(1);
    expect(await tmux.list()).toEqual([]);
    expect(agents.programFor('a9')).toBe('elowen');
  });

  it('throws clearly when no brain worker is wired or a rawPrompt caller asks for elowen', async () => {
    const { agents, tmux } = mk();
    await expect(new SpawnService({ tmux, agents, prompts }).launch({ projectId: 1, projectPath: '/o', taskId: 't', agentName: 'a', spec: { program: 'elowen', model: 'm' } }))
      .rejects.toThrow(/not available/);
    const withWorker = new SpawnService({ tmux, agents, prompts, brainWorker: { launch: async () => ({ session: 's' }) } });
    await expect(withWorker.launch({ projectId: 1, projectPath: '/o', taskId: 't', agentName: 'a', spec: { program: 'elowen', model: 'm' }, rawPrompt: 'PILOT' }))
      .rejects.toThrow(/raw prompt/i);
  });

  it('resolves the global tddMode() resolver into a CLI worker preamble', async () => {
    const { agents, tmux } = mk();
    const svc = new SpawnService({ tmux, agents, prompts, tddMode: () => true });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' } });
    expect(tmux.commandFor('elowen-Nova')).toContain('Test-Driven Development');
  });

  it('omits the TDD directive when the resolver returns false (default)', async () => {
    const { agents, tmux } = mk();
    const svc = new SpawnService({ tmux, agents, prompts, tddMode: () => false });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' } });
    expect(tmux.commandFor('elowen-Nova')).not.toContain('Test-Driven Development');
  });

  it('threads the resolved tddMode into the brain worker launch input for an elowen: spec', async () => {
    const { agents, tmux } = mk();
    const launched: { tddMode?: boolean }[] = [];
    const svc = new SpawnService({ tmux, agents, prompts, tddMode: () => true, brainWorker: { launch: async (i) => { launched.push(i); return { session: `elowen-${i.agentName}` }; } } });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'T-1', agentName: 'a9', spec: { program: 'elowen', model: 'relay/kimi' } });
    expect(launched[0].tddMode).toBe(true);
  });

  it('lets an explicit per-call tddMode override the global resolver', async () => {
    const { agents, tmux } = mk();
    const svc = new SpawnService({ tmux, agents, prompts, tddMode: () => false });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' }, tddMode: true });
    expect(tmux.commandFor('elowen-Nova')).toContain('Test-Driven Development');
  });
});

// ---- from tests/plugins/agents/spawn/commandBuilder.test.ts ----

// The plugin's builder takes the renderer as a REQUIRED seam (ctx.host.prompts in production). These
// tests exercise the command shape, so the core file-template renderer stands in — the same default
// the pre-extraction core builder used.
const buildAgentCommand = (spec: AgentSpec, ctx: SpawnCtx, renderPrompt: RenderPrompt = render) => buildRaw(spec, ctx, renderPrompt);

describe('buildAgentCommand', () => {
  it('routes a provider/model to the interactive `opencode` TUI with --prompt', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'ollama-cloud/deepseek-v4-flash' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
    expect(cmd).toContain("--model 'ollama-cloud/deepseek-v4-flash'"); // single-quoted so it can't break the shell
    expect(cmd).toContain('--prompt'); // UI mode: task preloaded into the composer
    expect(cmd).not.toContain('opencode run'); // not headless
  });
  it('bypasses opencode permission prompts by default via a merged OPENCODE_CONFIG_CONTENT env', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
    expect(cmd).toContain('export OPENCODE_CONFIG_CONTENT=');
    expect(cmd).toContain('"permission":"allow"');
  });
  it('omits the opencode permission bypass when skipPermissions is off', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', skipPermissions: false });
    expect(cmd).not.toContain('OPENCODE_CONFIG_CONTENT');
    expect(cmd).toContain('--prompt'); // still launches normally, just with prompts on
  });
  it('routes a bare model to claude with an autonomous approval bypass', () => {
    const cmd = buildAgentCommand({ program: 'claude-code', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
    expect(cmd).toContain("--model 'sonnet'");
    expect(cmd).toContain('--dangerously-skip-permissions');
  });
  it('omits the claude bypass flag when skipPermissions is off', () => {
    const cmd = buildAgentCommand({ program: 'claude-code', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', skipPermissions: false });
    expect(cmd).not.toContain('--dangerously-skip-permissions');
    expect(cmd).toContain("--model 'sonnet'");
  });
  it('routes codex with a positional prompt and autonomous approval bypass', () => {
    const cmd = buildAgentCommand({ program: 'codex', model: 'gpt-5.4' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
    expect(cmd).toContain('codex');
    expect(cmd).toContain("--model 'gpt-5.4'");
    expect(cmd).toContain('--dangerously-bypass-approvals-and-sandbox');
  });
  it('omits the codex bypass flag when skipPermissions is off', () => {
    const cmd = buildAgentCommand({ program: 'codex', model: 'gpt-5.4' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', skipPermissions: false });
    expect(cmd).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(cmd).toContain("--model 'gpt-5.4'");
  });
  it('wires the elowen MCP server into codex via `-c` flags when mcpUrl is set (codex ignores project-local config)', () => {
    const cmd = buildAgentCommand({ program: 'codex', model: 'gpt-5.4' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', mcpUrl: 'http://localhost:4600/mcp' });
    expect(cmd).toContain("-c 'mcp_servers.elowen.url=\"http://localhost:4600/mcp\"'"); // url override, shell-escaped
    expect(cmd).toContain("-c 'mcp_servers.elowen.bearer_token_env_var=\"ELOWEN_TOKEN\"'"); // token read from env, not the command line
    expect(cmd).toContain("--model 'gpt-5.4'"); // MCP flags precede --model, before the positional prompt
  });
  it('omits the codex MCP flags when no mcpUrl is set (workers get no MCP wiring)', () => {
    const cmd = buildAgentCommand({ program: 'codex', model: 'gpt-5.4' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
    expect(cmd).not.toContain('mcp_servers.elowen');
  });
  it('single-quotes the model so shell metacharacters cannot break out of the command (injection defense)', () => {
    // The model field can carry a task-supplied `exec:` value. Even if a bad value slips past the API
    // allow-list, single-quoting must neutralize it — the payload stays one literal --model argument.
    const evil = 'sonnet; touch /tmp/pwned #';
    const cmd = buildAgentCommand({ program: 'claude-code', model: evil }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
    expect(cmd).toContain("--model 'sonnet; touch /tmp/pwned #'"); // wrapped, not interpolated raw
    expect(cmd).not.toContain('--model sonnet; touch'); // the `;` never reaches the shell as a separator
  });
  it('embeds the close command in the prompt but never exports env into the pane command (delivered via tmux -e)', () => {
    const cmd = buildAgentCommand(
      { program: 'opencode', model: 'm' },
      { projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', closeCommand: 'node /x/cli.js close elowen-1' },
    );
    expect(cmd).toContain('node /x/cli.js close elowen-1');
    // The agent's env (incl. its token) is injected as tmux session env by the spawn layer, so the typed
    // pane command must carry NO `export ELOWEN_*` line — that would leak the token into the scrollback.
    expect(cmd).not.toContain('export ELOWEN_');
  });
  it('defaults the close command to `elowen close <id>` when none is given', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-9', agentName: 'A' });
    expect(cmd).toContain('elowen close elowen-9');
  });
  it('injects the task title and description into the agent prompt', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', taskTitle: 'Add CSV export', taskDescription: 'Use a button on the reports page' });
    expect(cmd).toContain('Add CSV export');
    expect(cmd).toContain('Use a button on the reports page');
  });
  it('uses the configured provider binary and extra args', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', bin: '/opt/oc/opencode', extraArgs: '--pure' });
    expect(cmd).toContain("/opt/oc/opencode --model 'm' --pure --prompt ");
  });
  it('frames a phase preamble as one phase of its mission and points it at `<cli> help`', () => {
    const cmd = buildAgentCommand(
      { program: 'opencode', model: 'm' },
      { projectPath: '/o', taskId: 'elowen-2', agentName: 'A', epicId: 'elowen-epic', cli: 'node /x/cli.js' },
    );
    expect(cmd).toContain('ONE phase of mission elowen-epic');
    expect(cmd).toContain('node /x/cli.js help'); // the full control guide (incl. epic close) is fetched on demand
  });
  it('keeps the epic-close detail OUT of the preamble — it lives in the on-demand guide', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-2', agentName: 'A', epicId: 'elowen-epic' });
    expect(cmd).not.toContain('close the epic yourself'); // moved to agent-guide-phase, not the spawn message
  });
  it('gives a standalone task no mission-phase framing', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
    expect(cmd).not.toContain('ONE phase of mission');
  });
  it('renders a resume note as its own "new input" block, separate from the task details', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', taskDescription: 'Original brief', resumeNote: 'Review rejected: fix the failing test' });
    expect(cmd).toContain('Original brief');                     // static details still present
    expect(cmd).toContain('New input for this run');             // dedicated block header
    expect(cmd).toContain('Review rejected: fix the failing test');
  });
  it('omits the resume-note block entirely on a clean first run (no note)', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', taskDescription: 'Original brief' });
    expect(cmd).not.toContain('New input for this run');
  });
  it('renders the resume note in the phase template too (epicId set)', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-2', agentName: 'A', epicId: 'elowen-epic', resumeNote: 'Review rejected: add the missing test' });
    expect(cmd).toContain('ONE phase of mission elowen-epic'); // confirms the worker-phase template
    expect(cmd).toContain('New input for this run');
    expect(cmd).toContain('Review rejected: add the missing test');
  });
  it('renders the resume note in the resume template too (reattached session)', () => {
    const cmd = buildAgentCommand({ program: 'claude-code', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', resume: { program: 'claude-code', sessionId: 's1' }, resumeNote: 'Stalled and relaunched — re-check state' });
    expect(cmd).toContain('resuming your earlier session'); // confirms the worker-resume template
    expect(cmd).toContain('New input for this run');
    expect(cmd).toContain('Stalled and relaunched — re-check state');
  });
  it('points a cold worker at the on-demand control guide (`<cli> help`) instead of inlining the tutorial', () => {
    const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', cli: 'node /x/cli.js' });
    expect(cmd).toContain('node /x/cli.js help'); // bootstrap pointer to the guide
    expect(cmd).not.toContain('1200000 ms'); // the long-timeout tip now lives in the guide, not the preamble
    expect(cmd).toContain('Work only inside your current working directory'); // the safety floor stays inline
  });
  it('uses rawPrompt verbatim and skips the worker preamble (reasoning agents)', () => {
    const cmd = buildAgentCommand(
      { program: 'claude-code', model: 'opus' },
      { projectPath: '/repo', taskId: 'pj-1', agentName: 'Pilot', rawPrompt: 'PLAN ONLY: do not implement' },
    );
    expect(cmd).toContain("--model 'opus'");
    expect(cmd).toContain("'PLAN ONLY: do not implement'");
    expect(cmd).not.toContain('elowen close'); // no close-command preamble for reasoning agents
    expect(cmd).not.toContain('1200000 ms'); // reasoning agents bypass the worker preamble
  });

  describe('TDD mission mode', () => {
    it('injects the TDD directive into the cold worker preamble when tddMode is on', () => {
      const cmd = buildAgentCommand({ program: 'claude-code', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', tddMode: true });
      expect(cmd).toContain('Test-Driven Development');
      expect(cmd).toContain('confirm it FAILS'); // the failing-test-first rule
    });
    it('omits the TDD directive when tddMode is off or unset', () => {
      const off = buildAgentCommand({ program: 'claude-code', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', tddMode: false });
      const unset = buildAgentCommand({ program: 'claude-code', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
      expect(off).not.toContain('Test-Driven Development');
      expect(unset).not.toContain('Test-Driven Development');
      expect(unset).not.toContain('{{tddDirective}}'); // placeholder always substituted, never leaks raw
    });
    it('injects the TDD directive into the phase template too (epicId set)', () => {
      const cmd = buildAgentCommand({ program: 'opencode', model: 'm' }, { projectPath: '/o', taskId: 'elowen-2', agentName: 'A', epicId: 'elowen-epic', tddMode: true });
      expect(cmd).toContain('ONE phase of mission elowen-epic'); // confirms the worker-phase template
      expect(cmd).toContain('Test-Driven Development');
    });
    it('injects the TDD directive into the resume template too (reattached session)', () => {
      const cmd = buildAgentCommand({ program: 'claude-code', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', resume: { program: 'claude-code', sessionId: 's1' }, tddMode: true });
      expect(cmd).toContain('resuming your earlier session'); // confirms the worker-resume template
      expect(cmd).toContain('Test-Driven Development');
    });
  });

  describe('new agent CLIs', () => {
    it('routes kilo to the interactive TUI with a --prompt flag and no command-line bypass (7.x)', () => {
      const cmd = buildAgentCommand({ program: 'kilo', model: 'anthropic/claude-sonnet-4-5' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
      expect(cmd).toContain("kilo --model 'anthropic/claude-sonnet-4-5'");
      expect(cmd).toContain('--prompt '); // 7.x delivers the task via --prompt, not a positional
      expect(cmd).not.toContain('kilo run'); // interactive TUI, not a one-shot subcommand
      expect(cmd).not.toContain('--yolo'); // gone in 7.x — auto-approval is config-driven
      expect(cmd).not.toContain('--nosplash'); // gone in 7.x
    });
    it('does not change the kilo command when skipPermissions is toggled off (the toggle is a no-op for kilo 7.x)', () => {
      const on = buildAgentCommand({ program: 'kilo', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
      const off = buildAgentCommand({ program: 'kilo', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', skipPermissions: false });
      expect(off).toEqual(on);
    });
    it('routes pi to the interactive TUI with a positional prompt and no bypass flag (tools run unattended)', () => {
      const cmd = buildAgentCommand({ program: 'pi', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
      expect(cmd).toContain("pi --model 'sonnet'");
      expect(cmd).not.toContain('--yolo');
      expect(cmd).not.toContain('--auto-approve');
    });
    it('does not change the pi command when skipPermissions is toggled off (the toggle is a no-op for pi)', () => {
      const on = buildAgentCommand({ program: 'pi', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
      const off = buildAgentCommand({ program: 'pi', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', skipPermissions: false });
      expect(off).toEqual(on);
    });
    it('routes omp to the interactive TUI with a positional prompt and the --auto-approve bypass', () => {
      const cmd = buildAgentCommand({ program: 'omp', model: 'opus' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
      expect(cmd).toContain("omp --auto-approve --model 'opus'");
    });
    it('omits the omp --auto-approve bypass when skipPermissions is off', () => {
      const cmd = buildAgentCommand({ program: 'omp', model: 'opus' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', skipPermissions: false });
      expect(cmd).not.toContain('--auto-approve');
      expect(cmd).toContain("omp --model 'opus'");
    });
    it('kilo resumes via --session alongside --model (no bypass flag in 7.x)', () => {
      const cmd = buildAgentCommand({ program: 'kilo', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', resume: { program: 'kilo', sessionId: 'k-7' } });
      expect(cmd).toContain("kilo --session 'k-7' --model 'm'");
    });
    it('pi resumes via --session alongside --model', () => {
      const cmd = buildAgentCommand({ program: 'pi', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', resume: { program: 'pi', sessionId: 'p-7' } });
      expect(cmd).toContain("pi --session 'p-7' --model 'm'");
    });
    it('omp resumes via --resume alongside --model, after the bypass flag', () => {
      const cmd = buildAgentCommand({ program: 'omp', model: 'm' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', resume: { program: 'omp', sessionId: 'o-7' } });
      expect(cmd).toContain("--auto-approve --resume 'o-7' --model 'm'");
    });
  });

  describe('resume', () => {
    it('claude resumes with --resume after the bypass flag, before --model, and a continuation prompt', () => {
      const cmd = buildAgentCommand(
        { program: 'claude-code', model: 'sonnet' },
        { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', resume: { program: 'claude-code', sessionId: 'sess-7' } },
      );
      expect(cmd).toContain("--dangerously-skip-permissions --resume 'sess-7' --model 'sonnet'");
      expect(cmd).toContain('resuming your earlier session'); // worker-resume preamble, not the full worker one
      expect(cmd).not.toContain('First read the project context'); // the cold-start worker preamble is gone
    });
    it('codex resumes via the `resume` subcommand, before the bypass flag and model', () => {
      const cmd = buildAgentCommand(
        { program: 'codex', model: 'gpt-5.5' },
        { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', resume: { program: 'codex', sessionId: 'cx-9' } },
      );
      expect(cmd).toContain("codex resume 'cx-9' --dangerously-bypass-approvals-and-sandbox --model 'gpt-5.5'");
    });
    it('opencode resumes via -s alongside --model and --prompt', () => {
      const cmd = buildAgentCommand(
        { program: 'opencode', model: 'ollama/x' },
        { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', resume: { program: 'opencode', sessionId: 'ses_42' } },
      );
      expect(cmd).toContain("-s 'ses_42' --model 'ollama/x'");
      expect(cmd).toContain('--prompt');
    });
    it('shell-escapes the resume session id (injection defense)', () => {
      const cmd = buildAgentCommand(
        { program: 'claude-code', model: 'sonnet' },
        { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', resume: { program: 'claude-code', sessionId: "x'; rm -rf / #" } },
      );
      expect(cmd).toContain("--resume 'x'\\''; rm -rf / #'"); // wrapped, the `;` never reaches the shell raw
    });
    it('omits resume tokens entirely when no resume is set (cold start unchanged)', () => {
      const cmd = buildAgentCommand({ program: 'claude-code', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A' });
      expect(cmd).not.toContain('--resume');
      expect(cmd).toContain('Before you do anything else, run'); // the normal (cold) worker bootstrap
    });
    it('points the resumed worker at the control guide and ask, using the resolved cli', () => {
      const cmd = buildAgentCommand({ program: 'claude-code', model: 'sonnet' }, { projectPath: '/o', taskId: 'elowen-1', agentName: 'A', resume: { program: 'claude-code', sessionId: 's1' }, cli: 'node /x/cli.js' });
      expect(cmd).toContain('node /x/cli.js help'); // refresher pointer renders with the daemon cli, not bare `elowen`
      expect(cmd).toContain('node /x/cli.js ask'); // the resume preamble still names the open-question channel
    });
  });
});

// ---- from tests/plugins/agents/spawn/resume/providers.test.ts ----

describe('resume providers', () => {
  it('claude resumes via the --resume flag, alongside --model', () => {
    expect(claudeResume.resumeArgs('abc-123')).toEqual({ args: ['--resume', 'abc-123'], placement: 'flag' });
  });
  it('codex resumes via the `resume` subcommand, before the flags', () => {
    expect(codexResume.resumeArgs('abc-123')).toEqual({ args: ['resume', 'abc-123'], placement: 'subcommand' });
  });
  it('opencode resumes via the -s session flag', () => {
    expect(opencodeResume.resumeArgs('ses_9')).toEqual({ args: ['-s', 'ses_9'], placement: 'flag' });
  });
  it('kilo resumes via the --session flag', () => {
    expect(kiloResume.resumeArgs('k-9')).toEqual({ args: ['--session', 'k-9'], placement: 'flag' });
  });
  it('pi resumes via the --session flag', () => {
    expect(piResume.resumeArgs('p-9')).toEqual({ args: ['--session', 'p-9'], placement: 'flag' });
  });
  it('omp resumes via the --resume flag', () => {
    expect(ompResume.resumeArgs('o-9')).toEqual({ args: ['--resume', 'o-9'], placement: 'flag' });
  });
});

describe('resumeProviderFor', () => {
  it('maps each program id to its strategy, normalizing opencode variants', () => {
    expect(resumeProviderFor('claude-code')).toBe(claudeResume);
    expect(resumeProviderFor('codex')).toBe(codexResume);
    expect(resumeProviderFor('opencode')).toBe(opencodeResume);
    expect(resumeProviderFor('opencode-zen')).toBe(opencodeResume); // 'opencode…' normalizes
    expect(resumeProviderFor('kilo')).toBe(kiloResume);
    expect(resumeProviderFor('pi')).toBe(piResume);
    expect(resumeProviderFor('omp')).toBe(ompResume);
    expect(resumeProviderFor('mystery')).toBeUndefined();
  });
});

describe('parseResumeLabel', () => {
  it('parses a well-formed resume label', () => {
    expect(parseResumeLabel(['exec:sonnet', 'resume:claude-code:7f3a-uuid'])).toEqual({ program: 'claude-code', sessionId: '7f3a-uuid' });
  });
  it('keeps an opencode session id intact (the `ses_` handle has no inner colon)', () => {
    expect(parseResumeLabel(['resume:opencode:ses_10037'])).toEqual({ program: 'opencode', sessionId: 'ses_10037' });
  });
  it('returns undefined when there is no resume label', () => {
    expect(parseResumeLabel(['exec:sonnet', 'agent:Nova'])).toBeUndefined();
  });
  it('rejects an unknown program (so a stale label can never resume a gone provider)', () => {
    expect(parseResumeLabel(['resume:ollama:xyz'])).toBeUndefined();
  });
  it('rejects a malformed label (missing session id)', () => {
    expect(parseResumeLabel(['resume:claude-code:'])).toBeUndefined();
    expect(parseResumeLabel(['resume:claude-code'])).toBeUndefined();
  });
});
