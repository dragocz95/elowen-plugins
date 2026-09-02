import { detectChrome } from './browser-launcher.js';
export async function browserReadiness(input) {
    const executable = detectChrome(input.config().chromeExecutable);
    if (!executable)
        return { id: 'browser-runtime', label: 'Browser runtime', ok: false, detail: 'Chrome or Chromium was not found.' };
    if (!await input.processFactory.dependencyAvailable()) {
        return { id: 'browser-runtime', label: 'Browser runtime', ok: false, detail: 'puppeteer-core is not installed in the daemon runtime.' };
    }
    if (!input.proxyFactory.safePinningAvailable || (input.proxyFactory.dependencyAvailable && !await input.proxyFactory.dependencyAvailable())) {
        return {
            id: 'browser-runtime',
            label: 'Browser runtime',
            ok: false,
            detail: 'proxy-chain 3.0 with per-request pinned DNS lookup support is not installed; browser launch is refused.',
        };
    }
    const artifactNote = input.artifacts.available ? '' : ' Inline chat artifacts are waiting for the core artifact bridge.';
    return {
        id: 'browser-runtime',
        label: 'Browser runtime',
        ok: true,
        detail: `Chrome executable: ${executable}. Chrome is launched without sandbox-disabling flags; the first managed launch remains the sandbox smoke check.${artifactNote}`,
    };
}
