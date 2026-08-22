// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('whatsapp tool permissions', () => {
  // Nothing in this plugin gates itself on identity any more — the users modal decides who holds which
  // tool. A scoped, non-operator session therefore reaches proactive sending too; an admin takes it away
  // by unticking WhatsappSend for that account.
  it('lets a project-scoped session reach group tools and proactive sending alike', async () => {
    const { registerTools } = await import(join(repoRoot, 'plugins/whatsapp/lib/tools.mjs')) as {
      registerTools: (ctx: unknown, adapter: unknown) => void;
    };
    type Tool = { name: string; execute: (id: string, p: Record<string, unknown>) => Promise<{ content: { text: string }[] }> };
    const tools = new Map<string, Tool>();
    registerTools({
      registerTool: (tool: Tool) => tools.set(tool.name, tool),
      isAdminSession: () => false,
      currentIdentity: () => ({ owner: false }),
    }, {
      requireSock: () => ({ groupFetchAllParticipating: async () => ({}), sendMessage: async () => ({}) }),
    });
    const run = async (name: string, params: Record<string, unknown> = {}) => {
      const out = await tools.get(name)!.execute('call-1', params);
      return out.content.map((part) => part.text).join('\n');
    };

    expect(await run('WhatsappGroupList')).toBe('(no groups)');
    expect(await run('WhatsappSend', { to: '420777123456', text: 'hi' })).not.toContain('only available to the operator');
  });
});
