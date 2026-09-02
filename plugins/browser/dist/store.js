const asRow = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const numberValue = (value) => typeof value === 'number' ? value : Number(value);
const stringValue = (value) => typeof value === 'string' ? value : '';
const nullableString = (value) => typeof value === 'string' ? value : null;
export class BrowserStore {
    db;
    constructor(db) {
        this.db = db;
        db.migrate([{ version: 1, up: (migration) => migration.exec(`
      CREATE TABLE IF NOT EXISTS p_browser_sessions (
        id TEXT PRIMARY KEY,
        owner_user_id INTEGER NOT NULL,
        conversation_id TEXT NOT NULL,
        artifact_ref TEXT,
        primary_target_id TEXT,
        state TEXT NOT NULL CHECK(state IN ('creating','agent','user','closing','closed','error')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        hard_expires_at INTEGER NOT NULL,
        closed_at INTEGER,
        close_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS p_browser_sessions_owner_idx ON p_browser_sessions(owner_user_id, state, updated_at);
      CREATE TABLE IF NOT EXISTS p_browser_processes (
        user_id INTEGER PRIMARY KEY,
        pid INTEGER NOT NULL,
        started_at_ticks TEXT NOT NULL,
        executable_path TEXT NOT NULL,
        profile_path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `) }]);
    }
    createSession(record) {
        this.db.prepare(`INSERT INTO p_browser_sessions(
      id,owner_user_id,conversation_id,artifact_ref,primary_target_id,state,created_at,updated_at,
      last_activity_at,hard_expires_at,closed_at,close_reason
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.id, record.ownerUserId, record.conversationId, record.artifactRef, record.primaryTargetId, record.state, record.createdAt, record.updatedAt, record.lastActivityAt, record.hardExpiresAt, record.closedAt, record.closeReason);
    }
    session(id) {
        const value = asRow(this.db.prepare('SELECT * FROM p_browser_sessions WHERE id=?').get(id));
        return value ? this.sessionRow(value) : null;
    }
    sessionsForUser(userId, activeOnly = false) {
        const sql = activeOnly
            ? "SELECT * FROM p_browser_sessions WHERE owner_user_id=? AND state NOT IN ('closed','error') ORDER BY created_at"
            : 'SELECT * FROM p_browser_sessions WHERE owner_user_id=? ORDER BY created_at DESC';
        return this.db.prepare(sql).all(userId).map((value) => this.sessionRow(asRow(value)));
    }
    unfinishedSessions() {
        return this.db.prepare("SELECT * FROM p_browser_sessions WHERE state NOT IN ('closed','error') ORDER BY created_at")
            .all().map((value) => this.sessionRow(asRow(value)));
    }
    activeUserCount() {
        const value = asRow(this.db.prepare("SELECT COUNT(DISTINCT owner_user_id) count FROM p_browser_sessions WHERE state NOT IN ('closed','error')").get());
        return numberValue(value?.count ?? 0);
    }
    updateSession(id, patch) {
        const current = this.session(id);
        if (!current)
            return false;
        return this.db.prepare(`UPDATE p_browser_sessions SET
      state=?,artifact_ref=?,primary_target_id=?,last_activity_at=?,updated_at=?,closed_at=?,close_reason=? WHERE id=?`).run(patch.state ?? current.state, patch.artifactRef === undefined ? current.artifactRef : patch.artifactRef, patch.primaryTargetId === undefined ? current.primaryTargetId : patch.primaryTargetId, patch.lastActivityAt ?? current.lastActivityAt, patch.updatedAt, patch.closedAt === undefined ? current.closedAt : patch.closedAt, patch.closeReason === undefined ? current.closeReason : patch.closeReason, id).changes === 1;
    }
    closeUnfinished(reason, now) {
        return this.db.transaction(() => {
            const sessions = this.unfinishedSessions();
            this.db.prepare("UPDATE p_browser_sessions SET state='closed',updated_at=?,closed_at=?,close_reason=? WHERE state NOT IN ('closed','error')")
                .run(now, now, reason);
            return sessions;
        });
    }
    pruneClosedSessions(closedBefore) {
        return this.db.prepare("DELETE FROM p_browser_sessions WHERE state IN ('closed','error') AND closed_at IS NOT NULL AND closed_at < ?")
            .run(closedBefore).changes;
    }
    deleteUser(userId) {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM p_browser_sessions WHERE owner_user_id=?').run(userId);
            this.db.prepare('DELETE FROM p_browser_processes WHERE user_id=?').run(userId);
        });
    }
    saveProcess(record) {
        this.db.prepare(`INSERT INTO p_browser_processes(user_id,pid,started_at_ticks,executable_path,profile_path,created_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET pid=excluded.pid,started_at_ticks=excluded.started_at_ticks,
      executable_path=excluded.executable_path,profile_path=excluded.profile_path,created_at=excluded.created_at`).run(record.userId, record.pid, record.startedAtTicks, record.executablePath, record.profilePath, record.createdAt);
    }
    process(userId) {
        const value = asRow(this.db.prepare('SELECT * FROM p_browser_processes WHERE user_id=?').get(userId));
        return value ? this.processRow(value) : null;
    }
    processes() {
        return this.db.prepare('SELECT * FROM p_browser_processes ORDER BY user_id').all()
            .map((value) => this.processRow(asRow(value)));
    }
    deleteProcess(userId) {
        this.db.prepare('DELETE FROM p_browser_processes WHERE user_id=?').run(userId);
    }
    sessionRow(value) {
        return {
            id: stringValue(value.id), ownerUserId: numberValue(value.owner_user_id), conversationId: stringValue(value.conversation_id),
            artifactRef: nullableString(value.artifact_ref), primaryTargetId: nullableString(value.primary_target_id),
            state: stringValue(value.state), createdAt: numberValue(value.created_at),
            updatedAt: numberValue(value.updated_at), lastActivityAt: numberValue(value.last_activity_at),
            hardExpiresAt: numberValue(value.hard_expires_at), closedAt: value.closed_at === null ? null : numberValue(value.closed_at),
            closeReason: nullableString(value.close_reason),
        };
    }
    processRow(value) {
        return {
            userId: numberValue(value.user_id), pid: numberValue(value.pid), startedAtTicks: stringValue(value.started_at_ticks),
            executablePath: stringValue(value.executable_path), profilePath: stringValue(value.profile_path),
            createdAt: numberValue(value.created_at),
        };
    }
}
