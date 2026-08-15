/** Port of the core AgentStore onto the plugin DB handle (extraction step 3) — SQL byte-identical,
 *  table grandfathered. */
export class AgentStore {
    db;
    constructor(db) {
        this.db = db;
    }
    upsert(input) {
        this.db.prepare(
        // Update program too, not just model: agent names come from a fixed pool and get recycled, so a
        // name first used by one CLI (e.g. opencode) can later run another (e.g. claude-code). Leaving a
        // stale program made the deriver pick the wrong provider's prompt detector → the agent hung.
        `INSERT INTO agents (project_id,name,program,model) VALUES (@project_id,@name,@program,@model)
       ON CONFLICT(project_id,name) DO UPDATE SET program=@program, model=@model, last_active_ts=datetime('now')`).run(input);
        return this.db.prepare('SELECT * FROM agents WHERE project_id=? AND name=?').get(input.project_id, input.name);
    }
    programFor(name) {
        const r = this.db.prepare('SELECT program FROM agents WHERE name=? COLLATE NOCASE ORDER BY last_active_ts DESC LIMIT 1').get(name);
        return r?.program?.toLowerCase() ?? null;
    }
    /** The project a named agent most recently ran in — the single source of truth for which repo a
     *  live session belongs to, across every role (worker / pilot / overseer all upsert here at spawn). */
    projectFor(name) {
        const r = this.db.prepare('SELECT project_id FROM agents WHERE name=? COLLATE NOCASE ORDER BY last_active_ts DESC LIMIT 1').get(name);
        return r?.project_id ?? null;
    }
}
