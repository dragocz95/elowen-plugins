import { tddDirective } from '../lib/tdd.js';
import { resumeProviderFor } from './resume/index.js';
import { codexMcpArgs } from '../lib/mcpArgs.js';
const esc = (s) => `'${s.replace(/'/g, "'\\''")}'`;
export function buildAgentCommand(spec, ctx, renderPrompt) {
    // A reasoning agent (Pilot/Overseer) carries its own complete prompt and never closes a task, so
    // it bypasses the worker preamble entirely. Returning early keeps that path obvious.
    if (ctx.rawPrompt !== undefined) {
        return buildLaunchCommand(spec, ctx, ctx.rawPrompt);
    }
    const closeCommand = ctx.closeCommand ?? `elowen close ${ctx.taskId}`;
    const titlePart = ctx.taskTitle ? `: ${ctx.taskTitle}` : '';
    const detailsPart = ctx.taskDescription && ctx.taskDescription.trim() ? `\n\nDetails:\n${ctx.taskDescription.trim()}` : '';
    // A relaunch carries fresh input the agent must address (review feedback, a stuck/manual restart
    // reason). Render it as its own block — separate from the static task details — so it reads as "new
    // this run", not as part of the original brief. Empty on a clean first run.
    const resumePart = ctx.resumeNote && ctx.resumeNote.trim() ? `\n\nNew input for this run — address it:\n${ctx.resumeNote.trim()}` : '';
    // A resumed agent reattaches to its prior session — it already holds the full goal and what it did,
    // so re-injecting the whole worker preamble would make it restart from scratch. Send a short
    // continuation instead: pick up where it left off, fold in any new input, then close.
    // A phase agent (epicId, not resumed) must NOT redo earlier phases — the phase template carries the
    // "build on prior phases" framing the standalone one lacks.
    // The preamble is deliberately short — it carries the task brief, a working-dir guard and a `close`
    // floor, then points the agent at `{{cli}} help` for the full control guide (how to work, ask the
    // autopilot, handoff notes, epic close). That guide is rendered on demand by the daemon from the
    // task's live state, so the tutorial lives in ONE place instead of being copied into every preamble.
    const base = ctx.resume
        ? renderPrompt('worker-resume', { agentName: ctx.agentName, taskId: ctx.taskId, titlePart, detailsPart, resumePart, closeCommand, cli: ctx.cli ?? 'elowen' })
        : ctx.epicId
            ? renderPrompt('worker-phase', { agentName: ctx.agentName, taskId: ctx.taskId, titlePart, detailsPart, resumePart, epicId: ctx.epicId, closeCommand, cli: ctx.cli ?? 'elowen' })
            : renderPrompt('worker', { agentName: ctx.agentName, taskId: ctx.taskId, titlePart, detailsPart, resumePart, closeCommand, cli: ctx.cli ?? 'elowen' });
    // Inject the TDD directive AFTER the template renders, not through a `{{tddDirective}}` placeholder:
    // a user's saved wholesale override (edited before TDD mode existed) carries no such placeholder, so
    // riding on it would silently drop the directive. Appending at this seam makes the placeholder
    // unnecessary — TDD mode reaches the worker regardless of the override. Off state appends '' (no-op).
    const prompt = base + tddDirective(ctx.tddMode ?? false);
    return buildLaunchCommand(spec, ctx, prompt);
}
/** Assemble the actual `cd && export … && <bin> … <prompt>` shell command for a given prompt. Shared
 *  by the worker path (assembled preamble) and the reasoning path (rawPrompt). */
function buildLaunchCommand(spec, ctx, prompt) {
    const cd = `cd ${esc(ctx.projectPath)}`;
    // NB: agent environment (ELOWEN_URL/TOKEN/TASK + caller extraEnv) is NOT exported here — the spawn layer
    // injects it as tmux session env (`-e KEY=VAL`) so a token can never enter the pane scrollback. Keeping
    // that as the single delivery path also stops a future caller from re-introducing the leak through here.
    const extra = ctx.extraArgs && ctx.extraArgs.trim() ? ` ${ctx.extraArgs.trim()}` : '';
    // Bypass interactive permission prompts unless the operator turned it off for this provider
    // (Settings → Providers). Each agent has its own mechanism; undefined defaults to on.
    const skip = ctx.skipPermissions !== false;
    // Resume splice: a 'subcommand' (codex `resume <id>`) must precede the bypass flag; a 'flag'
    // (claude `-r <id>`, opencode `-s <id>`) follows it, alongside --model. The leading tokens are our
    // own literal flags/subcommand (safe); only the trailing session id is dynamic, so escape just that
    // one (mirrors `--model ${esc(model)}`: the flag is literal, the value is quoted).
    const plan = ctx.resume ? (resumeProviderFor(spec.program)?.resumeArgs(ctx.resume.sessionId) ?? null) : null;
    const resumeStr = plan ? ' ' + plan.args.map((a, i) => i === plan.args.length - 1 ? esc(a) : a).join(' ') : '';
    const resumeBefore = plan?.placement === 'subcommand' ? resumeStr : '';
    const resumeAfter = plan?.placement === 'flag' ? resumeStr : '';
    if (spec.program.startsWith('opencode')) {
        const bin = ctx.bin || 'opencode';
        // Launch the interactive TUI (UI mode) with the task preloaded into the composer
        // via --prompt. The TUI holds the prompt but does not auto-submit it, so SpawnService
        // nudges Enter a few times once the UI has mounted (Enter on an empty composer is a
        // harmless no-op, so the extra presses are safe). The TUI has no skip-permissions flag (that
        // lives on `opencode run`), so the bypass is delivered as a merged config via env:
        // OPENCODE_CONFIG_CONTENT sets permission "*" → allow without writing any file into the repo.
        const yolo = skip ? `export OPENCODE_CONFIG_CONTENT=${esc('{"permission":"allow"}')} && ` : '';
        // opencode bypasses via the yolo env, not a flag, so both placements land after the binary.
        return `${cd} && ${yolo}${bin}${resumeBefore}${resumeAfter} --model ${esc(spec.model)}${extra} --prompt ${esc(prompt)}`;
    }
    if (spec.program.startsWith('codex')) {
        const bin = ctx.bin || 'codex';
        // Positional prompt + autonomous approval bypass (codex's skip-permissions equivalent).
        const bypass = skip ? ' --dangerously-bypass-approvals-and-sandbox' : '';
        // Codex ignores any project-local config, so its elowen MCP server is injected via `-c` overrides
        // (token read from the exported ELOWEN_TOKEN env, not the command line). codexMcpArgs alternates
        // [flag, value, …]; the `-c` flags are our own literals, only the values are dynamic — quote just
        // those (mirrors `--model ${esc(model)}`), so an odd-charactered URL can't break the shell.
        const mcp = ctx.mcpUrl ? ' ' + codexMcpArgs(spec.program, ctx.mcpUrl).map((a, i) => i % 2 === 0 ? a : esc(a)).join(' ') : '';
        return `${cd} && ${bin}${resumeBefore}${bypass}${resumeAfter}${mcp} --model ${esc(spec.model)}${extra} ${esc(prompt)}`;
    }
    if (spec.program === 'kilo') {
        const bin = ctx.bin || 'kilo';
        // Kilo Code (7.x) interactive TUI: the task is delivered via `--prompt` (a positional arg is the
        // project path, not the prompt), `--model provider/model` selects the model on a configured
        // provider, and resume (`--session <id>`) is a 'flag'. Kilo 7.x has no skip-permissions flag —
        // tool auto-approval lives in the user's kilo config (`permission: { bash: "allow", … }`), so
        // `skip` has no effect here (the Providers toggle is a no-op for kilo, same as pi/omp).
        return `${cd} && ${bin}${resumeBefore}${resumeAfter} --model ${esc(spec.model)}${extra} --prompt ${esc(prompt)}`;
    }
    if (spec.program === 'pi') {
        const bin = ctx.bin || 'pi';
        // Pi interactive TUI: positional prompt seeds and submits the conversation. Pi has no
        // skip-permissions flag — its built-in tools run without confirmation — so `skip` has no effect
        // here (the Providers toggle is a no-op for pi). Resume (`--session <id>`) is a 'flag'.
        return `${cd} && ${bin}${resumeBefore}${resumeAfter} --model ${esc(spec.model)}${extra} ${esc(prompt)}`;
    }
    if (spec.program === 'omp') {
        const bin = ctx.bin || 'omp';
        // oh-my-pi interactive TUI: positional prompt seeds and submits; `--auto-approve` skips all tool
        // approval prompts (its skip-permissions equivalent). Resume (`--resume <id>`) is a 'flag'. Note:
        // omp runs on the Bun runtime, so `bun` must be on the daemon's PATH for the bin to start.
        const bypass = skip ? ' --auto-approve' : '';
        return `${cd} && ${bin}${resumeBefore}${bypass}${resumeAfter} --model ${esc(spec.model)}${extra} ${esc(prompt)}`;
    }
    const bin = ctx.bin || 'claude';
    // Autonomous approval bypass: elowen-spawned agents run unattended in a tmux pane, so an
    // interactive permission prompt would hang the whole mission.
    const bypass = skip ? ' --dangerously-skip-permissions' : '';
    return `${cd} && ${bin}${resumeBefore}${bypass}${resumeAfter} --model ${esc(spec.model)}${extra} ${esc(prompt)}`;
}
