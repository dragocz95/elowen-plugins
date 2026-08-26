/** The decision at the centre of the mirror.
 *
 *  Every file is judged by comparing THREE states, not two: what is on disk now, what is in OneDrive now,
 *  and the BASELINE — what both sides looked like the last time they agreed. Two-way comparison cannot tell
 *  "they changed it" from "we changed it", which is exactly the difference between copying a file and
 *  destroying someone's work.
 *
 *  This module is deliberately pure and knows nothing about Graph, the filesystem or settings. Policy lives
 *  in the caller; what lives here is the truth about what happened. */
function localState(local, baseline) {
    if (!local.present)
        return baseline === null ? 'absent' : 'deleted';
    if (baseline === null)
        return 'added';
    return local.sha256 === baseline.sha256 ? 'unchanged' : 'changed';
}
function remoteState(remote, baseline) {
    if (!remote.present)
        return baseline === null ? 'absent' : 'deleted';
    if (baseline === null)
        return 'added';
    return remote.etag === baseline.etag ? 'unchanged' : 'changed';
}
/** Decide what to do with one path.
 *
 *  The governing rule is that NOTHING a person has not seen is destroyed. Where one side has content and the
 *  other has only a deletion made against an older version, the content wins and the deletion is treated as
 *  stale — re-uploading or re-downloading loses nothing, whereas honouring the stale deletion would throw
 *  away a change nobody reviewed. Where both sides genuinely moved, neither is guessed at: both copies are
 *  kept and the decision goes to a person. */
export function decide(local, remote, baseline) {
    const l = localState(local, baseline);
    const r = remoteState(remote, baseline);
    return { action: action(l, r), local: l, remote: r };
}
function action(l, r) {
    // Never synced before: whichever side has the file wins, and if both do we cannot tell which is intended.
    if (l === 'added' && r === 'absent')
        return 'upload';
    if (l === 'absent' && r === 'added')
        return 'download';
    if (l === 'added' && r === 'added')
        return 'conflict';
    // One side moved, the other did not.
    if (l === 'changed' && r === 'unchanged')
        return 'upload';
    if (l === 'unchanged' && r === 'changed')
        return 'download';
    // Both moved. Keeping both copies is the only answer that cannot lose work.
    if (l === 'changed' && r === 'changed')
        return 'conflict';
    // A deletion on one side against content on the other. The deletion was made against a version that no
    // longer exists, so the content is what survives.
    if (l === 'changed' && r === 'deleted')
        return 'upload';
    if (l === 'deleted' && r === 'changed')
        return 'download';
    // A deletion against a side that did not move: this one is real, and is applied.
    if (l === 'deleted' && r === 'unchanged')
        return 'deleteRemote';
    if (l === 'unchanged' && r === 'deleted')
        return 'trashLocal';
    if (l === 'deleted' && r === 'deleted')
        return 'forget';
    if (l === 'absent' && r === 'absent')
        return 'forget';
    return 'none';
}
