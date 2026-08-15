const COLS = 'mission_id,branch,worktree,pr_number,pr_url,pr_state,last_review_ts,fix_rounds,last_feedback';
/** Port of the core MissionPrStore onto the plugin DB handle (extraction step 3) — SQL byte-identical,
 *  table grandfathered. */
export class MissionPrStore {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Create the record for a freshly engaged mission, or return the existing one unchanged. Create is
     *  idempotent: re-engaging an epic (same mission id) must keep the original branch/worktree — a live
     *  worktree on disk must never be silently rebound to a new branch. */
    create(input) {
        this.db.prepare(`INSERT INTO mission_pr (mission_id,branch,worktree)
       VALUES (@mission_id,@branch,@worktree)
       ON CONFLICT(mission_id) DO NOTHING`).run({ ...input });
        return this.get(input.mission_id);
    }
    get(missionId) {
        return this.db.prepare(`SELECT ${COLS} FROM mission_pr WHERE mission_id=?`).get(missionId) ?? null;
    }
    /** Record an opened PR's number, url and state. */
    setPr(missionId, pr) {
        this.db.prepare('UPDATE mission_pr SET pr_number=?, pr_url=?, pr_state=? WHERE mission_id=?')
            .run(pr.number, pr.url, pr.state, missionId);
        return this.get(missionId);
    }
    /** Update just the PR lifecycle state (open → merged/closed), leaving number/url intact. */
    setPrState(missionId, state) {
        this.db.prepare('UPDATE mission_pr SET pr_state=? WHERE mission_id=?').run(state, missionId);
        return this.get(missionId);
    }
    /** Stamp the timestamp of the newest review the feedback poller has already ingested (dedup). */
    setLastReviewTs(missionId, ts) {
        this.db.prepare('UPDATE mission_pr SET last_review_ts=? WHERE mission_id=?').run(ts, missionId);
        return this.get(missionId);
    }
    /** Increment the PR fix-round counter and return the new value — the analogue of taskStore.bumpReviewFix,
     *  but for PR review feedback. Bounds the auto Codex↔Elowen fix ping-pong before escalating to a human. */
    bumpFixRounds(missionId) {
        this.db.prepare('UPDATE mission_pr SET fix_rounds = fix_rounds + 1 WHERE mission_id=?').run(missionId);
        return this.get(missionId)?.fix_rounds ?? 0;
    }
    /** Zero the fix-round budget and clear the fix context — on a merged/closed PR, or when a human
     *  manually re-engages the mission. */
    resetFixRounds(missionId) {
        this.db.prepare('UPDATE mission_pr SET fix_rounds = 0, last_feedback = NULL WHERE mission_id=?').run(missionId);
    }
    /** Record the aggregated PR-review feedback the current fix round is addressing (for the UI). */
    setLastFeedback(missionId, feedback) {
        this.db.prepare('UPDATE mission_pr SET last_feedback=? WHERE mission_id=?').run(feedback, missionId);
        return this.get(missionId);
    }
    remove(missionId) {
        this.db.prepare('DELETE FROM mission_pr WHERE mission_id=?').run(missionId);
    }
    /** Records whose PR is still open — the working set the feedback poller scans for new reviews. */
    withOpenPr() {
        return this.db.prepare(`SELECT ${COLS} FROM mission_pr WHERE pr_state='open'`).all();
    }
    /** Records still needing attention in the UI: no PR yet (ready to open / verify failed) or an open
     *  PR — i.e. anything not merged/closed. Lets a completed-but-PR-pending mission keep surfacing the
     *  branch/PR affordance even after it has disengaged. */
    pending() {
        return this.db.prepare(`SELECT ${COLS} FROM mission_pr WHERE pr_state IS NULL OR pr_state NOT IN ('merged','closed')`).all();
    }
}
