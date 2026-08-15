/** Inter-agent handoff notes — free-form context one agent leaves for the next agent working the same
 *  scope (a mission/epic by default). Generic `(scope, target)` keying mirrors the events table.
 *  Port of the core NoteStore onto the plugin DB handle (extraction step 3). */
export class NoteStore {
    db;
    constructor(db) {
        this.db = db;
    }
    add(input) {
        const r = this.db.prepare('INSERT INTO notes (scope, target, author, body) VALUES (@scope, @target, @author, @body)').run({ scope: input.scope, target: input.target, author: input.author ?? '', body: input.body });
        return this.db.prepare('SELECT * FROM notes WHERE id = ?').get(r.lastInsertRowid);
    }
    /** Notes for a scope/target, oldest-first so they read as a chronological handoff log. */
    list(scope, target) {
        return this.db.prepare('SELECT * FROM notes WHERE scope = ? AND target = ? ORDER BY id ASC').all(scope, target);
    }
    /** How many notes a scope/target already holds — used to bound the per-target log. */
    count(scope, target) {
        return this.db.prepare('SELECT COUNT(*) AS n FROM notes WHERE scope = ? AND target = ?').get(scope, target).n;
    }
    /** Purge a target's notes within one scope. */
    deleteForTarget(scope, target) {
        this.db.prepare('DELETE FROM notes WHERE scope = ? AND target = ?').run(scope, target);
    }
    /** Purge ALL of a target's notes across every scope (e.g. on epic delete) so a removed mission leaves
     *  no orphan notes under any scope — these would otherwise outlive their access-control anchor. */
    deleteAllForTarget(target) {
        this.db.prepare('DELETE FROM notes WHERE target = ?').run(target);
    }
}
