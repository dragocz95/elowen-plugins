import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PairingSettings } from '../plugins/whatsapp/web-src/PairingSettings';
import manifest from '../plugins/whatsapp/elowen-plugin.json' with { type: 'json' };
import { createWrapper } from './ui/hostHooks';
import { ensurePluginUiRuntime } from './ui/hostRuntime';
import { close, http, HttpResponse, listen, resetHandlers, setDefaults, use } from './ui/http';

ensurePluginUiRuntime();
const strings = (manifest as { web: { strings: Record<string, string> } }).web.strings;

setDefaults(
  http.get('/api/plugins/ui', () => HttpResponse.json([
    { name: 'whatsapp', url: '/plugins/whatsapp/web/index.js', apiVersion: 1, nav: [], settings: [], strings },
  ])),
);
beforeAll(() => listen());
afterEach(() => { cleanup(); resetHandlers(); });
afterAll(() => close());

const mount = () => {
  const { wrapper: Wrapper } = createWrapper();
  render(<Wrapper><PairingSettings surface="deck" /></Wrapper>);
};

describe('WhatsApp pairing settings', () => {
  it('keeps an unpair failure visible after the status refresh and rejects a duplicate confirmation', async () => {
    let unpairs = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    use(
      http.get('/api/plugins/whatsapp/pairing', () => HttpResponse.json({ qrImage: null, code: null, connected: true })),
      http.post('/api/plugins/whatsapp/unpair', async () => {
        unpairs += 1;
        await pending;
        return HttpResponse.json({ error: 'unpair failed' }, { status: 500 });
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: strings.unpairButton }));
    const dialog = await screen.findByRole('dialog', { name: strings.unpairButton });
    const confirm = within(dialog).getByRole('button', { name: strings.unpairButton });
    act(() => { confirm.click(); confirm.click(); });

    await waitFor(() => expect(unpairs).toBe(1));
    release();
    expect(await screen.findByText(strings.unpairError)).toHaveRole('alert');
    expect(screen.getByRole('button', { name: strings.unpairButton })).toBeEnabled();
  });
});
