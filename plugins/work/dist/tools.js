import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { callElowenApi } from './lib/apiClient.js';
/** Wrap a callElowenApi round-trip into the PI tool result shape. The raw JSON text is handed to the
 *  model — it reasons over it — so we return the API's own body verbatim (or a clear error line). */
async function call(ctx, method, path, body) {
    const r = await callElowenApi(method, path, body, { url: ctx.url, token: ctx.token, fetchImpl: ctx.fetchImpl });
    const text = r.ok ? r.text : `Elowen API error HTTP ${r.status}: ${r.text}`;
    return { content: [{ type: 'text', text }], details: {} };
}
/** The task lifecycle a tool caller may drive. Mirrors the REST `patchTaskSchema` enum exactly — a value
 *  outside it is rejected by the API, so keeping the two in step is what makes the tool's error messages
 *  honest. */
const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'closed', 'cancelled'];
function elowenListTasks(ctx) {
    return defineTool({
        name: 'ElowenListTasks', label: 'List tasks',
        description: [
            'List the tasks tracked in the Elowen control plane — the persistent work items, tickets and to-dos that',
            'belong to your projects — returning each task\'s id, title, status and project as JSON.',
            'Use it to see what work exists or is in progress, to answer "what am I working on", to pick the next task',
            'after finishing one, or to get an overview before planning. Call it before ElowenCreateTask so you do not',
            'create a duplicate of a task that already exists, and use it to obtain the task id the other Elowen task',
            'tools need. This is the control plane\'s durable task list, not the ephemeral per-conversation session list',
            'managed by TaskCreate, TaskUpdate and TaskList.',
            'Pass project_id to narrow the listing to a single project; omit it to list tasks across every project you',
            'may see. It is read-only and creates nothing. For a single task\'s full detail — description, result',
            'summary, dependencies, changed files — call ElowenGetTask instead. The tool works only in the owner\'s own',
            'chat session and needs a linked Elowen account; otherwise it answers with a refusal.',
        ].join(' '),
        parameters: Type.Object({ project_id: Type.Optional(Type.Number({ description: 'Numeric id of a project to list tasks from; omit to list tasks from every accessible project' })) }),
        execute: async (_id, p) => call(ctx, 'GET', p.project_id ? `/tasks?project_id=${p.project_id}` : '/tasks'),
    });
}
function elowenCreateTask(ctx) {
    return defineTool({
        name: 'ElowenCreateTask', label: 'Create task',
        description: [
            'Create a new task, ticket or work item in an Elowen project in the control plane. Tasks are the unit of',
            'organized work: each one belongs to a project and carries a title, an optional description and a status',
            'that tracks it through its lifecycle, and each can later be picked up by an agent.',
            'Use it when the request is genuinely multi-step, when the work needs a durable record that survives this',
            'conversation, when something should be remembered for later, or when the user simply asks to add a task.',
            'Do not create a task for a single trivial action — just do the work — and do not use it for the private',
            'per-conversation session list managed by TaskCreate and TaskUpdate. To have a whole goal decomposed into several',
            'tasks at once, call ElowenPlan instead.',
            'title should be a brief actionable imperative naming the outcome, project_id is the numeric id of the',
            'owning project (a task never exists standalone — get the id from ElowenListTasks), and description carries',
            'the context needed to resume the work after an interruption.',
            'Check ElowenListTasks first so you do not duplicate an existing task. The new task starts in status',
            '`open`; move it on with ElowenUpdateTask as the work proceeds. The created task is returned as JSON,',
            'including the id you will need later. This tool writes to the control plane and works only in the owner\'s',
            'own chat session with a linked Elowen account.',
        ].join(' '),
        parameters: Type.Object({
            title: Type.String({ description: 'A brief, actionable imperative naming the outcome, e.g. "Fix the auth bug in the login flow"' }),
            project_id: Type.Number({ description: 'The project the task belongs to — tasks never exist standalone' }),
            description: Type.Optional(Type.String({ description: 'Context for what needs doing, with enough detail to resume the work after an interruption' })),
        }),
        execute: async (_id, p) => call(ctx, 'POST', '/tasks', p),
    });
}
function elowenUpdateTask(ctx) {
    return defineTool({
        name: 'ElowenUpdateTask', label: 'Update task',
        description: [
            'Update an existing task in the Elowen control plane: change its status to move it through its lifecycle,',
            'rename it, or revise its description. This is how a task gets marked as started, finished, blocked or',
            'cancelled.',
            `Status values are ${TASK_STATUSES.join(', ')} — set \`in_progress\` when you start the work and \`closed\` when it is genuinely finished, \`blocked\` when something outside your control stops it, and \`cancelled\` when it is no longer wanted.`,
            'Only close a task you have actually completed: a partial implementation, a failing test or an unresolved',
            'error means it stays in_progress. task_id identifies the task and comes from ElowenListTasks or from what',
            'ElowenCreateTask returned; title and description replace those fields outright rather than appending to',
            'them.',
            'Pass at least one of status, title or description — an empty update is refused with an error instead of',
            'silently doing nothing. To halt a task an agent is actively running, prefer ElowenStopTask, which also',
            'handles the running session; to read a task before changing it, use ElowenGetTask. The updated task is',
            'returned as JSON. This tool writes to the control plane and works only in the owner\'s own chat session.',
        ].join(' '),
        parameters: Type.Object({
            task_id: Type.String({ description: 'Id of the task to update (from ElowenListTasks or ElowenCreateTask)' }),
            status: Type.Optional(Type.Union(TASK_STATUSES.map((s) => Type.Literal(s)), { description: 'New lifecycle status' })),
            title: Type.Optional(Type.String({ description: 'Rename the task' })),
            description: Type.Optional(Type.String({ description: 'Replace the task description' })),
        }),
        execute: async (_id, p) => {
            const patch = {
                ...(p.status !== undefined ? { status: p.status } : {}),
                ...(p.title !== undefined ? { title: p.title } : {}),
                ...(p.description !== undefined ? { description: p.description } : {}),
            };
            // An empty PATCH would be a silent no-op that still reads as success — say so instead, so the model
            // learns it forgot the field rather than believing the task moved.
            if (Object.keys(patch).length === 0) {
                return { content: [{ type: 'text', text: 'Error: nothing to update — pass at least one of status, title or description.' }], details: {} };
            }
            return call(ctx, 'PATCH', `/tasks/${encodeURIComponent(p.task_id)}`, patch);
        },
    });
}
function elowenPlan(ctx) {
    return defineTool({
        name: 'ElowenPlan', label: 'Plan a goal',
        description: [
            'Ask the Elowen control plane to break a larger goal down into a plan: the planner decomposes the goal into',
            'an epic with phase tasks and their dependencies inside the given project, so the work can then be picked',
            'up by agents.',
            'Use it when the user describes a whole feature, project or objective rather than a single work item — "we',
            'need user authentication", "prepare the release" — and you want a structured breakdown instead of writing',
            'one task by hand. For a single known work item call ElowenCreateTask instead, and to see what already',
            'exists before planning call ElowenListTasks.',
            'goal is the objective in plain language, stated with enough context and constraints for the planner to',
            'split it sensibly, and project_id is the numeric id of the project the resulting tasks belong to.',
            'Planning is asynchronous: the call returns the planner job as JSON rather than the finished task list, so',
            'poll ElowenListTasks afterwards to see the tasks that were created. It writes to the control plane, may',
            'create several tasks at once, and works only in the owner\'s own chat session with a linked Elowen account.',
        ].join(' '),
        parameters: Type.Object({
            goal: Type.String({ description: 'The objective to decompose, in plain language with the relevant context and constraints, e.g. "add e-mail based password reset to the web app"' }),
            project_id: Type.Number({ description: 'Numeric id of the project the planned tasks are created in (from ElowenListTasks)' }),
        }),
        execute: async (_id, p) => call(ctx, 'POST', '/tasks/plan', p),
    });
}
// ElowenListMissions + ElowenListSessions moved to the agents plugin (plugins/agents/src/tools.ts):
// they read exclusively the subsystem's surface, so they ride the plugin and vanish with it.
function elowenGetTask(ctx) {
    return defineTool({
        name: 'ElowenGetTask', label: 'Get task',
        description: [
            'Read one task from the Elowen control plane in full detail by its id: title, status, project, description,',
            'result summary, outcome, labels, dependencies on other tasks and the files it changed, returned as JSON.',
            'Use it to inspect a task\'s complete state before updating, stopping or closing it, to check what a task',
            'actually asked for, or to see which other tasks it depends on.',
            'For an overview of many tasks call ElowenListTasks, which returns only id, title, status and project; for',
            'just the agent\'s reported result and token usage call ElowenTaskOutput.',
            'task_id is the task identifier as returned by ElowenListTasks or ElowenCreateTask. The tool is read-only',
            'and changes nothing. An unknown id comes back as an API error rather than an empty task. It works only in',
            'the owner\'s own chat session and needs a linked Elowen account.',
        ].join(' '),
        parameters: Type.Object({
            task_id: Type.String({ description: 'Id of the task to retrieve, as returned by ElowenListTasks or ElowenCreateTask' }),
        }),
        execute: async (_id, p) => call(ctx, 'GET', `/tasks/${encodeURIComponent(p.task_id)}`),
    });
}
function elowenStopTask(ctx) {
    return defineTool({
        name: 'ElowenStopTask', label: 'Stop task',
        description: [
            'Stop a task that an agent is working on in the Elowen control plane: either hand it back by reverting its',
            'status to `open`, so it can be picked up or re-spawned later, or cancel it outright.',
            'Use it when an agent is stuck, looping, producing wrong results, or when the work is simply no longer',
            'wanted. To see which agents are actually running first, call ElowenListSessions; to change any other field',
            'of a task, or to close a task that genuinely finished, use ElowenUpdateTask instead.',
            'task_id identifies the task, from ElowenListTasks or ElowenListSessions. cancel defaults to false, which',
            'reverts the task to `open`; set it to true to move the task to `cancelled` permanently.',
            'Mechanically this is a status change, not a kill signal: the agent\'s tmux session is reaped by the',
            'background janitor once the task is closed or cancelled, so a task merely reverted to `open` may still',
            'have its session lingering for a moment — check ElowenListSessions if that matters. The updated task comes',
            'back as JSON. It writes to the control plane and works only in the owner\'s own chat session.',
        ].join(' '),
        parameters: Type.Object({
            task_id: Type.String({ description: 'Id of the task to stop, from ElowenListTasks or ElowenListSessions' }),
            cancel: Type.Optional(Type.Boolean({ description: 'True cancels the task permanently; false or omitted reverts it to open so it can be re-spawned' })),
        }),
        execute: async (_id, p) => {
            const status = p.cancel ? 'cancelled' : 'open';
            return call(ctx, 'PATCH', `/tasks/${encodeURIComponent(p.task_id)}`, { status });
        },
    });
}
function elowenTaskOutput(ctx) {
    return defineTool({
        name: 'ElowenTaskOutput', label: 'Task output',
        description: [
            'Read what an agent reported for a task in the Elowen control plane: the result summary and outcome it',
            'recorded when it closed the task, together with the token and cost usage that task consumed, composed into',
            'one JSON object.',
            'Use it to review what a finished task actually did, to report progress or results back to the user, or to',
            'check how expensive a piece of agent work was. For the task\'s full record — description, status, labels,',
            'dependencies, changed files — call ElowenGetTask; for the list of tasks call ElowenListTasks.',
            'task_id is the task identifier from ElowenListTasks or ElowenGetTask.',
            'The tool is read-only. A task that has not finished yet simply has null in result_summary and outcome, and',
            'when no usage was recorded the usage field reads "no usage recorded" — neither is an error. An unknown id',
            'returns an API error. It works only in the owner\'s own chat session with a linked Elowen account.',
        ].join(' '),
        parameters: Type.Object({
            task_id: Type.String({ description: 'Id of the task whose reported result and usage should be read' }),
        }),
        execute: async (_id, p) => {
            const id = encodeURIComponent(p.task_id);
            const opts = { url: ctx.url, token: ctx.token, fetchImpl: ctx.fetchImpl };
            // Compose the answer: the outcome/summary live on the task record, usage on a separate endpoint.
            // The old code queried ONLY /usage, so it never returned outcome/summary and handed the model the
            // literal text "null" whenever no usage was recorded.
            const task = await callElowenApi('GET', `/tasks/${id}`, undefined, opts);
            if (!task.ok)
                return { content: [{ type: 'text', text: `Elowen API error HTTP ${task.status}: ${task.text}` }], details: {} };
            const usage = await callElowenApi('GET', `/tasks/${id}/usage`, undefined, opts);
            const parse = (t) => { try {
                return JSON.parse(t);
            }
            catch {
                return null;
            } };
            const taskObj = (parse(task.text) ?? {});
            const usageObj = usage.ok ? parse(usage.text) : null;
            const composed = {
                result_summary: taskObj.result_summary ?? null,
                outcome: taskObj.outcome ?? null,
                usage: usageObj ?? 'no usage recorded',
            };
            return { content: [{ type: 'text', text: JSON.stringify(composed, null, 2) }], details: {} };
        },
    });
}
/** The task control plane's brain tools, moved out of the core (src/brain/tools/elowenTools.ts) with
 *  the same names, labels and parameter schemas. The descriptions have since been rewritten for hosted
 *  tool search (the provider retrieves a deferred tool by BM25 over name/description/argument text),
 *  so they no longer match the core originals byte for byte.
 *
 *  Two things the core got structurally and this must reproduce at EXECUTE time:
 *
 *  - The credential. In the core these tools were handed the acting user's own advisor token, so they
 *    ran under that user's tenancy and full scope. The host's shared `elowenCli().token` is
 *    AGENT-scoped and owned by a different principal, so using it would silently change both — in
 *    either direction. `tokenForUser` mints the same credential the core path did, read per call from
 *    the acting identity and never captured: a token captured at registration would let one user's turn
 *    act as whoever loaded the plugin.
 *  - The boundary. Core composed these into `owner-chat` sessions ONLY; the platform composes plugin
 *    tools into every session kind and expects an execute-time gate. That gate is
 *    `currentAccess().owner`, NOT isAdminSession(): an admin on a shared channel (a Discord moderator)
 *    is admin-but-not-owner, and these tools MUTATE — handing them to that turn would be exactly the
 *    privilege escalation the core's composition prevented by construction. The owner's own sub-agents
 *    inherit owner, which is what keeps the read-only agent allow-list (ElowenListTasks / ElowenGetTask
 *    / ElowenTaskOutput) working for explore/plan children. */
/** The task control plane's toolset, in its historical order. Exported so the plugin's tests exercise
 *  the very definitions it registers (name, description, schema and HTTP behaviour) rather than a
 *  parallel copy. */
export function buildWorkTools(ctx) {
    return [elowenListTasks(ctx), elowenCreateTask(ctx), elowenUpdateTask(ctx), elowenPlan(ctx), elowenGetTask(ctx), elowenStopTask(ctx), elowenTaskOutput(ctx)];
}
export function registerWorkTools(ctx) {
    const refusal = { content: [{ type: 'text', text: 'This tool is only available in the owner\'s own chat session.' }], details: {} };
    const unavailable = (why) => ({ content: [{ type: 'text', text: `Error: ${why}` }], details: {} });
    /** Resolve the acting user's own credential for THIS call, or explain why there is none. */
    const toolCtx = () => {
        const cli = ctx.host.elowenCli();
        const userId = ctx.currentIdentity()?.elowenUserId;
        if (userId == null)
            return 'this tool needs a linked Elowen account and this turn has none.';
        const token = cli.tokenForUser(userId);
        if (!token)
            return 'this tool could not resolve a credential for the acting user.';
        return { url: cli.url, token };
    };
    // Built once WITHOUT a credential for its static shape (name/label/description/schema — what the
    // model sees); each execute is wrapped so the gate and the acting user's token are resolved per call.
    const inert = buildWorkTools({ url: '', token: '' });
    inert.forEach((tool, i) => {
        ctx.registerTool({
            ...tool,
            execute: async (...args) => {
                if (!ctx.currentAccess().owner)
                    return refusal;
                const resolved = toolCtx();
                if (typeof resolved === 'string')
                    return unavailable(resolved);
                return buildWorkTools(resolved)[i].execute(...args);
            },
        });
    });
}
