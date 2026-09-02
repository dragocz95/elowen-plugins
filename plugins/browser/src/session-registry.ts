import { randomBytes } from 'node:crypto';
import { artifactData, parseArtifactRef } from './artifact.js';
import type { BrowserConfig } from './config.js';
import { BrowserPool } from './browser-launcher.js';
import { BrowserSession } from './browser-session.js';
import { StreamBudget } from './screencast-hub.js';
import { BrowserStore } from './store.js';
import type { BrowserArtifactPublisher, BrowserClock, BrowserLogger, ProcessInspector } from './types.js';

const CLOSED_SESSION_RETENTION_MS = 7 * 24 * 60 * 60_000;

class RegistryQueue {
  private tail: Promise<void> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => {}, () => {});
    return result;
  }
}

export interface CreateBrowserSessionInput {
  ownerUserId: number;
  conversationId: string;
  toolCallId: string;
}

export class SessionRegistry {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly createQueue = new RegistryQueue();
  private readonly streamBudget: StreamBudget;

  constructor(private readonly deps: {
    config: () => BrowserConfig;
    store: BrowserStore;
    pool: BrowserPool;
    artifacts: BrowserArtifactPublisher;
    processInspector: ProcessInspector;
    clock: BrowserClock;
    logger: BrowserLogger;
  }) {
    this.streamBudget = new StreamBudget(() => deps.config().globalStreamBytesPerSecond, () => deps.clock.now());
  }

  create(input: CreateBrowserSessionInput): Promise<BrowserSession> {
    return this.createQueue.run(async () => {
      const config = this.deps.config();
      const perUser = [...this.sessions.values()].filter((session) => session.ownerUserId === input.ownerUserId).length;
      if (perUser >= config.maxSessionsPerUser) throw new Error('The browser session limit for this account has been reached.');
      const activeUsers = new Set([...this.sessions.values()].map((session) => session.ownerUserId));
      if (!activeUsers.has(input.ownerUserId) && activeUsers.size >= config.maxActiveUsers) {
        throw new Error('The browser active-user limit has been reached.');
      }
      const now = this.deps.clock.now();
      const id = randomBytes(24).toString('base64url');
      const hardExpiresAt = now + config.hardSessionLimitMs;
      this.deps.store.createSession({
        id,
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        artifactRef: null,
        primaryTargetId: null,
        state: 'creating',
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
        hardExpiresAt,
        closedAt: null,
        closeReason: null,
      });
      let pageOpened = false;
      let createdSession: BrowserSession | null = null;
      try {
        const opened = await this.deps.pool.openPage(input.ownerUserId, id);
        pageOpened = true;
        const session = await BrowserSession.create({
          id,
          ownerUserId: input.ownerUserId,
          conversationId: input.conversationId,
          createdAt: now,
          hardExpiresAt,
          page: opened.page,
          tabs: opened.tabs,
          config: this.deps.config,
          store: this.deps.store,
          artifacts: this.deps.artifacts,
          streamBudget: this.streamBudget,
          traceLock: opened.traceLock,
          clock: this.deps.clock,
          logger: this.deps.logger,
          releasePage: () => this.deps.pool.releasePage(input.ownerUserId, id),
          forceCloseBrowser: () => this.deps.pool.closeUser(input.ownerUserId),
          onClosed: (sessionId) => { this.sessions.delete(sessionId); },
        });
        createdSession = session;
        const ref = await this.deps.artifacts.open({
          toolCallId: input.toolCallId,
          conversationId: input.conversationId,
          expiresAt: hardExpiresAt,
          data: artifactData({ browserSessionId: id, state: 'agent' }),
        });
        await session.setArtifact(ref);
        if (session.state !== 'agent') throw new Error('Browser session closed before artifact setup completed.');
        this.sessions.set(id, session);
        return session;
      } catch (error) {
        if (createdSession) await createdSession.close('creation_failed').catch(() => {});
        else if (pageOpened) await this.deps.pool.releasePage(input.ownerUserId, id).catch(() => {});
        const failedAt = this.deps.clock.now();
        this.deps.store.updateSession(id, {
          state: 'error', updatedAt: failedAt, lastActivityAt: failedAt, closedAt: failedAt,
          closeReason: error instanceof Error ? error.message : 'session_creation_failed',
        });
        throw error;
      }
    });
  }

  getOwned(sessionId: string, ownerUserId: number): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerUserId !== ownerUserId) throw new Error('Browser session not found.');
    return session;
  }

  get(sessionId: string): BrowserSession | null { return this.sessions.get(sessionId) ?? null; }

  listOwned(ownerUserId: number): BrowserSession[] {
    return [...this.sessions.values()].filter((session) => session.ownerUserId === ownerUserId);
  }

  async closeOwned(sessionId: string, ownerUserId: number, reason = 'closed'): Promise<void> {
    await this.getOwned(sessionId, ownerUserId).close(reason);
  }

  async closeUser(ownerUserId: number, reason = 'user_removed'): Promise<void> {
    await Promise.allSettled(this.listOwned(ownerUserId).map((session) => session.close(reason)));
    await this.deps.pool.closeUser(ownerUserId);
  }

  async clearProfile(ownerUserId: number): Promise<void> {
    if (this.listOwned(ownerUserId).length > 0) throw new Error('Close all browser sessions before clearing the profile.');
    this.deps.pool.clearProfile(ownerUserId);
  }

  profileSize(ownerUserId: number): number { return this.deps.pool.profileSize(ownerUserId); }

  async sweep(): Promise<void> {
    const now = this.deps.clock.now();
    const config = this.deps.config();
    const closing: Promise<void>[] = [];
    const byUser = new Map<number, BrowserSession[]>();
    for (const session of this.sessions.values()) {
      const group = byUser.get(session.ownerUserId) ?? [];
      group.push(session);
      byUser.set(session.ownerUserId, group);
      if (now >= session.hardExpiresAt) closing.push(session.close('hard_expiry'));
      else if (now - session.lastActivity >= config.idleTimeoutMs) closing.push(session.close('idle_timeout'));
    }
    for (const [userId, sessions] of byUser) {
      if (!this.deps.pool.isHealthy(userId)) {
        closing.push(...sessions.map((session) => session.close('browser_error')));
        continue;
      }
      if (this.deps.pool.rssBytes(userId) > config.maxChromeRssBytesPerUser) {
        const oldestIdle = sessions.filter((session) => session.state === 'agent').sort((a, b) => a.lastActivity - b.lastActivity)[0];
        if (oldestIdle) closing.push(oldestIdle.close('memory_limit'));
      }
    }
    await Promise.allSettled(closing);
    this.deps.store.pruneClosedSessions(now - CLOSED_SESSION_RETENTION_MS);
  }

  async closeAll(reason = 'plugin_reload'): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map((session) => session.close(reason)));
    await this.deps.pool.closeAll();
  }

  async bootReconcile(): Promise<void> {
    const now = this.deps.clock.now();
    const stale = this.deps.store.closeUnfinished('daemon_restart', now);
    for (const record of stale) {
      const ref = parseArtifactRef(record.artifactRef);
      if (ref) await this.deps.artifacts.close(ref).catch(() => {});
    }
    this.deps.store.pruneClosedSessions(now - CLOSED_SESSION_RETENTION_MS);
    for (const record of this.deps.store.processes()) {
      const exactProfileArg = `--user-data-dir=${record.profilePath}`;
      const matches = () => {
        const snapshot = this.deps.processInspector.inspect(record.pid);
        return snapshot
          && snapshot.startedAtTicks === record.startedAtTicks
          && snapshot.executablePath === record.executablePath
          && snapshot.args.includes(exactProfileArg);
      };
      const snapshot = this.deps.processInspector.inspect(record.pid);
      if (matches()) {
        try {
          this.deps.processInspector.terminate(record.pid);
          const killTimer = setTimeout(() => {
            if (!matches()) return;
            try { this.deps.processInspector.terminate(record.pid, 'SIGKILL'); }
            catch (error) { this.deps.logger.warn(`could not force-terminate orphan browser ${record.pid}: ${error instanceof Error ? error.message : String(error)}`); }
          }, 5_000);
          killTimer.unref();
        } catch (error) {
          this.deps.logger.warn(`could not terminate orphan browser ${record.pid}: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (snapshot) {
        this.deps.logger.warn(`refused to terminate PID ${record.pid}: managed browser identity no longer matches`);
      }
      this.deps.store.deleteProcess(record.userId);
    }
  }

  async deleteUser(ownerUserId: number): Promise<void> {
    await this.closeUser(ownerUserId, 'user_removed');
    this.deps.pool.clearProfile(ownerUserId);
    this.deps.store.deleteUser(ownerUserId);
  }

  status(): {
    activeUsers: number;
    activeSessions: number;
    maxActiveUsers: number;
    maxSessionsPerUser: number;
    artifactsAvailable: boolean;
  } {
    return {
      activeUsers: new Set([...this.sessions.values()].map((session) => session.ownerUserId)).size,
      activeSessions: this.sessions.size,
      maxActiveUsers: this.deps.config().maxActiveUsers,
      maxSessionsPerUser: this.deps.config().maxSessionsPerUser,
      artifactsAvailable: this.deps.artifacts.available,
    };
  }

  durableSessions(ownerUserId: number) {
    return this.deps.store.sessionsForUser(ownerUserId).slice(0, 100).map((record) => ({
      id: record.id,
      state: record.state,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      closedAt: record.closedAt,
      closeReason: record.closeReason,
    }));
  }
}
