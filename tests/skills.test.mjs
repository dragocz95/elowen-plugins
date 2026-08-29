import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { formatSkillsForPrompt } from '@earendil-works/pi-coding-agent';
import { register } from '../plugins/skills/index.mjs';

const pluginDir = fileURLToPath(new URL('../plugins/skills/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(pluginDir, 'elowen-plugin.json'), 'utf-8'));
const log = { info() {}, warn() {}, error() {} };

let dirs = [];
const tmpDir = (tag) => { const p = mkdtempSync(join(tmpdir(), `elowen-${tag}-`)); dirs.push(p); return p; };
const cleanup = () => { for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true }); };

const skillMd = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}.\n`;

// ── the stub host ────────────────────────────────────────────────────────────────────────────────────
// What the daemon's plugin loader hands `register(ctx)`. Only the seams the skills plugin actually
// touches are provided; anything it reaches for that is missing would throw rather than silently answer.

/**
 * Load the plugin under a stub host rooted at `dataRoot` (the daemon resolves ctx.dataDir() to
 * `<dataRoot>/skills`, which is where the HTTP routes and the CreateSkill tool both write).
 */
function loadPlugin({ dataRoot, requestReload = () => {}, users = () => [] } = {}) {
  const skills = [];
  const tools = [];
  const routes = [];
  const userRemoved = [];
  const promptFragments = [];
  // The identity/admin state the host would install around a turn or an API request. It is ambient in
  // the daemon (AsyncLocalStorage); a mutable cell is the same thing for a single-threaded test.
  const session = { identity: null, adminSession: false, contributionUserId: null };
  const ctx = {
    logger: log,
    dataDir: () => join(dataRoot, 'skills'),
    registerSkill: (skill, opts = {}) => { skills.push({ ...skill, ownerUserId: opts.ownerUserId ?? null }); },
    registerTool: (tool, opts = {}) => tools.push({ ...tool, ownerUserId: opts.ownerUserId ?? null }),
    registerSystemPromptFragment: (fragment) => promptFragments.push(fragment),
    registerApiRoute: (route) => routes.push(route),
    registerUserRemoved: (fn) => userRemoved.push(fn),
    requestReload,
    currentIdentity: () => session.identity,
    // WHOSE personal skills the turn may open. The host resolves it per turn from the session and its
    // verified writer, so it is deliberately NOT derived from `identity` here either: the two part company
    // for a delegated sub-agent, and a stub that tied them together could never show that.
    currentContributionUserId: () => session.contributionUserId,
    isAdminSession: () => session.adminSession,
    // Declared by the manifest as `capabilities.reads: ['stores']`; the plugin refuses to mint a personal
    // folder for an id that names no account, so it needs the same account list the daemon wires in. Read
    // LIVE, not snapshotted: a grant or an account deletion must be visible to the very next request.
    host: { stores: () => ({ usersRead: { list: users } }) },
  };
  register(ctx);
  return { skills, tools, routes, userRemoved, promptFragments, session };
}

/** Run `fn` as a TURN — the scope `runWithPolicy(policy, fn, { identity })` installs around a tool call.
 *
 *  The two axes are INDEPENDENT in the daemon and must stay so here: `isAdminSession()` answers from the
 *  turn's POLICY (`allowedProjectIds === 'all'`), while `currentIdentity()` answers from the account the
 *  turn acts FOR. A limited-policy turn can still belong to an account, and an admin-policy turn (a CLI
 *  session, a cron job) can belong to nobody — and the skills tools branch on that exact combination.
 *
 *  Awaited, not merely returned: the daemon's scope is AsyncLocalStorage and survives an `await` inside
 *  the tool, so tearing this one down the moment the promise is HANDED BACK would quietly diverge the day
 *  a tool grows one. */
const asTurn = async (plugin, { admin = false, identity = null }, fn) => {
  plugin.session.identity = identity;
  plugin.session.adminSession = admin;
  try { return await fn(); } finally { plugin.session.identity = null; plugin.session.adminSession = false; }
};

/** An owner-policy turn with no Elowen account id: may write the instance set, but has no personal set. */
const ADMIN_TURN = { admin: true, identity: { platform: 'elowen', userId: '1', admin: true, owner: true } };
/** Broad admin policy from a foreign identity: not authority over the instance-wide prompt. */
const FOREIGN_ADMIN_TURN = { admin: true, identity: { platform: 'discord', userId: '2', elowenUserId: 2, admin: true, owner: false } };
/** `runWithPolicy(LIMITED, …)` with no identity: neither an admin session nor an account. */
const LIMITED_TURN = { admin: false, identity: null };
/** A limited turn that DOES belong to an account. */
const turnFor = (elowenUserId) => ({ admin: false, identity: { platform: 'elowen', userId: String(elowenUserId), elowenUserId, admin: false, owner: false } });

const runTool = (plugin, name, params) => {
  const tool = plugin.tools.find((t) => t.name === name && t.ownerUserId === null);
  assert.ok(tool, `instance tool ${name} must be registered`);
  return tool.execute('t', params);
};

/** Run the ONE registered instance tool inside a turn whose CONTRIBUTION OWNER is `ownerUserId` — the
 *  host-resolved "whose personal skills may this turn open", null for the instance set alone. It replaced
 *  a per-account registered definition selected by the session's owner, because a shared room has no
 *  owner to select one with. */
const runScopedTool = async (plugin, name, ownerUserId, params) => {
  const tool = plugin.tools.find((t) => t.name === name && t.ownerUserId === null);
  assert.ok(tool, `instance tool ${name} must be registered`);
  plugin.session.contributionUserId = ownerUserId ?? null;
  try { return await tool.execute('t', params); } finally { plugin.session.contributionUserId = null; }
};

/** The message a tool REFUSED with. SkillLoad throws its refusals rather than returning them as text:
 *  a refusal handed back as a normal result is recorded as a successful call, and the model reads it as
 *  an answer instead of a failure. Asserting on the throw is therefore asserting on the real contract. */
const refusalOf = async (promise) => {
  // The assert.fail below sits OUTSIDE the catch on purpose: inside it, its own AssertionError would be
  // caught by this very handler and returned as if it were the tool's refusal, so a tool that RETURNED
  // its error instead of throwing would still pass. That is the exact regression this helper exists to
  // catch, and a helper that cannot fail is worse than no helper at all.
  let result;
  try {
    result = await promise;
  } catch (error) {
    assert.ok(error instanceof Error, 'a refusal must be a thrown Error');
    return error.message;
  }
  assert.fail(`expected a thrown refusal, got a successful result: ${asText(result)}`);
};

// ── the HTTP harness ─────────────────────────────────────────────────────────────────────────────────
// The daemon serves this plugin's grandfathered `/plugins/skills/*` surface through the ROOT-mounted
// plugin API dispatcher (src/api/routes/pluginApi.ts + PluginRegistry.rootApiRoute). There is no daemon
// here, so the parts of that path the assertions depend on are ported faithfully: mount registration
// (including the manifest declaration gate), the mount-ranking resolver, the access + per-user grant
// gates, the exact PluginApiRequest shape a handler is handed, and the response mapping. A looser stand-in
// would let the tests pass on behaviour production does not have.

/** The registry's registerApiRoute for a ROOT mount: `<rootMount>/<path>`, method upper-cased, and the
 *  full mount must be declared in the manifest's provides.apiRoutes or the route is dropped. */
function mountRoutes(routes) {
  const mounts = new Map();
  for (const route of routes) {
    const clean = route.path.replace(/^\/+|\/+$/g, '');
    assert.ok(route.rootMount, 'the skills plugin registers root mounts only');
    const base = route.rootMount.trim().replace(/\/+$/g, '');
    const mount = clean ? `${base}/${clean}` : base;
    // Every reason the registry DROPS a route at registration time (with a warning, so a typo shows up
    // as a dead endpoint rather than a crash). Asserted rather than mirrored: a route silently missing
    // from the harness would take its whole test with it and read as a plugin bug.
    assert.ok(['admin', 'user', 'agent'].includes(route.access), `access must be admin, user or agent, got '${route.access}'`);
    assert.ok(
      base.startsWith('/') && base.slice(1).split('/').every((seg) => /^[a-z0-9][a-z0-9-]*$/.test(seg) || /^:[a-zA-Z][a-zA-Z0-9]*$/.test(seg)),
      `rootMount '${route.rootMount}' must be an absolute lowercase path (segments may be ':param')`,
    );
    assert.ok(
      manifest.provides?.apiRoutes?.includes(mount),
      `root mount '${mount}' is not declared in the manifest's provides.apiRoutes — the daemon would drop it`,
    );
    const entry = mounts.get(mount) ?? [];
    entry.push({ ...(route.method ? { method: route.method.toUpperCase() } : {}), access: route.access, handler: route.handler });
    mounts.set(mount, entry);
  }
  return mounts;
}

/** Port of PluginRegistry.rootApiRoute: the mount naming the most leading segments wins (literal and
 *  ':param' mounts compete on the same scale), literal beats pattern at equal depth, and an exact method
 *  beats a method-less route. */
function resolveRootRoute(mounts, path, method) {
  const parts = ('/' + path.replace(/^\/+|\/+$/g, '')).slice(1).split('/');
  const candidates = [];
  for (let depth = parts.length; depth >= 1; depth--) {
    const mount = '/' + parts.slice(0, depth).join('/');
    if (!mounts.has(mount)) continue;
    candidates.push({ mount, remainder: parts.slice(depth).join('/'), params: {}, literals: depth, depth });
  }
  for (const mount of mounts.keys()) {
    if (!mount.includes('/:')) continue;
    const msegs = mount.slice(1).split('/');
    if (msegs.length > parts.length) continue;
    const params = {};
    let literals = 0;
    let ok = true;
    for (let i = 0; i < msegs.length; i++) {
      const seg = msegs[i];
      if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
      else if (seg === parts[i]) literals++;
      else { ok = false; break; }
    }
    if (!ok) continue;
    candidates.push({ mount, remainder: parts.slice(msegs.length).join('/'), params, literals, depth: msegs.length });
  }
  candidates.sort((a, b) => b.depth - a.depth || b.literals - a.literals);
  for (const candidate of candidates) {
    const entry = mounts.get(candidate.mount);
    const route = entry.find((r) => r.method === method) ?? entry.find((r) => r.method === undefined);
    if (route) return { ...candidate, ...route };
  }
  return undefined;
}

/** Port of shared/pluginAccess.ts: a userGrantable plugin is deny-by-default for a non-admin. */
const isPluginAllowedForUser = (user, grantable) => {
  if (!grantable) return true;
  if (!user || user.is_admin) return true;
  return user.granted_plugins.includes('skills');
};

/** A minimal stand-in for the daemon's UserStore: the FIRST account created is the admin, ids are never
 *  handed out twice, and a deleted account fires the plugin's user-removed handler. */
function makeUsers() {
  const rows = [];
  let seq = 0;
  return {
    create(username) {
      const user = { id: ++seq, username, is_admin: rows.length === 0, granted_plugins: [] };
      rows.push(user);
      return user;
    },
    list: () => rows.map((u) => ({ ...u })),
    get: (id) => rows.find((u) => u.id === id),
    setGrantedPlugins(id, plugins) { rows.find((u) => u.id === id).granted_plugins = plugins; },
    remove(id) {
      const at = rows.findIndex((u) => u.id === id);
      if (at === -1) return false;
      rows.splice(at, 1);
      return true;
    },
    issueToken: (id) => `user:${id}`,
  };
}

/**
 * The '/plugins/skills/*' surface, served exactly the way the daemon serves it. `enabled: []` leaves the
 * plugin unloaded, so its DECLARED-but-inactive mounts answer 503 rather than a bare 404 — the reason a
 * CLI or spawned agent can tell "subsystem off" from "no such endpoint".
 */
function setup(opts = {}) {
  const dataRoot = tmpDir('skills-data');
  const users = makeUsers();
  const admin = users.create('admin');
  const amy = users.create('amy');
  const enabled = opts.enabled ?? ['skills'];
  const plugin = enabled.includes('skills') ? loadPlugin({ dataRoot, users: () => users.list() }) : null;
  const mounts = plugin ? mountRoutes(plugin.routes) : new Map();
  // Mounts this plugin DECLARES but does not currently serve — i.e. it is disabled or failed to load.
  // A request under one of those answers an explicit 503 instead of a bare 404, so a caller can tell
  // "subsystem off" from "no such endpoint". A mount that IS live is excluded, exactly as the daemon
  // excludes it: a live mount with no route for the requested method is a 404, not a disabled plugin.
  const declaredInactive = manifest.provides.apiRoutes
    .filter((mount) => !mounts.has(mount))
    .map((mount) => mount.split('/').filter(Boolean));

  const app = {
    async request(url, init = {}) {
      const parsed = new URL(url, 'http://daemon');
      const method = (init.method ?? 'GET').toUpperCase();
      const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      const token = (headers.authorization ?? '').replace(/^Bearer /, '');
      const user = users.get(Number(token.replace(/^user:/, ''))) ?? null;
      // The daemon's global auth middleware runs BEFORE either dispatcher, so a request with no valid
      // bearer never reaches a handler. It has to be here too: `isPluginAllowedForUser(null, …)` answers
      // "allowed" for a userless caller, and that is only safe in the daemon because these guards
      // already owned the case — without them the harness would serve the whole surface anonymously.
      if (!user) return res(401, { error: 'unauthorized' });

      // Core routes win by construction (the plugin dispatcher is a fall-through registered last). Only
      // the one this suite exercises is modelled; NOT modelled is the `/plugins/:name/*` core family that
      // shadows `/plugins/skills/config`, `…/icon`, `…/logs` and friends — which is why the plugin keeps
      // its own RESERVED_NAMES list. Neither repo's suite covers those names, so nothing here asserts on
      // a path the daemon would route elsewhere.
      if (method === 'DELETE' && /^\/users\/\d+$/.test(parsed.pathname)) {
        if (!user?.is_admin) return res(403, { error: 'forbidden' });
        const id = Number(parsed.pathname.split('/')[2]);
        if (!users.remove(id)) return res(404, { error: 'not found' });
        for (const fn of plugin?.userRemoved ?? []) await fn(id);
        return res(200, { ok: true });
      }

      const match = resolveRootRoute(mounts, parsed.pathname, method);
      if (!match) {
        const segs = parsed.pathname.split('/').filter(Boolean);
        const inactive = declaredInactive.some((m) => m.length <= segs.length && m.every((seg, i) => seg.startsWith(':') || seg === segs[i]));
        return inactive ? res(503, { error: 'skills plugin is disabled' }) : res(404, { error: 'not found' });
      }
      // Declared access, enforced centrally — before the plugin ever sees the request.
      if (match.access === 'admin' && !user?.is_admin) return res(403, { error: 'forbidden' });
      // Per-user grant for a plugin whose manifest opted in, checked once for the whole surface so a
      // plugin cannot grow an ungated endpoint by forgetting one.
      if (!isPluginAllowedForUser(user, manifest.userGrantable === true)) return res(403, { error: 'forbidden' });

      const raw = Buffer.from(init.body ?? '');
      const request = {
        method,
        path: match.remainder,
        query: Object.fromEntries(parsed.searchParams),
        headers,
        params: match.params,
        body: () => Promise.resolve(raw),
        json: () => Promise.resolve(JSON.parse(raw.toString('utf8'))),
        auth: {
          userId: user?.id ?? null,
          admin: user?.is_admin === true,
          tokenScope: 'user',
          agentTask: null,
          accessibleProjects: user?.is_admin ? null : [],
        },
      };
      // An API handler runs inside an IDENTITY scope, explicitly NOT a turn scope: no session id, so
      // `isAdminSession()` stays false and the tools' admin-only path guard keeps refusing.
      plugin.session.identity = {
        platform: 'http',
        userId: String(request.auth.userId ?? ''),
        ...(request.auth.userId !== null ? { elowenUserId: request.auth.userId } : {}),
        admin: request.auth.admin,
        owner: request.auth.userId === 1,
      };
      plugin.session.adminSession = false;
      try {
        const out = await match.handler(request);
        return res(out.status ?? 200, out.body);
      } catch (error) {
        // Body-shape failures map exactly like the core route families' onError, so a grandfathered root
        // mount keeps its clients' 400 contract.
        if (error instanceof SyntaxError) return res(400, { error: 'invalid JSON body' });
        return res(500, { error: 'plugin api handler failed' });
      } finally {
        plugin.session.identity = null;
      }
    },
  };
  return { app, dataRoot, users, admin, amy, plugin, userDir: join(dataRoot, 'skills'), adminTok: users.issueToken(admin.id), amyTok: users.issueToken(amy.id) };
}

const res = (status, body) => ({ status, json: async () => body });
const auth = (t) => ({ headers: { authorization: `Bearer ${t}` } });
const post = (t, body) => ({ method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const del = (t) => ({ method: 'DELETE', headers: { authorization: `Bearer ${t}` } });
const patch = (t, body) => ({ method: 'PATCH', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

const skill = (extra = {}) => ({ name: 'deploy-checklist', description: 'When deploying.', content: 'Check twice.', ...extra });

// ── assertion helpers (the node:test counterparts of the vitest matchers the sources used) ───────────
const matches = (row, shape) => Object.entries(shape).every(([key, value]) => {
  // Strict, deliberately: legacy deepEqual treats an ABSENT field as equal to `null`, which would let
  // `{ owner: null }` match a payload that never carried an owner column at all.
  try { assert.deepStrictEqual(row?.[key], value); return true; } catch { return false; }
});
/** vitest's `toContainEqual(expect.objectContaining(shape))`. */
const assertContains = (rows, shape) =>
  assert.ok(rows.some((row) => matches(row, shape)), `no row matching ${JSON.stringify(shape)} in ${JSON.stringify(rows)}`);
/** vitest's `toMatchObject`. */
const assertMatches = (row, shape) =>
  assert.ok(matches(row, shape), `${JSON.stringify(row)} does not match ${JSON.stringify(shape)}`);

const listSkills = async (app, token) => (await (await app.request('/plugins/skills/list', auth(token))).json());

// ═══ suite 1 — plugin registration (ported from tests/plugins/skillsPlugin.test.ts) ═══════════════════

/** The identity skillsPlugin.test.ts ran its tool calls under: an admin-policy turn whose identity
 *  names no Elowen account, so callerId() is null and every unspecified write is the instance set. */
const OWNER_TURN = { admin: true, identity: { platform: 'elowen', userId: '1', admin: true, owner: true } };

test('bundled skills plugin', async (t) => {
  t.after(cleanup);

  await t.test('registers at least one skill from its bundled dir', () => {
    const reg = loadPlugin({ dataRoot: tmpDir('skills') });
    assert.ok(reg.skills.length > 0);
    assert.ok(reg.skills.map((s) => s.name).includes('skill-creation'));
  });

  await t.test('registers SkillLoad and preserves the Read fallback for skills from other plugins', async () => {
    const reg = loadPlugin({ dataRoot: tmpDir('skills') });
    assert.ok(formatSkillsForPrompt(reg.skills).length > 0);
    assert.ok(reg.promptFragments.some((fragment) => fragment.includes('SkillLoad') && fragment.includes('other plugins') && fragment.includes('Read')));
    const loaded = asText(await runScopedTool(reg, 'SkillLoad', null, { name: 'skill-creation' }));
    assert.match(loaded, /Skill: skill-creation/);
    assert.match(loaded, /Skill directory:/);
    assert.match(loaded, /CreateSkill/);
  });

  await t.test('SkillLoad accepts only visible exact names and fails safely when a file disappears', async () => {
    const dataRoot = tmpDir('skills');
    const skillsDir = join(dataRoot, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    const autoFile = join(skillsDir, 'auto-skill.md');
    writeFileSync(autoFile, skillMd('auto-skill', 'load automatically'));
    writeFileSync(join(skillsDir, 'manual-skill.md'), '---\nname: manual-skill\ndescription: explicit only\ndisable-model-invocation: true\n---\n\nsecret manual body\n');
    const reg = loadPlugin({ dataRoot });
    const instanceTool = reg.tools.find((tool) => tool.name === 'SkillLoad' && tool.ownerUserId === null);
    assert.ok(instanceTool);

    // The schema is a free-form string and enumerates NOTHING — not even the instance names. An enum was
    // rejected by schema validation before execute() ran, so the model never reached the message telling it
    // what to call instead; it only saw "must be equal to constant". Seven recorded failures were that.
    const schema = JSON.stringify(instanceTool.parameters);
    assert.doesNotMatch(schema, /auto-skill/);
    assert.doesNotMatch(schema, /manual-skill/);
    assert.doesNotMatch(schema, /"const"|"enum"|"anyOf"/);

    // Every refusal names what WOULD have worked.
    const missing = await refusalOf(runScopedTool(reg, 'SkillLoad', null, { name: 'does-not-exist' }));
    assert.match(missing, /does-not-exist/);
    assert.match(missing, /auto-skill/, 'the refusal must list the skills that can be loaded');

    // A manual-only skill is announced to the model, so "it does not exist" would be a lie that invites a
    // retry which can never succeed. It is refused for the actual reason, with the invocation that works.
    const manual = await refusalOf(runScopedTool(reg, 'SkillLoad', null, { name: 'manual-skill' }));
    assert.match(manual, /manual-only/);
    assert.match(manual, /\/skill:manual-skill/);
    assert.doesNotMatch(manual, /secret manual body/);

    rmSync(autoFile);
    assert.match(await refusalOf(runScopedTool(reg, 'SkillLoad', null, { name: 'auto-skill' })), /missing or unreadable/);
  });

  await t.test('SkillLoad opens the personal set of the turn\'s contribution owner, and nobody else\'s', async () => {
    const dataRoot = tmpDir('skills');
    const skillsDir = join(dataRoot, 'skills');
    mkdirSync(join(skillsDir, 'users', '7'), { recursive: true });
    mkdirSync(join(skillsDir, 'users', '8'), { recursive: true });
    writeFileSync(join(skillsDir, 'shared-skill.md'), skillMd('shared-skill', 'shared procedure'));
    writeFileSync(join(skillsDir, 'users', '7', 'private-seven.md'), skillMd('private-seven', 'account seven only'));
    writeFileSync(join(skillsDir, 'users', '8', 'private-eight.md'), skillMd('private-eight', 'account eight only'));
    const reg = loadPlugin({ dataRoot });

    assert.match(asText(await runScopedTool(reg, 'SkillLoad', null, { name: 'shared-skill' })), /Body of shared-skill/);
    // The turn's IDENTITY is deliberately not what widens the set. The host resolves the contribution owner
    // once per turn and announces the very same set to the model; a tool second-guessing that from identity
    // would answer differently for a delegated child, whose identity names no account at all.
    await asTurn(reg, turnFor(7), async () => {
      await refusalOf(runScopedTool(reg, 'SkillLoad', null, { name: 'private-seven' }));
    });
    assert.match(asText(await runScopedTool(reg, 'SkillLoad', 7, { name: 'shared-skill' })), /Body of shared-skill/);
    assert.match(asText(await runScopedTool(reg, 'SkillLoad', 7, { name: 'private-seven' })), /Body of private-seven/);

    // The refusal enumerates, so it must enumerate only what the ASKING turn may see. A refusal that
    // helpfully listed every name would leak one account's private skill names to another — the same leak
    // an enumerated schema would have caused, moved into the error text. The wanted name is quoted back in
    // the sentence either way, so the assertion is on the LIST, not on the whole message.
    const listed = (refusal) => {
      const [, tail] = refusal.split('exactly these: ');
      assert.ok(tail, `refusal must enumerate the loadable skills: ${refusal}`);
      return tail.split('.')[0].split(', ').map((entry) => entry.trim());
    };

    // Asserted by membership rather than exact equality: the plugin's own bundled skills are in the
    // instance set too, and pinning the whole list would break every time one is added.
    const eightAsksSeven = listed(await refusalOf(runScopedTool(reg, 'SkillLoad', 8, { name: 'private-seven' })));
    assert.ok(eightAsksSeven.includes('shared-skill'));
    assert.ok(eightAsksSeven.includes('private-eight'));
    assert.ok(!eightAsksSeven.includes('private-seven'), `leaked account 7's skill names: ${eightAsksSeven}`);

    const sevenAsksEight = listed(await refusalOf(runScopedTool(reg, 'SkillLoad', 7, { name: 'private-eight' })));
    assert.ok(sevenAsksEight.includes('shared-skill'));
    assert.ok(sevenAsksEight.includes('private-seven'));
    assert.ok(!sevenAsksEight.includes('private-eight'), `leaked account 8's skill names: ${sevenAsksEight}`);
  });

  await t.test('the schema never publishes one account\'s private skill names to another', async () => {
    const dataRoot = tmpDir('skills');
    const skillsDir = join(dataRoot, 'skills');
    mkdirSync(join(skillsDir, 'users', '7'), { recursive: true });
    writeFileSync(join(skillsDir, 'shared-skill.md'), skillMd('shared-skill', 'shared procedure'));
    writeFileSync(join(skillsDir, 'users', '7', 'private-seven.md'), skillMd('private-seven', 'account seven only'));
    const reg = loadPlugin({ dataRoot });
    const tool = reg.tools.find((t) => t.name === 'SkillLoad' && t.ownerUserId === null);

    // The parameter schema rides every session's prompt, so it can name only what EVERY session may load —
    // which, once personal sets exist, is nothing it could enumerate honestly. Enumerating the union would
    // publish one person's private skill names to everyone else in the room; enumerating the instance names
    // alone would reject a name the model was correctly told it may load. The schema therefore names
    // nothing at all, takes the available-skills list as its stated source, and execute() is the gate.
    const schema = JSON.stringify(tool.parameters);
    assert.doesNotMatch(schema, /private-seven/);
    assert.doesNotMatch(schema, /shared-skill/);
    assert.match(asText(await runScopedTool(reg, 'SkillLoad', 7, { name: 'private-seven' })), /Body of private-seven/);
  });

  await t.test('a symlink into a personal skill directory never promotes it to instance scope', async () => {
    const dataRoot = tmpDir('skills');
    const skillsDir = join(dataRoot, 'skills');
    const privateDir = join(skillsDir, 'users', '7', 'private-linked');
    mkdirSync(privateDir, { recursive: true });
    writeFileSync(join(privateDir, 'SKILL.md'), skillMd('private-linked', 'account seven only'));
    symlinkSync(privateDir, join(skillsDir, 'linked-from-instance'), 'dir');
    const reg = loadPlugin({ dataRoot });

    await refusalOf(runScopedTool(reg, 'SkillLoad', null, { name: 'private-linked' }));
    assert.match(asText(await runScopedTool(reg, 'SkillLoad', 7, { name: 'private-linked' })), /Body of private-linked/);
  });

  await t.test('CreateSkill writes the skill AND asks the host to apply it live (no restart)', async () => {
    // Regression: before the fix, CreateSkill wrote the file but never triggered a reload, so a freshly
    // created skill only reached the model after a daemon restart / plugins toggle. It must now request a
    // live reload (drained by the brain once the turn settles) so the skill is available next message.
    const dataRoot = tmpDir('skills');
    let reloads = 0;
    const reg = loadPlugin({ dataRoot, requestReload: () => { reloads += 1; } });
    const out = await asTurn(reg, OWNER_TURN, () => runTool(reg, 'CreateSkill', { name: 'ship-it', scope: 'instance', description: 'how to ship a release', content: 'do the thing' }));
    assert.ok(out.content[0].text.includes('next message')); // the message no longer says "after a restart"
    assert.equal(reloads, 1); // the missing link: the tool now requests a live apply
    // A fresh load (what the reload performs) picks the new skill up from the data dir.
    const reloaded = loadPlugin({ dataRoot });
    assert.ok(reloaded.skills.map((s) => s.name).includes('ship-it'));
  });

  await t.test('DeleteSkill also asks the host to apply the removal live', async () => {
    const dataRoot = tmpDir('skills');
    mkdirSync(join(dataRoot, 'skills'), { recursive: true });
    writeFileSync(join(dataRoot, 'skills', 'temp-skill.md'), '---\nname: temp-skill\ndescription: throwaway\n---\n\nbody\n');
    let reloads = 0;
    const reg = loadPlugin({ dataRoot, requestReload: () => { reloads += 1; } });
    const out = await asTurn(reg, OWNER_TURN, () => runTool(reg, 'DeleteSkill', { name: 'temp-skill' }));
    assert.ok(out.content[0].text.includes('deleted'));
    assert.equal(reloads, 1);
  });

  await t.test('lists AND deletes a directory-form <name>/SKILL.md user skill, not just flat .md', async () => {
    // ctx.dataDir() resolves to <dataRoot>/skills — seed a directory-form skill there (PI treats a dir
    // with a SKILL.md as a skill root). The old flat-*.md readdir catalog would miss it entirely.
    const dataRoot = tmpDir('skills');
    const skillDir = join(dataRoot, 'skills', 'deploy-flow');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: deploy-flow\ndescription: how to deploy the app\n---\n\nsteps here\n');

    const reg = loadPlugin({ dataRoot });
    // PI's loader registered the dir-form skill…
    assert.ok(reg.skills.map((s) => s.name).includes('deploy-flow'));
    // …and ListSkills surfaces it (via the loader, not a flat readdir).
    const listed = await asTurn(reg, OWNER_TURN, () => runTool(reg, 'ListSkills', {}));
    assert.ok(listed.content[0].text.includes('deploy-flow'));
    // …and DeleteSkill removes the whole skill directory.
    const removed = await asTurn(reg, OWNER_TURN, () => runTool(reg, 'DeleteSkill', { name: 'deploy-flow' }));
    assert.ok(removed.content[0].text.includes('deleted'));
    assert.equal(existsSync(skillDir), false);
  });
});

// ═══ suite 1b — the creator tools (ported from tests/plugins/cronSkillsImagePlugins.test.ts) ═════════

const asText = (r) => r.content[0].text;

test('skills plugin creator tools', async (t) => {
  t.after(cleanup);

  await t.test('create → list → delete a user skill (admin only)', async () => {
    const dataRoot = tmpDir('pdata');
    const reg = loadPlugin({ dataRoot });

    await asTurn(reg, LIMITED_TURN, async () => {
      // No account behind the turn: neither a personal target nor owner authority for the shared set.
      const refusal = asText(await runTool(reg, 'CreateSkill', { name: 'x', scope: 'personal', description: 'd', content: 'c' }));
      assert.match(refusal, /instance owner/);
      assert.match(refusal, /no account behind it/);
    });
    await asTurn(reg, FOREIGN_ADMIN_TURN, async () => {
      const refusal = asText(await runTool(reg, 'CreateSkill', { name: 'foreign-shared', scope: 'instance', description: 'd', content: 'c' }));
      assert.match(refusal, /instance owner/);
      assert.equal(existsSync(join(dataRoot, 'skills/foreign-shared.md')), false);
    });
    await asTurn(reg, ADMIN_TURN, async () => {
      assert.match(asText(await runTool(reg, 'CreateSkill', { name: 'Bad Name', scope: 'instance', description: 'd', content: 'c' })), /kebab-case/);
      assert.match(asText(await runTool(reg, 'CreateSkill', { name: 'users', scope: 'instance', description: 'd', content: 'c' })), /reserved/);
      assert.match(asText(await runTool(reg, 'CreateSkill', { name: 'deploy-checklist', scope: 'instance', description: 'Kdy nasazovat', content: 'Kroky…' })), /saved/);
      const file = join(dataRoot, 'skills/deploy-checklist.md');
      assert.ok(readFileSync(file, 'utf-8').includes('name: deploy-checklist'));
      assert.ok(asText(await runTool(reg, 'ListSkills', {})).includes('deploy-checklist (instance)'));
      assert.match(asText(await runTool(reg, 'DeleteSkill', { name: 'deploy-checklist' })), /deleted/);
      assert.equal(existsSync(file), false);
    });
  });

  // `scope` used to be optional and default to "instance for an admin". An admin noting down their own
  // way of doing something — in their own chat, where nobody else is — therefore edited every session's
  // prompt on the instance. Being an admin says what someone MAY do, never what they meant.
  await t.test('an ADMIN asking for a personal skill gets a personal one, not an instance-wide one', async () => {
    const dataRoot = tmpDir('pdata');
    const reg = loadPlugin({ dataRoot });
    const boss = { ...turnFor(7), admin: true, owner: true };

    await asTurn(reg, boss, async () => {
      assert.match(asText(await runTool(reg, 'CreateSkill', { name: 'my-way', scope: 'personal', description: 'd', content: 'c' })), /personal/);
    });
    assert.equal(existsSync(join(dataRoot, 'skills/users/7/my-way.md')), true);
    assert.equal(existsSync(join(dataRoot, 'skills/my-way.md')), false); // NOT in everyone's prompt
  });

  // A turn that belongs to an account writes into THAT account's set by default; the instance set stays
  // admin-only. Without this, one person's CreateSkill would edit everyone's system prompt.
  await t.test('writes a personal skill for the account behind the turn, and hides it from other accounts', async () => {
    const dataRoot = tmpDir('pdata');
    const reg = loadPlugin({ dataRoot });
    const amy = turnFor(4);
    const bob = turnFor(5);

    await asTurn(reg, amy, async () => {
      assert.match(asText(await runTool(reg, 'CreateSkill', { name: 'amy-skill', scope: 'personal', description: 'd', content: 'c' })), /personal/);
      assert.equal(existsSync(join(dataRoot, 'skills/users/4/amy-skill.md')), true);
      assert.equal(existsSync(join(dataRoot, 'skills/amy-skill.md')), false);
      // A non-admin cannot promote it to the shared set.
      assert.match(asText(await runTool(reg, 'CreateSkill', { name: 'amy-shared', description: 'd', content: 'c', scope: 'instance' })), /instance owner/);
      assert.ok(asText(await runTool(reg, 'ListSkills', {})).includes('amy-skill (personal)'));
    });

    await asTurn(reg, bob, async () => {
      assert.ok(!asText(await runTool(reg, 'ListSkills', {})).includes('amy-skill'));
    });
  });

  await t.test('user-created skills register on the next plugin load', async () => {
    const dataRoot = tmpDir('pdata');
    const reg1 = loadPlugin({ dataRoot });
    await asTurn(reg1, ADMIN_TURN, () => runTool(reg1, 'CreateSkill', { name: 'novy-skill', scope: 'instance', description: 'test', content: 'obsah' }));
    const reg2 = loadPlugin({ dataRoot });
    assert.equal(reg2.skills.some((s) => s.name === 'novy-skill'), true);
  });
});

// ═══ suite 2 — skill ownership (ported from tests/plugins/skillOwnership.test.ts) ═════════════════════

/** A skill is a briefing the model believes. One that names a tool teaches the model that the tool is
 *  there — and a model convinced a missing tool should exist works around its absence instead of
 *  reporting it. So a skill about a plugin's tools has to load and unload WITH that plugin, which means
 *  shipping inside it. This is the guard for the whole class: it caught the task tools being taught by
 *  the core skills plugin after the task domain had moved out of core. */
test('a skill that teaches a plugin’s tools ships with that plugin', async (t) => {
  t.after(cleanup);

  /** Tools owned by OTHER plugins — none of them may be taught by this one. The task tools left for the
   *  work plugin; the scheduling tools left for cronjob, taking the mission/session half of the old
   *  elowen-control skill with them into the agents plugin. */
  const FOREIGN_TOOLS = [
    'ElowenListTasks', 'ElowenCreateTask', 'ElowenPlan', 'ElowenUpdateTask', 'ElowenGetTask', 'ElowenStopTask', 'ElowenTaskOutput',
    'CronAdd', 'ScheduleWakeup', 'CronList', 'CronRemove',
    'ElowenListMissions', 'ElowenListSessions',
  ];

  await t.test('and by nothing that outlives it — the core skills plugin no longer names them', () => {
    const reg = loadPlugin({ dataRoot: tmpDir('skills') });
    const names = reg.skills.map((s) => s.name);
    // It still ships ONE skill of its own — the meta-skill about authoring skills, which is this
    // plugin's own subject. Without this the assertions below could pass on an empty set.
    assert.deepEqual(names, ['skill-creation']);
    // What the model will actually READ: a registered skill is a pointer to its file, not its text.
    const everything = reg.skills.map((s) => readFileSync(s.filePath, 'utf8')).join('\n');
    for (const tool of FOREIGN_TOOLS) {
      assert.equal(`${tool} taught without its plugin: ${everything.includes(tool)}`, `${tool} taught without its plugin: false`);
    }
  });
});

// ═══ suite 3 — the HTTP routes (ported from tests/api/skillsRoutes.test.ts) ═══════════════════════════

// The '/plugins/skills/*' surface is served by the REAL skills plugin (root mounts), so the "bundled"
// fixtures below are the plugin's actual shipped skill ('skill-creation'), not
// synthetic ones: the .mjs resolves its bundled dir next to its own file.
const BUNDLED = 'skill-creation';

test('skills routes', async (t) => {
  t.after(cleanup);

  await t.test('GET /plugins/skills/list returns bundled + user skills with parsed descriptions', async () => {
    const { app, userDir, adminTok } = setup();
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'my-skill.md'), skillMd('my-skill', 'A user skill.'));
    const response = await app.request('/plugins/skills/list', auth(adminTok));
    assert.equal(response.status, 200);
    const list = await response.json();
    assertContains(list, { name: BUNDLED, source: 'bundled', scope: 'bundled/system', active: true, canDelete: false });
    assertContains(list, { name: 'my-skill', description: 'A user skill.', source: 'user', scope: 'user-defined', active: true, canDelete: true });
  });

  await t.test('GET lists bundled skills even when the user dir does not exist yet', async () => {
    const { app, adminTok } = setup();
    const list = await listSkills(app, adminTok);
    assert.ok(list.length > 0);
    assert.equal(list.every((sk) => sk.source === 'bundled'), true);
    assertContains(list, { name: BUNDLED, canDelete: false });
  });

  await t.test('POST creates the user skill file in the CreateSkill format and GET lists it', async () => {
    const { app, userDir, adminTok } = setup();
    const response = await app.request('/plugins/skills?owner=instance', post(adminTok, skill()));
    assert.equal(response.status, 201);
    assert.equal(
      readFileSync(join(userDir, 'deploy-checklist.md'), 'utf-8'),
      '---\nname: deploy-checklist\ndescription: When deploying.\n---\n\nCheck twice.\n',
    );
    const list = await listSkills(app, adminTok);
    assertContains(list, { name: 'deploy-checklist', description: 'When deploying.', source: 'user', canDelete: true });
  });

  await t.test('POST flattens newlines in the description (frontmatter stays one line)', async () => {
    const { app, userDir, adminTok } = setup();
    await app.request('/plugins/skills?owner=instance', post(adminTok, skill({ description: 'line one\nline two' })));
    assert.ok(readFileSync(join(userDir, 'deploy-checklist.md'), 'utf-8').includes('description: line one line two\n'));
  });

  await t.test('POST rejects a bad name, empty description/content and a non-JSON body (400)', async () => {
    const { app, adminTok } = setup();
    for (const bad of [skill({ name: 'Bad Name' }), skill({ name: 'x' }), skill({ description: '' }), skill({ content: '  ' }), skill({ content: undefined })]) {
      assert.equal((await app.request('/plugins/skills?owner=instance', post(adminTok, bad))).status, 400, JSON.stringify(bad));
    }
    const raw = await app.request('/plugins/skills', { method: 'POST', headers: { authorization: `Bearer ${adminTok}`, 'content-type': 'application/json' }, body: '{not json' });
    assert.equal(raw.status, 400);
  });

  await t.test('POST refuses a name colliding with a bundled skill (400) but overwrites a user skill', async () => {
    const { app, adminTok } = setup();
    assert.equal((await app.request('/plugins/skills?owner=instance', post(adminTok, skill({ name: BUNDLED })))).status, 400);
    assert.equal((await app.request('/plugins/skills?owner=instance', post(adminTok, skill()))).status, 201);
    assert.equal((await app.request('/plugins/skills?owner=instance', post(adminTok, skill({ content: 'v2' })))).status, 201);
  });

  await t.test('POST writes the disable-model-invocation flag and GET reports it', async () => {
    const { app, userDir, adminTok } = setup();
    await app.request('/plugins/skills?owner=instance', post(adminTok, skill({ disableModelInvocation: true })));
    assert.ok(readFileSync(join(userDir, 'deploy-checklist.md'), 'utf-8').includes('disable-model-invocation: true\n'));
    const list = await listSkills(app, adminTok);
    const row = list.find((s) => s.name === 'deploy-checklist');
    assert.equal(row?.disableModelInvocation, true);
    assert.equal(row?.content, 'Check twice.'); // user skills carry their body so the editor can prefill
  });

  await t.test('PATCH edits a user skill in place; partial fields keep their current value', async () => {
    const { app, userDir, adminTok } = setup();
    await app.request('/plugins/skills?owner=instance', post(adminTok, skill()));
    // Toggle the flag only — description/content are preserved.
    assert.equal((await app.request('/plugins/skills/deploy-checklist?owner=instance', patch(adminTok, { disableModelInvocation: true }))).status, 200);
    assert.equal(
      readFileSync(join(userDir, 'deploy-checklist.md'), 'utf-8'),
      '---\nname: deploy-checklist\ndescription: When deploying.\ndisable-model-invocation: true\n---\n\nCheck twice.\n',
    );
    // Edit body + description, and clear the flag. A content edit bumps metadata.version (absent → 1).
    assert.equal((await app.request('/plugins/skills/deploy-checklist?owner=instance', patch(adminTok, { description: 'Updated.', content: 'New body.', disableModelInvocation: false }))).status, 200);
    assert.equal(
      readFileSync(join(userDir, 'deploy-checklist.md'), 'utf-8'),
      '---\nname: deploy-checklist\ndescription: Updated.\nmetadata:\n  version: 1\n---\n\nNew body.\n',
    );
  });

  await t.test('PATCH preserves unknown frontmatter fields (license/allowed-tools/metadata/compatibility)', async () => {
    const { app, userDir, adminTok } = setup();
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'claude-skill.md'),
      '---\nname: claude-skill\ndescription: "Quoted: with a colon"\nlicense: MIT\nallowed-tools:\n  - Read\n  - Grep\ncompatibility: pi>=1\nmetadata:\n  version: 3\n  author: sam\n---\n\nOriginal body.\n');
    // Toggle the disclosure flag only — nothing else may be lost, and the version must NOT bump.
    assert.equal((await app.request('/plugins/skills/claude-skill?owner=instance', patch(adminTok, { disableModelInvocation: true }))).status, 200);
    const raw = readFileSync(join(userDir, 'claude-skill.md'), 'utf-8');
    assert.ok(raw.includes('license: MIT\n'));
    assert.ok(raw.includes('allowed-tools:\n  - Read\n  - Grep\n'));
    assert.ok(raw.includes('compatibility: pi>=1\n'));
    assert.ok(raw.includes('version: 3\n'));
    assert.ok(raw.includes('author: sam\n'));
    assert.ok(raw.includes('disable-model-invocation: true\n'));
    // The quoted description parses cleanly (no surrounding quotes leak into the UI payload).
    const list = await listSkills(app, adminTok);
    const row = list.find((s) => s.name === 'claude-skill');
    assert.equal(row?.description, 'Quoted: with a colon');
    assert.equal(row?.version, 3);
  });

  await t.test('PATCH bumps metadata.version on a content edit but not on a flag-only toggle', async () => {
    const { app, userDir, adminTok } = setup();
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'versioned.md'), '---\nname: versioned\ndescription: D.\nmetadata:\n  version: 5\n---\n\nBody.\n');
    // Flag-only toggle: version stays 5.
    await app.request('/plugins/skills/versioned?owner=instance', patch(adminTok, { disableModelInvocation: true }));
    assert.ok(readFileSync(join(userDir, 'versioned.md'), 'utf-8').includes('version: 5\n'));
    // Content edit: 5 → 6.
    await app.request('/plugins/skills/versioned?owner=instance', patch(adminTok, { content: 'Changed.' }));
    assert.ok(readFileSync(join(userDir, 'versioned.md'), 'utf-8').includes('version: 6\n'));
  });

  await t.test('reads, edits and deletes the directory-form <name>/SKILL.md layout', async () => {
    const { app, userDir, adminTok } = setup();
    const skillDir = join(userDir, 'nested-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: nested-skill\ndescription: Nested.\n---\n\nNested body.\n');
    // A support file that must survive a delete of the skill.
    mkdirSync(join(skillDir, 'references'), { recursive: true });
    writeFileSync(join(skillDir, 'references', 'notes.md'), 'keep me\n');

    const list = await listSkills(app, adminTok);
    assertContains(list, { name: 'nested-skill', content: 'Nested body.' });

    assert.equal((await app.request('/plugins/skills/nested-skill?owner=instance', patch(adminTok, { content: 'Edited.' }))).status, 200);
    assert.ok(readFileSync(join(skillDir, 'SKILL.md'), 'utf-8').includes('Edited.\n'));

    assert.equal((await app.request('/plugins/skills/nested-skill?owner=instance', del(adminTok))).status, 200);
    assert.equal(existsSync(join(skillDir, 'SKILL.md')), false);
    // Support files remain, so the folder is kept.
    assert.equal(existsSync(join(skillDir, 'references', 'notes.md')), true);
  });

  await t.test('DELETE removes an empty directory-form skill folder entirely', async () => {
    const { app, userDir, adminTok } = setup();
    const skillDir = join(userDir, 'bare-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: bare-skill\ndescription: Bare.\n---\n\nBody.\n');
    assert.equal((await app.request('/plugins/skills/bare-skill?owner=instance', del(adminTok))).status, 200);
    assert.equal(existsSync(skillDir), false);
  });

  await t.test('PATCH rejects a bundled skill (400), a missing skill (404) and empty content (400)', async () => {
    const { app, adminTok } = setup();
    await app.request('/plugins/skills?owner=instance', post(adminTok, skill()));
    assert.equal((await app.request(`/plugins/skills/${BUNDLED}`, patch(adminTok, { content: 'x' }))).status, 400);
    assert.equal((await app.request('/plugins/skills/nope?owner=instance', patch(adminTok, { content: 'x' }))).status, 404);
    assert.equal((await app.request('/plugins/skills/deploy-checklist?owner=instance', patch(adminTok, { content: '  ' }))).status, 400);
  });

  await t.test('DELETE removes a user skill; bundled → 400, missing → 404, bad name → 400', async () => {
    const { app, userDir, adminTok } = setup();
    await app.request('/plugins/skills?owner=instance', post(adminTok, skill()));
    assert.equal((await app.request(`/plugins/skills/${BUNDLED}`, del(adminTok))).status, 400);
    assert.equal((await app.request('/plugins/skills/nope?owner=instance', del(adminTok))).status, 404);
    assert.equal((await app.request('/plugins/skills/Bad%20Name?owner=instance', del(adminTok))).status, 400);
    const response = await app.request('/plugins/skills/deploy-checklist?owner=instance', del(adminTok));
    assert.equal(response.status, 200);
    assert.equal(existsSync(join(userDir, 'deploy-checklist.md')), false);
  });

  // Skills is a user-grantable plugin: an account the admin has not granted it reaches nothing at all,
  // not even its own set. The refusal happens in the core HTTP gate, before the plugin sees the request.
  await t.test('rejects an ungranted non-admin (403) on list, create and delete', async () => {
    const { app, amyTok } = setup();
    assert.equal((await app.request('/plugins/skills/list', auth(amyTok))).status, 403);
    assert.equal((await app.request('/plugins/skills', post(amyTok, skill()))).status, 403);
    assert.equal((await app.request('/plugins/skills/x', patch(amyTok, { content: 'y' }))).status, 403);
    assert.equal((await app.request('/plugins/skills/x', del(amyTok))).status, 403);
  });

  await t.test('gives a granted non-admin her OWN skills set, and nobody else\'s', async () => {
    const { app, dataRoot, users, amy, amyTok, adminTok } = setup();
    users.setGrantedPlugins(amy.id, ['skills']);
    // An instance-wide skill everyone sees, written by the admin.
    assert.equal((await app.request('/plugins/skills?owner=instance', post(adminTok, skill({ name: 'shared-one' })))).status, 201);

    // Her ownerless write lands in her own folder, not the shared dir.
    assert.equal((await app.request('/plugins/skills', post(amyTok, skill({ name: 'amy-skill' })))).status, 201);
    assert.equal(existsSync(join(dataRoot, 'skills', 'users', String(amy.id), 'amy-skill.md')), true);
    assert.equal(existsSync(join(dataRoot, 'skills', 'amy-skill.md')), false);

    // She sees bundled + instance-wide + her own, with the owner column filled in.
    const list = await listSkills(app, amyTok);
    assertContains(list, { name: 'amy-skill', owner: amy.id });
    assertContains(list, { name: 'shared-one', owner: null });
    assertContains(list, { name: BUNDLED, owner: null });

    // She may not write the shared set, nor reach another account's.
    assert.equal((await app.request('/plugins/skills?owner=instance', post(amyTok, skill({ name: 'sneaky' })))).status, 403);
    assert.equal((await app.request('/plugins/skills/shared-one?owner=instance', del(amyTok))).status, 403);
    assert.equal((await app.request(`/plugins/skills?owner=${amy.id + 99}`, post(amyTok, skill({ name: 'sneaky' })))).status, 403);
    assert.equal((await app.request('/plugins/skills?owner=abc', post(amyTok, skill({ name: 'sneaky' })))).status, 400);
    assert.equal(existsSync(join(dataRoot, 'skills', 'sneaky.md')), false);
  });

  await t.test('sends an admin\'s unspecified write to the shared set, and only an explicit "me" to his own', async () => {
    const { app, dataRoot, users, adminTok } = setup();
    const admin = users.list()[0];
    // What this endpoint did before ownership existed, and what a client written back then still expects.
    assert.equal((await app.request('/plugins/skills', post(adminTok, skill({ name: 'ops-runbook' })))).status, 201);
    assert.equal(existsSync(join(dataRoot, 'skills', 'ops-runbook.md')), true);

    assert.equal((await app.request('/plugins/skills?owner=me', post(adminTok, skill({ name: 'my-notes' })))).status, 201);
    assert.equal(existsSync(join(dataRoot, 'skills', 'users', String(admin.id), 'my-notes.md')), true);
    assert.equal(existsSync(join(dataRoot, 'skills', 'my-notes.md')), false);
  });

  await t.test('refuses a name that already exists in the other set, in BOTH directions', async () => {
    const { app, users, amy, amyTok, adminTok } = setup();
    users.setGrantedPlugins(amy.id, ['skills']);
    assert.equal((await app.request('/plugins/skills?owner=instance', post(adminTok, skill({ name: 'deploy' })))).status, 201);
    // Personal shadowing instance: two files, one name, fighting over one slot in her prompt.
    assert.equal((await app.request('/plugins/skills?owner=me', post(amyTok, skill({ name: 'deploy' })))).status, 400);

    assert.equal((await app.request('/plugins/skills?owner=me', post(amyTok, skill({ name: 'her-own' })))).status, 201);
    // And the same collision the other way round: an instance skill lands in HER sessions too.
    const response = await app.request('/plugins/skills?owner=instance', post(adminTok, skill({ name: 'her-own' })));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /personal skill/);
  });

  await t.test('does not offer a non-admin controls for a skill she cannot write', async () => {
    const { app, users, amy, amyTok, adminTok } = setup();
    users.setGrantedPlugins(amy.id, ['skills']);
    assert.equal((await app.request('/plugins/skills?owner=instance', post(adminTok, skill({ name: 'shared-one' })))).status, 201);
    assert.equal((await app.request('/plugins/skills?owner=me', post(amyTok, skill({ name: 'mine' })))).status, 201);

    const list = await listSkills(app, amyTok);
    // The UI hides its edit/delete controls on this flag, so it has to match what the write routes do —
    // a button whose request is always refused is worse than no button.
    assert.equal(list.find((x) => x.name === 'shared-one').canDelete, false);
    assert.equal(list.find((x) => x.name === 'mine').canDelete, true);

    const adminList = await listSkills(app, adminTok);
    assert.equal(adminList.find((x) => x.name === 'shared-one').canDelete, true);
    assert.equal(adminList.find((x) => x.name === 'mine').canDelete, true);
  });

  await t.test('shows the admin every account\'s skills and lets him clean one up', async () => {
    const { app, dataRoot, users, amy, amyTok, adminTok } = setup();
    users.setGrantedPlugins(amy.id, ['skills']);
    await app.request('/plugins/skills', post(amyTok, skill({ name: 'amy-skill' })));

    const list = await listSkills(app, adminTok);
    assertContains(list, { name: 'amy-skill', owner: amy.id });

    assert.equal((await app.request(`/plugins/skills/amy-skill?owner=${amy.id}`, del(adminTok))).status, 200);
    assert.equal(existsSync(join(dataRoot, 'skills', 'users', String(amy.id), 'amy-skill.md')), false);
  });

  // Nothing can ever reach that folder again, so leaving it behind just keeps one person's private
  // instructions on the operator's disk forever.
  await t.test('drops an account\'s personal skills when the account is deleted', async () => {
    const { app, dataRoot, users, amy, amyTok, adminTok } = setup();
    users.setGrantedPlugins(amy.id, ['skills']);
    await app.request('/plugins/skills', post(amyTok, skill({ name: 'amy-skill' })));
    const dir = join(dataRoot, 'skills', 'users', String(amy.id));
    assert.equal(existsSync(dir), true);

    assert.equal((await app.request(`/users/${amy.id}`, del(adminTok))).status, 200);
    assert.equal(existsSync(dir), false);
  });

  await t.test('keeps a --- line in the body as body, not a second frontmatter delimiter', async () => {
    const { app, userDir, adminTok } = setup();
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'rules.md'), '---\nname: rules\ndescription: R.\n---\nPart one.\n\n---\n\nPart two.\n');
    const list = await listSkills(app, adminTok);
    assertMatches(list.find((s) => s.name === 'rules'), { description: 'R.', content: 'Part one.\n\n---\n\nPart two.' });
  });

  await t.test('answers 503 "skills plugin is disabled" when the plugin is off', async () => {
    const { app, adminTok } = setup({ enabled: [] });
    const response = await app.request('/plugins/skills/list', auth(adminTok));
    assert.equal(response.status, 503);
    assert.deepStrictEqual(await response.json(), { error: 'skills plugin is disabled' });
    assert.equal((await app.request('/plugins/skills?owner=instance', post(adminTok, skill()))).status, 503);
  });

  await t.test('parses a BOM-prefixed user skill and keeps its frontmatter through an edit', async () => {
    const { app, userDir, adminTok } = setup();
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'bom-skill.md'), '\uFEFF---\nname: bom-skill\ndescription: B.\nlicense: MIT\n---\nBody.\n');
    const list = await listSkills(app, adminTok);
    assertMatches(list.find((s) => s.name === 'bom-skill'), { description: 'B.', content: 'Body.' });
    // PATCH keeps the unknown license field — the frontmatter was actually parsed, not treated as body.
    assert.equal((await app.request('/plugins/skills/bom-skill?owner=instance', patch(adminTok, { content: 'v2' }))).status, 200);
    assert.ok(readFileSync(join(userDir, 'bom-skill.md'), 'utf-8').includes('license: MIT\n'));
  });
});

// ═══ suite 4 — moving a skill between scopes ═════════════════════════════════════════════════════════
// A transfer is a filesystem MOVE, not a field flip, so what it must not do is lose a file or let a skill
// arrive somewhere it could never have been created.
test('skills ownership transfer', async (t) => {
  t.after(cleanup);

  const moveTo = (token, owner) => post(token, { owner });

  await t.test('moves an instance skill into an account\'s personal set', async () => {
    const { app, userDir, adminTok, amy } = setup();
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'movable.md'), skillMd('movable', 'Movable.'));

    const response = await app.request(`/plugins/skills/movable/owner?owner=instance`, moveTo(adminTok, String(amy.id)));

    assert.equal(response.status, 200);
    assert.deepStrictEqual(await response.json(), { ok: true, owner: amy.id });
    assert.equal(existsSync(join(userDir, 'movable.md')), false, 'it must LEAVE the instance set');
    assert.equal(existsSync(join(userDir, 'users', String(amy.id), 'movable.md')), true);
  });

  // The whole point of moving the folder rather than the markdown: SKILL.md resolves its references
  // against its own directory, so a move that left them behind would produce a skill pointing at nothing.
  await t.test('carries a directory-form skill\'s support files with it', async () => {
    const { app, userDir, adminTok, amy } = setup();
    const skillDir = join(userDir, 'nested-move');
    mkdirSync(join(skillDir, 'references'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), skillMd('nested-move', 'Nested.'));
    writeFileSync(join(skillDir, 'references', 'notes.md'), 'keep me\n');

    assert.equal((await app.request('/plugins/skills/nested-move/owner?owner=instance', moveTo(adminTok, String(amy.id)))).status, 200);

    const moved = join(userDir, 'users', String(amy.id), 'nested-move');
    assert.equal(existsSync(skillDir), false, 'the source folder must be gone, not half-emptied');
    assert.equal(readFileSync(join(moved, 'references', 'notes.md'), 'utf-8'), 'keep me\n');
    assert.ok(readFileSync(join(moved, 'SKILL.md'), 'utf-8').includes('nested-move'));
  });

  await t.test('refuses to overwrite a skill the destination already has', async () => {
    const { app, userDir, adminTok, amy } = setup();
    const amyDir = join(userDir, 'users', String(amy.id));
    mkdirSync(amyDir, { recursive: true });
    writeFileSync(join(userDir, 'clash.md'), skillMd('clash', 'Instance one.'));
    writeFileSync(join(amyDir, 'clash.md'), skillMd('clash', 'Hers.'));

    const response = await app.request('/plugins/skills/clash/owner?owner=instance', moveTo(adminTok, String(amy.id)));

    assert.equal(response.status, 409);
    assert.ok(readFileSync(join(amyDir, 'clash.md'), 'utf-8').includes('Hers.'), 'hers must survive untouched');
    assert.equal(existsSync(join(userDir, 'clash.md')), true, 'and the source must stay put');
  });

  // Instance-wide skills land in EVERY session's prompt, so promoting one is admin authority — the same
  // rule POST enforces. A granted account may still move her own skill around her own scope.
  await t.test('refuses a non-admin promoting her own skill to the instance set', async () => {
    const { app, userDir, users, amy, amyTok } = setup();
    users.setGrantedPlugins(amy.id, ['skills']);
    const amyDir = join(userDir, 'users', String(amy.id));
    mkdirSync(amyDir, { recursive: true });
    writeFileSync(join(amyDir, 'hers.md'), skillMd('hers', 'Hers.'));

    const response = await app.request('/plugins/skills/hers/owner?owner=me', moveTo(amyTok, 'instance'));

    assert.equal(response.status, 403);
    assert.equal(existsSync(join(amyDir, 'hers.md')), true);
    assert.equal(existsSync(join(userDir, 'hers.md')), false, 'it must not reach the shared set');
  });

  // `skillFileIn` reports the FLAT file when a name exists in both layouts, because that is what the
  // loader shadows with. Moving on that answer would take the .md and leave `<name>/SKILL.md` behind,
  // and the two copies would then register under one name in the same session.
  await t.test('refuses to move a name that exists in both layouts, rather than moving half of it', async () => {
    const { app, userDir, adminTok, amy } = setup();
    const skillDir = join(userDir, 'twoform');
    mkdirSync(join(skillDir, 'references'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), skillMd('twoform', 'Directory form.'));
    writeFileSync(join(skillDir, 'references', 'notes.md'), 'keep me\n');
    writeFileSync(join(userDir, 'twoform.md'), skillMd('twoform', 'Flat form.'));

    const response = await app.request('/plugins/skills/twoform/owner?owner=instance', post(adminTok, { owner: String(amy.id) }));

    assert.equal(response.status, 409);
    // Neither copy moved: the support file is still beside the SKILL.md it belongs to.
    assert.equal(existsSync(join(userDir, 'twoform.md')), true);
    assert.equal(readFileSync(join(skillDir, 'references', 'notes.md'), 'utf-8'), 'keep me\n');
    assert.equal(existsSync(join(userDir, 'users', String(amy.id), 'twoform.md')), false);
  });

  // A reserved name is shadowed by the core /plugins/:name/* route family in EVERY scope, so a skill
  // carrying one could no longer be edited or deleted through the API wherever it landed.
  await t.test('refuses to move a reserved name into any scope', async () => {
    const { app, userDir, adminTok, amy } = setup();
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'config.md'), skillMd('config', 'Reserved.'));

    const response = await app.request('/plugins/skills/config/owner?owner=instance', post(adminTok, { owner: String(amy.id) }));

    assert.equal(response.status, 400);
    assert.equal(existsSync(join(userDir, 'config.md')), true);
  });

  await t.test('rejects a move that goes nowhere, and an unknown skill', async () => {
    const { app, userDir, adminTok } = setup();
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'staying.md'), skillMd('staying', 'Staying.'));

    assert.equal((await app.request('/plugins/skills/staying/owner?owner=instance', moveTo(adminTok, 'instance'))).status, 400);
    assert.equal((await app.request('/plugins/skills/ghost/owner?owner=instance', moveTo(adminTok, 'me'))).status, 404);
    assert.equal(existsSync(join(userDir, 'staying.md')), true);
  });
});

test('skills manifest and marketplace registry expose the same release version', () => {
  const registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'));
  const catalog = registry.plugins.find((plugin) => plugin.name === 'skills');
  assert.equal(catalog?.version, manifest.version);
});
