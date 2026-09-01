/** Shared type exports for the host-owned auto-save primitives.
 *
 * Runtime values remain host-owned. The authoritative ABI lives in `elowen-plugin-ui-kit`; registry
 * bundles and test fixtures import through this module so they cannot grow a second structural copy.
 */
export type {
  AutoSaveStatusProps,
  PluginConfigDraft,
  SaveStatus,
  UseAutoSaveStatus,
  UseAutoSaveStatusOptions,
  UseAutoSaveStatusResult,
} from 'elowen-plugin-ui-kit';
