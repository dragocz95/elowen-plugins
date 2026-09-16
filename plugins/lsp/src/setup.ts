import type { PluginContext, SetupContext, SetupStepResult } from 'elowen/dist/plugins/api.js';
import { listServers } from './servers.js';

interface LspServerRow {
  command: string;
  label: string;
  installed: boolean;
  installable: boolean;
  installHint: string;
}

interface LspStatus {
  servers: LspServerRow[];
}

/** The setup contribution for the TypeScript server. The plugin owns the server catalog and all
 * server-specific wording; the host owns wizard ordering, markers and the prompt implementation. */
export function registerLspSetup(ctx: PluginContext): void {
  if (typeof ctx.registerSetupStep !== 'function') return;
  ctx.registerSetupStep({ id: 'lsp', run: runLspSetup });
}

async function runLspSetup(setup: SetupContext): Promise<SetupStepResult> {
  const spec = listServers().find((server) => server.language === 'typescript');
  if (!spec) {
    setup.log.warn('Skipping code intelligence — the TypeScript language server is not registered.');
    return { status: 'skipped', summary: 'not installed' };
  }

  setup.note('Elowen can type-check its own edits live through language servers (LSP). Optional.', 'Code intelligence');

  let response: { ok: boolean; status: number; data: LspStatus | null };
  try {
    response = await setup.request<LspStatus>('GET', '/brain/lsp');
  } catch {
    setup.log.warn('Skipping code intelligence — the daemon is not reachable.');
    return { status: 'skipped', summary: 'not installed' };
  }
  if (response.status === 503) {
    setup.log.warn('Skipping code intelligence — the LSP plugin is disabled on this daemon.');
    return { status: 'skipped', summary: 'not installed' };
  }
  if (!response.ok || !response.data) {
    setup.log.warn(`Skipping code intelligence — the daemon answered ${response.status}.`);
    return { status: 'skipped', summary: 'not installed' };
  }

  const row = response.data.servers.find((server) => server.command === spec.command);
  if (!row) {
    setup.log.warn('Skipping code intelligence — this daemon has no TypeScript language server registered.');
    return { status: 'skipped', summary: 'not installed' };
  }
  if (row.installed) {
    setup.log.success(`${row.command} is already installed.`);
    return { status: 'done', summary: `${row.command} installed` };
  }
  if (!row.installable) {
    setup.log.warn(`Elowen cannot install ${row.label} itself — ${row.installHint}.`);
    return { status: 'skipped', summary: 'not installed' };
  }

  const choice = await setup.select({
    message: `Install the ${row.label} language server?`,
    options: [
      { value: 'install', label: 'Install now', hint: row.installHint },
      { value: 'skip', label: 'Skip for now' },
      { value: 'back', label: 'Go back' },
    ],
  });
  if (typeof choice !== 'string') return { status: 'back' };
  if (choice === 'back') return { status: 'back' };
  if (choice === 'skip') return { status: 'skipped', summary: 'not installed' };

  const spinner = setup.spinner();
  spinner.start(`Installing ${row.command} (npm)…`);
  try {
    const installed = await setup.request<{ message?: string; error?: string }>('POST', '/brain/lsp/install', { command: row.command });
    if (installed.ok) {
      spinner.stop(`${row.command} installed.`);
      return { status: 'done', summary: `${row.command} installed` };
    }
    spinner.stop(`Install failed: ${installed.data?.error ?? `daemon answered ${installed.status}`}`, 'error');
    setup.log.warn(`You can install it later: ${row.installHint} (or from the /lsp modal).`);
    return { status: 'skipped', summary: 'not installed' };
  } catch {
    spinner.stop('Install failed: the daemon is not reachable.', 'error');
    setup.log.warn(`You can install it later: ${row.installHint} (or from the /lsp modal).`);
    return { status: 'skipped', summary: 'not installed' };
  }
}
