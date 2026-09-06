import type { PluginReadinessCheck } from 'elowen/plugin-api';
import type { PublishedSitesEnvironmentStatus } from './coreSeams.js';

/** How many environment dependency rows the plugin can contribute.
 *
 *  Core fixes the set of readiness checks when the plugin registers, but the dependency checklist is
 *  produced at REQUEST time by the privileged helper, so the row count is not known at load. Each slot
 *  therefore resolves one entry of the same report and returns null when that entry does not exist,
 *  which core renders as no row at all. The last slot folds anything beyond the slot count into one row
 *  rather than dropping it, so a dependency can never fail invisibly. */
export const ENVIRONMENT_READINESS_SLOTS = 24;

const ENVIRONMENT_HINT =
  'Review the Sites settings checklist. Dependency installation is exposed by the later admin API and UI phase.';

const disabledRow = (): PluginReadinessCheck => ({
  id: 'sites-environments',
  label: 'Sites environments',
  ok: true,
  detail: 'Persistent environments are disabled in Sites settings.',
});

const itemRow = (
  item: PublishedSitesEnvironmentStatus['items'][number],
  report: PublishedSitesEnvironmentStatus,
): PluginReadinessCheck => ({
  id: `sites-env-${item.id}`,
  label: item.label,
  ok: item.ok,
  detail: item.detail || (item.ok ? 'Ready.' : 'Not ready.'),
  // The report-wide detail explains WHY a whole checklist is failing (an unreachable helper, a failed
  // provisioning run). It belongs on the rows that are actually failing, not on every green one.
  ...(item.ok ? {} : { hint: [report.detail, ENVIRONMENT_HINT].filter(Boolean).join(' ') }),
});

/** One readiness row per dependency the setup page already lists, from the SAME provisioning report. */
export function environmentReadinessRows(report: PublishedSitesEnvironmentStatus): PluginReadinessCheck[] {
  if (report.items.length === 0) {
    return [{
      id: 'sites-environments',
      label: 'Sites environments',
      ok: report.ready,
      detail: report.detail || 'No environment dependency checks were returned.',
    }];
  }
  const fits = report.items.length <= ENVIRONMENT_READINESS_SLOTS;
  const shown = fits ? report.items : report.items.slice(0, ENVIRONMENT_READINESS_SLOTS - 1);
  const rows = shown.map((item) => itemRow(item, report));
  const rest = report.items.slice(shown.length);
  if (rest.length > 0) {
    rows.push({
      id: 'sites-env-remaining',
      label: `${rest.length} further environment checks`,
      ok: rest.every((item) => item.ok),
      detail: rest.map((item) => `${item.label}: ${item.ok ? 'ready' : 'not ready'}`).join('; '),
      ...(rest.every((item) => item.ok) ? {} : { hint: ENVIRONMENT_HINT }),
    });
  }
  return rows;
}

/** The environment rows as separate checks, sharing ONE probe per readiness request.
 *
 *  Core calls every registered check on each request, and inspecting the dependencies runs privileged
 *  helper and Podman commands — so the slots read one short-lived shared report instead of probing the
 *  host once per row. */
export function environmentReadinessChecks(deps: {
  enabled(): boolean;
  status(): Promise<PublishedSitesEnvironmentStatus>;
  now?(): number;
  ttlMs?: number;
}): (() => Promise<PluginReadinessCheck | null>)[] {
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.ttlMs ?? 2_000;
  let pending: Promise<PluginReadinessCheck[]> | null = null;
  let cached: Promise<PluginReadinessCheck[]> | null = null;
  let settledAt = 0;

  const rows = (): Promise<PluginReadinessCheck[]> => {
    if (pending) return pending;
    if (cached && now() - settledAt < ttlMs) return cached;
    const probe = (async () => (deps.enabled() ? environmentReadinessRows(await deps.status()) : [disabledRow()]))();
    const tracked = probe.then(
      (value) => { settledAt = now(); pending = null; return value; },
      (error: unknown) => { settledAt = now(); pending = null; cached = null; throw error; },
    );
    pending = tracked;
    cached = tracked;
    return tracked;
  };

  return Array.from(
    { length: ENVIRONMENT_READINESS_SLOTS },
    (_unused, slot) => async (): Promise<PluginReadinessCheck | null> => (await rows())[slot] ?? null,
  );
}

/** One toolchain interpreter, as the confined Sandbox has to see it. */
interface ToolchainProbe {
  id: string;
  label: string;
  paths: string[];
  /** A missing required tool means Project agents cannot build a site at all; the optional ones only
   *  narrow what a site can be written in, so they report their state without failing the card. */
  required: boolean;
}

export const SITES_TOOLCHAIN: ToolchainProbe[] = [
  { id: 'node', label: 'Node, npm and Corepack', paths: ['/usr/bin/node', '/usr/bin/npm', '/usr/bin/corepack'], required: true },
  { id: 'python', label: 'Python (optional)', paths: ['/usr/bin/python3'], required: false },
  { id: 'bun', label: 'Bun (optional)', paths: ['/usr/local/bin/bun'], required: false },
  { id: 'php', label: 'PHP-CGI (optional)', paths: ['/usr/bin/php-cgi'], required: false },
];

export function toolchainRow(probe: ToolchainProbe, visible: (path: string) => boolean): PluginReadinessCheck {
  const missing = probe.paths.filter((path) => !visible(path));
  if (missing.length === 0) return { id: `sites-toolchain-${probe.id}`, label: probe.label, ok: true, detail: 'Ready.' };
  return {
    id: `sites-toolchain-${probe.id}`,
    label: probe.label,
    ok: !probe.required,
    detail: `Missing from the confined Sandbox: ${missing.join(', ')}.`,
    ...(probe.required ? { hint: 'Install the required tools under /usr so Project agents can build sites.' } : {}),
  };
}
