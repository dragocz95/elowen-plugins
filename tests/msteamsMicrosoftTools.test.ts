// @vitest-environment node
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMicrosoftTools } from '../plugins/msteams/lib/microsoftTools.mjs';

const originalFetch = globalThis.fetch;
const tempRoot = '/tmp/msteams-m365-tools-test';
afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  await rm(tempRoot, { recursive: true, force: true });
});

type Tool = { description: string; execute(id: string, params: Record<string, unknown>): Promise<{ content: { text: string }[] }> };

function harness(config: Record<string, unknown> = { m365AccessMode: 'read_write' }, subjectId = 'aad-1') {
  const tools = new Map<string, Tool>();
  const linking = {
    delegatedSession: vi.fn(async () => ({
      token: 'delegated-secret-token',
      subjectId,
      tenantId: 'tenant-1',
      profile: { id: subjectId, displayName: 'Alex' },
    })),
  };
  const ctx = {
    currentIdentity: () => ({ platform: 'msteams', userId: subjectId, elowenUserId: 7 }),
    currentWorkDir: () => tempRoot,
    host: { projectFiles: () => ({ safe: (_root: string, path: string) => `${tempRoot}/${path}` }) },
    registerTool: (tool: Tool & { name: string }) => tools.set(tool.name, tool),
  };
  registerMicrosoftTools(ctx, linking, config);
  const run = async (name: string, params: Record<string, unknown>) => {
    const result = await tools.get(name)!.execute('call-1', params);
    return result.content.map((item) => item.text).join('\n');
  };
  return { tools, linking, run };
}

describe('delegated Microsoft 365 tools', () => {
  it('registers eight understandable domain tools', () => {
    const { tools } = harness();
    expect([...tools.keys()]).toEqual([
      'MicrosoftDirectory', 'MicrosoftSharePoint', 'MicrosoftFiles', 'MicrosoftOutlook',
      'MicrosoftTasks', 'MicrosoftOneNote', 'MicrosoftExcel', 'MicrosoftTeams',
    ]);
  });

  it('uses the turn-bound delegated session and never returns its token', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'aad-1', displayName: 'Alex' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const { linking, run } = harness();
    const text = await run('MicrosoftDirectory', { action: 'me' });
    expect(linking.delegatedSession).toHaveBeenCalledWith(expect.objectContaining({ platform: 'msteams', userId: 'aad-1' }));
    expect(text).toContain('Alex');
    expect(text).not.toContain('delegated-secret-token');
  });

  it('shows permission context only for classified authorization failures', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'itemNotFound', message: 'Item not found' } }), {
        status: 404, headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'Authorization_RequestDenied', message: 'Access denied' } }), {
        status: 403, headers: { 'content-type': 'application/json' },
      }));
    const { run } = harness();

    const missing = await run('MicrosoftFiles', { action: 'search', query: 'missing' });
    expect(missing).toContain('Item not found');
    expect(missing).not.toContain('delegated permission');

    const denied = await run('MicrosoftSharePoint', { action: 'search_sites', query: 'chetty' });
    expect(denied).toContain('Delegated permission for this operation: Sites.ReadWrite.All');
  });

  it('escapes apostrophes inside Graph OData string literals', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ value: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { run } = harness();
    await run('MicrosoftFiles', { action: 'search', query: "O'Brien" });
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toContain("search(q='O''Brien')");

    await run('MicrosoftExcel', { action: 'read_range', itemId: 'book-1', worksheet: 'Sheet1', range: "A'1" });
    expect(String(vi.mocked(globalThis.fetch).mock.calls[1]?.[0])).toContain("range(address='A''1')");
  });

  it('blocks writes globally in read-only mode before Graph is called', async () => {
    globalThis.fetch = vi.fn();
    const { run } = harness({ m365AccessMode: 'read_only' });
    const text = await run('MicrosoftOutlook', {
      resource: 'mail', action: 'send', to: ['person@example.com'], subject: 'Hello', body: 'World', commit: true,
    });
    expect(text).toContain('writes are disabled');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('previews an authorized mutation without calling Graph', async () => {
    globalThis.fetch = vi.fn();
    const { run } = harness();
    const text = await run('MicrosoftOutlook', {
      resource: 'mail', action: 'send', to: ['person@example.com'], subject: 'Hello', body: 'World',
    });
    expect(text).toContain('"committed": false');
    expect(text).toContain('person@example.com');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('commits the exact mail send once and does not echo the bearer', async () => {
    globalThis.fetch = vi.fn(async (_input, init) => {
      expect(init?.method).toBe('POST');
      expect(String(init?.body)).toContain('person@example.com');
      return new Response(null, { status: 202 });
    });
    const { run } = harness();
    const text = await run('MicrosoftOutlook', {
      resource: 'mail', action: 'send', to: ['person@example.com'], subject: 'Hello', body: 'World', commit: true,
    });
    expect(text).toContain('"sent": true');
    expect(text).not.toContain('delegated-secret-token');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not blindly retry a failed resumable upload chunk', async () => {
    await mkdir(tempRoot, { recursive: true });
    await writeFile(`${tempRoot}/large.bin`, new Uint8Array(4 * 1024 * 1024 + 1));
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ uploadUrl: 'https://chunk.up.1drv.com/upload/session' }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('failed', { status: 500 }));
    const { run } = harness();
    const result = await run('MicrosoftFiles', { action: 'upload', path: 'large.bin', name: 'large.bin', commit: true });
    expect(result).toContain('refused bytes');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('binds opaque Excel sessions to one Microsoft subject and workbook', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'raw-session-secret' }), { status: 201, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ address: 'Sheet1!A1', values: [['ok']] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const first = harness();
    const created = JSON.parse(await first.run('MicrosoftExcel', { action: 'create_session', itemId: 'book-1', commit: true }));
    expect(created.session).toBeTypeOf('string');
    expect(created.session).not.toContain('raw-session-secret');
    const read = await first.run('MicrosoftExcel', { action: 'read_range', itemId: 'book-1', worksheet: 'Sheet1', range: 'A1', session: created.session });
    expect(read).toContain('ok');
    expect(vi.mocked(globalThis.fetch).mock.calls[1]?.[1]?.headers).toMatchObject({ 'workbook-session-id': 'raw-session-secret' });

    globalThis.fetch = vi.fn();
    const other = harness({ m365AccessMode: 'read_write' }, 'aad-2');
    const denied = await other.run('MicrosoftExcel', { action: 'read_range', itemId: 'book-1', worksheet: 'Sheet1', range: 'A1', session: created.session });
    expect(denied).toContain('another Microsoft identity');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('hard-disables SharePoint item and drive-item deletion before Graph is called', async () => {
    globalThis.fetch = vi.fn();
    const { tools, run } = harness();
    expect(tools.get('MicrosoftSharePoint')?.description).not.toContain('delete_item');
    expect(tools.get('MicrosoftFiles')?.description).not.toMatch(/Actions:.*\bdelete\b/);

    const item = await run('MicrosoftSharePoint', {
      action: 'delete_item', siteId: 'site-1', listId: 'list-1', itemId: 'item-1', commit: true,
    });
    const file = await run('MicrosoftFiles', { action: 'delete', itemId: 'file-1', commit: true });

    expect(item).toContain('deletion is disabled by policy');
    expect(file).toContain('deletion is disabled by policy');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps SharePoint updates and drive-item renames available', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ Title: 'Updated' }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'file-1', name: 'renamed.txt' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { run } = harness();

    expect(await run('MicrosoftSharePoint', {
      action: 'update_item', siteId: 'site-1', listId: 'list-1', itemId: 'item-1', fields: { Title: 'Updated' }, commit: true,
    })).toContain('Updated');
    expect(await run('MicrosoftFiles', { action: 'rename', itemId: 'file-1', name: 'renamed.txt', commit: true })).toContain('renamed.txt');

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(String(calls[0]?.[0])).toContain('/sites/site-1/lists/list-1/items/item-1/fields');
    expect(calls[0]?.[1]?.method).toBe('PATCH');
    expect(String(calls[1]?.[0])).toContain('/me/drive/items/file-1');
    expect(calls[1]?.[1]?.method).toBe('PATCH');
  });

  it('requires Planner etags for destructive writes', async () => {
    globalThis.fetch = vi.fn();
    const { run } = harness();
    const text = await run('MicrosoftTasks', { service: 'planner', action: 'delete_task', id: 'task-1', commit: true });
    expect(text).toContain('etag is required');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
