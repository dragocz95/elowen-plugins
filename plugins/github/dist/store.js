import { randomBytes, createHash } from 'node:crypto';
import { GitHubPluginError } from './errors.js';
const row = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const number = (value) => typeof value === 'number' ? value : Number(value);
const string = (value) => typeof value === 'string' ? value : '';
const nullableString = (value) => typeof value === 'string' ? value : null;
export const hashValue = (value) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
export class GitHubStore {
    db;
    constructor(db) {
        this.db = db;
        db.migrate([{ version: 1, up: (migration) => migration.exec(`
      CREATE TABLE IF NOT EXISTS p_github_accounts (
        user_id INTEGER PRIMARY KEY,
        github_user_id INTEGER NOT NULL UNIQUE,
        login TEXT NOT NULL,
        name TEXT,
        avatar_url TEXT,
        token_expires_at INTEGER NOT NULL,
        refresh_expires_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('connected','reconnect_required')),
        last_error TEXT,
        verified_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS p_github_project_mappings (
        user_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        base_repo_id INTEGER NOT NULL,
        base_owner TEXT NOT NULL,
        base_name TEXT NOT NULL,
        push_repo_id INTEGER NOT NULL,
        push_owner TEXT NOT NULL,
        push_name TEXT NOT NULL,
        base_remote TEXT,
        push_remote TEXT,
        verified_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, project_id)
      );
      CREATE TABLE IF NOT EXISTS p_github_oauth_flows (
        state_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        secret_key TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        replace_identity INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p_github_oauth_user_idx ON p_github_oauth_flows(user_id, expires_at);
      CREATE TABLE IF NOT EXISTS p_github_refresh_leases (
        user_id INTEGER PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS p_github_confirmations (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        project_id INTEGER,
        target_json TEXT NOT NULL,
        expected_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS p_github_confirm_user_idx ON p_github_confirmations(user_id, expires_at);
    `) }, { version: 2, up: (migration) => {
                    const columns = migration.prepare('PRAGMA table_info(p_github_project_mappings)').all().map((value) => string(row(value)?.name));
                    if (!columns.includes('active'))
                        migration.exec('ALTER TABLE p_github_project_mappings ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
                } }, { version: 3, up: (migration) => migration.exec(`
      CREATE TABLE IF NOT EXISTS p_github_pr_leases (
        lease_key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `) }]);
    }
    account(userId) {
        const value = row(this.db.prepare('SELECT * FROM p_github_accounts WHERE user_id=?').get(userId));
        if (!value)
            return null;
        return {
            userId: number(value.user_id), githubUserId: number(value.github_user_id), login: string(value.login),
            name: nullableString(value.name), avatarUrl: nullableString(value.avatar_url), tokenExpiresAt: number(value.token_expires_at),
            refreshExpiresAt: number(value.refresh_expires_at), status: value.status === 'connected' ? 'connected' : 'reconnect_required',
            lastError: nullableString(value.last_error), verifiedAt: number(value.verified_at), updatedAt: number(value.updated_at),
        };
    }
    accountOwner(githubUserId) {
        const value = row(this.db.prepare('SELECT user_id FROM p_github_accounts WHERE github_user_id=?').get(githubUserId));
        return value ? number(value.user_id) : null;
    }
    saveAccount(account) {
        this.db.prepare(`INSERT INTO p_github_accounts(
      user_id,github_user_id,login,name,avatar_url,token_expires_at,refresh_expires_at,status,last_error,verified_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
      github_user_id=excluded.github_user_id,login=excluded.login,name=excluded.name,avatar_url=excluded.avatar_url,
      token_expires_at=excluded.token_expires_at,refresh_expires_at=excluded.refresh_expires_at,status=excluded.status,
      last_error=excluded.last_error,verified_at=excluded.verified_at,updated_at=excluded.updated_at`).run(account.userId, account.githubUserId, account.login, account.name, account.avatarUrl, account.tokenExpiresAt, account.refreshExpiresAt, account.status, account.lastError, account.verifiedAt, account.updatedAt);
    }
    markReconnect(userId, code, now) {
        this.db.prepare("UPDATE p_github_accounts SET status='reconnect_required',last_error=?,updated_at=? WHERE user_id=?").run(code, now, userId);
    }
    disconnectAccount(userId) {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM p_github_confirmations WHERE user_id=?').run(userId);
            this.db.prepare('DELETE FROM p_github_refresh_leases WHERE user_id=?').run(userId);
            this.db.prepare('DELETE FROM p_github_oauth_flows WHERE user_id=?').run(userId);
            this.db.prepare('DELETE FROM p_github_accounts WHERE user_id=?').run(userId);
        });
    }
    deleteAccount(userId) {
        this.db.transaction(() => {
            this.disconnectAccount(userId);
            this.db.prepare('DELETE FROM p_github_project_mappings WHERE user_id=?').run(userId);
        });
    }
    saveFlow(flow) {
        this.db.prepare('INSERT INTO p_github_oauth_flows(state_hash,user_id,secret_key,redirect_uri,replace_identity,expires_at) VALUES (?,?,?,?,?,?)')
            .run(flow.stateHash, flow.userId, flow.secretKey, flow.redirectUri, flow.replaceIdentity ? 1 : 0, flow.expiresAt);
    }
    flow(stateHash) {
        const value = row(this.db.prepare('SELECT * FROM p_github_oauth_flows WHERE state_hash=?').get(stateHash));
        return value ? {
            stateHash: string(value.state_hash), userId: number(value.user_id), secretKey: string(value.secret_key),
            redirectUri: string(value.redirect_uri), replaceIdentity: number(value.replace_identity) === 1, expiresAt: number(value.expires_at),
        } : null;
    }
    deleteFlow(stateHash) { return this.db.prepare('DELETE FROM p_github_oauth_flows WHERE state_hash=?').run(stateHash).changes > 0; }
    flows(input = {}) {
        const clauses = [];
        const params = [];
        if (input.userId !== undefined) {
            clauses.push('user_id=?');
            params.push(input.userId);
        }
        if (input.expiredAt !== undefined) {
            clauses.push('expires_at<=?');
            params.push(input.expiredAt);
        }
        const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
        return this.db.prepare(`SELECT * FROM p_github_oauth_flows${where}`).all(...params).map((value) => {
            const flow = row(value);
            return {
                stateHash: string(flow.state_hash), userId: number(flow.user_id), secretKey: string(flow.secret_key),
                redirectUri: string(flow.redirect_uri), replaceIdentity: number(flow.replace_identity) === 1, expiresAt: number(flow.expires_at),
            };
        });
    }
    mapping(userId, projectId) {
        const value = row(this.db.prepare('SELECT * FROM p_github_project_mappings WHERE user_id=? AND project_id=?').get(userId, projectId));
        return value ? this.mappingRow(value) : null;
    }
    mappings(userId) {
        return this.db.prepare('SELECT * FROM p_github_project_mappings WHERE user_id=? ORDER BY project_id').all(userId)
            .map((value) => this.mappingRow(row(value)));
    }
    mappingRow(value) {
        return {
            userId: number(value.user_id), projectId: number(value.project_id), baseRepoId: number(value.base_repo_id),
            baseOwner: string(value.base_owner), baseName: string(value.base_name), pushRepoId: number(value.push_repo_id),
            pushOwner: string(value.push_owner), pushName: string(value.push_name), baseRemote: nullableString(value.base_remote),
            pushRemote: nullableString(value.push_remote), verifiedAt: number(value.verified_at), active: number(value.active) === 1,
        };
    }
    saveMapping(mapping) {
        this.db.prepare(`INSERT INTO p_github_project_mappings(
      user_id,project_id,base_repo_id,base_owner,base_name,push_repo_id,push_owner,push_name,base_remote,push_remote,verified_at,active
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,project_id) DO UPDATE SET
      base_repo_id=excluded.base_repo_id,base_owner=excluded.base_owner,base_name=excluded.base_name,
      push_repo_id=excluded.push_repo_id,push_owner=excluded.push_owner,push_name=excluded.push_name,
      base_remote=excluded.base_remote,push_remote=excluded.push_remote,verified_at=excluded.verified_at,active=excluded.active`).run(mapping.userId, mapping.projectId, mapping.baseRepoId, mapping.baseOwner, mapping.baseName, mapping.pushRepoId, mapping.pushOwner, mapping.pushName, mapping.baseRemote, mapping.pushRemote, mapping.verifiedAt, mapping.active ? 1 : 0);
    }
    deleteMapping(userId, projectId) {
        return this.db.prepare('DELETE FROM p_github_project_mappings WHERE user_id=? AND project_id=?').run(userId, projectId).changes > 0;
    }
    deactivateMappings(userId) {
        this.db.prepare('UPDATE p_github_project_mappings SET active=0 WHERE user_id=?').run(userId);
    }
    deleteProject(projectId) { this.db.prepare('DELETE FROM p_github_project_mappings WHERE project_id=?').run(projectId); }
    acquireRefreshLease(userId, owner, now, ttlMs) {
        return this.db.transaction(() => {
            this.db.prepare('DELETE FROM p_github_refresh_leases WHERE user_id=? AND expires_at<=?').run(userId, now);
            return this.db.prepare('INSERT OR IGNORE INTO p_github_refresh_leases(user_id,owner,expires_at) VALUES (?,?,?)').run(userId, owner, now + ttlMs).changes === 1;
        });
    }
    releaseRefreshLease(userId, owner) {
        this.db.prepare('DELETE FROM p_github_refresh_leases WHERE user_id=? AND owner=?').run(userId, owner);
    }
    acquirePullRequestLease(leaseKey, owner, now, ttlMs) {
        return this.db.transaction(() => {
            this.db.prepare('DELETE FROM p_github_pr_leases WHERE lease_key=? AND expires_at<=?').run(leaseKey, now);
            return this.db.prepare('INSERT OR IGNORE INTO p_github_pr_leases(lease_key,owner,expires_at) VALUES (?,?,?)')
                .run(leaseKey, owner, now + ttlMs).changes === 1;
        });
    }
    renewPullRequestLease(leaseKey, owner, now, ttlMs) {
        return this.db.prepare('UPDATE p_github_pr_leases SET expires_at=? WHERE lease_key=? AND owner=?')
            .run(now + ttlMs, leaseKey, owner).changes === 1;
    }
    releasePullRequestLease(leaseKey, owner) {
        this.db.prepare('DELETE FROM p_github_pr_leases WHERE lease_key=? AND owner=?').run(leaseKey, owner);
    }
    createConfirmation(input) {
        const token = randomToken();
        this.db.prepare(`INSERT INTO p_github_confirmations(
      token_hash,user_id,action,project_id,target_json,expected_json,expires_at,consumed_at
    ) VALUES (?,?,?,?,?,?,?,NULL)`).run(hashValue(token), input.userId, input.action, input.projectId, JSON.stringify(input.target), JSON.stringify(input.expected), input.expiresAt);
        return { token, expiresAt: input.expiresAt };
    }
    consumeConfirmation(token, userId, action, now) {
        return this.db.transaction(() => {
            const tokenHash = hashValue(token);
            const value = row(this.db.prepare('SELECT * FROM p_github_confirmations WHERE token_hash=?').get(tokenHash));
            if (!value || number(value.user_id) !== userId || string(value.action) !== action) {
                throw new GitHubPluginError('confirmation_invalid', 403, 'The confirmation does not belong to this account or action.');
            }
            if (value.consumed_at !== null && value.consumed_at !== undefined)
                throw new GitHubPluginError('confirmation_used', 409, 'This confirmation has already been used.');
            if (number(value.expires_at) <= now)
                throw new GitHubPluginError('confirmation_expired', 409, 'This confirmation has expired. Preview the action again.');
            if (this.db.prepare('UPDATE p_github_confirmations SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL').run(now, tokenHash).changes !== 1) {
                throw new GitHubPluginError('confirmation_used', 409, 'This confirmation has already been used.');
            }
            return {
                tokenHash, userId, action, projectId: value.project_id === null ? null : number(value.project_id),
                target: JSON.parse(string(value.target_json)),
                expected: JSON.parse(string(value.expected_json)), expiresAt: number(value.expires_at),
            };
        });
    }
    prune(now) {
        this.db.prepare('DELETE FROM p_github_refresh_leases WHERE expires_at<=?').run(now);
        this.db.prepare('DELETE FROM p_github_pr_leases WHERE expires_at<=?').run(now);
        this.db.prepare('DELETE FROM p_github_confirmations WHERE expires_at<=?').run(now);
    }
    reconcile(validUsers, validProjects) {
        for (const value of this.db.prepare('SELECT user_id FROM p_github_accounts').all()) {
            const userId = number(row(value)?.user_id);
            if (!validUsers.has(userId))
                this.deleteAccount(userId);
        }
        for (const value of this.db.prepare('SELECT DISTINCT project_id FROM p_github_project_mappings').all()) {
            const projectId = number(row(value)?.project_id);
            if (!validProjects.has(projectId))
                this.deleteProject(projectId);
        }
    }
}
