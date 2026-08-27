/** The decision at the centre of the mirror.
 *
 *  Every file is judged by comparing THREE states, not two: what is on disk now, what is in OneDrive now,
 *  and the BASELINE — what both sides looked like the last time they agreed. Two-way comparison cannot tell
 *  "they changed it" from "we changed it", which is exactly the difference between copying a file and
 *  destroying someone's work.
 *
 *  This module is deliberately pure and knows nothing about Graph, the filesystem or settings. Policy lives
 *  in the caller; what lives here is the truth about what happened. */

export type LocalFile =
  | { present: true; size: number; mtimeMs: number; sha256: string }
  | { present: false };

export type RemoteFile =
  | { present: true; itemId: string; etag: string; size: number }
  | { present: false };

/** What the two sides looked like when they last agreed. `null` means this path has never been synced. */
export type Baseline = { sha256: string; etag: string } | null;

type SideState = 'added' | 'changed' | 'unchanged' | 'deleted' | 'absent';

type MergeAction =
  /** Local content is authoritative: put it in OneDrive. */
  | 'upload'
  /** Remote content is authoritative: bring it down, atomically. */
  | 'download'
  /** The file was removed locally after both sides agreed: remove the copy we put in OneDrive. */
  | 'deleteRemote'
  /** The file was removed in OneDrive after both sides agreed: move the local copy into the mirror trash. */
  | 'trashLocal'
  /** Both sides moved independently. Keep BOTH and let a person decide. */
  | 'conflict'
  /** Gone from both sides: the baseline row is the only thing left to clean up. */
  | 'forget'
  | 'none';

export interface MergeDecision {
  action: MergeAction;
  local: SideState;
  remote: SideState;
}

function localState(local: LocalFile, baseline: Baseline): SideState {
  if (!local.present) return baseline === null ? 'absent' : 'deleted';
  if (baseline === null) return 'added';
  return local.sha256 === baseline.sha256 ? 'unchanged' : 'changed';
}

function remoteState(remote: RemoteFile, baseline: Baseline): SideState {
  if (!remote.present) return baseline === null ? 'absent' : 'deleted';
  if (baseline === null) return 'added';
  return remote.etag === baseline.etag ? 'unchanged' : 'changed';
}

/** Decide what to do with one path.
 *
 *  The governing rule is that NOTHING a person has not seen is destroyed. Where one side has content and the
 *  other has only a deletion made against an older version, the content wins and the deletion is treated as
 *  stale — re-uploading or re-downloading loses nothing, whereas honouring the stale deletion would throw
 *  away a change nobody reviewed. Where both sides genuinely moved, neither is guessed at: both copies are
 *  kept and the decision goes to a person. */
export function decide(local: LocalFile, remote: RemoteFile, baseline: Baseline): MergeDecision {
  const l = localState(local, baseline);
  const r = remoteState(remote, baseline);
  return { action: action(l, r), local: l, remote: r };
}

function action(l: SideState, r: SideState): MergeAction {
  // Never synced before: whichever side has the file wins, and if both do we cannot tell which is intended.
  if (l === 'added' && r === 'absent') return 'upload';
  if (l === 'absent' && r === 'added') return 'download';
  if (l === 'added' && r === 'added') return 'conflict';

  // One side moved, the other did not.
  if (l === 'changed' && r === 'unchanged') return 'upload';
  if (l === 'unchanged' && r === 'changed') return 'download';

  // Both moved. Keeping both copies is the only answer that cannot lose work.
  if (l === 'changed' && r === 'changed') return 'conflict';

  // A deletion on one side against content on the other. The deletion was made against a version that no
  // longer exists, so the content is what survives.
  if (l === 'changed' && r === 'deleted') return 'upload';
  if (l === 'deleted' && r === 'changed') return 'download';

  // A deletion against a side that did not move: this one is real, and is applied.
  if (l === 'deleted' && r === 'unchanged') return 'deleteRemote';
  if (l === 'unchanged' && r === 'deleted') return 'trashLocal';

  if (l === 'deleted' && r === 'deleted') return 'forget';
  if (l === 'absent' && r === 'absent') return 'forget';

  return 'none';
}
