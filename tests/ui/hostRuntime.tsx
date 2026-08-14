/** Install `window.ElowenUiRuntime` — the host API surface a plugin's browser bundle runs against.
 *
 *  In production the app installs this (web/lib/pluginUi.tsx) and the bundle reaches it through the two
 *  window globals; the bundle never imports from the app. Rendering a plugin panel in this repo therefore
 *  means installing an equivalent runtime here: the panel under test resolves EVERYTHING (React,
 *  components, hooks, the HTTP helper) through this object, exactly as the shipped bundle does.
 *
 *  It carries only what this repo's plugin panels touch, not the app's full curated set — an addition is
 *  cheap, and a component the panels never reach for would be dead weight nobody could keep honest. */
import * as React from 'react';
import * as ReactDom from 'react-dom';
import * as JsxRuntime from 'react/jsx-runtime';
import * as C from './hostComponents';
import * as H from './hostHooks';
import { api, apiErrorMessage } from './hostClient';
import { compactElapsed, isValidSchedule, parseTs } from './hostUtils';

export const PLUGIN_UI_API_VERSION = 1;

interface HostWindow extends Window {
  ElowenUiRuntime?: unknown;
  __elowenRegisterPluginUi?: (plugin: string, registration: unknown) => void;
}

const registrations = new Map<string, unknown>();

/** Idempotent, like the app's own — every bundle load calls it. */
export function ensurePluginUiRuntime(): void {
  const host = window as HostWindow;
  if (host.ElowenUiRuntime) return;
  host.ElowenUiRuntime = {
    apiVersion: PLUGIN_UI_API_VERSION,
    react: React,
    reactDom: ReactDom,
    jsxRuntime: JsxRuntime,
    components: {
      Badge: C.Badge, Button: C.Button, Input: C.Input, Field: C.Field, Toggle: C.Toggle, Segmented: C.Segmented,
      ControlSurfaceDocument: C.ControlSurfaceDocument, ControlSurfaceToolbar: C.ControlSurfaceToolbar,
      ControlSurfaceRegister: C.ControlSurfaceRegister, ControlSurfaceState: C.ControlSurfaceState,
      DataTable: C.DataTable, DataTableRow: C.DataTableRow, DataTableCell: C.DataTableCell,
      EmptyState: C.EmptyState, LoadingState: C.LoadingState, ErrorState: C.ErrorState,
      ConfirmDialog: C.ConfirmDialog, WorkspaceDetailRail: C.WorkspaceDetailRail,
      AutoSaveStatus: C.AutoSaveStatus, Spinner: C.Spinner, Checkbox: C.Checkbox, ModelIcon: C.ModelIcon,
      SelectionSummary: C.SelectionSummary, ManageSelectionModal: C.ManageSelectionModal, BrainModelField: C.BrainModelField,
      WorkspacePage: C.WorkspacePage, SpatialWorkspaceLayout: C.SpatialWorkspaceLayout, WorkspaceMetric: C.WorkspaceMetric,
      MarkdownAssetEditor: C.MarkdownAssetEditor,
    },
    // The data hooks keep the react-query cache in the HOST, so a plugin panel and the app share one
    // cache and one invalidation path. A bundle that imported the library itself would get a second
    // QueryClient context and read an empty cache.
    hooks: {
      useTranslation: H.useTranslation, useToast: H.useToast, usePluginStrings: H.usePluginStrings,
      useMe: H.useMe, usePluginUi: H.usePluginUi,
      usePluginSkills: H.usePluginSkills, useCreatePluginSkill: H.useCreatePluginSkill,
      useUpdatePluginSkill: H.useUpdatePluginSkill, useDeletePluginSkill: H.useDeletePluginSkill,
      useCronJobs: H.useCronJobs, useSaveCronJob: H.useSaveCronJob, useDeleteCronJob: H.useDeleteCronJob,
      useDiscordChannels: H.useDiscordChannels, useBrainModels: H.useBrainModels,
      useAutoSaveStatus: H.useAutoSaveStatus,
    },
    utils: { apiErrorMessage, parseTs, compactElapsed, isValidSchedule },
    api,
    navigate: (href: string) => { window.location.assign(href); },
  };
  host.__elowenRegisterPluginUi = (plugin, registration) => { registrations.set(plugin, registration); };
}

/** What a bundle registered through `__elowenRegisterPluginUi` — the production entry point's own path. */
export const pluginRegistration = (plugin: string): unknown => registrations.get(plugin);
