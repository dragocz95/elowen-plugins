import type { PluginReadinessCheck } from 'elowen/plugin-api';
import { detectChrome, inspectChromeSandbox } from './browser-launcher.js';
import type { BrowserConfig } from './config.js';
import type { BrowserArtifactPublisher, BrowserProcessFactory, BrowserProxyFactory } from './types.js';

/** How much of the browser stack a check's outcome allows.
 *
 *  `blocked` means a managed session cannot start at all, `warning` means it can but something the plugin
 *  offers is missing or unproven, `ready` means the dependency answered for itself. */
export type BrowserDependencyStatus = 'ready' | 'warning' | 'blocked';

/** One dependency, as the panel shows it.
 *
 *  The backend decides `status` — a browser UI never re-derives it — and carries English copy so a host
 *  without the plugin's locale still reads a full sentence. `code` is the stable outcome name a surface
 *  translates by (`<code>` for the detail, `<code>.fix` for the remediation); `value` is a verbatim fact
 *  that must never be translated, and is the only place a path may appear. */
export interface BrowserDependencyCheck {
  id: 'chrome' | 'chrome-sandbox' | 'browser-control' | 'network-proxy' | 'profile-storage' | 'chat-artifacts';
  status: BrowserDependencyStatus;
  label: string;
  code: string;
  detail: string;
  value?: string;
  remediation?: string;
}

export interface BrowserDependencyReport {
  /** The worst outcome in `checks` — what the panel's summary states. */
  status: BrowserDependencyStatus;
  ready: number;
  total: number;
  checks: BrowserDependencyCheck[];
}

/** What the report is allowed to look at. Every one of these is a read: nothing here starts Chrome, opens
 *  a proxy, writes config or touches the network, because an operator opening a status page must not be
 *  the thing that allocates a browser. */
export interface BrowserDependencyInput {
  config: () => BrowserConfig;
  processFactory: BrowserProcessFactory;
  proxyFactory: BrowserProxyFactory;
  artifacts: BrowserArtifactPublisher;
  storage?: () => { ok: boolean; writable: boolean; private: boolean; name: string };
}

const RANK: Record<BrowserDependencyStatus, number> = { ready: 0, warning: 1, blocked: 2 };

/** A probe that throws answers "cannot be proven", never an exception and never its own message: a stack
 *  or an errno from inside the daemon is exactly the kind of internal detail this panel must not print. */
const safely = async (probe: () => Promise<boolean>): Promise<boolean> => {
  try { return await probe(); }
  catch { return false; }
};

async function chromeControl(factory: BrowserProcessFactory): Promise<BrowserDependencyCheck> {
  const available = await safely(() => factory.dependencyAvailable());
  return available
    ? { id: 'browser-control', status: 'ready', label: 'Browser control library', code: 'control.ready', detail: 'puppeteer-core is loadable in the daemon runtime.' }
    : {
      id: 'browser-control',
      status: 'blocked',
      label: 'Browser control library',
      code: 'control.missing',
      detail: 'puppeteer-core cannot be loaded in the daemon runtime.',
      remediation: 'Install puppeteer-core in the Elowen daemon runtime, then reload the plugin.',
    };
}

async function networkProxy(factory: BrowserProxyFactory): Promise<BrowserDependencyCheck> {
  const label = 'Enforcing network proxy';
  if (!factory.safePinningAvailable) {
    return {
      id: 'network-proxy',
      status: 'blocked',
      label,
      code: 'proxy.unsupported',
      detail: 'The proxy adapter cannot pin DNS per request, so browser launch is refused.',
      remediation: 'Restore the bundled proxy adapter; a browser session may only reach a host the navigation policy resolved.',
    };
  }
  const installed = factory.dependencyAvailable ? await safely(() => factory.dependencyAvailable!()) : true;
  return installed
    ? { id: 'network-proxy', status: 'ready', label, code: 'proxy.ready', detail: 'proxy-chain is loadable and pins DNS per request.' }
    : {
      id: 'network-proxy',
      status: 'blocked',
      label,
      code: 'proxy.missing',
      detail: 'proxy-chain 3.0 cannot be loaded, so browser launch is refused.',
      remediation: 'Install proxy-chain 3.0 or newer in the Elowen daemon runtime, then reload the plugin.',
    };
}

function chromeExecutable(config: BrowserConfig): { check: BrowserDependencyCheck; executable: string | null } {
  const executable = detectChrome(config.chromeExecutable);
  const label = 'Chrome or Chromium';
  if (executable) {
    return {
      executable,
      check: {
        id: 'chrome',
        status: 'ready',
        label,
        code: config.chromeExecutable ? 'chrome.configured' : 'chrome.detected',
        detail: config.chromeExecutable ? 'Using the executable configured for this plugin.' : 'Found a supported executable on this host.',
        value: executable,
      },
    };
  }
  return {
    executable: null,
    check: {
      id: 'chrome',
      status: 'blocked',
      label,
      code: config.chromeExecutable ? 'chrome.unusable' : 'chrome.missing',
      detail: config.chromeExecutable
        ? 'The configured executable is missing or cannot be executed by the daemon account.'
        : 'No supported Chrome or Chromium executable was found on this host.',
      remediation: config.chromeExecutable
        ? 'Correct the Chrome executable in this plugin\u2019s settings, or clear it to detect one automatically.'
        : 'Install Google Chrome or Chromium, or set the executable in this plugin\u2019s settings.',
    },
  };
}

function chromeSandbox(executable: string | null): BrowserDependencyCheck {
  const label = 'Chrome sandbox';
  const support = inspectChromeSandbox(executable);
  if (support.namespaces || support.setuidHelper) {
    return {
      id: 'chrome-sandbox',
      status: 'ready',
      label,
      code: support.namespaces ? 'sandbox.namespaces' : 'sandbox.setuid',
      detail: support.namespaces
        ? 'The kernel offers the user namespaces Chrome sandboxes with.'
        : 'The setuid sandbox helper shipped with the executable is in place.',
    };
  }
  return {
    id: 'chrome-sandbox',
    status: 'warning',
    label,
    code: 'sandbox.unverified',
    // Deliberately not a failure: Chrome decides at launch, and the plugin never disables the sandbox to
    // get past this, so the honest report is "unproven, the first launch is the real check".
    detail: 'Neither user namespaces nor the setuid helper could be confirmed; the first managed launch remains the real check.',
    remediation: 'Allow unprivileged user namespaces on this host, or install the Chrome package that ships the setuid sandbox helper.',
  };
}

/** The profile root reports its STATE and not its location: an operator needs to know that the directory
 *  is private and writable, and the remediation names what to change — printing the data root, let alone a
 *  per-account profile path, would put user storage on an admin page for no added help. */
function profileStorage(storage: BrowserDependencyInput['storage']): BrowserDependencyCheck | null {
  if (!storage) return null;
  const label = 'Profile storage';
  const state = storage();
  if (state.ok) {
    return { id: 'profile-storage', status: 'ready', label, code: 'storage.ready', detail: 'The profile directory is private and writable.' };
  }
  if (!state.private) {
    return {
      id: 'profile-storage',
      status: 'blocked',
      label,
      code: 'storage.exposed',
      detail: 'The profile directory is readable beyond the daemon account.',
      remediation: 'Restrict the plugin data directory to the daemon account (owner-only access), then reload the plugin.',
    };
  }
  return {
    id: 'profile-storage',
    status: 'blocked',
    label,
    code: 'storage.unwritable',
    detail: 'The profile directory is missing or not writable by the daemon account.',
    remediation: 'Give the daemon account write access to the plugin data directory, then reload the plugin.',
  };
}

function chatArtifacts(artifacts: BrowserArtifactPublisher): BrowserDependencyCheck {
  const label = 'Live view in chat';
  return artifacts.available
    ? { id: 'chat-artifacts', status: 'ready', label, code: 'artifacts.ready', detail: 'The host publishes the inline chat artifact bridge.' }
    : {
      id: 'chat-artifacts',
      // A session still runs and every tool still works; only the live card in chat is missing.
      status: 'warning',
      label,
      code: 'artifacts.missing',
      detail: 'This host has no inline chat artifact bridge, so sessions run without a live card in chat.',
      remediation: 'Update Elowen to a release that publishes inline chat artifacts.',
    };
}

/** Every dependency the plugin actually needs, decided in one place so the host readiness check and the
 *  settings panel can never disagree about what "ready" means. */
export async function browserDependencyReport(input: BrowserDependencyInput): Promise<BrowserDependencyReport> {
  const { check: chrome, executable } = chromeExecutable(input.config());
  const checks = [
    chrome,
    chromeSandbox(executable),
    await chromeControl(input.processFactory),
    await networkProxy(input.proxyFactory),
    profileStorage(input.storage),
    chatArtifacts(input.artifacts),
  ].filter((check): check is BrowserDependencyCheck => check !== null);
  const status = checks.reduce<BrowserDependencyStatus>(
    (worst, check) => (RANK[check.status] > RANK[worst] ? check.status : worst),
    'ready',
  );
  return { status, ready: checks.filter((check) => check.status === 'ready').length, total: checks.length, checks };
}

/** The host's own readiness line, derived from the same report rather than probing a second time. */
export async function browserReadiness(input: BrowserDependencyInput): Promise<PluginReadinessCheck> {
  const report = await browserDependencyReport(input);
  const blocked = report.checks.find((check) => check.status === 'blocked');
  if (blocked) return { id: 'browser-runtime', label: 'Browser runtime', ok: false, detail: `${blocked.label}: ${blocked.detail}` };
  const warnings = report.checks.filter((check) => check.status === 'warning');
  const chrome = report.checks.find((check) => check.id === 'chrome');
  const notes = warnings.map((check) => ` ${check.label}: ${check.detail}`).join('');
  return {
    id: 'browser-runtime',
    label: 'Browser runtime',
    ok: true,
    detail: `Chrome executable: ${chrome?.value ?? 'unknown'}. Chrome is launched without sandbox-disabling flags.${notes}`,
  };
}
