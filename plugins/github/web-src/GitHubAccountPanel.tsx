import { GitHubConnectionPanel } from './GitHubConnectionPanel';

/** GitHub as one identity of the Account page, mounted as a row of the Linked accounts drawer beside the
 *  chat platforms (manifest `web.account` declares `placement: 'linkedAccount'`). It renders no heading
 *  and no wrapper of its own: the drawer names what it holds and supplies the divider between rows, and
 *  the row inside builds itself from the host's `LinkedAccountRow`, which carries its own spacing. A
 *  padded box here would make GitHub the one row sitting lower than its neighbours. */
export function GitHubAccountPanel() {
  return <GitHubConnectionPanel />;
}

export { GitHubAccountChip } from './GitHubConnectionPanel';
