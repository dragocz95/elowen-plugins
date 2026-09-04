import type { PluginDb } from 'elowen/plugin-api';
import type { BrowserSessionState, ManagedDisplayRecord, ManagedProcessRecord } from './types.js';

interface Row { [key: string]: unknown }
const asRow = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
const numberValue = (value: unknown): number => typeof value === 'number' ? value : Number(value);
const stringValue = (value: unknown): string => typeof value === 'string' ? value : '';
const nullableString = (value: unknown): string | null => typeof value === 'string' ? value : null;

export interface BrowserSessionRecord {
  id: string;
  ownerUserId: number;
  conversationId: string;
  artifactRef: string | null;
  primaryTargetId: string | null;
  state: BrowserSessionState;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  hardExpiresAt: number;
  closedAt: number | null;
  closeReason: string | null;
}

export class BrowserStore {
  constructor(readonly db: PluginDb) {
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
    `) }, {
      // The X server and the VNC server outlive the daemon that spawned them, exactly as Chrome does, so
      // they need the same ownership record: after a hard crash this table is the only thing that can
      // tell a leaked framebuffer from somebody else's display.
      version: 2,
      up: (migration) => migration.exec(`
        CREATE TABLE IF NOT EXISTS p_browser_displays (
          user_id INTEGER PRIMARY KEY,
          display_number INTEGER NOT NULL,
          xvfb_pid INTEGER NOT NULL,
          xvfb_started_at_ticks TEXT NOT NULL,
          xvfb_executable_path TEXT NOT NULL,
          vnc_pid INTEGER NOT NULL,
          vnc_started_at_ticks TEXT NOT NULL,
          vnc_executable_path TEXT NOT NULL,
          socket_path TEXT NOT NULL,
          root_path TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `),
    }]);
  }

  createSession(record: BrowserSessionRecord): void {
    this.db.prepare(`INSERT INTO p_browser_sessions(
      id,owner_user_id,conversation_id,artifact_ref,primary_target_id,state,created_at,updated_at,
      last_activity_at,hard_expires_at,closed_at,close_reason
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      record.id, record.ownerUserId, record.conversationId, record.artifactRef, record.primaryTargetId,
      record.state, record.createdAt, record.updatedAt, record.lastActivityAt, record.hardExpiresAt,
      record.closedAt, record.closeReason,
    );
  }

  session(id: string): BrowserSessionRecord | null {
    const value = asRow(this.db.prepare('SELECT * FROM p_browser_sessions WHERE id=?').get(id));
    return value ? this.sessionRow(value) : null;
  }

  sessionsForUser(userId: number, activeOnly = false): BrowserSessionRecord[] {
    const sql = activeOnly
      ? "SELECT * FROM p_browser_sessions WHERE owner_user_id=? AND state NOT IN ('closed','error') ORDER BY created_at"
      : 'SELECT * FROM p_browser_sessions WHERE owner_user_id=? ORDER BY created_at DESC';
    return this.db.prepare(sql).all(userId).map((value) => this.sessionRow(asRow(value)!));
  }

  unfinishedSessions(): BrowserSessionRecord[] {
    return this.db.prepare("SELECT * FROM p_browser_sessions WHERE state NOT IN ('closed','error') ORDER BY created_at")
      .all().map((value) => this.sessionRow(asRow(value)!));
  }

  activeUserCount(): number {
    const value = asRow(this.db.prepare("SELECT COUNT(DISTINCT owner_user_id) count FROM p_browser_sessions WHERE state NOT IN ('closed','error')").get());
    return numberValue(value?.count ?? 0);
  }

  updateSession(id: string, patch: {
    state?: BrowserSessionState;
    artifactRef?: string | null;
    primaryTargetId?: string | null;
    lastActivityAt?: number;
    updatedAt: number;
    closedAt?: number | null;
    closeReason?: string | null;
  }): boolean {
    const current = this.session(id);
    if (!current) return false;
    return this.db.prepare(`UPDATE p_browser_sessions SET
      state=?,artifact_ref=?,primary_target_id=?,last_activity_at=?,updated_at=?,closed_at=?,close_reason=? WHERE id=?`).run(
      patch.state ?? current.state,
      patch.artifactRef === undefined ? current.artifactRef : patch.artifactRef,
      patch.primaryTargetId === undefined ? current.primaryTargetId : patch.primaryTargetId,
      patch.lastActivityAt ?? current.lastActivityAt,
      patch.updatedAt,
      patch.closedAt === undefined ? current.closedAt : patch.closedAt,
      patch.closeReason === undefined ? current.closeReason : patch.closeReason,
      id,
    ).changes === 1;
  }

  closeUnfinished(reason: string, now: number): BrowserSessionRecord[] {
    return this.db.transaction(() => {
      const sessions = this.unfinishedSessions();
      this.db.prepare("UPDATE p_browser_sessions SET state='closed',updated_at=?,closed_at=?,close_reason=? WHERE state NOT IN ('closed','error')")
        .run(now, now, reason);
      return sessions;
    });
  }

  pruneClosedSessions(closedBefore: number): number {
    return this.db.prepare("DELETE FROM p_browser_sessions WHERE state IN ('closed','error') AND closed_at IS NOT NULL AND closed_at < ?")
      .run(closedBefore).changes;
  }

  deleteUser(userId: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM p_browser_sessions WHERE owner_user_id=?').run(userId);
      this.db.prepare('DELETE FROM p_browser_processes WHERE user_id=?').run(userId);
      this.db.prepare('DELETE FROM p_browser_displays WHERE user_id=?').run(userId);
    });
  }

  saveProcess(record: ManagedProcessRecord): void {
    this.db.prepare(`INSERT INTO p_browser_processes(user_id,pid,started_at_ticks,executable_path,profile_path,created_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET pid=excluded.pid,started_at_ticks=excluded.started_at_ticks,
      executable_path=excluded.executable_path,profile_path=excluded.profile_path,created_at=excluded.created_at`).run(
      record.userId, record.pid, record.startedAtTicks, record.executablePath, record.profilePath, record.createdAt,
    );
  }

  process(userId: number): ManagedProcessRecord | null {
    const value = asRow(this.db.prepare('SELECT * FROM p_browser_processes WHERE user_id=?').get(userId));
    return value ? this.processRow(value) : null;
  }

  processes(): ManagedProcessRecord[] {
    return this.db.prepare('SELECT * FROM p_browser_processes ORDER BY user_id').all()
      .map((value) => this.processRow(asRow(value)!));
  }

  deleteProcess(userId: number): void {
    this.db.prepare('DELETE FROM p_browser_processes WHERE user_id=?').run(userId);
  }

  saveDisplay(record: ManagedDisplayRecord): void {
    this.db.prepare(`INSERT INTO p_browser_displays(
      user_id,display_number,xvfb_pid,xvfb_started_at_ticks,xvfb_executable_path,
      vnc_pid,vnc_started_at_ticks,vnc_executable_path,socket_path,root_path,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
      display_number=excluded.display_number,xvfb_pid=excluded.xvfb_pid,
      xvfb_started_at_ticks=excluded.xvfb_started_at_ticks,xvfb_executable_path=excluded.xvfb_executable_path,
      vnc_pid=excluded.vnc_pid,vnc_started_at_ticks=excluded.vnc_started_at_ticks,
      vnc_executable_path=excluded.vnc_executable_path,socket_path=excluded.socket_path,
      root_path=excluded.root_path,created_at=excluded.created_at`).run(
      record.userId, record.displayNumber, record.xvfbPid, record.xvfbStartedAtTicks, record.xvfbExecutablePath,
      record.vncPid, record.vncStartedAtTicks, record.vncExecutablePath, record.socketPath, record.rootPath,
      record.createdAt,
    );
  }

  displays(): ManagedDisplayRecord[] {
    return this.db.prepare('SELECT * FROM p_browser_displays ORDER BY user_id').all()
      .map((value) => this.displayRow(asRow(value)!));
  }

  deleteDisplay(userId: number): void {
    this.db.prepare('DELETE FROM p_browser_displays WHERE user_id=?').run(userId);
  }

  private sessionRow(value: Row): BrowserSessionRecord {
    return {
      id: stringValue(value.id), ownerUserId: numberValue(value.owner_user_id), conversationId: stringValue(value.conversation_id),
      artifactRef: nullableString(value.artifact_ref), primaryTargetId: nullableString(value.primary_target_id),
      state: stringValue(value.state) as BrowserSessionState, createdAt: numberValue(value.created_at),
      updatedAt: numberValue(value.updated_at), lastActivityAt: numberValue(value.last_activity_at),
      hardExpiresAt: numberValue(value.hard_expires_at), closedAt: value.closed_at === null ? null : numberValue(value.closed_at),
      closeReason: nullableString(value.close_reason),
    };
  }

  private processRow(value: Row): ManagedProcessRecord {
    return {
      userId: numberValue(value.user_id), pid: numberValue(value.pid), startedAtTicks: stringValue(value.started_at_ticks),
      executablePath: stringValue(value.executable_path), profilePath: stringValue(value.profile_path),
      createdAt: numberValue(value.created_at),
    };
  }

  private displayRow(value: Row): ManagedDisplayRecord {
    return {
      userId: numberValue(value.user_id), displayNumber: numberValue(value.display_number),
      xvfbPid: numberValue(value.xvfb_pid), xvfbStartedAtTicks: stringValue(value.xvfb_started_at_ticks),
      xvfbExecutablePath: stringValue(value.xvfb_executable_path),
      vncPid: numberValue(value.vnc_pid), vncStartedAtTicks: stringValue(value.vnc_started_at_ticks),
      vncExecutablePath: stringValue(value.vnc_executable_path),
      socketPath: stringValue(value.socket_path), rootPath: stringValue(value.root_path),
      createdAt: numberValue(value.created_at),
    };
  }
}
