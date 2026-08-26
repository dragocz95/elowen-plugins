import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { fail, keyFor, ok, parseObject } from './common.mjs';
import { pushTaskCard, renderTaskContext } from './render.mjs';

const TASK_STATUSES = ['pending', 'in_progress', 'completed'];
const TASK_STATUS_SCHEMA = Type.Union(TASK_STATUSES.map((status) => Type.Literal(status)));

/** Three idle conversation turns leave enough time to inspect finished work without carrying it into a
 *  later topic indefinitely. New work clears an aged finished list immediately, before its first task lands. */
export const COMPLETED_LIST_GRACE_TURNS = 3;

export const TASK_MIGRATIONS = [{
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS p_todo_task_lists (
        list_key TEXT PRIMARY KEY,
        next_id INTEGER NOT NULL DEFAULT 1 CHECK (next_id >= 1)
      );
      CREATE TABLE IF NOT EXISTS p_todo_tasks (
        list_key TEXT NOT NULL,
        id INTEGER NOT NULL CHECK (id >= 1),
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        active_form TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed')),
        owner TEXT,
        metadata_json TEXT,
        PRIMARY KEY (list_key, id)
      );
      CREATE TABLE IF NOT EXISTS p_todo_task_blockers (
        list_key TEXT NOT NULL,
        task_id INTEGER NOT NULL,
        blocker_id INTEGER NOT NULL,
        PRIMARY KEY (list_key, task_id, blocker_id)
      );
      CREATE INDEX IF NOT EXISTS p_todo_task_blockers_blocker
        ON p_todo_task_blockers(list_key, blocker_id);
    `);
  },
}, {
  version: 2,
  up(db) {
    const columns = db.prepare('PRAGMA table_info(p_todo_task_lists)').all();
    if (!columns.some((column) => column.name === 'completed_turns')) {
      db.exec('ALTER TABLE p_todo_task_lists ADD COLUMN completed_turns INTEGER NOT NULL DEFAULT 0 CHECK (completed_turns >= 0)');
    }
  },
}];

function numericId(value) {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

function metadataFromJson(value) {
  if (typeof value !== 'string' || !value) return {};
  try { return parseObject(JSON.parse(value)); } catch { return {}; }
}

function metadataToJson(value) {
  return Object.keys(value).length ? JSON.stringify(value) : null;
}

function reaches(edges, from, target) {
  const seen = new Set();
  const stack = [from];
  while (stack.length) {
    const current = stack.pop();
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of edges.get(current) ?? []) stack.push(next);
  }
  return false;
}

/** blocker id → the ids it blocks, over a whole task list. */
function edgeMap(tasks) {
  const edges = new Map();
  for (const item of tasks) {
    for (const blockerId of item.blockedBy) {
      if (!edges.has(blockerId)) edges.set(blockerId, new Set());
      edges.get(blockerId).add(item.id);
    }
  }
  return edges;
}

/** Record one blocker → blocked edge in `edges`, rejecting a self-dependency or a cycle. Returns false
 *  when the edge is already there, so repeated declarations stay idempotent. Both creation and update go
 *  through here: the dependency rules must not drift apart between the two entry points. */
function addDependency(edges, blockerId, blockedId) {
  if (blockerId === blockedId) throw new Error('a task cannot depend on itself');
  if (edges.get(blockerId)?.has(blockedId)) return false;
  if (reaches(edges, blockedId, blockerId)) throw new Error('dependency cycle detected');
  if (!edges.has(blockerId)) edges.set(blockerId, new Set());
  edges.get(blockerId).add(blockedId);
  return true;
}

class TaskStore {
  constructor(db) {
    this.db = db;
    this.insertList = db.prepare('INSERT OR IGNORE INTO p_todo_task_lists(list_key,next_id,completed_turns) VALUES (?,1,0)');
    this.readList = db.prepare('SELECT next_id,completed_turns FROM p_todo_task_lists WHERE list_key = ?');
    this.bumpList = db.prepare('UPDATE p_todo_task_lists SET next_id = ?, completed_turns = 0 WHERE list_key = ?');
    this.setCompletedTurns = db.prepare('UPDATE p_todo_task_lists SET completed_turns = ? WHERE list_key = ?');
    this.selectTasks = db.prepare('SELECT id,subject,description,active_form,status,owner,metadata_json FROM p_todo_tasks WHERE list_key = ? ORDER BY id');
    this.selectBlockers = db.prepare('SELECT task_id,blocker_id FROM p_todo_task_blockers WHERE list_key = ? ORDER BY task_id,blocker_id');
    this.insertTask = db.prepare('INSERT INTO p_todo_tasks(list_key,id,subject,description,active_form,status,owner,metadata_json) VALUES (?,?,?,?,?,?,?,?)');
    this.updateTask = db.prepare('UPDATE p_todo_tasks SET subject=?,description=?,active_form=?,status=?,owner=?,metadata_json=? WHERE list_key=? AND id=?');
    this.deleteTask = db.prepare('DELETE FROM p_todo_tasks WHERE list_key = ? AND id = ?');
    this.deleteTaskEdges = db.prepare('DELETE FROM p_todo_task_blockers WHERE list_key = ? AND (task_id = ? OR blocker_id = ?)');
    this.deleteCompletedEdges = db.prepare(`
      DELETE FROM p_todo_task_blockers
      WHERE list_key = ? AND (
        task_id IN (SELECT id FROM p_todo_tasks WHERE list_key = ? AND status = 'completed')
        OR blocker_id IN (SELECT id FROM p_todo_tasks WHERE list_key = ? AND status = 'completed')
      )
    `);
    this.deleteCompletedTasks = db.prepare("DELETE FROM p_todo_tasks WHERE list_key = ? AND status = 'completed'");
    this.deleteListTasks = db.prepare('DELETE FROM p_todo_tasks WHERE list_key = ?');
    this.deleteListEdges = db.prepare('DELETE FROM p_todo_task_blockers WHERE list_key = ?');
    this.insertEdge = db.prepare('INSERT OR IGNORE INTO p_todo_task_blockers(list_key,task_id,blocker_id) VALUES (?,?,?)');
  }

  #ensureList(key) { this.insertList.run(key); }

  list(key) {
    const rows = this.selectTasks.all(key);
    const blockerRows = this.selectBlockers.all(key);
    const blockedBy = new Map();
    const blocks = new Map();
    for (const row of blockerRows) {
      const taskId = String(row.task_id);
      const blockerId = String(row.blocker_id);
      if (!blockedBy.has(taskId)) blockedBy.set(taskId, []);
      if (!blocks.has(blockerId)) blocks.set(blockerId, []);
      blockedBy.get(taskId).push(blockerId);
      blocks.get(blockerId).push(taskId);
    }
    return rows.map((row) => ({
      id: String(row.id),
      subject: String(row.subject),
      description: String(row.description),
      ...(row.active_form ? { activeForm: String(row.active_form) } : {}),
      status: String(row.status),
      ...(row.owner ? { owner: String(row.owner) } : {}),
      metadata: metadataFromJson(row.metadata_json),
      blockedBy: blockedBy.get(String(row.id)) ?? [],
      blocks: blocks.get(String(row.id)) ?? [],
    }));
  }

  get(key, taskId) {
    return this.list(key).find((task) => task.id === String(taskId)) ?? null;
  }

  /** Age a fully finished list only while the host builds later conversational turns. The list row
   *  deliberately stays after cleanup: `next_id` is conversation-scoped history, and resetting it could make
   *  a stale id resolve to new work. */
  ageCompletedAtTurnBoundary(key) {
    return this.db.transaction(() => {
      const tasks = this.list(key);
      if (tasks.length === 0 || tasks.some((task) => task.status !== 'completed')) {
        this.setCompletedTurns.run(0, key);
        return false;
      }
      const completedTurns = Number(this.readList.get(key)?.completed_turns ?? 0);
      if (completedTurns < COMPLETED_LIST_GRACE_TURNS) {
        this.setCompletedTurns.run(completedTurns + 1, key);
        return false;
      }
      this.deleteListEdges.run(key);
      this.deleteListTasks.run(key);
      this.setCompletedTurns.run(0, key);
      return true;
    });
  }

  /** Create a whole batch in ONE transaction. The model plans the work once instead of firing a call per
   *  task and then wiring the prerequisites afterwards, so ids are reserved in input order and an item may
   *  name a sibling by position before any id exists.
   *
   *  A completed list is cleared here only after a later turn boundary has aged it. That distinction keeps a
   *  second batch created in the SAME turn attached to the work whose ids the model still holds, while genuinely
   *  new conversational work starts with a clean panel instead of joining an old finished list. */
  create(key, inputs) {
    return this.db.transaction(() => {
      this.#ensureList(key);
      let current = this.list(key);
      const listState = this.readList.get(key);
      if (
        current.length > 0
        && current.every((task) => task.status === 'completed')
        && Number(listState?.completed_turns ?? 0) > 0
      ) {
        this.deleteListEdges.run(key);
        this.deleteListTasks.run(key);
        current = [];
      }
      const edges = edgeMap(current);
      const known = new Set(current.map((task) => task.id));

      let nextId = Number(listState?.next_id ?? 1);
      const created = inputs.map((input) => {
        const id = String(nextId);
        nextId += 1;
        return { id, subject: String(input.subject) };
      });

      // Resolve and validate every dependency BEFORE the first write: a rejected batch has to leave the
      // list exactly as it was, and a position may point at a sibling that does not have its row yet.
      const links = [];
      inputs.forEach((input, index) => {
        const blockedId = created[index].id;
        for (const value of input.blockedBy ?? []) {
          const blockerId = String(value);
          if (!known.has(blockerId)) throw new Error('dependency task not found');
          links.push([blockerId, blockedId]);
        }
        for (const position of input.blockedByIndex ?? []) {
          if (!Number.isInteger(position) || position < 1 || position > created.length) {
            throw new Error('dependency task not found');
          }
          links.push([created[position - 1].id, blockedId]);
        }
      });
      const accepted = links.filter(([blockerId, blockedId]) => addDependency(edges, blockerId, blockedId));

      inputs.forEach((input, index) => {
        this.insertTask.run(
          key, Number(created[index].id), String(input.subject), String(input.description),
          input.activeForm == null ? null : String(input.activeForm),
          'pending', null, metadataToJson(parseObject(input.metadata)),
        );
      });
      this.bumpList.run(nextId, key);
      for (const [blockerId, blockedId] of accepted) this.insertEdge.run(key, Number(blockedId), Number(blockerId));
      return created;
    });
  }

  delete(key, taskIdValue) {
    const taskId = numericId(taskIdValue);
    if (taskId == null) throw new Error('task not found');
    return this.db.transaction(() => {
      if (!this.get(key, taskId)) throw new Error('task not found');
      this.deleteTaskEdges.run(key, taskId, taskId);
      this.deleteTask.run(key, taskId);
      return { success: true, taskId: String(taskId) };
    });
  }

  clear(key, scope) {
    return this.db.transaction(() => {
      if (scope === 'completed') {
        this.deleteCompletedEdges.run(key, key, key);
        const removed = this.deleteCompletedTasks.run(key).changes;
        this.setCompletedTurns.run(0, key);
        return removed;
      }
      this.deleteListEdges.run(key);
      const removed = this.deleteListTasks.run(key).changes;
      this.setCompletedTurns.run(0, key);
      return removed;
    });
  }

  update(key, taskIdValue, patch) {
    const taskId = numericId(taskIdValue);
    if (taskId == null) throw new Error('task not found');
    return this.db.transaction(() => {
      const tasks = this.list(key);
      const task = tasks.find((item) => item.id === String(taskId));
      if (!task) throw new Error('task not found');

      const hasUpdate = ['subject', 'description', 'activeForm', 'status', 'owner', 'metadata']
        .some((field) => patch[field] !== undefined)
        || (patch.addBlocks?.length ?? 0) > 0
        || (patch.addBlockedBy?.length ?? 0) > 0;
      if (!hasUpdate) throw new Error('nothing to update');

      if (patch.status === 'deleted') {
        this.deleteTaskEdges.run(key, taskId, taskId);
        this.deleteTask.run(key, taskId);
        return { success: true, taskId: String(taskId), updatedFields: ['deleted'] };
      }

      const updatedFields = [];
      const next = { ...task, metadata: { ...task.metadata } };
      for (const [input, target] of [
        ['subject', 'subject'], ['description', 'description'], ['activeForm', 'activeForm'], ['owner', 'owner'],
      ]) {
        if (patch[input] !== undefined && patch[input] !== next[target]) {
          next[target] = String(patch[input]);
          updatedFields.push(input);
        }
      }

      let statusChange;
      if (patch.status !== undefined && patch.status !== task.status) {
        next.status = patch.status;
        updatedFields.push('status');
        statusChange = { from: task.status, to: patch.status };
      }

      if (patch.metadata !== undefined) {
        for (const [name, value] of Object.entries(parseObject(patch.metadata))) {
          if (value === null) delete next.metadata[name];
          else next.metadata[name] = value;
        }
        updatedFields.push('metadata');
      }

      const byId = new Map(tasks.map((item) => [item.id, item]));
      const edges = edgeMap(tasks);

      const additions = [];
      for (const blockerId of patch.addBlockedBy ?? []) additions.push([String(blockerId), String(taskId)]);
      for (const blockedId of patch.addBlocks ?? []) additions.push([String(taskId), String(blockedId)]);
      let dependencyChanged = false;
      for (const [blockerId, blockedId] of additions) {
        if (blockerId !== blockedId && !(byId.has(blockerId) && byId.has(blockedId))) {
          throw new Error('dependency task not found');
        }
        if (!addDependency(edges, blockerId, blockedId)) continue;
        this.insertEdge.run(key, Number(blockedId), Number(blockerId));
        dependencyChanged = true;
      }
      if (dependencyChanged) updatedFields.push('dependencies');

      this.updateTask.run(
        next.subject, next.description, next.activeForm ?? null, next.status,
        next.owner ?? null, metadataToJson(next.metadata), key, taskId,
      );
      if (statusChange) this.setCompletedTurns.run(0, key);

      return {
        success: true,
        taskId: String(taskId),
        updatedFields: [...new Set(updatedFields)],
        ...(statusChange ? { statusChange } : {}),
      };
    });
  }
}

function taskForGet(task) {
  return task ? {
    id: task.id,
    subject: task.subject,
    description: task.description,
    status: task.status,
    blocks: task.blocks,
    blockedBy: task.blockedBy,
  } : null;
}

function tasksForList(tasks) {
  const completed = new Set(tasks.filter((task) => task.status === 'completed').map((task) => task.id));
  return tasks.map((task) => ({
    id: task.id,
    subject: task.subject,
    status: task.status,
    ...(task.owner ? { owner: task.owner } : {}),
    blockedBy: task.blockedBy.filter((id) => !completed.has(id)),
  }));
}

function syncCard(ctx, store, key) {
  const tasks = key ? store.list(key) : [];
  pushTaskCard(ctx, tasks);
  return tasks;
}

const SAFE_ERRORS = new Set([
  'a task list belongs to a conversation, and this turn has none',
  'tasks must be a non-empty array of tasks to create',
  'every task needs a non-empty subject and description',
  'task not found',
  'nothing to update',
  'a task cannot depend on itself',
  'dependency task not found',
  'dependency cycle detected',
]);

const NOT_FOUND_HINT = 'This task ID does not exist — it was never created, or it was deleted. '
  + 'Call TaskList for the current IDs and retry with one of them, or TaskCreate if this work is not on the list yet. '
  + 'Do not retry this ID and do not guess another one.';

function safeError(ctx, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (SAFE_ERRORS.has(message)) return message;
  ctx.logger.warn(`session task storage failed: ${message}`);
  return 'task storage unavailable';
}

function jsonRes(body, status = 200) {
  return { status, body };
}

function apiListKey(req) {
  if (req.auth.tokenScope === 'agent' || !Number.isInteger(req.auth.userId)) return null;
  const sessionId = String(req.query.session ?? '').trim();
  if (!sessionId || sessionId.length > 256) return null;
  return `u${req.auth.userId}#${sessionId}`;
}

export function registerTaskMode(ctx, db) {
  db.migrate(TASK_MIGRATIONS);
  const store = new TaskStore(db);

  const routeKey = (req) => {
    if (req.auth.tokenScope === 'agent' || !Number.isInteger(req.auth.userId)) {
      return { error: jsonRes({ error: 'forbidden' }, 403) };
    }
    const key = apiListKey(req);
    return key ? { key } : { error: jsonRes({ error: 'session is required' }, 400) };
  };

  ctx.registerApiRoute({
    path: 'tasks', method: 'GET', access: 'user',
    handler: async (req) => {
      const resolved = routeKey(req);
      if (resolved.error) return resolved.error;
      try { return jsonRes({ tasks: store.list(resolved.key) }); }
      catch (error) { return jsonRes({ error: safeError(ctx, error) }, 503); }
    },
  });

  ctx.registerApiRoute({
    path: 'task', method: 'PATCH', access: 'user',
    handler: async (req) => {
      const resolved = routeKey(req);
      if (resolved.error) return resolved.error;
      let body;
      try { body = await req.json(); } catch { return jsonRes({ error: 'invalid JSON' }, 400); }
      const status = body?.status;
      if (!TASK_STATUSES.includes(status)) return jsonRes({ error: 'invalid task status' }, 400);
      try {
        const taskId = String(body?.taskId ?? '');
        store.update(resolved.key, taskId, { status });
        return jsonRes({ task: store.get(resolved.key, taskId), tasks: store.list(resolved.key) });
      } catch (error) {
        const message = safeError(ctx, error);
        return jsonRes({ error: message }, message === 'task not found' ? 404 : 503);
      }
    },
  });

  ctx.registerApiRoute({
    path: 'task', method: 'DELETE', access: 'user',
    handler: async (req) => {
      const resolved = routeKey(req);
      if (resolved.error) return resolved.error;
      try {
        const result = store.delete(resolved.key, req.query.taskId);
        return jsonRes({ ...result, tasks: store.list(resolved.key) });
      }
      catch (error) {
        const message = safeError(ctx, error);
        return jsonRes({ error: message }, message === 'task not found' ? 404 : 503);
      }
    },
  });

  ctx.registerApiRoute({
    path: 'tasks', method: 'DELETE', access: 'user',
    handler: async (req) => {
      const resolved = routeKey(req);
      if (resolved.error) return resolved.error;
      const scope = String(req.query.scope ?? '');
      if (scope !== 'completed' && scope !== 'all') return jsonRes({ error: 'invalid clear scope' }, 400);
      try {
        const removed = store.clear(resolved.key, scope);
        return jsonRes({ success: true, removed, tasks: store.list(resolved.key) });
      } catch (error) {
        return jsonRes({ error: safeError(ctx, error) }, 503);
      }
    },
  });

  ctx.registerTool(defineTool({
    name: 'TaskCreate',
    label: 'Create tasks',
    description: 'Create one or more NEW pending tasks in the current conversation task list and return the ID assigned to each. Send the whole plan as a SINGLE call with every task in the tasks array, in the order they should appear — do not call this once per task. Use it only to add work that is not on the list yet: to change work that already exists, call TaskUpdate with that task ID instead. Per task, use subject for the short user-visible outcome, description for private working context, activeForm for present-continuous progress text, and metadata for private structured context. Declare prerequisites right here instead of following up with TaskUpdate: blockedBy takes IDs of tasks that ALREADY exist, and blockedByIndex takes 1-based positions within this same call, so a task can depend on a sibling that has no ID yet. The whole batch is rejected together if a dependency is missing, self-referential or cyclic. Keep the returned IDs: they are the only valid handles for later TaskGet and TaskUpdate calls.',
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          subject: Type.String({ description: 'Brief user-visible title for the task' }),
          description: Type.String({ description: 'Private detail describing what needs to be done' }),
          activeForm: Type.Optional(Type.String({ description: 'Present-continuous text shown while the task is in progress' })),
          metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Private structured metadata' })),
          blockedBy: Type.Optional(Type.Array(Type.String(), { description: 'IDs of ALREADY EXISTING tasks that must finish before this one' })),
          // Type.Number, not Type.Integer: the typebox build the daemon loads plugins against does not
          // expose Integer. create() enforces whole numbers in range itself.
          blockedByIndex: Type.Optional(Type.Array(Type.Number({ minimum: 1 }), { description: '1-based positions of tasks in THIS call that must finish before this one' })),
        }),
        { minItems: 1, description: 'Every task to create, in order. Send the whole plan at once rather than one call per task.' },
      ),
    }),
    execute: async (_id, params) => {
      try {
        const key = keyFor(ctx);
        if (!key) throw new Error('a task list belongs to a conversation, and this turn has none');
        const inputs = params.tasks;
        if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('tasks must be a non-empty array of tasks to create');
        const usable = (value) => typeof value === 'string' && value.trim() !== '';
        if (!inputs.every((input) => input && usable(input.subject) && usable(input.description))) {
          throw new Error('every task needs a non-empty subject and description');
        }
        const tasks = store.create(key, inputs);
        syncCard(ctx, store, key);
        return ok({ tasks });
      } catch (error) { return fail(safeError(ctx, error)); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TaskGet',
    label: 'Get task',
    description: 'Retrieve one EXISTING task by ID, including its private description and dependency graph. The detailed result is model-only and is not shown in the Todo panel. A null task means that ID does not exist; call TaskList to see the current IDs instead of trying other ones.',
    parameters: Type.Object({ taskId: Type.String({ description: 'ID of an existing task, exactly as returned by TaskCreate or TaskList. Never invent or guess an ID.' }) }),
    execute: async (_id, { taskId }) => {
      try {
        const key = keyFor(ctx);
        return ok({ task: key ? taskForGet(store.get(key, taskId)) : null });
      } catch (error) { return fail(safeError(ctx, error)); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TaskList',
    label: 'List tasks',
    description: 'List the current conversation tasks with public status, owner and unresolved blockers. Private descriptions and metadata are omitted. This is the authoritative set of task IDs: call it whenever you are unsure which tasks exist, and always after a TaskUpdate or TaskGet reported that an ID was not found. An empty list means there is nothing to update — create what you need with TaskCreate.',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const key = keyFor(ctx);
        const tasks = syncCard(ctx, store, key);
        return ok({ tasks: tasksForList(tasks) });
      } catch (error) { return fail(safeError(ctx, error)); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TaskUpdate',
    label: 'Update task',
    description: 'Update one EXISTING task incrementally, identified by an ID that TaskCreate returned or TaskList reported. It never creates a task: an unknown ID fails with error "task not found", and the fix is to call TaskList and retry with a current ID (or TaskCreate if the work is genuinely new) — never to guess another ID or repeat the same call. Status is pending, in_progress, completed, or deleted. addBlockedBy adds prerequisites; addBlocks makes this task a prerequisite of other tasks. Dependency changes reject missing tasks, self-dependencies and cycles; repeated edges are idempotent.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'ID of an existing task, exactly as returned by TaskCreate or TaskList. Never invent or guess an ID.' }),
      subject: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      activeForm: Type.Optional(Type.String()),
      status: Type.Optional(Type.Union([...TASK_STATUSES.map((status) => Type.Literal(status)), Type.Literal('deleted')])),
      addBlocks: Type.Optional(Type.Array(Type.String())),
      addBlockedBy: Type.Optional(Type.Array(Type.String())),
      owner: Type.Optional(Type.String()),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Keys merge; null deletes a key' })),
    }),
    execute: async (_id, params) => {
      const key = keyFor(ctx);
      const taskId = String(params.taskId ?? '');
      if (!key) return ok({ success: false, taskId, updatedFields: [], error: 'task list unavailable outside a conversation' });
      try {
        const result = store.update(key, taskId, params);
        syncCard(ctx, store, key);
        return ok(result);
      } catch (error) {
        const message = safeError(ctx, error);
        // A missing ID is the one failure the model reliably retries blind — usually after the task was
        // deleted, so the turn context no longer lists it either. Say what recovers it instead of leaving
        // the model to guess another ID. The tool still refuses to create anything.
        return ok({
          success: false, taskId, updatedFields: [], error: message,
          ...(message === 'task not found' ? { hint: NOT_FOUND_HINT } : {}),
        });
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TaskDelete',
    label: 'Delete task',
    description: 'Delete one EXISTING task from the current conversation task list. This permanently removes the task and every blocker edge that points to or from it. Use the exact ID returned by TaskCreate or TaskList; an unknown ID fails and does not affect any other task.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'ID of an existing task, exactly as returned by TaskCreate or TaskList. Never invent or guess an ID.' }),
    }),
    execute: async (_id, { taskId }) => {
      const key = keyFor(ctx);
      const id = String(taskId ?? '');
      if (!key) return ok({ success: false, taskId: id, error: 'task list unavailable outside a conversation' });
      try {
        const result = store.delete(key, id);
        syncCard(ctx, store, key);
        return ok(result);
      } catch (error) {
        const message = safeError(ctx, error);
        return ok({
          success: false, taskId: id, error: message,
          ...(message === 'task not found' ? { hint: NOT_FOUND_HINT } : {}),
        });
      }
    },
  }));

  ctx.registerTurnContext(() => {
    try {
      const key = keyFor(ctx);
      // Core calls turn-context providers only while composing a fresh prompt turn. Mid-turn steers go
      // straight into PI's queue and never pass this seam, so ids held by the running turn cannot be cleared.
      if (key) store.ageCompletedAtTurnBoundary(key);
      const tasks = syncCard(ctx, store, key);
      return tasks.length ? renderTaskContext(tasks) : '';
    } catch (error) {
      safeError(ctx, error);
      return '';
    }
  }, { placement: 'after-user' });

  ctx.registerSystemPromptFragment(
    'You have a session task list (tools `TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskDelete`, `TaskList`). Use it for genuinely multi-step work and update tasks incrementally by ID. `TaskCreate` takes the WHOLE plan in one call — pass every task in its `tasks` array, with prerequisites declared inline, instead of calling it once per task — and returns the new IDs; `TaskUpdate` only changes a task that already exists and never creates one. `TaskDelete` permanently removes one existing task and its dependency edges. Never guess a task ID — use the ID `TaskCreate` returned or one `TaskList` reported, and when an update or delete reports that an ID was not found, call `TaskList` and act on the current IDs rather than retrying. The user sees public progress automatically in the Todo panel; descriptions and metadata remain private, and the list must not be repeated in the reply.',
  );

  ctx.logger.info('session task tools registered (TaskCreate + TaskGet + TaskUpdate + TaskDelete + TaskList)');
}
