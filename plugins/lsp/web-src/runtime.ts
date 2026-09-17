import type { ComponentType } from 'react';
export interface PluginChatRailSectionProps { variant: 'expanded' | 'compact'; sessionId: string | null; data: unknown; open: (target: string) => void; closeMobile?: () => void }
interface Registration { requiresApiVersion: number; chatRailSections?: Record<string, ComponentType<PluginChatRailSectionProps>> }
interface HostWindow { __elowenRegisterPluginUi?: (plugin: string, registration: Registration) => void; ElowenUiRuntime?: { hooks: { usePluginStrings(plugin: string): Record<string, string> } } }
export function runtime() {
  const value = (window as HostWindow).ElowenUiRuntime;
  if (!value) throw new Error('ElowenUiRuntime is not installed');
  return value;
}
export function registerLspUi(registration: Registration): void {
  (window as HostWindow).__elowenRegisterPluginUi?.('lsp', registration);
}