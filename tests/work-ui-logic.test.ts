/** The work bundle's pure logic: bucketing, filter counts, the calendar grid, task vocabulary, the
 *  drag rules, the timeline axis and the context-menu spec.
 *
 *  Every one of these modules reaches for `window.ElowenUiRuntime` at module scope (they pull React and
 *  the host helpers off it), so the runtime is installed BEFORE the dynamic import — the same order the
 *  host page uses in the browser. A static import would run first and blow up on an absent runtime. */
import { describe, it, expect } from 'vitest';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { cs, en } from './ui/hostDictionary';

ensurePluginUiRuntime();

const { groupByStatus } = await import('../plugins/work/web-src/kanban/groupByStatus');
const { taskFilterCounts } = await import('../plugins/work/web-src/tasks/taskFilters');
const { taskDayMs, isUnscheduled } = await import('../plugins/work/web-src/tasks/dateRange');
const { dayKey, tasksByDay, countUnscheduled, startOfWeek, weekDays, monthMatrix, shift } = await import('../plugins/work/web-src/kanban/calendar');
const { taskTypeMeta, statusLabel, taskTypeLabel, TASK_TYPES, PRIORITIES } = await import('../plugins/work/web-src/tasks/taskMeta');
const { canDropOnTask, canReparent } = await import('../plugins/work/web-src/tasks/useTaskDrop');
const { eventTone, eventIcon, markerTone } = await import('../plugins/work/web-src/timeline/eventMeta');
const { plotAxis, groupEvents } = await import('../plugins/work/web-src/timeline/axis');
const { buildTaskMenu, SPEC_DIVIDER } = await import('../plugins/work/web-src/tasks/taskContextMenu');

import type { Task } from '../plugins/work/web-src/types';
import type { TaskMenuCtx, TaskMenuActionId, TaskMenuSubmenuId, TaskMenuEntry, TaskMenuOption } from '../plugins/work/web-src/tasks/taskContextMenu';

// ── kanban buckets ───────────────────────────────────────────────────────────

describe('groupByStatus', () => {
  const t = (id: string, status: Task['status']): Task => ({ id, title: id, status });

  it('buckets tasks by status with every status key present', () => {
    const g = groupByStatus([t('a', 'open'), t('b', 'open'), t('c', 'blocked')]);
    expect(g.open.map((x) => x.id)).toEqual(['a', 'b']);
    expect(g.blocked.map((x) => x.id)).toEqual(['c']);
    expect(g.in_progress).toEqual([]);
    expect(g.closed).toEqual([]);
    expect(g.cancelled).toEqual([]);
  });
  it('returns all-empty buckets for no tasks', () => {
    const g = groupByStatus([]);
    expect(g).toEqual({ open: [], in_progress: [], blocked: [], closed: [], cancelled: [] });
  });
});

// ── filter counts ────────────────────────────────────────────────────────────

describe('taskFilterCounts', () => {
  it('counts top-level tasks with effective epic status and a separate autopilot total', () => {
    const tasks = [
      { id: 'active', title: 'Active', status: 'in_progress', type: 'task', labels: [] },
      { id: 'open', title: 'Open', status: 'open', type: 'task', labels: [] },
      { id: 'blocked', title: 'Blocked', status: 'blocked', type: 'task', labels: [] },
      { id: 'closed', title: 'Closed', status: 'closed', type: 'task', labels: [] },
      { id: 'epic', title: 'Epic', status: 'open', type: 'epic', labels: [] },
      { id: 'phase', parent_id: 'epic', title: 'Phase', status: 'open', type: 'task', labels: [] },
    ] as Task[];

    expect(taskFilterCounts(tasks, [])).toEqual({
      in_progress: 1,
      open: 2,
      blocked: 1,
      closed: 1,
      autopilot: 1,
      all: 5,
    });
  });
});

// ── task dates ───────────────────────────────────────────────────────────────

describe('dateRange (task-specific helpers)', () => {
  it('isUnscheduled: true when neither scheduled_at nor closed_at is set', () => {
    const base = { id: '1', title: 'T', status: 'open' as const, created_at: '2026-06-01T10:00:00Z' };
    expect(isUnscheduled({ ...base })).toBe(true);
    // null values are also unscheduled
    expect(isUnscheduled({ ...base, scheduled_at: null, closed_at: null })).toBe(true);
    // in_progress with no schedule — must stay visible
    expect(isUnscheduled({ ...base, status: 'in_progress' as const })).toBe(true);
  });

  it('isUnscheduled: false when scheduled_at or closed_at is present', () => {
    const base = { id: '1', title: 'T', status: 'open' as const, created_at: '2026-06-01T10:00:00Z' };
    expect(isUnscheduled({ ...base, scheduled_at: '2026-06-20T09:00:00Z' })).toBe(false);
    expect(isUnscheduled({ ...base, closed_at: '2026-06-10T10:00:00Z' })).toBe(false);
    expect(isUnscheduled({ ...base, scheduled_at: '2026-06-20T09:00:00Z', closed_at: '2026-06-10T10:00:00Z' })).toBe(false);
  });

  it('taskDayMs returns scheduled_at over closed_at over created_at, 0 for dateless', () => {
    const base = { id: '1', title: 'T', status: 'open' as const, created_at: '2026-06-01T10:00:00Z', closed_at: null as null, scheduled_at: null as null };
    expect(taskDayMs({ ...base })).toBe(new Date('2026-06-01T10:00:00Z').getTime());
    expect(taskDayMs({ ...base, closed_at: '2026-06-10T10:00:00Z' })).toBe(new Date('2026-06-10T10:00:00Z').getTime());
    expect(taskDayMs({ ...base, scheduled_at: '2026-06-20T09:00:00Z', closed_at: '2026-06-10T10:00:00Z' })).toBe(new Date('2026-06-20T09:00:00Z').getTime());
    // No date fields at all → 0 (dateless tasks never hide from any filter)
    expect(taskDayMs({ id: '2', title: 'T', status: 'open' as const })).toBe(0);
  });
});

// ── calendar grid ────────────────────────────────────────────────────────────

describe('calendar helpers', () => {
  const t = (id: string, scheduled_at: string | null): Task => ({ id, title: id, status: 'open', scheduled_at });

  it('groups scheduled tasks by local day and skips unscheduled', () => {
    const map = tasksByDay([t('a', '2026-06-17T09:00:00.000Z'), t('b', null), t('c', '2026-06-17T20:00:00.000Z')]);
    const day = new Date('2026-06-17T09:00:00.000Z');
    expect(map.get(dayKey(day))?.map((x) => x.id).sort()).toEqual(['a', 'c']);
    expect(countUnscheduled([t('a', '2026-06-17T09:00:00.000Z'), t('b', null)])).toBe(1);
  });

  it('places completed tasks on their closed day even without a schedule', () => {
    const closed: Task = { id: 'done', title: 'done', status: 'closed', scheduled_at: null, closed_at: '2026-06-15T14:00:00.000Z' };
    const map = tasksByDay([closed]);
    expect(map.get(dayKey(new Date('2026-06-15T14:00:00.000Z')))?.map((x) => x.id)).toEqual(['done']);
    expect(countUnscheduled([closed])).toBe(0); // has a calendar date now
  });

  it('startOfWeek returns the Monday', () => {
    const wed = new Date(2026, 5, 17); // Wed Jun 17 2026
    const mon = startOfWeek(wed);
    expect(mon.getDay()).toBe(1); // Monday
    expect(weekDays(wed)).toHaveLength(7);
    expect(weekDays(wed)[0]!.getDay()).toBe(1);
  });

  it('monthMatrix rows are 7 wide and include the month', () => {
    const weeks = monthMatrix(new Date(2026, 5, 17));
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().some((d) => d.getMonth() === 5 && d.getDate() === 17)).toBe(true);
  });

  it('shift moves by day/week/month', () => {
    const ref = new Date(2026, 5, 17);
    expect(shift(ref, 'day', 1).getDate()).toBe(18);
    expect(shift(ref, 'week', -1).getDate()).toBe(10);
    expect(shift(ref, 'month', 1).getMonth()).toBe(6);
  });
});

// ── task vocabulary ──────────────────────────────────────────────────────────

describe('taskTypeMeta', () => {
  it('maps known types to a label and tone', () => {
    expect(taskTypeMeta('bug').label).toBe('Bug');
    expect(taskTypeMeta('bug').tone).toBe('danger');
    expect(taskTypeMeta('epic').label).toBe('Epic');
  });
  it('falls back for unknown types without throwing', () => {
    const meta = taskTypeMeta('whatever');
    expect(meta.label).toBe('whatever');
    expect(meta.icon).toBeTruthy();
  });
  it('defaults to task when type is undefined', () => {
    expect(taskTypeMeta(undefined).label).toBe('Task');
  });
  it('exposes the type and priority option lists', () => {
    expect(TASK_TYPES).toContain('feature');
    expect(PRIORITIES).toEqual(['P0', 'P1', 'P2', 'P3']);
  });
});

describe('statusLabel', () => {
  it('maps known statuses through the dictionary (EN + CS)', () => {
    expect(statusLabel(en, 'in_progress')).toBe(en.tasks.statusInProgress);
    expect(statusLabel(en, 'cancelled')).toBe(en.tasks.statusCancelled);
    expect(statusLabel(cs, 'blocked')).toBe(cs.tasks.statusBlocked);
  });
  it('falls back to the raw status for unknown values', () => {
    expect(statusLabel(en, 'mystery')).toBe('mystery');
  });
});

describe('taskTypeLabel', () => {
  it('maps known types through the dictionary (EN + CS)', () => {
    expect(taskTypeLabel(en, 'bug')).toBe(en.tasks.typeBug);
    expect(taskTypeLabel(cs, 'feature')).toBe(cs.tasks.typeFeature);
  });
  it('falls back to the English meta label for unknown types', () => {
    expect(taskTypeLabel(en, 'whatever')).toBe('whatever');
  });
});

// ── drag rules ───────────────────────────────────────────────────────────────

describe('canDropOnTask', () => {
  const task = (over: Partial<Task> & { id: string }): Task => ({ title: over.id, status: 'open', project_id: 1, ...over });

  it('rejects dropping a task onto itself', () => {
    const a = task({ id: 'a' });
    expect(canDropOnTask(a, a, new Set())).toBe(false);
  });
  it('rejects a cross-project drop', () => {
    const a = task({ id: 'a', project_id: 1 });
    const b = task({ id: 'b', project_id: 2 });
    expect(canDropOnTask(a, b, new Set())).toBe(false);
  });
  it('rejects when the dragged task is already a phase', () => {
    const a = task({ id: 'a', parent_id: 'epic' });
    const b = task({ id: 'b' });
    expect(canDropOnTask(a, b, new Set())).toBe(false);
    expect(canDropOnTask(task({ id: 'c' }), b, new Set(['c']))).toBe(false);
  });
  it('rejects when the target is already a phase', () => {
    const a = task({ id: 'a' });
    const b = task({ id: 'b', parent_id: 'epic' });
    expect(canDropOnTask(a, b, new Set())).toBe(false);
    expect(canDropOnTask(a, task({ id: 'd' }), new Set(['d']))).toBe(false);
  });
  it('allows a valid standalone-onto-standalone drop', () => {
    const a = task({ id: 'a' });
    const b = task({ id: 'b' });
    expect(canDropOnTask(a, b, new Set())).toBe(true);
  });
  it('allows dropping an epic-with-children onto a plain task (dependency is still legal)', () => {
    const epic = task({ id: 'epic', type: 'epic' });
    const b = task({ id: 'b' });
    expect(canDropOnTask(epic, b, new Set())).toBe(true);
  });
});

describe('canReparent', () => {
  const task = (over: Partial<Task> & { id: string }): Task => ({ title: over.id, status: 'open', project_id: 1, ...over });

  it('true when the dragged task has no children', () => {
    expect(canReparent(task({ id: 'a' }), new Map())).toBe(true);
  });
  it('false when the dragged task already has children (no nested epics)', () => {
    const childMap = new Map([['epic', [task({ id: 'phase' })]]]);
    expect(canReparent(task({ id: 'epic' }), childMap)).toBe(false);
  });
});

// ── timeline vocabulary ──────────────────────────────────────────────────────

describe('eventTone', () => {
  it('maps types to tones', () => {
    expect(eventTone('task')).toBe('accent');
    expect(eventTone('mission')).toBe('accent');
    expect(eventTone('signal')).toBe('muted');
    expect(eventTone('other')).toBe('default');
  });
});

describe('eventIcon', () => {
  it('returns a distinct icon per known type and a fallback otherwise', () => {
    expect(eventIcon('task')).not.toBe(eventIcon('mission'));
    expect(eventIcon('review')).not.toBe(eventIcon('signal'));
    expect(eventIcon('whatever')).toBe(eventIcon('whatever')); // stable fallback
  });
});

describe('markerTone', () => {
  it('colours review verdicts by their outcome prefix', () => {
    expect(markerTone('review', 'approved: looks good')).toBe('success');
    expect(markerTone('review', 'escalated: missing tests')).toBe('danger');
  });
  it('colours task statuses (open green, closed red, working amber)', () => {
    expect(markerTone('task', 'open')).toBe('success');
    expect(markerTone('task', 'closed')).toBe('danger');
    expect(markerTone('signal', 'working')).toBe('warning');
  });
  it('falls back to the kind tone for an unknown detail', () => {
    expect(markerTone('mission', 'whatever')).toBe('accent');
  });
});

// ── timeline axis ────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
// Fixed "now": 2026-06-17T12:00:00Z
const NOW = Date.parse('2026-06-17T12:00:00Z');
const HOURS = 12;
const WINDOW_START = NOW - HOURS * HOUR_MS;

function makeEvent(id: string, offsetMs: number) {
  return { id, type: 'task', target: `t-${id}`, detail: 'open', timestamp: NOW - offsetMs };
}

describe('plotAxis', () => {
  it('always generates the requested number of ticks', () => {
    const { ticks } = plotAxis([], NOW, HOURS);
    expect(ticks).toHaveLength(HOURS);
  });

  it('tick labels are HH:MM formatted UTC strings', () => {
    const { ticks } = plotAxis([], NOW, HOURS);
    for (const tick of ticks) {
      expect(tick.label).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('tick fracs are monotonically increasing and in (0, 1]', () => {
    const { ticks } = plotAxis([], NOW, HOURS);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].frac).toBeGreaterThan(ticks[i - 1].frac);
    }
    expect(ticks[ticks.length - 1].frac).toBeCloseTo(1, 5);
  });

  it('maps an event at "now" to frac ≈ 1', () => {
    const { points } = plotAxis([makeEvent('a', 0)], NOW, HOURS);
    expect(points).toHaveLength(1);
    expect(points[0].frac).toBeCloseTo(1, 5);
  });

  it('maps an event at the start of the window to frac ≈ 0', () => {
    const event = { id: 'b', type: 'task', target: 't', detail: 'd', timestamp: WINDOW_START };
    const { points } = plotAxis([event], NOW, HOURS);
    expect(points).toHaveLength(1);
    expect(points[0].frac).toBeCloseTo(0, 5);
  });

  it('maps an event at the midpoint to frac ≈ 0.5', () => {
    const mid = { id: 'c', type: 'task', target: 't', detail: 'd', timestamp: WINDOW_START + (HOURS / 2) * HOUR_MS };
    const { points } = plotAxis([mid], NOW, HOURS);
    expect(points[0].frac).toBeCloseTo(0.5, 5);
  });

  it('drops events before the window', () => {
    const old = { id: 'd', type: 'task', target: 't', detail: 'd', timestamp: WINDOW_START - 1 };
    const { points } = plotAxis([old], NOW, HOURS);
    expect(points).toHaveLength(0);
  });

  it('drops events after now', () => {
    const future = { id: 'e', type: 'task', target: 't', detail: 'd', timestamp: NOW + 1 };
    const { points } = plotAxis([future], NOW, HOURS);
    expect(points).toHaveLength(0);
  });

  it('empty events → no points, ticks still present', () => {
    const { ticks, points } = plotAxis([], NOW, HOURS);
    expect(points).toHaveLength(0);
    expect(ticks).toHaveLength(HOURS);
  });

  it('preserves all event fields in the output point', () => {
    const e = { id: 'z', type: 'mission', target: 'my-target', detail: 'active', timestamp: NOW - HOUR_MS };
    const { points } = plotAxis([e], NOW, HOURS);
    expect(points[0]).toMatchObject({ id: 'z', type: 'mission', target: 'my-target', detail: 'active', count: 1 });
  });

  it('collapses a flood of identical signals into one point with a count', () => {
    // 5 "working" signals 5s apart — should render as a single marker ×5.
    const flood = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      type: 'signal',
      target: 'agent-1',
      detail: 'working',
      timestamp: NOW - HOUR_MS + i * 5_000,
    }));
    const { points } = plotAxis(flood, NOW, HOURS);
    expect(points).toHaveLength(1);
    expect(points[0].count).toBe(5);
  });
});

describe('groupEvents', () => {
  const sig = (id: string, target: string, detail: string, timestamp: number) => ({
    id,
    type: 'signal',
    target,
    detail,
    timestamp,
  });

  it('collapses consecutive identical events into one with a count', () => {
    const events = [
      sig('a', 'agent-1', 'working', NOW),
      sig('b', 'agent-1', 'working', NOW + 5_000),
      sig('c', 'agent-1', 'working', NOW + 10_000),
    ];
    const groups = groupEvents(events);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].firstTimestamp).toBe(NOW);
    expect(groups[0].timestamp).toBe(NOW + 10_000); // keeps latest timestamp
    expect(groups[0].id).toBe('c'); // keeps latest id
  });

  it('keeps distinct events separate', () => {
    const events = [
      sig('a', 'agent-1', 'working', NOW),
      sig('b', 'agent-2', 'working', NOW + 5_000),
      sig('c', 'agent-1', 'idle', NOW + 10_000),
    ];
    const groups = groupEvents(events);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.count === 1)).toBe(true);
  });

  it('does not merge identical events separated by a large gap', () => {
    const events = [
      sig('a', 'agent-1', 'working', NOW),
      sig('b', 'agent-1', 'working', NOW + 30 * 60 * 1000), // 30 min later
    ];
    const groups = groupEvents(events);
    expect(groups).toHaveLength(2);
  });

  it('sorts unordered input by timestamp before grouping', () => {
    const events = [
      sig('b', 'agent-1', 'working', NOW + 5_000),
      sig('a', 'agent-1', 'working', NOW),
      sig('c', 'agent-1', 'working', NOW + 10_000),
    ];
    const groups = groupEvents(events);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
  });

  it('does not mutate the input array', () => {
    const events = [sig('a', 'agent-1', 'working', NOW + 5_000), sig('b', 'agent-1', 'working', NOW)];
    const snapshot = events.map((e) => e.id);
    groupEvents(events);
    expect(events.map((e) => e.id)).toEqual(snapshot);
  });

  it('returns empty for empty input', () => {
    expect(groupEvents([])).toEqual([]);
  });
});

// ── context-menu spec ────────────────────────────────────────────────────────

describe('buildTaskMenu', () => {
  const task = (over: Partial<Task> & { id: string }): Task => ({ title: over.id, status: 'open', ...over });

  const ctx = (over: Partial<TaskMenuCtx> & { task: Task; kind: TaskMenuCtx['kind'] }): TaskMenuCtx => ({
    running: false, hasSession: false, hasBlockers: false, isGated: false, canMutate: true,
    models: [{ label: 'Sonnet', exec: 'sonnet' }, { label: 'Opus', exec: 'opus' }], currentExec: '',
    ...over,
  });

  /** Ids of leaf actions present in the spec. */
  const ids = (entries: TaskMenuEntry[]): TaskMenuActionId[] =>
    entries.filter((e): e is Extract<TaskMenuEntry, { kind: 'item' }> => e !== SPEC_DIVIDER && e.kind === 'item').map((e) => e.id);
  /** A leaf action's enabled flag, or undefined when the action is absent. */
  const enabled = (entries: TaskMenuEntry[], id: TaskMenuActionId): boolean | undefined =>
    entries.find((e): e is Extract<TaskMenuEntry, { kind: 'item' }> => e !== SPEC_DIVIDER && e.kind === 'item' && e.id === id)?.enabled;
  const submenu = (entries: TaskMenuEntry[], id: TaskMenuSubmenuId): Extract<TaskMenuEntry, { kind: 'submenu' }> | undefined =>
    entries.find((e): e is Extract<TaskMenuEntry, { kind: 'submenu' }> => e !== SPEC_DIVIDER && e.kind === 'submenu' && e.id === id);

  it('a running standalone task offers stop/pause/terminal but not start', () => {
    const m = buildTaskMenu(ctx({ task: task({ id: 't1', status: 'in_progress' }), kind: 'standalone', running: true, hasSession: true }));
    expect(ids(m)).toContain('stop');
    expect(ids(m)).toContain('pause');
    expect(ids(m)).toContain('terminal');
    expect(ids(m)).not.toContain('start');
  });

  it('an idle standalone task with no blockers can start; with blockers start is disabled', () => {
    const idle = buildTaskMenu(ctx({ task: task({ id: 't1' }), kind: 'standalone' }));
    expect(enabled(idle, 'start')).toBe(true);
    const blocked = buildTaskMenu(ctx({ task: task({ id: 't1' }), kind: 'standalone', hasBlockers: true }));
    expect(enabled(blocked, 'start')).toBe(false);
  });

  it('a closed task offers reopen and copy/delete but no start or close', () => {
    const m = buildTaskMenu(ctx({ task: task({ id: 't1', status: 'closed' }), kind: 'standalone' }));
    expect(ids(m)).toContain('reopen');
    expect(ids(m)).not.toContain('start');
    expect(ids(m)).not.toContain('close');
    expect(ids(m)).toContain('delete');
  });

  it('a gated phase offers approveGate; an ungated one does not', () => {
    const gated = buildTaskMenu(ctx({ task: task({ id: 'p1', status: 'blocked', parent_id: 'e1' }), kind: 'phase', isGated: true }));
    expect(ids(gated)).toContain('approveGate');
    const plain = buildTaskMenu(ctx({ task: task({ id: 'p1', parent_id: 'e1' }), kind: 'phase' }));
    expect(ids(plain)).not.toContain('approveGate');
  });

  it('an epic offers runReview, addPhase and deleteMission but no run controls or planMission', () => {
    const m = buildTaskMenu(ctx({ task: task({ id: 'e1', type: 'epic' }), kind: 'epic' }));
    expect(ids(m)).toEqual(expect.arrayContaining(['runReview', 'addPhase', 'deleteMission', 'copyId']));
    expect(ids(m)).not.toContain('start');
    expect(ids(m)).not.toContain('planMission');
    expect(ids(m)).not.toContain('delete');
  });

  it('planMission is offered only on a standalone task, not a phase or epic', () => {
    expect(ids(buildTaskMenu(ctx({ task: task({ id: 't1' }), kind: 'standalone' })))).toContain('planMission');
    expect(ids(buildTaskMenu(ctx({ task: task({ id: 'p1', parent_id: 'e1' }), kind: 'phase' })))).not.toContain('planMission');
    expect(ids(buildTaskMenu(ctx({ task: task({ id: 'e1', type: 'epic' }), kind: 'epic' })))).not.toContain('planMission');
  });

  it('the model submenu lists every model plus a default option, marking the current one', () => {
    const m = buildTaskMenu(ctx({ task: task({ id: 't1' }), kind: 'standalone', currentExec: 'opus' }));
    const sm = submenu(m, 'setModel');
    expect(sm?.options.map((o: TaskMenuOption) => o.value)).toEqual(['', 'sonnet', 'opus']);
    expect(sm?.options.find((o: TaskMenuOption) => o.value === 'opus')?.current).toBe(true);
    expect(sm?.options.find((o: TaskMenuOption) => o.value === '')?.current).toBe(false);
  });

  it('the model submenu is disabled while the agent is running', () => {
    const m = buildTaskMenu(ctx({ task: task({ id: 't1', status: 'in_progress' }), kind: 'standalone', running: true, hasSession: true }));
    expect(submenu(m, 'setModel')?.enabled).toBe(false);
  });

  it('the status submenu omits in_progress and marks the current status', () => {
    const m = buildTaskMenu(ctx({ task: task({ id: 't1', status: 'blocked' }), kind: 'standalone' }));
    const sm = submenu(m, 'setStatus');
    expect(sm?.options.map((o: TaskMenuOption) => o.value)).toEqual(['open', 'blocked', 'closed', 'cancelled']);
    expect(sm?.options.find((o: TaskMenuOption) => o.value === 'blocked')?.current).toBe(true);
  });

  it('without mutate rights, mutating actions disable but open/copy/terminal stay enabled', () => {
    const m = buildTaskMenu(ctx({ task: task({ id: 't1', status: 'in_progress' }), kind: 'standalone', running: true, hasSession: true, canMutate: false }));
    expect(enabled(m, 'open')).toBe(true);
    expect(enabled(m, 'copyId')).toBe(true);
    expect(enabled(m, 'terminal')).toBe(true);
    expect(enabled(m, 'stop')).toBe(false);
    expect(enabled(m, 'edit')).toBe(false);
    expect(submenu(m, 'setPriority')?.enabled).toBe(false);
  });

  it('never starts or ends with a divider and has no consecutive dividers', () => {
    const m = buildTaskMenu(ctx({ task: task({ id: 't1' }), kind: 'standalone' }));
    expect(m[0]).not.toBe(SPEC_DIVIDER);
    expect(m[m.length - 1]).not.toBe(SPEC_DIVIDER);
    for (let i = 1; i < m.length; i++) expect(m[i] === SPEC_DIVIDER && m[i - 1] === SPEC_DIVIDER).toBe(false);
  });
});
