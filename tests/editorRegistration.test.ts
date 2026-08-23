// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openPluginTablesDb } from './helpers/pluginTablesDb.js';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { PluginRegistryProvider } from 'elowen/dist/plugins/pluginsProvider.js';
import { createServer } from 'elowen/dist/api/server.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { TaskStore } from '../plugins/work/dist/store/taskStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { UserProjectStore } from 'elowen/dist/store/userProjectStore.js';
import { MissionStore } from '../plugins/agents/dist/store/missionStore.js';
import { Readiness } from '../plugins/work/dist/store/readiness.js';
import { EventBus } from 'elowen/dist/api/sse.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { safeProjectPath } from 'elowen/dist/integrations/projectFiles.js';
import type { PluginHostWiring } from 'elowen/dist/plugins/registry.js';

const pluginsDir = join(fileURLToPath(new URL('..', import.meta.url)), 'plugins');
const logger = { info() {}, warn() {}, error() {} };

function loadWith(enabled: string[], host?: PluginHostWiring) {
  return loadPlugins({ dirs: [pluginsDir], enabled, logger, host });
}

function serverWith(enabled: string[], projectPath = '/tmp') {
  const db = openPluginTablesDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen',?)").run(projectPath);
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw');
  const member = users.create('member', 'pw');
  const projects = new ProjectStore(db);
  const host: PluginHostWiring = { stores: { projects } as never, projectFiles: { safe: safeProjectPath } };
  const app = createServer({
    tasks: new TaskStore(db), readiness: new Readiness(db), missions: new MissionStore(db), bus: new EventBus(),
    tmux: null as never, project: { id: 1, path: '/tmp' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db), users, projects, userProjects: new UserProjectStore(db),
    plugins: new PluginRegistryProvider(() => loadWith(enabled, host)), pluginDirs: [pluginsDir],
  });
  return { app, token: users.issueToken(admin.id), memberToken: users.issueToken(member.id) };
}

describe('editor plugin', () => {
  it('owns every grandfathered project-file root route and browser bundle when enabled', async () => {
    const host: PluginHostWiring = { stores: { projects: { get: () => null } } as never, projectFiles: { safe: safeProjectPath } };
    const registry = await loadWith(['editor'], host);
    expect([...registry.rootApiRoutes.keys()]).toEqual(expect.arrayContaining([
      '/projects/:id/files', '/projects/:id/file', '/projects/:id/raw', '/projects/:id/office-preview', '/projects/:id/new-file', '/projects/:id/dir',
      '/projects/:id/rename', '/projects/:id/copy', '/projects/:id/entry', '/projects/:id/diff', '/projects/:id/head',
      '/projects/:id/commit/:hash', '/projects/:id/commit/:hash/diff', '/projects/:id/commits', '/projects/:id/changed', '/projects/:id/changes',
    ]));
    expect(registry.webUi.get('editor')?.nav).toEqual([{ label: 'Editor', icon: 'Code2', route: '' }]);
  });

  it('serves raw files with extension MIME, byte ranges and project authorization', async () => {
    const root = mkdtempSync(join(tmpdir(), 'elowen-editor-api-'));
    try {
      writeFileSync(join(root, 'sample.pdf'), Buffer.from('%PDF-1.7\n0123456789'));
      const { app, token, memberToken } = serverWith(['editor'], root);
      const response = await app.request('/projects/1/raw?path=sample.pdf', {
        headers: { authorization: `Bearer ${token}`, range: 'bytes=5-9' },
      });
      expect(response.status).toBe(206);
      expect(response.headers.get('content-type')).toBe('application/pdf');
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(response.headers.get('content-range')).toBe('bytes 5-9/19');
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('1.7\n0');

      const forbidden = await app.request('/projects/1/raw?path=sample.pdf', { headers: { authorization: `Bearer ${memberToken}` } });
      expect(forbidden.status).toBe(403);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('answers 503 rather than falling through when the editor is disabled', async () => {
    const { app, token } = serverWith([]);
    const response = await app.request('/projects/1/files', { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'editor plugin is disabled' });
  });
});
