import { Github } from 'lucide-react';
import type { PluginPageProps } from 'elowen-plugin-ui-kit';
import { runtime } from './runtime';
import { GitHubConnectionPanel } from './GitHubConnectionPanel';

export function GitHubAccountPanel({ surface }: PluginPageProps) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('github');
  return (
    <C.PluginSection
      surface={surface}
      title={s.accountTitle || s.title}
      description={s.accountHint || s.intro}
      icon={Github}
    >
      <GitHubConnectionPanel />
    </C.PluginSection>
  );
}
