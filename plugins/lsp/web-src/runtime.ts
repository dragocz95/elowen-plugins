import type { ComponentType, ReactNode } from 'react';
import type { AssertPublished } from 'elowen-plugin-ui-kit';
export interface PluginChatRailSectionProps { variant: 'expanded' | 'compact'; sessionId: string | null; data: unknown; open: (target: string) => void; closeMobile?: () => void }
interface Registration { requiresApiVersion: number; chatRailSections?: Record<string, ComponentType<PluginChatRailSectionProps>> }
interface Components {
  /** The host's shared rail heading; a bundle must not rebuild its markup, because the skin styles it by class. */
  RailSectionHead: ComponentType<{ label: string; icon?: ReactNode; meta?: ReactNode }>;
}
type PublishedNames = AssertPublished<keyof Components>;
interface HostWindow { __elowenRegisterPluginUi?: (plugin: string, registration: Registration) => void; ElowenUiRuntime?: { components: Pick<Components, PublishedNames>; hooks: { usePluginStrings(plugin: string): Record<string, string> } } }
export function runtime() {
  const value = (window as HostWindow).ElowenUiRuntime;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}
export function registerLspUi(registration: Registration): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('lsp', registration);
}