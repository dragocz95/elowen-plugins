// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from 'elowen/dist/api/sse.js';
import { createServer } from 'elowen/dist/api/server.js';
import { FakeClock } from 'elowen/dist/shared/clock.js';
import { ConfigStore } from 'elowen/dist/store/configStore.js';
import { UserStore } from 'elowen/dist/store/userStore.js';
import { ProjectStore } from 'elowen/dist/store/projectStore.js';
import { UserProjectStore } from 'elowen/dist/store/userProjectStore.js';
import { openDb } from 'elowen/dist/store/db.js';
import { loadPlugins } from 'elowen/dist/plugins/loader.js';
import { PluginRegistryProvider } from 'elowen/dist/plugins/pluginsProvider.js';

let dirs: string[] = [];
const tmpDir = (tag: string): string => { const p = mkdtempSync(join(tmpdir(), `elowen-${tag}-`)); dirs.push(p); return p; };
afterEach(() => { for (const p of dirs) rmSync(p, { recursive: true, force: true }); dirs = []; });

const pluginsDir = join(process.cwd(), 'plugins');

/** Both routes below are admin-only root mounts served by the REAL plugin, exactly as the pairing routes
 *  are. These contracts were asserted in the Elowen package before the plugins moved here; they came with
 *  neither plugin, so the same server is stood up here to keep them. */
function setup(enabled: string[]) {
  const dataRoot = tmpDir('adminroutes');
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw');
  const amy = users.create('amy', 'pw');
  const provider = new PluginRegistryProvider(() => loadPlugins({
    dirs: [pluginsDir], enabled, dataRoot,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }));
  const app = createServer({
    bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db), users, projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
    pluginDataRoot: dataRoot, pluginDirs: [pluginsDir],
    plugins: provider,
  });
  return { app, adminTok: users.issueToken(admin.id), amyTok: users.issueToken(amy.id) };
}
const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

describe('msteams app-package route', () => {
  // Enabled but unconfigured: register() bails before building an adapter, so the package cannot be
  // built — and the route still answers 503, because it is registered AHEAD of the credential check.
  // A 404 here is the regression this pins: it would mean the registration slid below that bail-out.
  it('answers 503 (not 404) while the plugin has no adapter', async () => {
    const { app, adminTok } = setup(['msteams']);
    const res = await app.request('/plugins/msteams/app-package', auth(adminTok));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'msteams plugin not enabled' });
  });

  // The route serves an org's bot credentials packaged for sideloading, so `access: 'admin'` is the
  // whole access control on it — dropping it hands the package to any signed-in user.
  it('rejects a non-admin (403)', async () => {
    const { app, amyTok } = setup(['msteams']);
    expect((await app.request('/plugins/msteams/app-package', auth(amyTok))).status).toBe(403);
  });

  it('answers the platform 503 when the plugin is off', async () => {
    const { app, adminTok } = setup([]);
    const res = await app.request('/plugins/msteams/app-package', auth(adminTok));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'msteams plugin is disabled' });
  });
});

describe('discord channels route', () => {
  // Unconfigured (no botToken/guildId) the picker must still answer, with an empty destination list.
  // Same ordering invariant as above: the route is registered before the token bail-out precisely so an
  // enabled-but-unconfigured instance shows an EMPTY picker rather than a broken (404) one.
  it('returns 200 [] when the plugin has no token/guild configured', async () => {
    const { app, adminTok } = setup(['discord']);
    const res = await app.request('/plugins/discord/channels', auth(adminTok));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  // Guild channel and thread names are not public; `access: 'admin'` is what keeps them off a
  // non-admin's screen.
  it('rejects a non-admin (403)', async () => {
    const { app, amyTok } = setup(['discord']);
    expect((await app.request('/plugins/discord/channels', auth(amyTok))).status).toBe(403);
  });

  // An unconfigured plugin answers (empty picker); a DISABLED one is the platform's 503. The two must
  // not collapse into one another — that distinction is what the ordering above buys.
  it('answers 503 "discord plugin is disabled" when the plugin is off', async () => {
    const { app, adminTok } = setup([]);
    const res = await app.request('/plugins/discord/channels', auth(adminTok));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'discord plugin is disabled' });
  });
});
