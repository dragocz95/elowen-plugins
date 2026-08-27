import type { PluginPageProps } from 'elowen-plugin-ui-kit';
import { GitHubConnectionPanel } from './GitHubConnectionPanel';

/** GitHub as one identity of the Account page, mounted as a row of the Linked accounts drawer beside the
 *  chat platforms (manifest `web.account` declares `placement: 'linkedAccount'`). It renders no heading
 *  of its own: the drawer already names what it holds, and the rows beside it are a bare identity block
 *  over a card of rows — which is exactly the shape below. */
export function GitHubAccountPanel({ surface }: PluginPageProps) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <GitHubConnectionPanel surface={surface} />
    </div>
  );
}
