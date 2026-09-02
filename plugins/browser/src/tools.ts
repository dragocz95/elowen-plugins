import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { PluginContext } from 'elowen/plugin-api';
import { requireBrowserToolOwner } from './ownership.js';
import { SessionRegistry } from './session-registry.js';
import type { AccessibilitySnapshot } from './types.js';

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  details: {},
});

const snapshotPayload = (sessionId: string, snapshot: AccessibilitySnapshot) => ({
  sessionId,
  title: snapshot.title,
  url: snapshot.url,
  snapshot: snapshot.text,
});

const sessionIdSchema = Type.String({ description: 'Opaque browser session ID returned by BrowserOpen', minLength: 16, maxLength: 256 });

export function registerBrowserTools(ctx: PluginContext, registry: SessionRegistry): void {
  const own = () => requireBrowserToolOwner(ctx);
  const session = (sessionId: string) => {
    const owner = own();
    return { owner, session: registry.getOwned(sessionId, owner.userId) };
  };

  const tools = [
    defineTool({
      name: 'BrowserOpen',
      label: 'Open browser',
      description: 'Open a persistent private browser tab for the linked account. Browser profiles are per-account; shared rooms, unlinked senders and delegated child agents are refused.',
      parameters: Type.Object({ url: Type.Optional(Type.String({ description: 'Optional absolute public http(s) URL to open' })) }),
      execute: async (toolCallId: string, input: { url?: string }, signal?: AbortSignal) => {
        const owner = own();
        const browser = await registry.create({ ownerUserId: owner.userId, conversationId: owner.conversationId, toolCallId });
        try {
          const snapshot = input.url ? await browser.navigate(input.url, signal) : (await browser.snapshot(false, signal)).snapshot;
          return textResult(snapshotPayload(browser.id, snapshot));
        } catch (error) {
          await browser.close('open_failed');
          throw error;
        }
      },
    }),
    defineTool({
      name: 'BrowserSnapshot',
      label: 'Browser snapshot',
      description: 'Read a bounded accessibility snapshot of the current browser page. A model-visible screenshot is returned only when explicitly requested.',
      parameters: Type.Object({ sessionId: sessionIdSchema, screenshot: Type.Optional(Type.Boolean()) }),
      execute: async (_toolCallId: string, input: { sessionId: string; screenshot?: boolean }, signal?: AbortSignal) => {
        const current = session(input.sessionId);
        const captured = await current.session.snapshot(input.screenshot === true, signal);
        const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
          { type: 'text', text: JSON.stringify(snapshotPayload(current.session.id, captured.snapshot), null, 2) },
        ];
        if (captured.screenshot) content.push({ type: 'image', data: captured.screenshot, mimeType: 'image/jpeg' });
        return { content, details: {} };
      },
    }),
    defineTool({
      name: 'BrowserNavigate',
      label: 'Navigate browser',
      description: 'Navigate an owned browser session to an absolute http(s) URL allowed by the enforcing network policy, then return a fresh accessibility snapshot.',
      parameters: Type.Object({ sessionId: sessionIdSchema, url: Type.String() }),
      execute: async (_toolCallId: string, input: { sessionId: string; url: string }, signal?: AbortSignal) => {
        const current = session(input.sessionId);
        return textResult(snapshotPayload(current.session.id, await current.session.navigate(input.url, signal)));
      },
    }),
    defineTool({
      name: 'BrowserClick',
      label: 'Click browser element',
      description: 'Click an accessibility element by ref in an owned browser session. The element ref comes from the latest BrowserSnapshot or mutating browser result.',
      parameters: Type.Object({ sessionId: sessionIdSchema, ref: Type.String({ minLength: 2, maxLength: 32 }) }),
      execute: async (_toolCallId: string, input: { sessionId: string; ref: string }, signal?: AbortSignal) => {
        const current = session(input.sessionId);
        return textResult(snapshotPayload(current.session.id, await current.session.click(input.ref, signal)));
      },
    }),
    defineTool({
      name: 'BrowserFill',
      label: 'Fill browser field',
      description: 'Fill an accessibility text field in an owned browser session. Filled values are never copied into live action events.',
      parameters: Type.Object({ sessionId: sessionIdSchema, ref: Type.String(), value: Type.String({ maxLength: 20_000 }) }),
      execute: async (_toolCallId: string, input: { sessionId: string; ref: string; value: string }, signal?: AbortSignal) => {
        const current = session(input.sessionId);
        return textResult(snapshotPayload(current.session.id, await current.session.fill(input.ref, input.value, signal)));
      },
    }),
    defineTool({
      name: 'BrowserPressKey',
      label: 'Press browser key',
      description: 'Press a validated key with optional modifiers in an owned browser session.',
      parameters: Type.Object({
        sessionId: sessionIdSchema,
        key: Type.String({ maxLength: 32 }),
        modifiers: Type.Optional(Type.Array(Type.Union([Type.Literal('Alt'), Type.Literal('Control'), Type.Literal('Meta'), Type.Literal('Shift')]), { maxItems: 4 })),
      }),
      execute: async (_toolCallId: string, input: { sessionId: string; key: string; modifiers?: string[] }, signal?: AbortSignal) => {
        const current = session(input.sessionId);
        return textResult(snapshotPayload(current.session.id, await current.session.pressKey(input.key, input.modifiers, signal)));
      },
    }),
    defineTool({
      name: 'BrowserScroll',
      label: 'Scroll browser',
      description: 'Scroll the current page in an owned browser session and return a fresh accessibility snapshot.',
      parameters: Type.Object({ sessionId: sessionIdSchema, deltaX: Type.Optional(Type.Number()), deltaY: Type.Number() }),
      execute: async (_toolCallId: string, input: { sessionId: string; deltaX?: number; deltaY: number }, signal?: AbortSignal) => {
        const current = session(input.sessionId);
        return textResult(snapshotPayload(current.session.id, await current.session.scroll(input.deltaX ?? 0, input.deltaY, signal)));
      },
    }),
    defineTool({
      name: 'BrowserWaitFor',
      label: 'Wait for browser text',
      description: 'Wait until text appears in bounded accessibility snapshots of an owned browser session.',
      parameters: Type.Object({ sessionId: sessionIdSchema, text: Type.String({ maxLength: 500 }), timeoutMs: Type.Optional(Type.Number({ minimum: 100, maximum: 60_000 })) }),
      execute: async (_toolCallId: string, input: { sessionId: string; text: string; timeoutMs?: number }, signal?: AbortSignal) => {
        const current = session(input.sessionId);
        return textResult(snapshotPayload(current.session.id, await current.session.waitFor(input.text, input.timeoutMs ?? 10_000, signal)));
      },
    }),
    defineTool({
      name: 'BrowserTabs',
      label: 'Manage browser tabs',
      description: 'List, select or close tabs that belong to one owned browser session. It cannot inspect another account or another browser session.',
      parameters: Type.Object({
        sessionId: sessionIdSchema,
        action: Type.Union([Type.Literal('list'), Type.Literal('select'), Type.Literal('close')]),
        tabId: Type.Optional(Type.String({ maxLength: 256 })),
      }),
      execute: async (_toolCallId: string, input: { sessionId: string; action: 'list' | 'select' | 'close'; tabId?: string }, signal?: AbortSignal) => {
        const current = session(input.sessionId);
        if (input.action === 'list') return textResult({ sessionId: current.session.id, tabs: await current.session.agentTabs(signal) });
        if (!input.tabId) throw new Error('tabId is required for select and close actions.');
        const snapshot = input.action === 'select'
          ? await current.session.selectTab(input.tabId, signal)
          : await current.session.closeTab(input.tabId, signal);
        return textResult(snapshotPayload(current.session.id, snapshot));
      },
    }),
    defineTool({
      name: 'BrowserRequestTakeover',
      label: 'Request browser takeover',
      description: 'Pause agent input and give the linked user exclusive browser control. The tool waits for release, disconnect, timeout or abort, then returns a fresh accessibility snapshot.',
      parameters: Type.Object({ sessionId: sessionIdSchema }),
      execute: async (_toolCallId: string, input: { sessionId: string }, signal?: AbortSignal) => {
        const current = session(input.sessionId);
        return textResult(snapshotPayload(current.session.id, await current.session.requestTakeoverForAgent(signal)));
      },
    }),
    defineTool({
      name: 'BrowserClose',
      label: 'Close browser session',
      description: 'Close an owned browser tab session, its streams and control lease. The persistent per-account browser profile remains on disk.',
      parameters: Type.Object({ sessionId: sessionIdSchema }),
      execute: async (_toolCallId: string, input: { sessionId: string }) => {
        const current = session(input.sessionId);
        await current.session.close('agent_closed');
        return textResult({ sessionId: input.sessionId, closed: true });
      },
    }),
  ];
  for (const tool of tools) ctx.registerTool(tool);
}
