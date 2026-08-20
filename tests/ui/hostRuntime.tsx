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
      HelpTip: C.HelpTip, Modal: C.Modal, ModalBody: C.ModalBody, ModalFooter: C.ModalFooter,
      ControlSurfaceDocument: C.ControlSurfaceDocument, ControlSurfaceToolbar: C.ControlSurfaceToolbar,
      ControlSurfaceRegister: C.ControlSurfaceRegister, ControlSurfaceState: C.ControlSurfaceState,
      DataTable: C.DataTable, DataTableRow: C.DataTableRow, DataTableCell: C.DataTableCell,
      EmptyState: C.EmptyState, LoadingState: C.LoadingState, LoadingLine: C.LoadingLine, ErrorState: C.ErrorState,
      ConfirmDialog: C.ConfirmDialog, WorkspaceDetailRail: C.WorkspaceDetailRail,
      AutoSaveStatus: C.AutoSaveStatus, Spinner: C.Spinner, Checkbox: C.Checkbox, ModelIcon: C.ModelIcon,
      SelectionSummary: C.SelectionSummary, ManageSelectionModal: C.ManageSelectionModal, BrainModelField: C.BrainModelField,
      WorkspacePage: C.WorkspacePage, SpatialWorkspaceLayout: C.SpatialWorkspaceLayout, WorkspaceMetric: C.WorkspaceMetric,
      CompactWorkspaceHeader: C.CompactWorkspaceHeader, MarkdownAssetEditor: C.MarkdownAssetEditor,
      // The work and stats surfaces compose these shared workspace primitives. They are app chrome shared
      // with the surfaces that stay in core, which is why they live on the runtime rather than inside either
      // bundle.
      ActionMenu: C.ActionMenu, AgentIdentityStrip: C.AgentIdentityStrip, AgentStatusDot: C.AgentStatusDot,
      ContextMenu: C.ContextMenu, DateRangeFilter: C.DateRangeFilter, EntityList: C.EntityList, EntityRow: C.EntityRow,
      ExecutorPicker: C.ExecutorPicker, IconButton: C.IconButton, LiveTail: C.LiveTail, ModuleHeader: C.ModuleHeader,
      MotionLayout: C.MotionLayout, MotionLayoutItem: C.MotionLayoutItem, MotionPresence: C.MotionPresence,
      OutcomeBadge: C.OutcomeBadge, PatchView: C.PatchView, ProgressRibbon: C.ProgressRibbon,
      ProjectFilterPills: C.ProjectFilterPills, ProjectIcon: C.ProjectIcon, ProjectPill: C.ProjectPill,
      TaskContextLine: C.TaskContextLine, TaskUsageBadge: C.TaskUsageBadge, TerminalModal: C.TerminalModal,
      ChangeStrip: C.ChangeStrip,
      // The settings-extraction surface (the moved CLI-agents / autopilot / GitHub sections).
      SettingsDocument: C.SettingsDocument, SettingsGroup: C.SettingsGroup, SettingsRow: C.SettingsRow,
      BackendPicker: C.BackendPicker, ProviderPicker: C.ProviderPicker, ModelCatalogField: C.ModelCatalogField,
      ChoiceField: C.ChoiceField, ConstellationScope: C.ConstellationScope, ProviderLogo: C.ProviderLogo,
      PluginPageFrame: C.PluginPageFrame, PluginPageHeader: C.PluginPageHeader, PluginSection: C.PluginSection,
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
      // Work, agents and usage data stay on the HOST so plugin pages and core surfaces share ONE
      // react-query cache and ONE invalidation path.
      useTasks: H.useTasks, useAllDeps: H.useAllDeps, useMissions: H.useMissions, useSessions: H.useSessions,
      useSessionInfos: H.useSessionInfos, useSessionSignals: H.useSessionSignals, useSessionSignal: H.useSessionSignal,
      useConfig: H.useConfig, useProjects: H.useProjects, useProjectGit: H.useProjectGit,
      useActivity: H.useActivity, useModelUsage: H.useModelUsage, useUsageByDay: H.useUsageByDay,
      useUsageByOrigin: H.useUsageByOrigin,
      useProjectsCommits: H.useProjectsCommits, useTaskConversation: H.useTaskConversation,
      useTaskBrainConversation: H.useTaskBrainConversation, useTaskCommits: H.useTaskCommits,
      useTaskCommitFileDiff: H.useTaskCommitFileDiff, useTaskUsage: H.useTaskUsage,
      useMissionNotes: H.useMissionNotes, usePlanJob: H.usePlanJob,
      useEscalations: H.useEscalations, usePendingAsks: H.usePendingAsks,
      useSystemSkills: H.useSystemSkills, useInstallSkills: H.useInstallSkills,
      usePluginDetail: H.usePluginDetail, useSavePluginConfig: H.useSavePluginConfig,
      useAgentsPlugin: H.useAgentsPlugin, useEditorPlugin: H.useEditorPlugin, useWorkPlugin: H.useWorkPlugin,
      useCreateTask: H.useCreateTask, useUpdateTask: H.useUpdateTask, useDeleteTask: H.useDeleteTask,
      useCloseTask: H.useCloseTask, useSetTaskStatus: H.useSetTaskStatus, useSetTaskExec: H.useSetTaskExec,
      useSpawn: H.useSpawn, usePlanTask: H.usePlanTask, useInsertPhases: H.useInsertPhases,
      useEngage: H.useEngage, usePauseMission: H.usePauseMission, useResumeMission: H.useResumeMission,
      useDisengage: H.useDisengage, useDeleteMission: H.useDeleteMission,
      useOpenMissionPr: H.useOpenMissionPr, useMergeMissionPr: H.useMergeMissionPr,
      useApproveGate: H.useApproveGate, useReplyAsk: H.useReplyAsk, useKillSession: H.useKillSession,
      useSendInput: H.useSendInput, useUpdateConfig: H.useUpdateConfig, useResetUsage: H.useResetUsage,
      useSessionStall: H.useSessionStall, useTaskControls: H.useTaskControls,
      // Batched queries against the HOST's react-query client — a bundle that imported the library
      // itself would get a second QueryClient context and read an empty cache.
      useQueries: H.useQueries,
    },
    utils: {
      apiErrorMessage, parseTs: U.parseTs, compactElapsed: U.compactElapsed, isValidSchedule: U.isValidSchedule,
      copyText: U.copyText, defineEditorThemes: U.defineEditorThemes, editorTheme: U.editorTheme,
      // Task/agent mapping and the epic tree.
      taskExec: U.taskExec, taskAgentName: U.taskAgentName, taskSessionName: U.taskSessionName,
      taskStartedMs: U.taskStartedMs, taskElapsedMs: U.taskElapsedMs, taskElapsed: U.taskElapsed,
      taskBlockers: U.taskBlockers, agentDisplayName: U.agentDisplayName, phaseDetails: U.phaseDetails,
      needsInputSessions: U.needsInputSessions, taskForSession: U.taskForSession,
      missionEpicId: U.missionEpicId, keysForOption: U.keysForOption,
      epicChildren: U.epicChildren, phaseIds: U.phaseIds, epicProgress: U.epicProgress,
      epicLive: U.epicLive, epicEffectiveStatus: U.epicEffectiveStatus,
      // The date window.
      DEFAULT_RANGE: U.DEFAULT_RANGE, serializeRange: U.serializeRange, parseRange: U.parseRange,
      isStoredRange: U.isStoredRange, rangeBounds: U.rangeBounds, inRange: U.inRange,
      rangeWindowCapHours: U.rangeWindowCapHours,
      // Formatting + presentation vocabulary shared with the core surfaces that render task shapes.
      formatCost: U.formatCost, formatDuration: U.formatDuration, formatTokens: U.formatTokens,
      formatTaskTime: U.formatTaskTime, baseName: U.baseName, dirName: U.dirName, fileIcon: U.fileIcon,
      taskTypeMeta: U.taskTypeMeta, statusTone: U.statusTone, eventIcon: U.eventIcon,
      TONE_TEXT: U.TONE_TEXT, contextMenuDivider: U.DIVIDER,
      // Models + usage.
      allModels: U.allModels, execModel: U.execModel, buildUsageSummary: U.buildUsageSummary,
      cliProviders: U.PROVIDERS,
      // Host services. `elowenClient` is the app's ONE HTTP client — a bundle narrows it to the calls
      // it makes rather than shipping a second one.
      openTerminalWindow: U.openTerminalWindow, elowenClient, ElowenApiError,
    },
    api,
    navigate: (href: string) => { window.location.assign(href); },
  };
  host.__elowenRegisterPluginUi = (plugin, registration) => { registrations.set(plugin, registration); };
}

/** What a bundle registered through `__elowenRegisterPluginUi` — the production entry point's own path. */
export const pluginRegistration = (plugin: string): unknown => registrations.get(plugin);
