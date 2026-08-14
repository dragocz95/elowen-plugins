/** The hook set the host installs on `window.ElowenUiRuntime.hooks`.
 *
 *  Ported from web/lib/queries.ts + web/lib/mutations.ts, on the REAL @tanstack/react-query — the panel's
 *  behaviour under test is react-query behaviour (the optimistic disclosure toggle, its rollback on
 *  error, the refetch on settle), so a hand-rolled stand-in would be testing the stand-in.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { elowenClient, type CronJobRow, type PluginSkillRow, type SkillOwner } from './hostClient';
export { useAutoSaveStatus } from './useAutoSaveStatus';

// ── i18n ─────────────────────────────────────────────────────────────────────────────────────────────
// The app's own English dictionary, narrowed to the keys the shared register and the plugin panel read.
// These are CORE labels, not plugin ones — the "All" option of the scope filter is the clearest case:
// the register owns that option, which is why the plugin ships no string for it.

export const DICTIONARY = {
  common: {
    daemonUnreachable: 'elowen daemon unreachable',
    cancel: 'Cancel',
    delete: 'Delete',
    retry: 'Retry',
    close: 'Close',
    loading: 'Loading…',
    saving: 'Saving…',
    saved: 'Saved',
    saveFailed: 'Couldn\'t save',
  },
  // The managed-selection vocabulary (SelectionSummary + ManageSelectionModal). These are CORE labels
  // too: the picker owns its search box, its "All" chip and its Save button, which is why the cronjob
  // plugin ships none of them.
  managePicker: {
    manage: 'Manage',
    searchPlaceholder: 'Search…',
    all: 'All',
    selectedCount: '{n} selected',
    saveChanges: 'Save changes',
    noResults: 'No results',
    filterByGroup: 'Filter by group',
    groupChannels: 'Channels',
    groupThreads: 'Threads',
  },
  assetEditor: {
    search: 'Search…',
    emptySearch: 'Nothing matches the filter',
    filterAll: 'All',
    filterUser: 'Custom',
    filterBuiltin: 'Built-in',
    colName: 'Name',
    colDescription: 'Description',
    pageRange: '{from}–{to} of {total}',
    pageLabel: 'Page {page} of {pages}',
    prevPage: 'Back',
    nextPage: 'Next',
  },
} as const;

export const useTranslation = () => ({ t: DICTIONARY as unknown as Record<string, Record<string, string>>, locale: 'en' });

// ── toasts ───────────────────────────────────────────────────────────────────────────────────────────

export interface ToastRecord { message: string; tone: 'ok' | 'error' }
const ToastContext = createContext<{ toast: (message: string, tone?: 'ok' | 'error') => void; toasts: ToastRecord[] }>({ toast: () => {}, toasts: [] });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const value = useMemo(() => ({
    toasts,
    toast: (message: string, tone: 'ok' | 'error' = 'ok') => setToasts((cur) => [...cur, { message, tone }]),
  }), [toasts]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);

// ── data plane ───────────────────────────────────────────────────────────────────────────────────────

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: elowenClient.me, staleTime: 5 * 60 * 1000 });

export const usePluginUi = (locale: string) =>
  useQuery({ queryKey: ['plugin-ui', locale], queryFn: () => elowenClient.pluginUi(locale), staleTime: 60_000 });

/** Localized view strings for one plugin's bundle: the /plugins/ui listing's merged `strings` record.
 *
 *  TOTAL by construction — an unknown key reads as the empty string rather than `undefined`. The record
 *  is empty for the paint or two before the listing resolves, and a view that formats its copy would not
 *  render a blank label there, it would throw and take the whole page down. */
export function usePluginStrings(plugin: string): Record<string, string> {
  const { locale } = useTranslation();
  const listing = usePluginUi(locale);
  const strings = listing.data?.find((p) => p.name === plugin)?.strings;
  return useMemo(() => new Proxy(strings ?? {}, {
    get: (target, key) => (typeof key === 'string' ? target[key] ?? '' : undefined),
  }), [strings]);
}

export const usePluginSkills = () => useQuery({ queryKey: ['plugin-skills'], queryFn: elowenClient.pluginSkills });

export function useCreatePluginSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skill: { name: string; description: string; content: string; disableModelInvocation?: boolean; owner?: SkillOwner }) => elowenClient.createPluginSkill(skill),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugin-skills'] }),
  });
}

/** Edit a user skill in place — description/content and the disable-model-invocation flag. Optimistic:
 *  the row flips instantly (the daemon's plugin hot-reload can take a while, and the old
 *  wait-for-refetch behaviour left the toggle greyed out until a manual reload). On error the change
 *  rolls back; on settle the list re-fetches the real backend state. */
export function useUpdatePluginSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; owner?: SkillOwner; patch: { description?: string; content?: string; disableModelInvocation?: boolean } }) =>
      elowenClient.updatePluginSkill(v.name, v.patch, v.owner),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['plugin-skills'] });
      const prev = qc.getQueryData<PluginSkillRow[]>(['plugin-skills']);
      // Match on name AND owner: the same name can legitimately exist for two accounts, and an
      // optimistic patch keyed on the name alone would flip a row belonging to someone else.
      const targetOwner = v.owner === 'instance' || v.owner == null ? null : v.owner;
      qc.setQueryData<PluginSkillRow[]>(['plugin-skills'], (cur) => cur?.map((s) => (s.name === v.name && (s.owner ?? null) === targetOwner ? { ...s, ...v.patch } : s)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['plugin-skills'], ctx.prev); },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['plugin-skills'] }); },
  });
}

export function useDeletePluginSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; owner?: SkillOwner }) => elowenClient.deletePluginSkill(v.name, v.owner),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugin-skills'] }),
  });
}

/** The provider tree a plugin panel is mounted inside — one QueryClient per test, so no cache leaks
 *  between them, and no retries (a deliberate 500 must surface as an error, not as three more requests). */
export function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  };
}

// ── cronjob panel ────────────────────────────────────────────────────────────────────────────────────
// Ported from the host's web/lib/queries.ts + mutations.ts, cache keys included: the panel's refetch
// after a save is react-query invalidating 'cron-jobs', so the key has to be the real one.

/** The cronjob plugin's scheduled jobs (admin-only endpoint). */
export const useCronJobs = (enabled = true) =>
  useQuery({ queryKey: ['cron-jobs'], queryFn: elowenClient.cronJobs, enabled });

/** Text channels + active threads of the configured Discord guild (the cron destination picker). */
export const useDiscordChannels = () =>
  useQuery({ queryKey: ['discord-channels'], queryFn: elowenClient.discordChannels, staleTime: 60_000 });

/** Pickable brain models across all configured providers. */
export const useBrainModels = () =>
  useQuery({ queryKey: ['brain-models'], queryFn: elowenClient.brainModels });

export function useSaveCronJob() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (job: CronJobRow) => elowenClient.saveCronJob(job), onSuccess: () => qc.invalidateQueries({ queryKey: ['cron-jobs'] }) });
}

export function useDeleteCronJob() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => elowenClient.deleteCronJob(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['cron-jobs'] }) });
}
