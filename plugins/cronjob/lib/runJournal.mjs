import { randomUUID } from 'node:crypto';

const RUN_DETAIL_DAYS = 7;
const RUN_AGGREGATE_DAYS = 90;
const RESULT_PREVIEW_CHARS = 2_000;
const DAY_MS = 86_400_000;
const ERROR_CHARS = 1_000;
const TERMINAL = new Set(['ok', 'error', 'skipped']);
const NON_TERMINAL = new Set(['waiting', 'running']);

const MIGRATIONS = [{
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS p_cronjob_runs (
        id TEXT PRIMARY KEY,
        claim_key TEXT NOT NULL UNIQUE,
        job_id TEXT NOT NULL,
        job_name TEXT NOT NULL,
        owner_user_id INTEGER,
        lifecycle TEXT NOT NULL CHECK (lifecycle IN ('recurring','oneShot')),
        schedule TEXT,
        trigger TEXT NOT NULL CHECK (trigger IN ('schedule','catchUp','manual')),
        slot_ms INTEGER,
        slot_local_date TEXT NOT NULL,
        slot_local_time TEXT NOT NULL,
        timezone TEXT NOT NULL,
        claimed_ms INTEGER NOT NULL,
        started_ms INTEGER,
        finished_ms INTEGER,
        duration_ms INTEGER,
        outcome TEXT NOT NULL CHECK (outcome IN ('waiting','running','ok','error','skipped')),
        skip_reason TEXT,
        error_message TEXT,
        preview TEXT,
        preview_truncated INTEGER NOT NULL DEFAULT 0 CHECK (preview_truncated IN (0,1)),
        session_id TEXT,
        message_id TEXT,
        delivered INTEGER NOT NULL DEFAULT 0 CHECK (delivered IN (0,1)),
        delivery_target TEXT,
        model TEXT,
        tokens_total INTEGER,
        cost_usd REAL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS p_cronjob_runs_day
        ON p_cronjob_runs(slot_local_date, started_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS p_cronjob_runs_job
        ON p_cronjob_runs(job_id, started_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS p_cronjob_runs_owner_time
        ON p_cronjob_runs(owner_user_id, started_ms DESC, id DESC);
      CREATE INDEX IF NOT EXISTS p_cronjob_runs_outcome_time
        ON p_cronjob_runs(outcome, started_ms DESC, id DESC);

      CREATE TABLE IF NOT EXISTS p_cronjob_run_daily (
        job_id TEXT NOT NULL,
        local_date TEXT NOT NULL,
        job_name TEXT NOT NULL,
        owner_user_id INTEGER,
        lifecycle TEXT NOT NULL CHECK (lifecycle IN ('recurring','oneShot')),
        schedule TEXT,
        timezone TEXT NOT NULL,
        ok_count INTEGER NOT NULL DEFAULT 0 CHECK (ok_count >= 0),
        error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
        skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
        total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
        total_duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_duration_ms >= 0),
        tokens_total INTEGER NOT NULL DEFAULT 0 CHECK (tokens_total >= 0),
        cost_usd REAL NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
        first_started_ms INTEGER NOT NULL,
        last_started_ms INTEGER NOT NULL,
        PRIMARY KEY (job_id, local_date)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS p_cronjob_run_daily_owner_date
        ON p_cronjob_run_daily(owner_user_id, local_date DESC);
      CREATE INDEX IF NOT EXISTS p_cronjob_run_daily_date
        ON p_cronjob_run_daily(local_date DESC);
    `);
  },
}];

const bounded = (value, max) => typeof value === 'string' ? value.slice(0, max) : null;
const requiredText = (value, field, max = 300) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim().slice(0, max);
};
const optionalInteger = (value, field) => {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be an integer`);
  return value;
};
const validateDate = (value) => {
  const text = requiredText(value, 'localDate', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('localDate must be YYYY-MM-DD');
  return text;
};
const validateTime = (value) => {
  const text = requiredText(value, 'localTime', 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error('localTime must be HH:mm');
  return text;
};
const actorPredicate = (actor, column = 'owner_user_id') => {
  const userId = Number.isSafeInteger(actor?.userId) ? actor.userId : null;
  if (actor?.admin === true) {
    return userId === null
      ? { sql: `${column} IS NULL`, params: [] }
      : { sql: `(${column} = ? OR ${column} IS NULL)`, params: [userId] };
  }
  return userId === null
    ? { sql: '0 = 1', params: [] }
    : { sql: `${column} = ?`, params: [userId] };
};

const cursorEncode = (startedMs, id) => Buffer.from(JSON.stringify([startedMs, id])).toString('base64url');
const cursorDecode = (value) => {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isSafeInteger(parsed[0]) || typeof parsed[1] !== 'string') return null;
    return { startedMs: parsed[0], id: parsed[1] };
  } catch {
    return null;
  }
};

const publicRow = (row) => ({
  id: row.id,
  jobId: row.job_id,
  jobName: row.job_name,
  ownerUserId: row.owner_user_id,
  lifecycle: row.lifecycle,
  schedule: row.schedule,
  trigger: row.trigger,
  localDate: row.slot_local_date,
  localTime: row.slot_local_time,
  timezone: row.timezone,
  startedAt: row.started_ms === null ? new Date(row.claimed_ms).toISOString() : new Date(row.started_ms).toISOString(),
  finishedAt: row.finished_ms === null ? null : new Date(row.finished_ms).toISOString(),
  durationMs: row.duration_ms,
  outcome: row.outcome,
  ...(row.skip_reason ? { skipReason: row.skip_reason } : {}),
  ...(row.error_message ? { errorMessage: row.error_message } : {}),
  ...(row.preview !== null ? { preview: row.preview } : {}),
  previewTruncated: row.preview_truncated === 1,
  ...(row.session_id ? { sessionId: row.session_id } : {}),
  ...(row.message_id ? { messageId: row.message_id } : {}),
  delivered: row.delivered === 1,
  ...(row.delivery_target ? { deliveryTarget: row.delivery_target } : {}),
  ...(row.model ? { model: row.model } : {}),
  ...(row.tokens_total !== null ? { tokensTotal: row.tokens_total } : {}),
  ...(row.cost_usd !== null ? { costUsd: row.cost_usd } : {}),
});

export function openRunJournal(db, options = {}) {
  db.migrate(MIGRATIONS);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const detailDays = Number.isSafeInteger(options.detailDays) ? options.detailDays : RUN_DETAIL_DAYS;
  const aggregateDays = Number.isSafeInteger(options.aggregateDays) ? options.aggregateDays : RUN_AGGREGATE_DAYS;
  const previewChars = Number.isSafeInteger(options.previewChars) ? options.previewChars : RESULT_PREVIEW_CHARS;

  const claim = (input) => {
    const claimKey = requiredText(input?.claimKey, 'claimKey', 500);
    const existing = db.prepare('SELECT id FROM p_cronjob_runs WHERE claim_key = ?').get(claimKey);
    if (existing) return { id: existing.id, created: false };
    const id = randomUUID();
    const owner = optionalInteger(input.ownerUserId, 'ownerUserId');
    const lifecycle = input.lifecycle;
    const trigger = input.trigger;
    if (lifecycle !== 'recurring' && lifecycle !== 'oneShot') throw new Error('invalid lifecycle');
    if (!['schedule', 'catchUp', 'manual'].includes(trigger)) throw new Error('invalid trigger');
    const claimedMs = Number.isSafeInteger(input.startedMs) ? input.startedMs : now();
    try {
      db.prepare(`
        INSERT INTO p_cronjob_runs (
          id,claim_key,job_id,job_name,owner_user_id,lifecycle,schedule,trigger,slot_ms,
          slot_local_date,slot_local_time,timezone,claimed_ms,outcome
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'waiting')
      `).run(
        id,
        claimKey,
        requiredText(input.jobId, 'jobId', 300),
        requiredText(input.jobName, 'jobName', 300),
        owner,
        lifecycle,
        bounded(input.schedule, 300),
        trigger,
        optionalInteger(input.slotMs, 'slotMs'),
        validateDate(input.localDate),
        validateTime(input.localTime),
        requiredText(input.timezone, 'timezone', 100),
        claimedMs,
      );
      return { id, created: true };
    } catch (error) {
      const duplicate = db.prepare('SELECT id FROM p_cronjob_runs WHERE claim_key = ?').get(claimKey);
      if (duplicate) return { id: duplicate.id, created: false };
      throw error;
    }
  };

  const start = (id, startedMs = now()) => {
    if (!Number.isSafeInteger(startedMs)) throw new Error('startedMs must be an integer');
    return db.prepare(`
      UPDATE p_cronjob_runs SET outcome='running', started_ms=?
      WHERE id=? AND outcome='waiting'
    `).run(startedMs, id).changes === 1;
  };

  const note = (id, patch = {}) => {
    const fields = [];
    const params = [];
    const assign = (field, value) => { fields.push(`${field}=?`); params.push(value); };
    if (patch.sessionId !== undefined) assign('session_id', bounded(patch.sessionId, 500));
    if (patch.messageId !== undefined) assign('message_id', bounded(patch.messageId, 500));
    if (patch.deliveryTarget !== undefined) assign('delivery_target', bounded(patch.deliveryTarget, 500));
    if (patch.model !== undefined) assign('model', bounded(patch.model, 300));
    if (patch.tokensTotal !== undefined) assign('tokens_total', optionalInteger(patch.tokensTotal, 'tokensTotal'));
    if (patch.costUsd !== undefined) {
      const cost = Number(patch.costUsd);
      if (!Number.isFinite(cost) || cost < 0) throw new Error('costUsd must be a non-negative number');
      assign('cost_usd', cost);
    }
    if (patch.delivered !== undefined) assign('delivered', patch.delivered === true ? 1 : 0);
    if (fields.length === 0) return false;
    params.push(id);
    return db.prepare(`UPDATE p_cronjob_runs SET ${fields.join(',')} WHERE id=?`).run(...params).changes === 1;
  };

  const prune = (nowMs = now()) => db.transaction(() => {
    const detailCutoff = nowMs - detailDays * DAY_MS;
    const groups = db.prepare(`
      SELECT job_id,slot_local_date,job_name,owner_user_id,lifecycle,schedule,timezone,
        SUM(CASE WHEN outcome='ok' THEN 1 ELSE 0 END) AS ok_count,
        SUM(CASE WHEN outcome='error' THEN 1 ELSE 0 END) AS error_count,
        SUM(CASE WHEN outcome='skipped' THEN 1 ELSE 0 END) AS skipped_count,
        COUNT(*) AS total_count,
        SUM(COALESCE(duration_ms,0)) AS total_duration_ms,
        SUM(COALESCE(tokens_total,0)) AS tokens_total,
        SUM(COALESCE(cost_usd,0)) AS cost_usd,
        MIN(COALESCE(started_ms,claimed_ms)) AS first_started_ms,
        MAX(COALESCE(started_ms,claimed_ms)) AS last_started_ms
      FROM p_cronjob_runs
      WHERE outcome IN ('ok','error','skipped') AND finished_ms < ?
      GROUP BY job_id,slot_local_date
    `).all(detailCutoff);
    const upsert = db.prepare(`
      INSERT INTO p_cronjob_run_daily (
        job_id,local_date,job_name,owner_user_id,lifecycle,schedule,timezone,
        ok_count,error_count,skipped_count,total_count,total_duration_ms,tokens_total,cost_usd,
        first_started_ms,last_started_ms
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(job_id,local_date) DO UPDATE SET
        job_name=excluded.job_name,
        owner_user_id=excluded.owner_user_id,
        lifecycle=excluded.lifecycle,
        schedule=excluded.schedule,
        timezone=excluded.timezone,
        ok_count=ok_count+excluded.ok_count,
        error_count=error_count+excluded.error_count,
        skipped_count=skipped_count+excluded.skipped_count,
        total_count=total_count+excluded.total_count,
        total_duration_ms=total_duration_ms+excluded.total_duration_ms,
        tokens_total=tokens_total+excluded.tokens_total,
        cost_usd=cost_usd+excluded.cost_usd,
        first_started_ms=MIN(first_started_ms,excluded.first_started_ms),
        last_started_ms=MAX(last_started_ms,excluded.last_started_ms)
    `);
    for (const group of groups) {
      upsert.run(
        group.job_id, group.slot_local_date, group.job_name, group.owner_user_id, group.lifecycle,
        group.schedule, group.timezone, group.ok_count, group.error_count, group.skipped_count,
        group.total_count, group.total_duration_ms, group.tokens_total, group.cost_usd,
        group.first_started_ms, group.last_started_ms,
      );
    }
    const detailDeleted = db.prepare(`
      DELETE FROM p_cronjob_runs
      WHERE outcome IN ('ok','error','skipped') AND finished_ms < ?
    `).run(detailCutoff).changes;
    const aggregateDeleted = db.prepare('DELETE FROM p_cronjob_run_daily WHERE last_started_ms < ?')
      .run(nowMs - aggregateDays * DAY_MS).changes;
    return { detailDeleted, aggregateDeleted };
  });

  const close = (id, result) => {
    if (!TERMINAL.has(result?.outcome)) throw new Error('terminal outcome must be ok, error or skipped');
    const current = db.prepare('SELECT claimed_ms,started_ms,outcome FROM p_cronjob_runs WHERE id=?').get(id);
    if (!current || !NON_TERMINAL.has(current.outcome)) return false;
    const finishedMs = Number.isSafeInteger(result.finishedMs) ? result.finishedMs : now();
    const startedMs = current.started_ms ?? current.claimed_ms;
    const rawPreview = typeof result.preview === 'string' ? result.preview : null;
    const preview = rawPreview === null ? null : rawPreview.slice(0, previewChars);
    const changed = db.prepare(`
      UPDATE p_cronjob_runs SET
        finished_ms=?,duration_ms=?,outcome=?,skip_reason=?,error_message=?,preview=?,preview_truncated=?
      WHERE id=? AND outcome IN ('waiting','running')
    `).run(
      finishedMs,
      Number.isSafeInteger(result.durationMs) && result.durationMs >= 0
        ? result.durationMs
        : Math.max(0, finishedMs - startedMs),
      result.outcome,
      bounded(result.skipReason, 100),
      bounded(result.errorMessage, ERROR_CHARS),
      preview,
      rawPreview !== null && rawPreview.length > previewChars ? 1 : 0,
      id,
    ).changes === 1;
    if (changed) prune(finishedMs);
    return changed;
  };

  const reconcile = ({ nowMs = now(), tickMs }) => {
    const cutoff = nowMs - Math.max(1, Number(tickMs) || 1);
    return db.prepare(`
      UPDATE p_cronjob_runs SET
        outcome='error',finished_ms=?,duration_ms=MAX(0,?-COALESCE(started_ms,claimed_ms)),
        error_message='the daemon stopped before the run finished'
      WHERE outcome IN ('waiting','running') AND claimed_ms < ?
    `).run(nowMs, nowMs, cutoff).changes;
  };

  const filters = (actor, query = {}, includeCursor = true) => {
    const access = actorPredicate(actor);
    const where = [access.sql];
    const params = [...access.params];
    if (query.date !== undefined) { where.push('slot_local_date = ?'); params.push(query.date); }
    if (query.from !== undefined) { where.push('slot_local_date >= ?'); params.push(query.from); }
    if (query.to !== undefined) { where.push('slot_local_date <= ?'); params.push(query.to); }
    if (query.outcome !== undefined) { where.push('outcome = ?'); params.push(query.outcome); }
    if (query.jobId !== undefined) { where.push('job_id = ?'); params.push(query.jobId); }
    if (query.owner === 'mine') {
      if (Number.isSafeInteger(actor?.userId)) { where.push('owner_user_id = ?'); params.push(actor.userId); }
      else where.push('0 = 1');
    }
    if (query.owner === 'instance') where.push(actor?.admin === true ? 'owner_user_id IS NULL' : '0 = 1');
    if (typeof query.q === 'string' && query.q.trim()) {
      where.push("(job_name LIKE ? ESCAPE '\\' OR COALESCE(preview,'') LIKE ? ESCAPE '\\')");
      const escaped = query.q.trim().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
    if (includeCursor && query.cursor !== undefined) {
      const cursor = cursorDecode(query.cursor);
      if (!cursor) throw new Error('invalid cursor');
      where.push('(COALESCE(started_ms,claimed_ms) < ? OR (COALESCE(started_ms,claimed_ms) = ? AND id < ?))');
      params.push(cursor.startedMs, cursor.startedMs, cursor.id);
    }
    return { where: where.join(' AND '), params };
  };

  const list = (actor, query = {}) => {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const base = filters(actor, query, false);
    const count = db.prepare(`SELECT COUNT(*) AS n FROM p_cronjob_runs WHERE ${base.where}`).get(...base.params);
    const page = filters(actor, query, true);
    const rows = db.prepare(`
      SELECT * FROM p_cronjob_runs WHERE ${page.where}
      ORDER BY COALESCE(started_ms,claimed_ms) DESC,id DESC LIMIT ? OFFSET ?
    `).all(...page.params, limit, query.cursor ? 0 : offset);
    const last = rows.at(-1);
    return {
      runs: rows.map(publicRow),
      total: Number(count?.n ?? 0),
      ...(rows.length === limit && last
        ? { nextCursor: cursorEncode(last.started_ms ?? last.claimed_ms, last.id) }
        : {}),
    };
  };

  const get = (actor, id) => {
    const access = actorPredicate(actor);
    const row = db.prepare(`SELECT * FROM p_cronjob_runs WHERE id=? AND ${access.sql}`).get(id, ...access.params);
    return row ? publicRow(row) : null;
  };

  const countsByDay = (actor, from, to) => {
    const access = actorPredicate(actor);
    const rows = db.prepare(`
      SELECT slot_local_date AS local_date,outcome,COUNT(*) AS n
      FROM p_cronjob_runs
      WHERE ${access.sql} AND slot_local_date >= ? AND slot_local_date < ?
      GROUP BY slot_local_date,outcome
    `).all(...access.params, from, to);
    const result = new Map();
    for (const row of rows) {
      const counts = result.get(row.local_date) ?? { ok: 0, error: 0, skipped: 0, running: 0 };
      if (Object.hasOwn(counts, row.outcome)) counts[row.outcome] = Number(row.n);
      result.set(row.local_date, counts);
    }
    return result;
  };

  const latestByJobDays = (actor, from, to) => {
    const access = actorPredicate(actor);
    const rows = db.prepare(`
      SELECT * FROM (
        SELECT r.*,ROW_NUMBER() OVER (
          PARTITION BY job_id,slot_local_date
          ORDER BY COALESCE(started_ms,claimed_ms) DESC,id DESC
        ) AS rank
        FROM p_cronjob_runs r
        WHERE ${access.sql} AND slot_local_date >= ? AND slot_local_date < ?
      ) WHERE rank=1
    `).all(...access.params, from, to);
    return new Map(rows.map((row) => [`${row.job_id}:${row.slot_local_date}`, publicRow(row)]));
  };

  const removeUser = (userId) => db.transaction(() => {
    const details = db.prepare('DELETE FROM p_cronjob_runs WHERE owner_user_id=?').run(userId).changes;
    const aggregates = db.prepare('DELETE FROM p_cronjob_run_daily WHERE owner_user_id=?').run(userId).changes;
    return details + aggregates;
  });

  const removeJob = (jobId) => db.transaction(() => {
    const details = db.prepare('DELETE FROM p_cronjob_runs WHERE job_id=?').run(jobId).changes;
    const aggregates = db.prepare('DELETE FROM p_cronjob_run_daily WHERE job_id=?').run(jobId).changes;
    return details + aggregates;
  });

  const removeMissingUsers = (userIds) => {
    const ids = [...userIds].filter(Number.isSafeInteger);
    return db.transaction(() => {
      if (ids.length === 0) return 0;
      const marks = ids.map(() => '?').join(',');
      const details = db.prepare(`DELETE FROM p_cronjob_runs WHERE owner_user_id IS NOT NULL AND owner_user_id NOT IN (${marks})`)
        .run(...ids).changes;
      const aggregates = db.prepare(`DELETE FROM p_cronjob_run_daily WHERE owner_user_id IS NOT NULL AND owner_user_id NOT IN (${marks})`)
        .run(...ids).changes;
      return details + aggregates;
    });
  };

  return {
    claim, start, note, close, reconcile, prune, list, get, countsByDay, latestByJobDays,
    removeUser, removeJob, removeMissingUsers,
  };
}
