// Bundled reference plugin: exposes markdown skills to the brain. Hand-written ESM (no build step) so
// it doubles as the canonical example of the plugin format. It reads .md skills from its own `skills/`
// directory plus the instance's user skills dir (where CreateSkill writes), and registers each so the
// brain's system prompt advertises them. The creator tools are admin-only — skills are shared state.
import { loadSkillsFromDir, defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve, sep } from 'node:path';
import { writeFileSync, unlinkSync, rmSync, rmdirSync, existsSync, statSync, readFileSync, readdirSync, mkdirSync, realpathSync, renameSync } from 'node:fs';

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
// Names that collide with the core per-plugin route family under /plugins/skills/* (PATCH
// /plugins/:name/config would eat PATCH /plugins/skills/config, and the rest are reserved for URL
// hygiene). Core matched routes first, so a skill with one of these names could never be edited.
const RESERVED_NAMES = new Set(['config', 'icon', 'logs', 'contributions', 'hook-executions', 'data', 'restore', 'api', 'list', 'users']);

/** Index the visible (model-invocable) skills of one set by name. A duplicate is dropped with a warning:
 *  two files claiming the same name are a catalog problem, and silently picking one is how the wrong body
 *  gets loaded. */
function indexVisible(skills, logger) {
  const byName = new Map();
  for (const skill of skills) {
    if (skill.disableModelInvocation) continue;
    if (byName.has(skill.name)) {
      logger.warn(`duplicate visible skill name '${skill.name}' ignored by SkillLoad (${skill.filePath})`);
      continue;
    }
    byName.set(skill.name, skill);
  }
  return byName;
}

/** ONE instance-wide loader over every set this plugin owns, resolving WHOSE personal skills the call may
 *  open at execute time — the same shape the memory tools use, and for the same reason.
 *
 *  It used to be one registered definition per account, selected by PluginRegistry.toolsFor() from the
 *  session's owner. That works only where a session has ONE owner. A shared room has none: its sender
 *  changes turn to turn while its tool set is fixed at spawn, so every room fell back to the instance
 *  definition and a colleague's own skills did not exist there at all — for them or for anyone.
 *
 *  The caller comes from `ctx.currentContributionUserId()`, which the host resolves once per turn and uses
 *  for its OWN available-skills announcement, so this tool offers exactly the set the model was told about.
 *  Deliberately not `currentIdentity().elowenUserId`: a delegated sub-agent carries no account identity yet
 *  legitimately inherits the skills of the turn that spawned it, and reading identity there would announce
 *  a skill and then refuse to open it. Outside a turn, or for an unlinked sender / accountless automation,
 *  it answers null and only the instance set is reachable. */
function buildSkillLoadTool(ctx, instanceSkills, personalSkills) {
  const logger = ctx.logger;
  const instanceByName = indexVisible(instanceSkills, logger);
  const personalByName = new Map();
  for (const [ownerUserId, owned] of personalSkills) personalByName.set(ownerUserId, indexVisible(owned, logger));
  const anyPersonal = [...personalByName.values()].some((byName) => byName.size > 0);
  if (instanceByName.size === 0 && !anyPersonal) return null;

  /** A personal definition shadows an instance one of the same name, inside that account's turns only —
   *  the precedence PluginRegistry.toolsFor() applied when this was still one tool per owner. */
  const visibleTo = (ownerUserId) => {
    const owned = ownerUserId == null ? undefined : personalByName.get(ownerUserId);
    return owned && owned.size ? new Map([...instanceByName, ...owned]) : instanceByName;
  };

  const description = 'Exact skill name from the available-skills list.';
  const instanceLiterals = [...instanceByName.keys()].map((skillName) => Type.Literal(skillName));
  // The schema enumerates the names only while EVERY session sees the same ones. The moment any account
  // owns a personal set, an enum could only be built from one of two wrong lists: the instance names alone
  // would reject a name the model was correctly told it may load, and the union of everybody's names would
  // publish one person's private skill names into every other person's prompt. A free string with the
  // available-skills list as its stated source is the honest third answer, and execute() is the gate.
  const name = !anyPersonal && instanceLiterals.length > 0
    ? (instanceLiterals.length === 1
        ? Type.Literal([...instanceByName.keys()][0], { description })
        : Type.Union(instanceLiterals, { description }))
    : Type.String({ description });

  return defineTool({
    name: 'SkillLoad', label: 'Load skill',
    description: [
      'Load the complete instructions for one available skill managed by the skills plugin, using an exact name from the available-skills list.',
      'Prefer this tool over Read for a skill it can load; skills contributed by other plugins remain loadable through Read at the location shown in the available-skills list.',
      'The result includes the skill directory used to resolve relative paths in its instructions.',
      'Personal skills remain limited to their owner and instance skills are shared. Manual-only skills are omitted; only the user can invoke one explicitly with /skill:<name>.',
    ].join(' '),
    parameters: Type.Object({ name }),
    execute: async (_id, params) => {
      const skill = visibleTo(ctx.currentContributionUserId()).get(params.name);
      if (!skill) return ok('Error: that skill is not available in this session. Use an exact name from the available-skills list.');
      try {
        const content = readFileSync(skill.filePath, 'utf-8');
        return ok(`Skill: ${skill.name}\nSkill directory: ${skill.baseDir}\n\n${content}`);
      } catch (error) {
        logger.warn(`could not load skill '${skill.name}' from '${skill.filePath}': ${error instanceof Error ? error.message : error}`);
        return ok(`Error: skill "${skill.name}" could not be loaded because its file is missing or unreadable.`);
      }
    },
  });
}

/** Split a skill file into its leading `---` fenced YAML frontmatter and the markdown body — the
 *  regex mirrors src/shared/frontmatter.ts (this no-build plugin cannot import daemon sources):
 *  BOM-tolerant, CRLF-tolerant, and the block ends at the FIRST `---` line so a horizontal rule
 *  later in the body stays body. */
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*(?:\r?\n)([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;
function splitFrontmatter(source) {
  const m = FRONTMATTER_RE.exec(source);
  if (!m) return { frontmatter: '', body: source };
  return { frontmatter: m[1] ?? '', body: m[2] ?? '' };
}

export function register(ctx) {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundledDir = join(here, 'skills');
  const instanceDir = ctx.dataDir(); // instance-wide skills every session sees
  // PERSONAL skills live under `<dataDir>/users/<accountId>/`. They sit INSIDE the instance dir (so one
  // data dir still holds everything the plugin owns) but must never be loaded as instance-wide ones — PI's
  // loader recurses into subdirectories, so the instance scan below explicitly drops anything under here.
  const USERS_SUBDIR = 'users';
  const usersRoot = join(instanceDir, USERS_SUBDIR);
  const userSkillsDir = (userId) => join(usersRoot, String(userId));
  // An instance skill in directory form could already be called `users` (a `users/SKILL.md` written before
  // personal sets existed). That folder is a SKILL, not the personal root, and treating it as the root
  // would delete it from every prompt on upgrade — so the reservation only applies when it is not one.
  const usersRootIsPersonalStore = () => !existsSync(join(usersRoot, 'SKILL.md'));
  const canonicalPath = (path) => {
    try { return realpathSync(path); } catch { return resolve(path); }
  };
  const isPersonalPath = (file) => {
    if (!usersRootIsPersonalStore()) return false;
    const abs = canonicalPath(file);
    const root = canonicalPath(usersRoot);
    return abs === root || abs.startsWith(root + sep);
  };
  // Both catalog surfaces (list/delete) go through PI's loader, not a raw `*.md` readdir, so they see
  // EVERY skill PI actually loads — including the `<name>/SKILL.md` directory form (PI treats a dir with a
  // SKILL.md as a skill root). A flat readdir would silently miss those.
  const loadSkills = (dir, source) => (existsSync(dir) ? loadSkillsFromDir({ dir, source }).skills : []);
  // Account ids that currently own a personal skills folder. Read from disk rather than from the user
  // store: the plugin has no reach into it, and a folder whose account is gone is dropped by the
  // user-removed handler below, not by guessing here.
  const skillOwnerIds = () => (existsSync(usersRoot) && usersRootIsPersonalStore()
    ? readdirSync(usersRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^[0-9]+$/.test(e.name))
        .map((e) => Number(e.name))
    : []);

  const instanceSkills = [];
  const personalSkills = new Map();
  let count = 0;
  for (const { dir, source } of [
    { dir: bundledDir, source: 'elowen-plugin:skills' },
    { dir: instanceDir, source: 'elowen-user:skills' },
  ]) {
    for (const skill of loadSkills(dir, source)) {
      if (dir === instanceDir && isPersonalPath(skill.filePath)) continue; // owned by one account, registered below
      ctx.registerSkill(skill);
      instanceSkills.push(skill);
      count += 1;
    }
  }
  for (const ownerUserId of skillOwnerIds()) {
    const owned = loadSkills(userSkillsDir(ownerUserId), 'elowen-user:skills');
    personalSkills.set(ownerUserId, owned);
    for (const skill of owned) {
      ctx.registerSkill(skill, { ownerUserId });
      count += 1;
    }
  }

  // ONE registered definition, instance-wide. The per-account variants it replaced could only ever be
  // selected by a session's OWNER, which no shared room has — so the loader now carries every set and
  // decides per turn (see buildSkillLoadTool). Being an ordinary instance tool also puts it squarely under
  // the writer's own tool grant: an account an admin never granted SkillLoad cannot reach their personal
  // skills through it, which is exactly what the grant is for.
  const skillLoader = buildSkillLoadTool(ctx, instanceSkills, personalSkills);
  if (skillLoader) ctx.registerTool(skillLoader);
  if (skillLoader) {
    ctx.registerSystemPromptFragment([
      '<skill_loading>',
      'Prefer SkillLoad when its schema offers the matching skill name.',
      'Some available skills are contributed by other plugins and are not offered by SkillLoad; load those with Read at the location shown in the available-skills list.',
      'SkillLoad returns the skill directory; resolve every relative reference in the instructions against that directory.',
      '</skill_loading>',
    ].join('\n'));
  }

  // An account is gone: drop its personal skills with it. Nothing else ever reaches this folder again
  // (the id is never handed out twice — see db.ts's user-sequence guard), so leaving it behind would
  // simply keep one person's private instructions on the operator's disk forever.
  ctx.registerUserRemoved((userId) => {
    const dir = userSkillsDir(userId);
    if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); ctx.requestReload?.(); }
  });

  /** The account behind the current request/turn, or null when there is none (cron, an unlinked sender). */
  const callerId = () => ctx.currentIdentity()?.elowenUserId ?? null;
  const adminOnly = () => { if (!ctx.isAdminSession()) throw new Error('instance-wide skills can only be managed from an admin session'); };
  const ownerOnly = () => { if (ctx.currentIdentity()?.owner !== true) throw new Error('instance-wide skills can only be created by the instance owner'); };

  // ── Admin skills API (root mounts, grandfathered core URLs): bundled .md skills ship inside this
  // plugin folder (read-only), user skills live in the plugin's writable data dir — the same files
  // CreateSkill/DeleteSkill write. Both the flat `<name>.md` and the Agent-Skills `<name>/SKILL.md`
  // directory layout are supported, because the loader reads either. A successful write/delete
  // requests a plugin reload (deferred + coalesced by the host), so new conversations pick it up. ──

  // Resolve a skill name to its file in a dir, accepting both layouts. Flat wins when both exist so a
  // stray `<name>.md` keeps shadowing the folder the way the loader sees it.
  const skillFileIn = (dir, name) => {
    const flat = join(dir, `${name}.md`);
    if (existsSync(flat)) return flat;
    const nested = join(dir, name, 'SKILL.md');
    return existsSync(nested) ? nested : null;
  };
  /** Why this name may not be written into `target`, or null when it may. A name must be unique across
   *  the sets a single session sees, in BOTH directions: a personal skill may not shadow an instance one,
   *  and an instance skill may not shadow somebody's personal one — either way two files would register
   *  under one name and fight over the same slot in that person's prompt. */
  const sameDir = (a, b) => a !== null && b !== null && canonicalPath(a) === canonicalPath(b);
  /** `fromDir` is set only by a TRANSFER, and names the dir the skill is LEAVING. Without it every move
   *  would collide with itself: the file being moved is still on disk in the source scope, and that is
   *  exactly the scope this check searches. */
  const nameCollision = (name, targetOwner, fromDir = null) => {
    if (skillFileIn(bundledDir, name)) return `a bundled skill named "${name}" already exists`;
    if (targetOwner !== null) {
      if (sameDir(fromDir, instanceDir)) return null; // moving OUT of the instance set
      return skillFileIn(instanceDir, name) ? `an instance-wide skill named "${name}" already exists` : null;
    }
    // Writing the instance set: it lands in EVERY session, including the sessions of the people who
    // already own a personal skill by that name.
    const clash = skillOwnerIds().find((id) => !sameDir(fromDir, userSkillsDir(id)) && skillFileIn(userSkillsDir(id), name));
    return clash === undefined ? null : `an account already has a personal skill named "${name}" — pick another name`;
  };

  // Every skill file in a dir, from both layouts. A folder only counts when it carries a SKILL.md —
  // support dirs (references/, scripts/) never appear as skills on their own.
  const enumerateSkills = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) out.push({ name: entry.name.replace(/\.md$/, ''), file: join(dir, entry.name) });
      else if (entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md'))) out.push({ name: entry.name, file: join(dir, entry.name, 'SKILL.md') });
    }
    return out;
  };
  // Frontmatter as an object + trimmed body. Unknown fields (license, allowed-tools, compatibility,
  // metadata…) stay in the object so a write preserves them verbatim instead of dropping them.
  const splitSkillFile = (raw, file) => {
    const { frontmatter, body } = splitFrontmatter(raw);
    let front = {};
    if (frontmatter) {
      try {
        const parsed = parseYaml(frontmatter);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) front = parsed;
      } catch (e) {
        // Say it out loud. Treating malformed frontmatter as absent keeps the body editable, which is
        // right, but silence made the failure look like a different bug entirely: the skill still appears
        // in the catalogue, just with no description — and the description is the ONLY thing the model
        // reads when deciding whether to load it, so a silently unparsable file is a skill that can never
        // trigger. Seen in the wild with `description: Firemní know-how: použij …`, where the second
        // colon-space makes the whole block invalid YAML and takes `name` down with it.
        ctx.logger.warn(`skill ${file ?? '(unknown file)'}: frontmatter is not valid YAML (${e instanceof Error ? e.message.split('\n')[0] : e}) — name and description will be missing until it is fixed; quote any value containing ': '`);
      }
    }
    return { front, body: body.replace(/^\n+/, '').replace(/\n+$/, '') };
  };
  const skillVersion = (front) => {
    const meta = front.metadata;
    if (meta && typeof meta === 'object' && !Array.isArray(meta) && typeof meta.version === 'number') return meta.version;
    return null;
  };
  const readSkillFile = (file) => {
    const { front, body } = splitSkillFile(readFileSync(file, 'utf-8'), file);
    const description = typeof front.description === 'string' ? front.description : '';
    // A skill with no description is advertised but unreachable — the catalogue line the model sees
    // carries the name and the description, and nothing else says when to use it.
    if (!description.trim()) ctx.logger.warn(`skill ${file}: no description — it will be listed but the model has no trigger for it`);
    return {
      front,
      description,
      content: body,
      disableModelInvocation: front['disable-model-invocation'] === true,
      version: skillVersion(front),
    };
  };
  // Overlay the fields the editor manages onto an existing frontmatter object, leaving every other key
  // (and its order) untouched. Serializing via the YAML library — not string interpolation — keeps a
  // description with a colon-space or a leading '#' valid.
  const applyManagedFields = (existing, name, description, disableModelInvocation) => {
    const fm = { ...existing };
    fm.name = name;
    fm.description = description.replaceAll('\n', ' ');
    if (disableModelInvocation) fm['disable-model-invocation'] = true;
    else delete fm['disable-model-invocation'];
    return fm;
  };
  // Bump metadata.version in place (absent/invalid → 1).
  const bumpVersion = (fm) => {
    const meta = (fm.metadata && typeof fm.metadata === 'object' && !Array.isArray(fm.metadata)) ? { ...fm.metadata } : {};
    meta.version = (typeof meta.version === 'number' ? meta.version : 0) + 1;
    fm.metadata = meta;
  };
  const buildSkillBody = (front, content) => `---\n${stringifyYaml(front).trimEnd()}\n---\n\n${content}\n`;
  const jsonRes = (body, status = 200) => ({ status, body });

  // HTTP compatibility for clients that omit `?owner=`: preserve the route's historical auth-based target.
  // An API admin writes the instance set; anyone else writes their own set. The CreateSkill tool does NOT
  // use this fallback — its explicit `scope` is gated independently on instance-owner identity.
  const legacyTarget = (isAdmin, me) => {
    if (isAdmin) return { ok: true, owner: null, dir: instanceDir };
    if (me === null) return { ok: false };
    return { ok: true, owner: me, dir: userSkillsDir(me) };
  };

  // WHICH skills dir a request targets. `owner` is the literal 'me' for the caller's own personal set,
  // 'instance' for the shared one, an account id for somebody else's, or absent — which means the legacy
  // target above, so a client written before ownership keeps writing where it always did. Reaching
  // another account's skills — or writing the instance set — is admin-only, and the refusal is the same
  // shape either way so a non-admin cannot probe which accounts exist.
  /** Resolve an owner SPEC to a skills dir, or null when the spec is absent. Both the `owner` query of a
   *  read/write and the DESTINATION of a transfer go through here, so a scope can never be reached by one
   *  route under weaker authority than by another. */
  const resolveOwnerSpec = (raw, auth) => {
    const me = auth.userId;
    if (raw === 'instance') {
      return auth.admin ? { ok: true, owner: null, dir: instanceDir } : { ok: false };
    }
    if (raw === 'me') {
      return me === null ? { ok: false } : { ok: true, owner: me, dir: userSkillsDir(me) };
    }
    if (raw !== '') {
      if (!/^[0-9]+$/.test(raw)) return { ok: false, invalid: true };
      const id = Number(raw);
      if (id !== me && !auth.admin) return { ok: false };
      // The id has to name a REAL account. Otherwise a typo mints a folder for a person who does not
      // exist, and every later load enumerates it as somebody's skill set. Refused exactly like another
      // account's set, so a probe cannot tell a missing account from one it may not touch.
      if (id !== me && !accountExists(id)) return { ok: false };
      return { ok: true, owner: id, dir: userSkillsDir(id) };
    }
    return null;
  };

  const resolveTarget = (req) => {
    const raw = typeof req.query?.owner === 'string' ? req.query.owner.trim() : '';
    return resolveOwnerSpec(raw, req.auth) ?? legacyTarget(req.auth.admin, req.auth.userId);
  };

  /** Whether an account id still exists. A failing read answers "no": minting a personal folder needs a
   *  positive answer, and an unreadable user table is not one. */
  const accountExists = (id) => {
    try { return ctx.host.stores().usersRead.list().some((u) => u.id === id); }
    catch (e) { ctx.logger.warn(`could not read the account list (${e instanceof Error ? e.message : e}) — treating account ${id} as unknown`); return false; }
  };

  const describeSkill = (name, file, source, owner, canWrite = true) => {
    const parsed = readSkillFile(file);
    return {
      name,
      description: parsed.description,
      source,
      scope: source === 'bundled' ? 'bundled/system' : 'user-defined',
      // The account this skill belongs to; null for bundled and instance-wide skills. The catalog UI
      // renders it as the owner column, and it is the value a write passes back as `?owner=`.
      owner,
      location: file,
      active: true, // this plugin is serving the request, so it is enabled by definition
      // Whether THIS caller may edit or delete it. The UI hides its controls on this, so it must carry the
      // same rule the write routes enforce — offering a button that always 403s is worse than no button.
      canDelete: source === 'user' && canWrite,
      disableModelInvocation: parsed.disableModelInvocation,
      version: parsed.version,
      // Editable skills carry their body so the web editor can prefill an edit; bundled skills are
      // read-only, so their (larger) content is left off the list payload.
      ...(source === 'user' ? { content: parsed.content } : {}),
    };
  };

  ctx.registerApiRoute({
    rootMount: '/plugins/skills/list', path: '', method: 'GET', access: 'user',
    handler: async (req) => {
      if (req.path !== '') return jsonRes({ error: 'not found' }, 404);
      const out = [];
      for (const { name, file } of existsSync(bundledDir) ? enumerateSkills(bundledDir) : []) {
        out.push(describeSkill(name, file, 'bundled', null));
      }
      for (const { name, file } of existsSync(instanceDir) ? enumerateSkills(instanceDir) : []) {
        if (isPersonalPath(file)) continue; // enumerated per account below
        out.push(describeSkill(name, file, 'user', null, req.auth.admin));
      }
      // Own skills always; everyone else's only for an admin, who is the one person who has to be able to
      // see (and clean up) what the instance actually loads.
      const owners = req.auth.admin ? skillOwnerIds() : (req.auth.userId === null ? [] : [req.auth.userId]);
      for (const ownerUserId of owners) {
        const dir = userSkillsDir(ownerUserId);
        if (!existsSync(dir)) continue;
        for (const { name, file } of enumerateSkills(dir)) {
          out.push(describeSkill(name, file, 'user', ownerUserId, req.auth.admin || ownerUserId === req.auth.userId));
        }
      }
      return jsonRes(out);
    },
  });

  // Create (or overwrite) a skill in the caller's own set (or, for an admin, the instance set / another
  // account's). A name shadowing a bundled or instance-wide skill is refused: both copies would register
  // and silently fight over the same slot in the system prompt.
  ctx.registerApiRoute({
    rootMount: '/plugins/skills', path: '', method: 'POST', access: 'user',
    handler: async (req) => {
      if (req.path !== '') return jsonRes({ error: 'not found' }, 404);
      const target = resolveTarget(req);
      if (!target.ok) return jsonRes({ error: target.invalid ? 'invalid owner' : 'forbidden' }, target.invalid ? 400 : 403);
      let b;
      try { b = await req.json(); } catch { b = null; }
      const name = typeof b?.name === 'string' ? b.name.trim() : '';
      const description = typeof b?.description === 'string' ? b.description.trim() : '';
      const content = typeof b?.content === 'string' ? b.content : '';
      const disableModelInvocation = b?.disableModelInvocation === true;
      if (!NAME_RE.test(name)) return jsonRes({ error: 'name must be kebab-case (a-z, 0-9, dashes), max 64 chars' }, 400);
      if (RESERVED_NAMES.has(name)) return jsonRes({ error: `"${name}" is reserved (it collides with a core /plugins route)` }, 400);
      if (description === '' || content.trim() === '') return jsonRes({ error: 'description and content must be non-empty' }, 400);
      const collision = nameCollision(name, target.owner);
      if (collision) return jsonRes({ error: collision }, 400);
      mkdirSync(target.dir, { recursive: true });
      writeFileSync(join(target.dir, `${name}.md`), buildSkillBody(applyManagedFields({}, name, description, disableModelInvocation), content), 'utf-8');
      ctx.requestReload?.(); // skills feed the brain's system prompt — apply live
      return jsonRes({ ok: true }, 201);
    },
  });

  // Edit a skill (bundled skills are read-only). Partial: any of description/content/the
  // disable-model-invocation flag may be omitted to keep its current value. The flag toggle lets an
  // operator hide a skill from progressive disclosure while leaving `/skill:name` invocation intact.
  ctx.registerApiRoute({
    rootMount: '/plugins/skills/:name', path: '', method: 'PATCH', access: 'user',
    handler: async (req) => {
      if (req.path !== '') return jsonRes({ error: 'not found' }, 404);
      const name = req.params.name ?? '';
      if (!NAME_RE.test(name)) return jsonRes({ error: 'invalid skill name' }, 400);
      if (skillFileIn(bundledDir, name)) return jsonRes({ error: 'bundled skills cannot be edited' }, 400);
      const target = resolveTarget(req);
      if (!target.ok) return jsonRes({ error: target.invalid ? 'invalid owner' : 'forbidden' }, target.invalid ? 400 : 403);
      const file = skillFileIn(target.dir, name);
      if (!file) return jsonRes({ error: 'unknown skill' }, 404);
      let b;
      try { b = await req.json(); } catch { b = null; }
      const cur = readSkillFile(file);
      const description = typeof b?.description === 'string' ? b.description.trim() : cur.description;
      const content = typeof b?.content === 'string' ? b.content : cur.content;
      const disableModelInvocation = typeof b?.disableModelInvocation === 'boolean' ? b.disableModelInvocation : cur.disableModelInvocation;
      if (description === '' || content.trim() === '') return jsonRes({ error: 'description and content must be non-empty' }, 400);
      const fm = applyManagedFields(cur.front, name, description, disableModelInvocation);
      // Bump the revision only when the editable content actually changed — a bare disclosure toggle
      // is an operational flag, not a new version of the skill.
      if (description !== cur.description || content !== cur.content) bumpVersion(fm);
      writeFileSync(file, buildSkillBody(fm, content), 'utf-8');
      ctx.requestReload?.();
      return jsonRes({ ok: true });
    },
  });

  ctx.registerApiRoute({
    rootMount: '/plugins/skills/:name', path: '', method: 'DELETE', access: 'user',
    handler: async (req) => {
      if (req.path !== '') return jsonRes({ error: 'not found' }, 404);
      const name = req.params.name ?? '';
      if (!NAME_RE.test(name)) return jsonRes({ error: 'invalid skill name' }, 400);
      if (skillFileIn(bundledDir, name)) return jsonRes({ error: 'bundled skills cannot be deleted' }, 400);
      const target = resolveTarget(req);
      if (!target.ok) return jsonRes({ error: target.invalid ? 'invalid owner' : 'forbidden' }, target.invalid ? 400 : 403);
      const file = skillFileIn(target.dir, name);
      if (!file) return jsonRes({ error: 'unknown skill' }, 404);
      unlinkSync(file);
      // A directory-form skill leaves its folder behind; drop it if now empty, but keep it (with any
      // references/scripts support files) if something remains.
      const parent = dirname(file);
      if (parent !== target.dir) { try { rmdirSync(parent); } catch { /* not empty → keep */ } }
      ctx.requestReload?.();
      return jsonRes({ ok: true });
    },
  });

  // Move a skill between scopes (personal ↔ instance ↔ another account). `?owner=` names where it is NOW,
  // the body's `owner` where it should end up — both resolved through the same authority check, so this
  // route cannot reach a scope that POST/PATCH would refuse. A transfer is a filesystem MOVE, not a field
  // flip: a directory-form skill travels as its whole folder, because its SKILL.md references support
  // files (references/, scripts/) that would be orphaned if only the markdown moved.
  ctx.registerApiRoute({
    rootMount: '/plugins/skills/:name', path: 'owner', method: 'POST', access: 'user',
    handler: async (req) => {
      if (req.path !== '') return jsonRes({ error: 'not found' }, 404);
      const name = req.params.name ?? '';
      if (!NAME_RE.test(name)) return jsonRes({ error: 'invalid skill name' }, 400);
      if (skillFileIn(bundledDir, name)) return jsonRes({ error: 'bundled skills cannot be moved' }, 400);
      const source = resolveTarget(req);
      if (!source.ok) return jsonRes({ error: source.invalid ? 'invalid owner' : 'forbidden' }, source.invalid ? 400 : 403);
      const file = skillFileIn(source.dir, name);
      if (!file) return jsonRes({ error: 'unknown skill' }, 404);
      let b;
      try { b = await req.json(); } catch { b = null; }
      const raw = typeof b?.owner === 'string' ? b.owner.trim() : (typeof b?.owner === 'number' ? String(b.owner) : '');
      if (raw === '') return jsonRes({ error: 'owner is required: "instance", "me" or an account id' }, 400);
      const dest = resolveOwnerSpec(raw, req.auth);
      if (dest === null || !dest.ok) return jsonRes({ error: dest?.invalid ? 'invalid owner' : 'forbidden' }, dest?.invalid ? 400 : 403);
      if (sameDir(source.dir, dest.dir)) return jsonRes({ error: 'the skill already belongs to that owner' }, 400);
      // Unconditional, exactly as POST refuses these names for every target. Two reasons, one per
      // direction: the instance set's `users/` subfolder IS the personal store, so a skill called `users`
      // landing there would be read as that store; and a reserved name in ANY scope is shadowed by the
      // core `/plugins/:name/*` route family, leaving a skill that can no longer be edited or deleted
      // through the API.
      if (RESERVED_NAMES.has(name)) {
        return jsonRes({ error: `"${name}" is reserved (it collides with a core /plugins route)` }, 400);
      }
      if (skillFileIn(dest.dir, name)) return jsonRes({ error: `a skill named "${name}" already exists there` }, 409);
      const collision = nameCollision(name, dest.owner, source.dir);
      if (collision) return jsonRes({ error: collision }, 409);
      // A name can exist in BOTH layouts at once (`skillFileIn` reports the flat one, because that is
      // what the loader shadows with). Moving is then ambiguous: taking the flat file alone would leave
      // `<name>/SKILL.md` behind in the source scope, and the two copies would end up registered under
      // one name in the same session — the exact collision every check here exists to prevent. Refuse
      // and say which files, rather than move half of it.
      if (existsSync(join(source.dir, `${name}.md`)) && existsSync(join(source.dir, name, 'SKILL.md'))) {
        return jsonRes({ error: `"${name}" exists both as ${name}.md and ${name}/SKILL.md — remove one before moving it` }, 409);
      }
      // Directory form travels whole; a flat skill is the single .md file.
      const dirForm = basename(file).toLowerCase() === 'skill.md';
      const from = dirForm ? dirname(file) : file;
      const to = join(dest.dir, dirForm ? name : `${name}.md`);
      mkdirSync(dest.dir, { recursive: true });
      try { renameSync(from, to); }
      catch (e) {
        ctx.logger.warn(`could not move skill '${name}': ${e instanceof Error ? e.message : e}`);
        return jsonRes({ error: 'the skill could not be moved' }, 500);
      }
      ctx.requestReload?.(); // it leaves one prompt and enters another — apply live
      return jsonRes({ ok: true, owner: dest.owner });
    },
  });

  // Explicit `/skill:name` expansion remains PI-native. Automatic model invocation uses the owner-scoped
  // SkillLoad tool registered above, while the management tools below own the persistent skill catalog.
  ctx.registerTool(defineTool({
    name: 'CreateSkill', label: 'Create skill',
    description: [
      'Save a reusable skill — a named markdown procedure, workflow or set of standing instructions that you can follow again in later conversations — as a file the agent loads automatically.',
      'Use it when a workflow keeps repeating (a deployment checklist, a report format, how a specific client wants things done) or when the user asks you to remember a procedure permanently. It is for durable know-how, not for facts about a person or project: store those as a memory instead, and use the session task list for the steps of the task you are doing right now.',
      'The `name` is a kebab-case identifier (a-z, digits and dashes, up to 64 characters) and also the file name; `description` is the single line that tells your future self when this skill applies, so write it as a trigger condition; `content` is the markdown body with the actual instructions. You MUST say who the skill is for with `scope`. "personal" keeps it to the account you are talking to and is what someone asking you to remember THEIR way of doing something wants; "instance" puts it in front of every session on this instance and is owner-only. When in doubt pick "personal": a person describing their own procedure is not asking to change everyone else\'s prompt, even if they happen to be an admin.',
      'Writing an existing personal skill of yours overwrites it, but a name that collides with a bundled or instance-wide skill is refused rather than shadowed, and only the instance owner can write the shared set. The new skill is applied live and appears in the available-skills list from your next message; use ListSkills to see what already exists and DeleteSkill to remove one.',
    ].join(' '),
    parameters: Type.Object({
      name: Type.String({ description: 'kebab-case identifier and file name, e.g. "deploy-checklist" (a-z, 0-9 and dashes, max 64 chars)' }),
      description: Type.String({ description: 'One line describing WHEN to use this skill — it is the trigger the agent matches on later, e.g. "Use when releasing a new backend version"' }),
      content: Type.String({ description: 'The skill body: markdown instructions, steps, rules and examples the agent should follow when the skill applies' }),
      scope: Type.Union([Type.Literal('instance'), Type.Literal('personal')], { description: '"instance" = shared with every session on this instance, owner only. "personal" = only the account you are talking to. Required: broad admin access does not grant authority over the instance-wide prompt, and scope must not be guessed.' }),
    }),
    execute: async (_id, p) => {
      try {
        const me = callerId();
        // `scope` used to be optional and default to "instance for an admin". That asked the wrong
        // question: an admin writing themselves a note in their own chat is an admin session, so a private
        // procedure silently became part of every session's prompt on this instance. The tool now asks.
        const target = p.scope === 'instance' ? { ok: true, owner: null, dir: instanceDir }
          : (me === null ? { ok: false } : { ok: true, owner: me, dir: userSkillsDir(me) });
        const wantsInstance = target.ok && target.owner === null;
        if (wantsInstance) ownerOnly();
        // No account behind the turn: there is no personal set to write to. The shared set remains a
        // separate owner-only choice, so say both constraints rather than implying broad admin access helps.
        if (!target.ok) return ok('Error: this turn has no account behind it, so there is no personal skill set to write to — and writing the instance-wide set requires the instance owner.');
        const dir = target.dir;
        if (!NAME_RE.test(p.name)) return ok('Error: name must be kebab-case (a-z, 0-9, dashes), max 64 chars.');
        if (RESERVED_NAMES.has(p.name)) return ok(`Error: "${p.name}" is reserved.`);
        // Refuse rather than shadow: a personal skill with an instance skill's name would register twice
        // and the two would fight over the same slot in the prompt.
        const collision = nameCollision(p.name, target.owner);
        if (collision) return ok(`Error: ${collision}.`);
        const body = `---\nname: ${p.name}\ndescription: ${p.description.replaceAll('\n', ' ')}\n---\n\n${p.content}\n`;
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${p.name}.md`), body, 'utf-8');
        // Apply live: the host reloads plugins once the current turn settles (respawning the session), so
        // the new skill is in the available-skills block from the next message — no restart needed.
        ctx.requestReload?.();
        return ok(`Skill "${p.name}" saved (${wantsInstance ? 'instance-wide' : 'personal'}). It is available from your next message.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'ListSkills', label: 'List skills',
    description: [
      'List every skill available in this session — the reusable markdown procedures and workflows the agent can follow — with each name, its scope tag and the one-line description that says when it applies.',
      'Use it to check what know-how is already saved before writing a new skill with CreateSkill, to find the exact name you need for DeleteSkill, or when the user asks what you can do or what instructions you have been given. It takes no parameters.',
      'Three sets are shown: bundled skills that ship with the plugin, instance-wide skills shared by every session, and your own personal ones. It never reveals other accounts private skills. Entries flagged "/skill only" are hidden from automatic matching and run only when invoked explicitly; the listing shows names and descriptions, not the full instruction bodies, so use SkillLoad when you need the steps.',
    ].join(' '),
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const me = callerId();
        const rows = [];
        const add = (skills, tag) => {
          for (const sk of skills) {
            const flags = sk.disableModelInvocation ? ', /skill only' : '';
            rows.push(`- ${sk.name} (${tag}${flags}) — ${sk.description}`);
          }
        };
        add(loadSkills(bundledDir, 'elowen-plugin:skills'), 'bundled');
        add(loadSkills(instanceDir, 'elowen-user:skills').filter((sk) => !isPersonalPath(sk.filePath)), 'instance');
        // Only the caller's own personal skills — this tool has no admin gate, so it must not become a
        // way to enumerate what other people keep.
        if (me !== null) add(loadSkills(userSkillsDir(me), 'elowen-user:skills'), 'personal');
        return ok(rows.length ? rows.join('\n') : 'No skills found.');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DeleteSkill', label: 'Delete skill',
    description: [
      'Permanently delete a saved skill by name, removing that reusable procedure from the agent instructions from the next message onward.',
      'Use it when a stored workflow is obsolete, wrong or was superseded — for example after the user says to forget a procedure. To change a skill rather than drop it, call CreateSkill with the same name to overwrite it, and use ListSkills first to confirm the exact name.',
      'Your own personal skills are removed directly; deleting an instance-wide skill that every session sees requires an admin session, and bundled skills that ship with the plugin cannot be deleted at all. Both flat "<name>.md" files and directory-form skills are handled — for a directory skill the whole folder, including its support files, is removed.',
      'This is irreversible: the file is unlinked with no backup and no undo, so confirm before deleting somebody elses shared skill. A name you may not touch, and a name that does not exist, return the same refusal.',
    ].join(' '),
    parameters: Type.Object({ name: Type.String({ description: 'The exact kebab-case skill name to delete, as shown by ListSkills, e.g. "deploy-checklist"' }) }),
    execute: async (_id, p) => {
      try {
        if (!NAME_RE.test(p.name)) return ok('Error: invalid skill name.');
        const me = callerId();
        // Resolve via the loader so BOTH forms are deletable: a flat `<name>.md` (unlink the file) and a
        // `<name>/SKILL.md` directory skill (remove the whole skill root). Personal first — an instance
        // skill of the same name cannot exist (writes refuse it), so the order only decides which dir is
        // searched first, not which of two copies is hit.
        const personalDir = me === null ? null : userSkillsDir(me);
        let dir = null;
        let skill = personalDir ? loadSkills(personalDir, 'elowen-user:skills').find((sk) => sk.name === p.name) : undefined;
        if (skill) dir = personalDir;
        else {
          skill = loadSkills(instanceDir, 'elowen-user:skills')
            .filter((sk) => !isPersonalPath(sk.filePath))
            .find((sk) => sk.name === p.name);
          if (skill) { adminOnly(); dir = instanceDir; }
        }
        if (!skill || !dir) return ok(`Error: no skill named "${p.name}" that you can delete.`);
        const isDirForm = basename(skill.filePath).toLowerCase() === 'skill.md';
        const target = isDirForm ? dirname(skill.filePath) : skill.filePath;
        // Guard the resolved path stays inside the dir we chose, so a crafted frontmatter name can never
        // point the delete outside it.
        const base = resolve(dir);
        const abs = resolve(target);
        if (abs !== base && !abs.startsWith(base + sep)) return ok('Error: skill path is outside the skills directory.');
        if (abs === base) return ok('Error: refusing to delete the skills root.');
        if (isDirForm && statSync(abs).isDirectory()) rmSync(abs, { recursive: true, force: true });
        else unlinkSync(abs);
        ctx.requestReload?.(); // apply live, same as CreateSkill — the skill leaves the prompt next message
        return ok(`Skill "${p.name}" deleted.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.logger.info(`registered ${count} skill(s) + loader and management tools`);
}
