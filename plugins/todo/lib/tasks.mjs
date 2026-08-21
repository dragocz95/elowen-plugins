import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { fail, keyFor, ok, parseObject } from './common.mjs';
import { pushTaskCard, renderTaskContext, renderTaskMarkdown } from './render.mjs';

const TASK_STATUSES = ['pending', 'in_progress', 'completed'];
const TASK_STATUS_SCHEMA = Type.Union(TASK_STATUSES.map((status) => Type.Literal(status)));

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

class TaskStore {
  constructor(db) {
    this.db = db;
    this.insertList = db.prepare('INSERT OR IGNORE INTO p_todo_task_lists(list_key,next_id) VALUES (?,1)');
    this.readList = db.prepare('SELECT next_id FROM p_todo_task_lists WHERE list_key = ?');
    this.bumpList = db.prepare('UPDATE p_todo_task_lists SET next_id = ? WHERE list_key = ?');
    this.countTasks = db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) completed FROM p_todo_tasks WHERE list_key = ?");
    this.selectTasks = db.prepare('SELECT id,subject,description,active_form,status,owner,metadata_json FROM p_todo_tasks WHERE list_key = ? ORDER BY id');
    this.selectBlockers = db.prepare('SELECT task_id,blocker_id FROM p_todo_task_blockers WHERE list_key = ? ORDER BY task_id,blocker_id');
    this.insertTask = db.prepare('INSERT INTO p_todo_tasks(list_key,id,subject,description,active_form,status,owner,metadata_json) VALUES (?,?,?,?,?,?,?,?)');
    this.updateTask = db.prepare('UPDATE p_todo_tasks SET subject=?,description=?,active_form=?,status=?,owner=?,metadata_json=? WHERE list_key=? AND id=?');
    this.deleteTask = db.prepare('DELETE FROM p_todo_tasks WHERE list_key = ? AND id = ?');
    this.deleteTaskEdges = db.prepare('DELETE FROM p_todo_task_blockers WHERE list_key = ? AND (task_id = ? OR blocker_id = ?)');
    this.deleteAllTasks = db.prepare('DELETE FROM p_todo_tasks WHERE list_key = ?');
    this.deleteAllEdges = db.prepare('DELETE FROM p_todo_task_blockers WHERE list_key = ?');
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

  create(key, input) {
    return this.db.transaction(() => {
      this.#ensureList(key);
      const counts = this.countTasks.get(key) ?? { total: 0, completed: 0 };
      const total = Number(counts.total ?? 0);
      if (total > 0 && Number(counts.completed ?? 0) === total) {
        this.deleteAllEdges.run(key);
        this.deleteAllTasks.run(key);
      }
      const list = this.readList.get(key);
      const id = Number(list?.next_id ?? 1);
      this.bumpList.run(id + 1, key);
      const metadata = parseObject(input.metadata);
      this.insertTask.run(
        key, id, String(input.subject), String(input.description),
        input.activeForm == null ? null : String(input.activeForm),
        'pending', null, metadataToJson(metadata),
      );
      return { id: String(id), subject: String(input.subject) };
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
      const edges = new Map();
      for (const item of tasks) {
        for (const blockerId of item.blockedBy) {
          if (!edges.has(blockerId)) edges.set(blockerId, new Set());
          edges.get(blockerId).add(item.id);
        }
      }

      const additions = [];
      for (const blockerId of patch.addBlockedBy ?? []) additions.push([String(blockerId), String(taskId)]);
      for (const blockedId of patch.addBlocks ?? []) additions.push([String(taskId), String(blockedId)]);
      let dependencyChanged = false;
      for (const [blockerId, blockedId] of additions) {
        if (blockerId === blockedId) throw new Error('a task cannot depend on itself');
        if (!byId.has(blockerId) || !byId.has(blockedId)) throw new Error('dependency task not found');
        if (edges.get(blockerId)?.has(blockedId)) continue;
        if (reaches(edges, blockedId, blockerId)) throw new Error('dependency cycle detected');
        if (!edges.has(blockerId)) edges.set(blockerId, new Set());
        edges.get(blockerId).add(blockedId);
        this.insertEdge.run(key, Number(blockedId), Number(blockerId));
        dependencyChanged = true;
      }
      if (dependencyChanged) updatedFields.push('dependencies');

      this.updateTask.run(
        next.subject, next.description, next.activeForm ?? null, next.status,
        next.owner ?? null, metadataToJson(next.metadata), key, taskId,
      );

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
  'task not found',
  'nothing to update',
  'a task cannot depend on itself',
  'dependency task not found',
  'dependency cycle detected',
]);

function safeError(ctx, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (SAFE_ERRORS.has(message)) return message;
  ctx.logger.warn(`session task storage failed: ${message}`);
  return 'task storage unavailable';
}

export function registerTaskMode(ctx, db) {
  db.migrate(TASK_MIGRATIONS);
  const store = new TaskStore(db);

  ctx.registerTool(defineTool({
    name: 'TaskCreate',
    label: 'Create task',
    description: 'Create one pending task in the current conversation task list. Use subject for the short user-visible outcome, description for private working context, activeForm for present-continuous progress text, and metadata for private structured context.',
    parameters: Type.Object({
      subject: Type.String({ description: 'Brief user-visible title for the task' }),
      description: Type.String({ description: 'Private detail describing what needs to be done' }),
      activeForm: Type.Optional(Type.String({ description: 'Present-continuous text shown while the task is in progress' })),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Private structured metadata' })),
    }),
    execute: async (_id, params) => {
      try {
        const key = keyFor(ctx);
        if (!key) throw new Error('a task list belongs to a conversation, and this turn has none');
        const task = store.create(key, params);
        syncCard(ctx, store, key);
        return ok({ task });
      } catch (error) { return fail(safeError(ctx, error)); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TaskGet',
    label: 'Get task',
    description: 'Retrieve one task by ID, including its private description and dependency graph. The detailed result is model-only and is not shown in the Todo panel.',
    parameters: Type.Object({ taskId: Type.String({ description: 'Task ID from TaskCreate or TaskList' }) }),
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
    description: 'List the current conversation tasks with public status, owner and unresolved blockers. Private descriptions and metadata are omitted.',
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
    description: 'Update one task incrementally. Status is pending, in_progress, completed, or deleted. addBlockedBy adds prerequisites; addBlocks makes this task a prerequisite of other tasks. Dependency changes reject missing tasks, self-dependencies and cycles; repeated edges are idempotent.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'Task ID to update' }),
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
        return ok({ success: false, taskId, updatedFields: [], error: safeError(ctx, error) });
      }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TodoRead',
    label: 'Read tasks',
    description: 'Return the active session task list as a public markdown checklist and refresh the Todo panel. Private descriptions and metadata are omitted.',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const key = keyFor(ctx);
        const tasks = syncCard(ctx, store, key);
        return ok(renderTaskMarkdown(tasks));
      } catch (error) { return fail(safeError(ctx, error)); }
    },
  }));

  ctx.registerTurnContext(() => {
    try {
      const key = keyFor(ctx);
      const tasks = syncCard(ctx, store, key);
      return tasks.length ? renderTaskContext(tasks) : '';
    } catch (error) {
      safeError(ctx, error);
      return '';
    }
  }, { placement: 'after-user' });

  ctx.registerSystemPromptFragment(
    'You have a session task list (tools `TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskList`, `TodoRead`). Use it for genuinely multi-step work and update tasks incrementally by ID. The user sees public progress automatically in the Todo panel; descriptions and metadata remain private, and the list must not be repeated in the reply.',
  );

  ctx.logger.info('session task tools registered (TaskCreate + TaskGet + TaskUpdate + TaskList + TodoRead)');
}
