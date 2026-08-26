import type { PluginPageProps } from 'elowen-plugin-ui-kit';
import { GitHubConnectionPanel } from './GitHubConnectionPanel';

/** GitHub as one section of the Account page. It renders no heading of its own: the section rail already
 *  names it, and the native sections beside it are a bare identity block over a card of rows. */
export function GitHubAccountPanel({ surface }: PluginPageProps) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <GitHubConnectionPanel surface={surface} />
    </div>
  );
}
