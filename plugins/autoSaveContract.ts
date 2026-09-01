/** Shared structural contract for the host-owned auto-save primitives.
 *
 * The runtime values remain host-owned. This file only gives registry bundles and their test fixtures one
 * vocabulary for the ABI that crosses `window.ElowenUiRuntime`; it must stay aligned with the host
 * `web/lib/useAutoSaveStatus.ts` and `web/components/ui/AutoSaveStatus.tsx` contracts.
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseAutoSaveStatusOptions {
  ready?: boolean;
  savable?: boolean;
  delay?: number;
}

export interface UseAutoSaveStatusResult {
  status: SaveStatus;
  retry: () => void;
  flush: () => void;
}

export type UseAutoSaveStatus = (
  deps: readonly unknown[],
  save: () => Promise<void> | void,
  opts?: UseAutoSaveStatusOptions,
) => UseAutoSaveStatusResult;

export interface AutoSaveStatusProps {
  status: SaveStatus;
  onRetry?: () => void;
}
