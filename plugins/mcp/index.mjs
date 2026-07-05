// MCP bridge: connect configured external MCP (Model Context Protocol) servers over stdio and expose their
// tools to the brain as `mcp__<server>__<tool>`. register() is async (the loader awaits it), so the MCP
// handshake + tools/list runs at load time; a lifecycle-only platform adapter's disconnect() closes every
// client on reload/disable, so the child MCP processes never leak.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

// Generous: a first-ever `npx <pkg>` cold-starts by downloading the package, which can take well over
// 20s; once cached, connects are quick. Better to wait than to spuriously drop a valid server.
const CONNECT_TIMEOUT_MS = 60_000;
const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });

/** Race a promise against a timeout so one hung MCP server can't wedge the whole plugin load. */
function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout: ${what}`)), ms); });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), timeout]);
}

/** MCP callTool result → PI tool result: join text parts, summarize non-text content, prefix errors. */
function mapResult(res) {
  const parts = (res?.content ?? []).map((c) => {
    if (c?.type === 'text') return c.text ?? '';
    if (c?.type === 'image') return `[image ${c.mimeType ?? ''}]`;
    if (c?.type === 'audio') return `[audio ${c.mimeType ?? ''}]`;
    if (c?.type === 'resource') return `[resource ${c.resource?.uri ?? ''}]`;
    return `[${c?.type ?? 'unknown'}]`;
  });
  const text = parts.join('\n').trim() || '(no output)';
  return ok(res?.isError ? `Error: ${text}` : text);
}

export async function register(ctx) {
  const servers = Array.isArray(ctx.config?.servers) ? ctx.config.servers : [];
  const clients = []; // live clients, closed by the lifecycle adapter's disconnect()

  for (const s of servers) {
    if (!s || s.enabled === false || !s.name || !s.command) continue;
    let transport;
    let client;
    try {
      transport = new StdioClientTransport({
        command: s.command,
        args: Array.isArray(s.args) ? s.args : [],
        // getDefaultEnvironment() carries a safe PATH/HOME so `npx`-launched servers resolve; server env overrides.
        env: { ...getDefaultEnvironment(), ...(s.env && typeof s.env === 'object' ? s.env : {}) },
        stderr: 'ignore',
      });
      client = new Client({ name: 'orca-mcp-bridge', version: '0.1.0' }, { capabilities: {} });
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `connect ${s.name}`);
      const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `listTools ${s.name}`);
      const tools = listed?.tools ?? [];
      clients.push(client);
      for (const t of tools) {
        ctx.registerTool(defineTool({
          name: `mcp__${s.name}__${t.name}`,
          label: t.title || t.name,
          description: t.description || `MCP tool "${t.name}" from server "${s.name}".`,
          // MCP inputSchema is plain JSON Schema; pi-ai's validation layer coerces raw JSON schema
          // (utils/validation.js: !hasTypeBoxMetadata && isJsonSchemaObject), so no typebox wrap is needed.
          parameters: (t.inputSchema && typeof t.inputSchema === 'object') ? t.inputSchema : { type: 'object', properties: {} },
          execute: async (_id, args) => {
            try {
              const res = await client.callTool({ name: t.name, arguments: args ?? {} });
              return mapResult(res);
            } catch (e) {
              return ok(`Error calling ${t.name}: ${e instanceof Error ? e.message : String(e)}`);
            }
          },
        }));
      }
      ctx.logger.info(`mcp: connected ${s.name} (${tools.length} tool${tools.length === 1 ? '' : 's'})`);
    } catch (e) {
      // Fail-open: one bad server must not throw out of register() (the loader would drop the whole plugin).
      // Close the transport so a timed-out/failed connect doesn't leak its child process.
      try { await (client?.close?.() ?? transport?.close?.()); } catch { /* ignore */ }
      ctx.logger.warn(`mcp: failed to connect ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Lifecycle-only adapter: the sole reload-safe teardown hook (platforms.stopAll → disconnect). Closing a
  // client kills its child MCP process, so a reload/disable never leaks the stdio subprocesses. It carries
  // no channel — listen/send are inert.
  ctx.registerPlatform({
    name: 'mcp-lifecycle',
    async connect() { /* connections are established in register(); nothing to do here */ },
    disconnect() { for (const c of clients) { Promise.resolve(c.close()).catch(() => {}); } },
    listen() { /* no inbound messages */ },
    async send() { /* no outbound messages */ },
  });
}
