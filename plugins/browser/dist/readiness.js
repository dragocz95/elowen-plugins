import { basename } from 'node:path';
import { detectChrome } from './browser-launcher.js';
import { detectExecutable } from './virtual-display.js';
const RANK = { ready: 0, warning: 1, blocked: 2 };
/** A probe that throws answers "cannot be proven", never an exception and never its own message: a stack
 *  or an errno from inside the daemon is exactly the kind of internal detail this panel must not print. */
const safely = async (probe) => {
    try {
        return await probe();
    }
    catch {
        return false;
    }
};
async function chromeControl(factory) {
    const available = await safely(() => factory.dependencyAvailable());
    return available
        ? { id: 'browser-control', status: 'ready', label: 'Browser control library', code: 'control.ready', detail: 'puppeteer-core is loadable and exposes launch().' }
        : {
            id: 'browser-control',
            status: 'blocked',
            label: 'Browser control library',
            code: 'control.missing',
            detail: 'puppeteer-core is missing from the daemon runtime, or does not expose launch().',
            // This plugin does not carry its own dependency tree — it runs on the daemon's. Telling an operator
            // to install a package beside it would produce a second, unmanaged copy.
            remediation: 'The plugin shares the Elowen daemon\u2019s runtime dependencies: reinstall or update Elowen with its runtime dependencies, then restart the daemon.',
        };
}
async function networkProxy(factory) {
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
    const installed = factory.dependencyAvailable ? await safely(() => factory.dependencyAvailable()) : true;
    return installed
        ? { id: 'network-proxy', status: 'ready', label, code: 'proxy.ready', detail: 'proxy-chain is loadable and pins DNS per request.' }
        : {
            id: 'network-proxy',
            status: 'blocked',
            label,
            code: 'proxy.missing',
            detail: 'proxy-chain 3.0 cannot be loaded, so browser launch is refused.',
            remediation: 'The plugin shares the Elowen daemon\u2019s runtime dependencies: reinstall or update Elowen with its runtime dependencies, then restart the daemon.',
        };
}
function chromeExecutable(config) {
    const executable = detectChrome(config.chromeExecutable);
    const label = 'Chrome or Chromium';
    if (executable) {
        return {
            id: 'chrome',
            status: 'ready',
            label,
            code: config.chromeExecutable ? 'chrome.configured' : 'chrome.detected',
            detail: config.chromeExecutable ? 'Using the executable configured for this plugin.' : 'Found a supported executable on this host.',
            // The browser's NAME, never where it lives.
            value: basename(executable),
        };
    }
    return {
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
    };
}
/** The profile root reports its STATE and not its location: an operator needs to know that the directory
 *  is private and writable, and the remediation names what to change — printing the data root, let alone a
 *  per-account profile path, would put user storage on an admin page for no added help. */
function profileStorage(storage) {
    if (!storage)
        return null;
    const label = 'Profile storage';
    const { state } = storage();
    if (state === 'ready') {
        return { id: 'profile-storage', status: 'ready', label, code: 'storage.ready', detail: 'The profile directory is private and writable.' };
    }
    // Each state gets the fix for what actually happened. A root that is GONE is not a root that is
    // world-readable, and telling an operator to tighten permissions on a directory that is not there
    // sends them after the wrong thing.
    const blocked = {
        missing: {
            detail: 'The profile directory is no longer the trusted directory the plugin created.',
            remediation: 'Restore the plugin data directory as a real directory owned by the daemon account, then restart the daemon.',
        },
        exposed: {
            detail: 'The profile directory is readable beyond the daemon account.',
            remediation: 'Restrict the plugin data directory to owner-only access, then restart the daemon.',
        },
        unwritable: {
            detail: 'The profile directory cannot be written by the daemon account.',
            remediation: 'Give the daemon account write access to the plugin data directory, then restart the daemon.',
        },
    }[state];
    return { id: 'profile-storage', status: 'blocked', label, code: `storage.${state}`, ...blocked };
}
/** Xvfb and x11vnc, which are no longer optional: a managed browser is always drawn on a private X
 *  display, so a host without them cannot start a session at all. Named individually, because installing
 *  the wrong one of the two is the likely mistake and "virtual display missing" would not say which. */
function virtualDisplay() {
    const label = 'Virtual display';
    const missing = ['Xvfb', 'x11vnc'].filter((binary) => !detectExecutable(binary));
    if (missing.length === 0) {
        return { id: 'virtual-display', status: 'ready', label, code: 'display.ready', detail: 'Xvfb and x11vnc are installed and executable.' };
    }
    return {
        id: 'virtual-display',
        status: 'blocked',
        label,
        code: 'display.missing',
        detail: 'A managed browser is drawn on a private X display, and this host is missing what serves it.',
        // The names, not the paths: which package to install is the actionable part.
        value: missing.join(', '),
        remediation: 'Install the Xvfb and x11vnc packages on this host, then restart the daemon.',
    };
}
/** The daemon's own WebSocket support. Without it the browser still runs and every tool still works, but
 *  nobody can watch or take over, because the framebuffer has no way to reach a page. */
function liveViewTransport(liveView) {
    if (!liveView)
        return null;
    const label = 'Live view transport';
    return liveView()
        ? { id: 'live-view', status: 'ready', label, code: 'liveview.ready', detail: 'This host carries plugin WebSocket routes.' }
        : {
            id: 'live-view',
            // A session is still fully usable by the agent; only watching and taking over are gone.
            status: 'warning',
            label,
            code: 'liveview.missing',
            detail: 'This host cannot carry a plugin WebSocket, so sessions run without a live view or user takeover.',
            remediation: 'Update Elowen to a release that offers plugin WebSocket routes.',
        };
}
function chatArtifacts(artifacts) {
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
export async function browserDependencyReport(input) {
    const checks = [
        chromeExecutable(input.config()),
        await chromeControl(input.processFactory),
        virtualDisplay(),
        await networkProxy(input.proxyFactory),
        profileStorage(input.storage),
        liveViewTransport(input.liveView),
        chatArtifacts(input.artifacts),
    ].filter((check) => check !== null);
    const status = checks.reduce((worst, check) => (RANK[check.status] > RANK[worst] ? check.status : worst), 'ready');
    return { status, ready: checks.filter((check) => check.status === 'ready').length, total: checks.length, checks };
}
/** The host's own readiness line, derived from the same report rather than probing a second time. */
export async function browserReadiness(input) {
    const report = await browserDependencyReport(input);
    const blocked = report.checks.find((check) => check.status === 'blocked');
    if (blocked)
        return { id: 'browser-runtime', label: 'Browser runtime', ok: false, detail: `${blocked.label}: ${blocked.detail}` };
    const warnings = report.checks.filter((check) => check.status === 'warning');
    const chrome = report.checks.find((check) => check.id === 'chrome');
    const notes = warnings.map((check) => ` ${check.label}: ${check.detail}`).join('');
    // This line is also served by the shared `/system/readiness` surface, which answers during setup: it
    // names the browser, never where it lives, and claims nothing about a sandbox it has not observed.
    return {
        id: 'browser-runtime',
        label: 'Browser runtime',
        ok: true,
        detail: `Browser: ${chrome?.value ?? 'unknown'}. Sandbox and CDP are verified by the first managed launch.${notes}`,
    };
}
