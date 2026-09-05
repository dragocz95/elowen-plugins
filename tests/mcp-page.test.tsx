import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, listen, resetHandlers, close, use, setDefaults } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import {
  allServers, canReconnect, filterServers, parseEnvironment, reconnectTargets, serverDraft, serverKey, serverPayload, McpServersPage,
} from '../plugins/mcp/web-src/McpServersPage';
import type { McpServer } from '../plugins/mcp/web-src/runtime';
import manifest from '../plugins/mcp/elowen-plugin.json' with { type: 'json' };
import { createWrapper } from './ui/hostHooks';

// The page resolves everything through window.ElowenUiRuntime — install the REAL runtime, so this
// exercises the production contract the bundle runs against.
ensurePluginUiRuntime();

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;

const server: McpServer = {
  name: 'github',
  scope: 'personal',
  transport: 'stdio',
  enabled: true,
  status: 'connected',
  toolCount: 1,
  tools: [{ name: 'search', title: 'Search' }],
  lastError: null,
  reconnecting: false,
  command: 'npx',
  args: ['-y', '@example/mcp'],
  env: { TOKEN: 'secret', REGION: 'eu' },
};

const remote: McpServer = {
  name: 'docs',
  scope: 'instance',
  transport: 'http',
  enabled: true,
  status: 'error',
  toolCount: 0,
  tools: [],
  lastError: 'connect ECONNREFUSED',
  reconnecting: false,
  url: 'https://mcp.example.test/',
};

describe('MCP bundle contract', () => {
  it('gates the manifest and built registration on plugin UI API 11', () => {
    const bundle = readFileSync(join(process.cwd(), 'plugins', 'mcp', 'web', 'index.js'), 'utf8');
    expect((manifest as { web: { requiresApiVersion: number } }).web.requiresApiVersion).toBe(11);
    expect(window.ElowenUiRuntime?.apiVersion).toBe(16);
    expect(bundle).toMatch(/requiresApiVersion:\s*11/);
  });
});

describe('MCP settings form mapping', () => {
  it('does not round-trip write-only environment values from an existing server', () => {
    expect(serverPayload(serverDraft(server))).toEqual({
      scope: 'personal',
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@example/mcp'],
      enabled: true,
    });
  });

  it('still accepts explicitly replaced environment values', () => {
    expect(serverPayload({ ...serverDraft(server), env: 'TOKEN=replaced\nREGION=eu' })).toMatchObject({
      env: { TOKEN: 'replaced', REGION: 'eu' },
    });
  });

  it('keeps everything after the first equals sign in an environment value', () => {
    expect(parseEnvironment('TOKEN=a=b=c\nEMPTY=\nFLAG')).toEqual({ TOKEN: 'a=b=c', EMPTY: '', FLAG: '' });
  });

  it('does not emit an empty environment object that would clear stored secrets', () => {
    expect(serverPayload(serverDraft(server))).not.toHaveProperty('env');
  });

  it('does not send stale stdio credentials after switching to HTTP', () => {
    const draft = { ...serverDraft(server), transport: 'http' as const, url: 'https://mcp.example.test/' };
    expect(serverPayload(draft)).toEqual({
      scope: 'personal', name: 'github', transport: 'http', url: 'https://mcp.example.test/', enabled: true,
    });
  });
});

describe('MCP register rows', () => {
  it('lists both ownership scopes as one register, personal first', () => {
    expect(allServers({ personal: [server], instance: [remote], canManageInstance: true }).map((row) => row.name))
      .toEqual(['github', 'docs']);
  });

  it('keys a row by scope and name, so the same name in both scopes stays two rows', () => {
    expect(serverKey(server)).not.toBe(serverKey({ ...server, scope: 'instance' }));
  });

  it('narrows by ownership scope and by a needle over name, transport, url and command', () => {
    const rows = [server, remote];
    expect(filterServers(rows, '', 'instance').map((row) => row.name)).toEqual(['docs']);
    expect(filterServers(rows, 'npx', 'all').map((row) => row.name)).toEqual(['github']);
    expect(filterServers(rows, 'example.test', 'all').map((row) => row.name)).toEqual(['docs']);
    expect(filterServers(rows, 'HTTP', 'all').map((row) => row.name)).toEqual(['docs']);
    expect(filterServers(rows, 'nothing', 'all')).toEqual([]);
  });

  it('offers reconnect only when the current account can execute it', () => {
    expect(canReconnect({ ...remote, enabled: true }, true)).toBe(true);
    expect(canReconnect({ ...remote, enabled: false }, true)).toBe(false);
    expect(canReconnect(server, false)).toBe(false);
    expect(canReconnect(server, true)).toBe(true);
  });

  it('targets only manageable disconnected or failed servers for reconnect-all', () => {
    const disconnected = { ...remote, name: 'remote-disconnected', status: 'disconnected' };
    const disabled = { ...remote, name: 'disabled', enabled: false };
    expect(reconnectTargets([remote, disconnected, server, disabled], false).map((entry) => entry.name))
      .toEqual(['docs', 'remote-disconnected']);
  });
});

setDefaults(
  http.get('*/api/plugins/ui', () => HttpResponse.json([{ name: 'mcp', url: '/plugins/mcp/web/index.js', apiVersion: 2, nav: [], settings: [], strings }])),
);
beforeAll(() => listen()); afterEach(() => { cleanup(); resetHandlers(); }); afterAll(() => close());

const mount = () => {
  const { wrapper: Wrapper } = createWrapper();
  render(<Wrapper><McpServersPage /></Wrapper>);
};

describe('MCP page load states', () => {
  // A failed load leaves the server list undefined, so a loading branch tested BEFORE the error branch
  // swallows the failure: the page would sit on the skeleton forever and never offer Retry.
  it('shows the error state with Retry when the server list fails to load', async () => {
    use(http.get('*/api/plugins/mcp/api/servers', () => HttpResponse.json({ error: 'nope' }, { status: 500 })));
    mount();
    expect(await screen.findByText(strings.loadError!)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders the register once the servers arrive', async () => {
    use(http.get('*/api/plugins/mcp/api/servers', () => HttpResponse.json({ personal: [server], instance: [remote], canManageInstance: true })));
    mount();
    expect(await screen.findByText('github')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();
    // The failure lands in the status cell as ONE line, not as a wrapped paragraph in a card.
    expect(screen.getByText('connect ECONNREFUSED')).toBeInTheDocument();
    expect(screen.queryByText(strings.loadError!)).not.toBeInTheDocument();
  });

  it('puts the search in the canonical page toolbar and the ownership scope behind its filter control', async () => {
    use(http.get('*/api/plugins/mcp/api/servers', () => HttpResponse.json({ personal: [server], instance: [remote], canManageInstance: true })));
    mount();
    const search = await screen.findByRole('searchbox', { name: strings.searchPlaceholder });
    // The row the shell draws under the hero, not a band this bundle lays out inside its own content:
    // a plugin register's controls have to sit where every built-in register's do.
    expect(search.closest('.page-toolbar__search')).not.toBeNull();
    expect(search.closest('.control-surface-toolbar')).toBeNull();

    // The search is permanent and the scope is a filter, so only one of them is on the row itself.
    expect(screen.queryByRole('radiogroup', { name: strings.scope })).toBeNull();
    fireEvent.click(screen.getByTestId('page-filters-trigger'));
    const panel = within(await screen.findByRole('dialog', { name: 'Filters' }));
    expect(panel.getByRole('radiogroup', { name: strings.scope })).toBeInTheDocument();
  });

  it('names the ownership filter in a chip that clears it', async () => {
    use(http.get('*/api/plugins/mcp/api/servers', () => HttpResponse.json({ personal: [server], instance: [remote], canManageInstance: true })));
    mount();
    await screen.findByText('github');
    fireEvent.click(screen.getByTestId('page-filters-trigger'));
    fireEvent.click(await screen.findByRole('radio', { name: strings.scopeInstance }));

    // "Instance" alone would not say WHAT it narrows, so the chip carries the field's own label too.
    expect(screen.getByTestId('page-filter-chips')).toHaveTextContent(`${strings.scope}: ${strings.scopeInstance}`);
    expect(screen.queryByText('github')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Remove filter ${strings.scope}: ${strings.scopeInstance}` }));
    expect(await screen.findByText('github')).toBeInTheDocument();
  });

  it('offers a non-owner no filter control at all, and keeps the search', async () => {
    // One ownership scope means nothing to narrow, so the toolbar is handed an EMPTY field set — which
    // draws no trigger rather than one that opens an empty panel.
    use(http.get('*/api/plugins/mcp/api/servers', () => HttpResponse.json({ personal: [server], instance: [], canManageInstance: false })));
    mount();
    await screen.findByText('github');
    expect(screen.queryByTestId('page-filters-trigger')).toBeNull();
    expect(screen.getByRole('searchbox', { name: strings.searchPlaceholder })).toBeInTheDocument();
  });

  it('clears a populated register search through the shared search control', async () => {
    use(http.get('*/api/plugins/mcp/api/servers', () => HttpResponse.json({ personal: [server], instance: [remote], canManageInstance: true })));
    mount();
    const search = await screen.findByRole('searchbox', { name: strings.searchPlaceholder });
    fireEvent.change(search, { target: { value: 'github' } });
    expect(screen.queryByText('docs')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: strings.searchClear }));
    expect(search).toHaveValue('');
    expect(screen.getByText('docs')).toBeInTheDocument();
  });

  it('keeps the moved row identity after a later edit failure, so Retry PATCHes instead of POSTing a duplicate', async () => {
    let moved = false;
    let transfers = 0;
    let patches = 0;
    let creates = 0;
    const personalRemote = { ...remote, scope: 'personal' as const, status: 'connected' as const };
    const instanceRemote = { ...personalRemote, scope: 'instance' as const };
    use(
      http.get('*/api/plugins/mcp/api/servers', () => HttpResponse.json({
        personal: moved ? [] : [personalRemote],
        instance: moved ? [instanceRemote] : [],
        canManageInstance: true,
      })),
      http.post('*/api/plugins/mcp/api/transfer', () => { transfers += 1; moved = true; return HttpResponse.json({ ok: true }); }),
      http.patch('*/api/plugins/mcp/api/servers/:name', () => {
        patches += 1;
        return patches === 1 ? HttpResponse.json({ error: 'edit failed' }, { status: 500 }) : HttpResponse.json({ ok: true });
      }),
      http.post('*/api/plugins/mcp/api/servers', () => { creates += 1; return HttpResponse.json({ ok: true }); }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: strings.openServer.replace('{name}', 'docs') }));
    fireEvent.change(await screen.findByRole('combobox', { name: strings.scope }), { target: { value: 'instance' } });
    fireEvent.click(screen.getByRole('button', { name: strings.save }));
    await screen.findByText('edit failed');

    fireEvent.click(screen.getByRole('button', { name: strings.save }));
    await waitFor(() => expect(patches).toBe(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(transfers).toBe(1);
    expect(creates).toBe(0);
  });
});

// Changing the scope is a MOVE on the daemon, not a field on the PATCH: PATCH resolves the server in the
// scope it is asked for, so sending the new one reads to it as a server that does not exist.
