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
import { api, apiErrorMessage, ElowenApiError, elowenClient } from './hostClient';
import * as U from './hostUtils';

/** The host's own constant, mirrored. `tests/hostRuntimeParity.test.ts` is what keeps this file and the
 *  maps below from drifting away from the runtime a bundle actually finds in production. */
const PLUGIN_UI_API_VERSION = 8;

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
      SelectMenu: ({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: { value: string; label: string }[] }) => <label>{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>,
      HelpTip: C.HelpTip, Modal: C.Modal, ModalBody: C.ModalBody, ModalFooter: C.ModalFooter,
      ControlSurfaceDocument: C.ControlSurfaceDocument, ControlSurfaceToolbar: C.ControlSurfaceToolbar,
      ControlSurfaceRegister: C.ControlSurfaceRegister, ControlSurfaceState: C.ControlSurfaceState,
      DataTable: C.DataTable, DataTableRow: C.DataTableRow, DataTableCell: C.DataTableCell,
      // The register footer, the toolbar's search field and the row's trailing open affordance — the
      // three pieces every plugin register used to hand-roll (API 8).
      Pager: C.Pager, RegisterSearch: C.RegisterSearch, DataTableChevronCell: C.DataTableChevronCell,
      EmptyState: C.EmptyState, LoadingState: C.LoadingState, LoadingLine: C.LoadingLine, ErrorState: C.ErrorState,
      ConfirmDialog: C.ConfirmDialog, WorkspaceDetailRail: C.WorkspaceDetailRail,
      AutoSaveStatus: C.AutoSaveStatus, Spinner: C.Spinner, Checkbox: C.Checkbox, ModelIcon: C.ModelIcon,
      SelectionSummary: C.SelectionSummary, ManageSelectionModal: C.ManageSelectionModal, BrainModelField: C.BrainModelField,
      // The canonical page shell and its hero, plus the pre-unification aliases onto them that shipped
      // bundles still mount by name.
      WorkspaceShell: C.WorkspaceShell, WorkspaceHero: C.WorkspaceHero, WorkspaceTakeover: C.WorkspaceTakeover,
      WorkspacePage: C.WorkspacePage, SpatialWorkspaceLayout: C.SpatialWorkspaceLayout, WorkspaceMetric: C.WorkspaceMetric,
      CompactWorkspaceHeader: C.CompactWorkspaceHeader, MarkdownAssetEditor: C.MarkdownAssetEditor,
      // App chrome shared with the surfaces that stay in core, which is why it lives on the runtime
      // rather than inside a bundle.
      ActionMenu: C.ActionMenu,
      // A person as the app draws one, and the caption a detail drawer hangs each of its sections from.
      Avatar: C.Avatar, DetailBlock: C.DetailBlock,
      ContextMenu: C.ContextMenu, DateRangeFilter: C.DateRangeFilter, EntityList: C.EntityList, EntityRow: C.EntityRow,
      ExecutorPicker: C.ExecutorPicker, IconButton: C.IconButton, LiveTail: C.LiveTail, ModuleHeader: C.ModuleHeader,
      MotionLayout: C.MotionLayout, MotionLayoutItem: C.MotionLayoutItem, MotionPresence: C.MotionPresence,
      OutcomeBadge: C.OutcomeBadge, PatchView: C.PatchView, ProgressRibbon: C.ProgressRibbon,
      ProjectFilterPills: C.ProjectFilterPills, ProjectPill: C.ProjectPill,
      ChangeStrip: C.ChangeStrip,
      // The settings-extraction surface (the moved CLI-agents / autopilot / GitHub sections).
      SettingsDocument: C.SettingsDocument, SettingsGroup: C.SettingsGroup, SettingsRow: C.SettingsRow,
      SpatialIdentity: C.SpatialIdentity, TimeSeriesChart: C.TimeSeriesChart,
      // A connector identity in the Linked accounts drawer, and its chip in the closed summary.
      LinkedAccountRow: C.LinkedAccountRow, SummaryChip: C.SummaryChip,
      BackendPicker: C.BackendPicker, ProviderPicker: C.ProviderPicker, ModelCatalogField: C.ModelCatalogField,
      ChoiceField: C.ChoiceField, ProviderLogo: C.ProviderLogo,
      PluginPageFrame: C.PluginPageFrame, PluginPageHeader: C.PluginPageHeader, PluginSection: C.PluginSection,
    },
    // The data hooks keep the react-query cache in the HOST, so a plugin panel and the app share one
    // cache and one invalidation path. A bundle that imported the library itself would get a second
    // QueryClient context and read an empty cache.
    hooks: {
      useTranslation: H.useTranslation, useToast: H.useToast, usePluginStrings: H.usePluginStrings,
      useMe: H.useMe,
      usePluginSkills: H.usePluginSkills, useCreatePluginSkill: H.useCreatePluginSkill,
      useUpdatePluginSkill: H.useUpdatePluginSkill, useDeletePluginSkill: H.useDeletePluginSkill,
      useCronJobs: H.useCronJobs, useSaveCronJob: H.useSaveCronJob, useDeleteCronJob: H.useDeleteCronJob,
      useNotificationDestinations: H.useNotificationDestinations, useBrainModels: H.useBrainModels,
      useAutoSaveStatus: H.useAutoSaveStatus,
      useProjectFiles: H.useProjectFiles, useProjectFile: H.useProjectFile, useProjectFileAtHead: H.useProjectFileAtHead,
      useProjectCommit: H.useProjectCommit, useProjectCommitFileDiff: H.useProjectCommitFileDiff,
      useProjectChanged: H.useProjectChanged, useProjectChanges: H.useProjectChanges,
      useWriteProjectFile: H.useWriteProjectFile, useNewProjectFile: H.useNewProjectFile, useNewProjectDir: H.useNewProjectDir,
      useRenameProjectEntry: H.useRenameProjectEntry, useCopyProjectEntry: H.useCopyProjectEntry, useDeleteProjectEntry: H.useDeleteProjectEntry,
      useMobile: H.useMobile,
      // Layout/selection behaviour shared with the built-in workspaces.
      usePersistentState: H.usePersistentState, useProjectFilter: H.useProjectFilter, useFillHeight: H.useFillHeight,
      // Config, project and usage data stay on the HOST so plugin pages and core surfaces share ONE
      // react-query cache and ONE invalidation path.
      useConfig: H.useConfig, useUpdateConfig: H.useUpdateConfig, useProjects: H.useProjects,
      useActivity: H.useActivity, useModelUsage: H.useModelUsage, useUsageByDay: H.useUsageByDay,
      useUsageByOrigin: H.useUsageByOrigin, useResetUsage: H.useResetUsage,
      usePluginDetail: H.usePluginDetail, useSavePluginConfig: H.useSavePluginConfig,
      // Batched queries against the HOST's react-query client — a bundle that imported the library
      // itself would get a second QueryClient context and read an empty cache.
      useQuery: H.useQuery, useMutation: H.useMutation, useInfiniteQuery: H.useInfiniteQuery,
      useQueryClient: H.useQueryClient, useQueries: H.useQueries,
    },
    utils: {
      apiErrorMessage, parseTs: U.parseTs, compactElapsed: U.compactElapsed, isValidSchedule: U.isValidSchedule,
      copyText: U.copyText, defineEditorThemes: U.defineEditorThemes, editorTheme: U.editorTheme,
      // The date window a usage page needs to persist and read back its own filter.
      DEFAULT_RANGE: U.DEFAULT_RANGE, serializeRange: U.serializeRange, parseRange: U.parseRange,
      isStoredRange: U.isStoredRange, rangeBounds: U.rangeBounds,
      // Formatting + presentation vocabulary shared with the core surfaces.
      formatCost: U.formatCost, formatDuration: U.formatDuration,
      baseName: U.baseName, dirName: U.dirName, fileIcon: U.fileIcon, eventIcon: U.eventIcon,
      contextMenuDivider: U.DIVIDER,
      // Models + usage.
      allModels: U.allModels, buildUsageSummary: U.buildUsageSummary, cliProviders: U.PROVIDERS,
      // Host services. `elowenClient` is the app's ONE HTTP client — a bundle narrows it to the calls
      // it makes rather than shipping a second one.
      elowenClient, ElowenApiError,
    },
    api,
    navigate: (href: string) => { window.location.assign(href); },
  };
  host.__elowenRegisterPluginUi = (plugin, registration) => { registrations.set(plugin, registration); };
}

/** What a bundle registered through `__elowenRegisterPluginUi` — the production entry point's own path. */
