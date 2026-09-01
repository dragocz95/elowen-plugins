import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, listen, setDefaults, resetHandlers, close, use } from './ui/http';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { McpServersPage } from '../plugins/mcp/web-src/McpServersPage';
import manifest from '../plugins/mcp/elowen-plugin.json' with { type: 'json' };
import cs from '../plugins/mcp/i18n/cs.json' with { type: 'json' };
import { ToastProvider, createWrapper } from './ui/hostHooks';
import type { McpServer } from '../plugins/mcp/web-src/runtime';

ensurePluginUiRuntime();

const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;
const csStrings = (cs as { web: { strings: Record<string, string> } }).web.strings;

const server: McpServer = {
  name: 'github',
  scope: 'personal',
  transport: 'stdio',
  enabled: true,
  status: 'connected',
  toolCount: 0,
  tools: [],
  lastError: null,
  reconnecting: false,
  command: 'npx',
  args: ['-y', '@example/mcp'],
  env: {},
};

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([{ name: 'mcp', url: '/plugins/mcp/web/index.js', apiVersion: 11, nav: [], settings: [], strings }])),
);
beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); });
afterAll(() => close());

function mount() {
  const { wrapper: Wrapper } = createWrapper();
  render(<Wrapper><ToastProvider><McpServersPage /></ToastProvider></Wrapper>);
}

describe('MCP drawer status toggle', () => {
  it('keeps the toggle at the top, exposes localized state labels, and persists disabling', async () => {
    let saved: Record<string, unknown> | undefined;
    use(
      http.get('/api/plugins/mcp/api/servers', () => HttpResponse.json({ personal: [server], instance: [], canManageInstance: false })),
      http.patch('/api/plugins/mcp/api/servers/github', async ({ request }) => {
        saved = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ server: { ...server, enabled: false } });
      }),
    );
    mount();

    fireEvent.click(await screen.findByRole('button', { name: strings.openServer.replace('{name}', server.name) }));
    const drawer = within(await screen.findByRole('dialog', { name: server.name }));
    const toggle = drawer.getByRole('switch', { name: `${server.name}: ${strings.enabled}` });
    const nameInput = drawer.getByLabelText(strings.name);

    expect(toggle.compareDocumentPosition(nameInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle.parentElement).toHaveTextContent(strings.stateEnabled);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle.parentElement).toHaveTextContent(strings.stateDisabled);
    expect(toggle.parentElement).not.toHaveTextContent(strings.stateEnabled);

    fireEvent.click(drawer.getByRole('button', { name: strings.save }));
    await waitFor(() => expect(saved?.enabled).toBe(false));
  });

  it('keeps the Czech state copy as Zapnuto and Vypnuto', () => {
    expect(csStrings.stateEnabled).toBe('Zapnuto');
    expect(csStrings.stateDisabled).toBe('Vypnuto');
  });
});
