// Bundled reference plugin: exposes markdown skills to the brain. Hand-written ESM (no build step) so
// it doubles as the canonical example of the plugin format. It reads .md skills from its own `skills/`
// directory plus the instance's user skills dir (where CreateSkill writes), and registers each so the
// brain's system prompt advertises them. The creator tools are admin-only — skills are shared state.
import { loadSkillsFromDir, defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve, sep } from 'node:path';
import { writeFileSync, unlinkSync, rmSync, rmdirSync, existsSync, lstatSync, readFileSync, readdirSync, mkdirSync, realpathSync, renameSync } from 'node:fs';

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
// One refusal sentence for the one NAME_RE rule. The HTTP create route returns it verbatim as its JSON
// `error`; the CreateSkill tool wraps it in the plugin's uniform `Error: ….` envelope, exactly as the
// `skillFieldError` and `nameCollision` sentences are wrapped at that tool. It used to be two
// hand-written literals at the two sites, agreeing only by luck and free to drift.
const nameError = (name) => `name "${name}" must be kebab-case (a-z, 0-9, dashes), max 64 chars`;
// Names that collide with the core per-plugin route family under /plugins/skills/* (PATCH
// /plugins/:name/config would eat PATCH /plugins/skills/config, and the rest are reserved for URL
// hygiene). Core matched routes first, so a skill with one of these names could never be edited.
const RESERVED_NAMES = new Set(['config', 'icon', 'logs', 'contributions', 'hook-executions', 'data', 'restore', 'api', 'list', 'users', 'accounts', 'plugin-availability']);

/** Split an argument string into tokens the way a shell would, honouring single and double quotes so a
 *  quoted phrase stays ONE argument. Nothing is expanded: `$FOO` and backticks travel through as literal
 *  text, because these tokens are only ever substituted into markdown, never executed. */
export function parseSkillArgs(args) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;
  for (const char of String(args ?? '')) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (/\s/.test(char)) {
      if (started || current) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
  }
  if (started || current) tokens.push(current);
  return tokens;
}

/** Substitute the skill placeholders into a skill body, with the reference's semantics
 *  (`utils/argumentSubstitution.ts`, `skills/loadSkillsDir.ts:344-363`):
 *
 *  - `${ELOWEN_SKILL_DIR}` becomes the skill's own directory, always, so a skill can point at files it
 *    ships with. (The reference calls its variable `${CLAUDE_SKILL_DIR}`.)
 *  - `$ARGUMENTS` becomes the whole argument string, `$ARGUMENTS[n]` and `$n` the nth token.
 *  - When `args` were given but the body has no placeholder at all, they are appended as an
 *    `ARGUMENTS:` line rather than silently dropped — a skill that never expected arguments still gets
 *    to see what the caller passed.
 *
 *  Deliberately NOT ported: the reference also executes `!` shell commands found in the markdown. Elowen
 *  skills are instructions handed to the model, never a script this plugin runs. */
export function substituteSkillPlaceholders(content, args, skillDir) {
  let out = skillDir ? content.replaceAll('${ELOWEN_SKILL_DIR}', skillDir) : content;
  if (args === undefined || args === null) return out;
  const before = out;
  const tokens = parseSkillArgs(args);
  out = out.replace(/\$ARGUMENTS\[(\d+)\]/g, (_match, index) => tokens[Number(index)] ?? '');
  out = out.replace(/\$(\d+)(?!\w)/g, (_match, index) => tokens[Number(index)] ?? '');
  out = out.replaceAll('$ARGUMENTS', args);
  if (out === before && args) out = `${out}\n\nARGUMENTS: ${args}`;
  return out;
}

/** The canonical location of `path` when it really lives inside `root`, or null when it does not.
 *
 *  Both sides go through realpath because the skill loader FOLLOWS symlinks — a link, a link on an
 *  intermediate path component, and a relative link all look like an ordinary child of `root` until the
 *  whole chain is resolved. That is the difference between "the loader found this file under account 7's
 *  folder" and "this file belongs to account 7", and personal skill sets are an isolation boundary.
 *
 *  The boundary test is a path SEPARATOR comparison, never a bare string prefix: `<root>-extra` shares
 *  every character of `<root>` and is a different directory. A path that cannot be canonicalized — it is
 *  gone, it is a dangling link, it is unreadable — answers null, because an uncheckable path is not a
 *  contained one and a containment check must never fail open. */
function canonicalWithin(root, path) {
  let abs;
  try { abs = realpathSync(path); } catch { return null; }
  // `root` is already canonical and PINNED by the host at registration time (or by ownerScopeRoot for the
  // account boundary). Never realpath it again: replacing that exact directory with a symlink later would
  // otherwise move both sides of the comparison together and turn the containment check into an approval.
  if (abs === root) return abs;
  return abs.startsWith(root + sep) ? abs : null;
}

/** Index the visible (model-invocable) skills of one set by name, alongside the names the set deliberately
 *  withholds. A duplicate is dropped with a warning: two files claiming the same name are a catalog
 *  problem, and silently picking one is how the wrong body gets loaded.
 *
 *  `manualOnly` is carried rather than discarded because the host announces those skills too. A model that
 *  reads one out of the available-skills list and calls SkillLoad for it deserves to be told it is
 *  manual-only, not that it does not exist — the second answer invites a retry that can never succeed. */
function indexVisible(skills, logger) {
  const byName = new Map();
  const manualOnly = new Set();
  for (const skill of skills) {
    if (skill.disableModelInvocation) { manualOnly.add(skill.name); continue; }
    if (byName.has(skill.name)) {
      logger.warn(`duplicate visible skill name '${skill.name}' ignored by SkillLoad (${skill.filePath})`);
      continue;
    }
    byName.set(skill.name, skill);
  }
  return { byName, manualOnly };
}

/** Thrown, never returned. A tool that hands a refusal back as ordinary text is recorded as a SUCCESSFUL
 *  call, so the model reads "that skill is not available" as an answer rather than a failure and moves on
 *  with nothing loaded. The host turns a throw into an error result. Same reasoning as the sites plugin's
 *  ToolError, which is where this shape comes from. */
class SkillLoadError extends Error {}

/** How many names a refusal may list before it stops being an aid and starts being a wall of text. */
const REFUSAL_NAME_CAP = 60;

const nameList = (names) => {
  const sorted = [...names].sort();
  if (sorted.length <= REFUSAL_NAME_CAP) return sorted.join(', ');
  return `${sorted.slice(0, REFUSAL_NAME_CAP).join(', ')} (+${sorted.length - REFUSAL_NAME_CAP} more)`;
};

/** The refusal for a name SkillLoad cannot load. It always ends by saying what WOULD have worked: a
 *  rejection that only reports the rejection is what makes a model guess again. */
function refuseSkill(wanted, loadable, manualOnly) {
  if (manualOnly.has(wanted)) {
    return `The skill "${wanted}" is manual-only: it is announced, but only the user can invoke it, with `
      + `/skill:${wanted}. SkillLoad cannot open it. Loadable skills are: ${nameList(loadable.keys())}.`;
  }
  if (loadable.size === 0) {
    return `No skill named "${wanted}" is loadable in this session, and no model-invocable skill is currently available.`;
  }
  return `No skill named "${wanted}" is available in this session. SkillLoad can load exactly these: `
    + `${nameList(loadable.keys())}.`;
}

/** ONE instance-wide loader over the merged registry's live skill catalog. The host resolves the current
 *  contribution owner once per turn and applies both personal ownership and plugin grants before returning
 *  the list, so this tool can load exactly what the model's available-skills block announced — including
 *  skills contributed by sibling plugins. The control is REQUIRED: silently falling back to this plugin's
 *  local files would recreate the split-brain catalog this tool exists to prevent. */
function buildSkillLoadTool(ctx, personalScopeRoot) {
  const logger = ctx.logger;
  const visibleCatalog = () => {
    const control = ctx.control?.('skillCatalog');
    if (!control || typeof control.visibleEntries !== 'function' || typeof control.canonicalBaseDir !== 'function') {
      throw new SkillLoadError('The live skill catalog is unavailable, so SkillLoad cannot safely decide which skill belongs to this turn. Continue without it and tell the user.');
    }
    try {
      // The entries carry who each skill belongs to, so the host's catalog is the only record of ownership
      // this tool reads: nothing kept here can go stale when the skill set is replaced in place.
      const entries = control.visibleEntries();
      return { ...indexVisible(entries.map((entry) => entry.skill), logger), entries, control };
    } catch (error) {
      logger.warn(`live skill catalog failed: ${error instanceof Error ? error.message : error}`);
      throw new SkillLoadError('The live skill catalog failed, so SkillLoad cannot safely decide which skill belongs to this turn. Continue without it and tell the user.');
    }
  };

  // A free-form string, always — deliberately NOT an enum of the installed names.
  //
  // An enum was only ever buildable from the instance set, and only while no account owned a personal
  // skill: the instance names alone would reject a name the model was correctly told it may load, and the
  // union of everybody's names would publish one person's private skill names into every other person's
  // prompt. So the schema's SHAPE used to flip — enum or string — on unrelated state, which is exactly the
  // kind of divergence that bites silently.
  //
  // It also could not be made correct. The host catalog is filtered per turn and includes personal,
  // grant-gated and manual-only skills, so no static enum built at plugin registration can mirror it. An
  // enum failure is unrecoverable in the worst way: the call is rejected by schema validation before
  // execute() runs, so the model never reads the message that would have told it what to call instead. It
  // just sees "must be equal to constant" — which does not even name the constant — and guesses again.
  // Seven recorded SkillLoad failures were exactly that.
  //
  // The reference tool suite the models are trained on takes a free-form string and resolves it at
  // runtime, so this is also the shape they already expect. execute() is the single gate, and its refusal
  // enumerates (see refuseSkill).
  const name = Type.String({ description: 'Exact skill name from the available-skills list.' });
  const args = Type.Optional(Type.String({
    description: 'Optional arguments for the skill, as one string. Quoted phrases stay one argument. The '
      + 'skill body may place them with $ARGUMENTS, $ARGUMENTS[0] or $0; when it has no placeholder they '
      + 'are appended as an "ARGUMENTS:" line.',
  }));

  return defineTool({
    name: 'SkillLoad', label: 'Load skill',
    description: [
      'Load the complete instructions for any model-invocable skill in the available-skills list, including skills contributed by other plugins.',
      'Pass the exact listed name. The result includes the canonical skill directory used to resolve relative paths in its instructions, and every ${ELOWEN_SKILL_DIR} in the instructions is already replaced with it.',
      'Pass args when the skill takes input: $ARGUMENTS is replaced with the whole string, $ARGUMENTS[0] and $0 with individual arguments, and a skill with no placeholder receives them as a trailing "ARGUMENTS:" line.',
      'Personal skills and grant-gated plugin skills remain limited to the current contribution owner. Manual-only skills are refused; only the user can invoke one explicitly with /skill:<name>.',
    ].join(' '),
    parameters: Type.Object({ name, args }),
    execute: async (_id, params) => {
      const owner = ctx.currentContributionUserId();
      const { byName: loadable, manualOnly, entries, control } = visibleCatalog();
      const wanted = String(params.name ?? '').trim();
      const skill = loadable.get(wanted);
      if (!skill) throw new SkillLoadError(refuseSkill(wanted, loadable, manualOnly));

      // Every advertised body is re-checked HERE, and the canonical path is what gets read. The host pins
      // the canonical base directory at REGISTRATION time, so re-pointing the base symlink later cannot move
      // the boundary. A local personal skill must satisfy BOTH boundaries: its base directory stays inside
      // the account's store, and its file stays inside that registered base directory. This also preserves
      // the correct directory for relative references in a directory-form skill.
      let directory = control.canonicalBaseDir(skill);
      const entry = entries.find((candidate) => candidate.skill === skill);
      if (owner != null && entry?.source === 'personal' && entry.ownerUserId === owner) {
        const accountRoot = personalScopeRoot(owner);
        directory = accountRoot === null || directory === null ? null : canonicalWithin(accountRoot, directory);
      }
      const file = directory === null ? null : canonicalWithin(directory, skill.filePath);
      if (file === null) {
        logger.warn(`skill '${wanted}' no longer resolves inside its registered skill directory — refused`);
        throw new SkillLoadError(`The skill "${wanted}" is announced but its file is missing or unreadable, so it cannot be loaded. Continue without it and tell the user.`);
      }
      try {
        const content = readFileSync(file, 'utf-8');
        const body = substituteSkillPlaceholders(content, params.args, directory);
        return ok(`Skill: ${skill.name}\nSkill directory: ${directory}\n\n${body}`);
      } catch (error) {
        logger.warn(`could not load skill '${skill.name}' from '${skill.filePath}': ${error instanceof Error ? error.message : error}`);
        throw new SkillLoadError(`The skill "${skill.name}" is announced but its file is missing or unreadable, so it cannot be loaded. Continue without it and tell the user.`);
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

function toolPolicyAllows(policy, name) {
  const covers = (entries) => entries?.some((entry) => entry === name
    || (entry.endsWith('*') && name.startsWith(entry.slice(0, -1)))) ?? false;
  return !(policy?.allow && !covers(policy.allow)) && !(policy?.deny && covers(policy.deny));
}

function unavailableSkillInput(name) {
  return `<skill-unavailable name="${xmlAttribute(name)}">\n`
    + `The user explicitly invoked this skill, but it is not available in the current turn. Continue without it and tell the user.\n`
    + '</skill-unavailable>';
}

function xmlAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function transformSkillInput(ctx, input) {
  if (!input.text.startsWith('/skill:')) return input.text;
  const spaceIndex = input.text.indexOf(' ');
  const name = (spaceIndex === -1 ? input.text.slice(7) : input.text.slice(7, spaceIndex)).trim();
  const args = spaceIndex === -1 ? '' : input.text.slice(spaceIndex + 1).trim();
  const owner = ctx.currentContributionUserId();
  const policy = ctx.currentAccess().toolPolicy;
  if (owner === null || !toolPolicyAllows(policy, 'SkillLoad')) return unavailableSkillInput(name);

  const control = ctx.control?.('skillCatalog');
  if (!control) return unavailableSkillInput(name);
  let skill;
  try {
    skill = control.visibleSkills().find((candidate) => candidate.name === name);
  } catch (error) {
    ctx.logger.warn(`live skill catalog failed during input transform: ${error instanceof Error ? error.message : error}`);
    return unavailableSkillInput(name);
  }
  if (!skill) return unavailableSkillInput(name);

  try {
    const directory = control.canonicalBaseDir(skill);
    const file = directory === null ? null : canonicalWithin(directory, skill.filePath);
    if (file === null) return unavailableSkillInput(name);
    const body = splitFrontmatter(readFileSync(file, 'utf-8')).body.trim();
    const skillBlock = `<skill name="${xmlAttribute(skill.name)}" location="${xmlAttribute(file)}">\n`
      + `References are relative to ${directory}.\n\n${body}\n</skill>`;
    return args ? `${skillBlock}\n\n${args}` : skillBlock;
  } catch (error) {
    ctx.logger.warn(`could not transform skill '${name}': ${error instanceof Error ? error.message : error}`);
    return unavailableSkillInput(name);
  }
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
  const under = (path, root) => path === root || path.startsWith(root + sep);
  // Personal by where it RESOLVES or by where it is WRITTEN, because the two escape in opposite
  // directions. A link in the instance dir pointing into `users/` is caught by the canonical target; a
  // link under `users/7/` pointing somewhere outside `users/` altogether resolves to neither account's
  // folder, and judging it by the target alone would read it as an ordinary instance skill — which puts
  // one account's file in front of every session on the instance.
  const isPersonalPath = (file) => usersRootIsPersonalStore()
    && (under(canonicalPath(file), canonicalPath(usersRoot)) || under(resolve(file), resolve(usersRoot)));
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
  /** Account `ownerUserId`'s own scope directory, canonicalized — or null when `users/<id>` is not that
   *  account's own real folder, which covers both "not there yet" and "it is a link somewhere else".
   *
   *  Verified to BE the literal `<id>` child of the canonical users root, rather than simply realpathed:
   *  containment below canonicalizes the root it compares against, so a linked `users/7` would become the
   *  boundary itself and every check would then confirm account 8's files as inside account 7's scope.
   *  The scan never enumerates a linked owner folder (a Dirent reports a symlink as neither a file nor a
   *  directory), but ListSkills, the creator tools and the HTTP routes all address it by account id. */
  const ownerScopeRoot = (ownerUserId) => {
    try {
      const base = realpathSync(userSkillsDir(ownerUserId));
      return base === join(realpathSync(usersRoot), String(ownerUserId)) ? base : null;
    } catch { return null; }
  };
  /** The same question for a WRITE, which must still be allowed to create the folder: something is there
   *  and it is not this account's own folder. Nothing there at all is not an alias. */
  const scopeRootAliased = (ownerUserId) => {
    try { lstatSync(userSkillsDir(ownerUserId)); } catch { return false; }
    return ownerScopeRoot(ownerUserId) === null;
  };
  /** One account's personal skills, with everything that does not actually live in that account's own
   *  folder dropped. The loader follows symlinks, so a link under `users/7/` pointing into `users/8/`
   *  otherwise loads as account 7's skill: announced in account 7's prompt and served in full by
   *  SkillLoad. The instance-scope guard above never caught it — it only ever asked whether a file sits
   *  under `users/` at all, which is true of both accounts. Every surface that reads a personal set goes
   *  through here, because a skill dropped from the load but still listed is the same leak with an extra
   *  step. */
  const personalSkillsOf = (ownerUserId) => {
    const root = ownerScopeRoot(ownerUserId);
    if (root === null) {
      // Say it out loud. An account whose folder is not its own loses every personal skill at once, and
      // an empty set with no explanation reads as "the skills never saved" rather than as a refusal.
      if (scopeRootAliased(ownerUserId)) {
        ctx.logger.warn(`${userSkillsDir(ownerUserId)} is not account ${ownerUserId}'s own folder (it resolves elsewhere) — its personal skills are ignored; a personal skills dir may not be a symlink`);
      }
      return [];
    }
    return loadSkills(userSkillsDir(ownerUserId), 'elowen-user:skills').filter((skill) => {
      if (canonicalWithin(root, skill.filePath) !== null) return true;
      ctx.logger.warn(`skill '${skill.name}' at ${skill.filePath} resolves outside account ${ownerUserId}'s skills directory — ignored`);
      return false;
    });
  };

  /** Every skill this plugin contributes, read from disk: bundled and instance-wide ones, then each
   *  account's personal set. The ONE source for both the boot registration and every live replacement,
   *  so the two can never disagree about what the plugin holds. */
  const collectSkills = () => {
    const registrations = [];
    for (const { dir, source } of [
      { dir: bundledDir, source: 'elowen-plugin:skills' },
      { dir: instanceDir, source: 'elowen-user:skills' },
    ]) {
      for (const skill of loadSkills(dir, source)) {
        if (dir === instanceDir && isPersonalPath(skill.filePath)) continue; // owned by one account, collected below
        registrations.push({ skill });
      }
    }
    for (const ownerUserId of skillOwnerIds()) {
      for (const skill of personalSkillsOf(ownerUserId)) registrations.push({ skill, ownerUserId });
    }
    return registrations;
  };
  /** Apply a change this plugin just wrote to disk: the host replaces the whole skill set in the running
   *  daemon, and every conversation reads it from its next message. No restart, no interrupted turn. */
  const reloadSkills = () => { ctx.requestReload({ mode: 'reload', skills: collectSkills() }); };

  const registrations = collectSkills();
  for (const { skill, ownerUserId } of registrations) {
    ctx.registerSkill(skill, ownerUserId === undefined ? undefined : { ownerUserId });
  }

  // ONE registered definition, instance-wide. The per-account variants it replaced could only ever be
  // selected by a session's OWNER, which no shared room has — so the loader now carries every set and
  // decides per turn (see buildSkillLoadTool). The core announces skills only when this writer may use the
  // loader, so granting a sibling plugin without granting the skills subsystem never creates a dead catalog.
  const skillLoader = buildSkillLoadTool(ctx, ownerScopeRoot);
  ctx.registerInputTransform?.((input) => transformSkillInput(ctx, input));
  ctx.registerTool(skillLoader, { workspaceSafe: true });
  ctx.registerSystemPromptFragment([
    '<skill_loading>',
    'Use SkillLoad for every model-invocable skill in the available-skills list, passing its exact name.',
    'SkillLoad resolves the same per-turn catalog the host advertised, including grant-gated and plugin-contributed skills.',
    'If SkillLoad refuses a name, use the loadable names in its error rather than guessing another spelling.',
    'SkillLoad returns the skill directory; resolve every relative reference in the instructions against that directory.',
    'Pass args when the skill takes input: ${ELOWEN_SKILL_DIR} and the $ARGUMENTS placeholders are substituted before the instructions reach you.',
    '</skill_loading>',
  ].join('\n'));

  // An account is gone: drop its personal skills with it. Nothing else ever reaches this folder again
  // (the id is never handed out twice — see db.ts's user-sequence guard), so leaving it behind would
  // simply keep one person's private instructions on the operator's disk forever.
  ctx.registerUserRemoved((userId) => {
    const dir = userSkillsDir(userId);
    if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); reloadSkills(); }
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
  /** Whether `path` under a PERSONAL target would take the request out of that account's own folder.
   *  `existsSync`, `readFileSync`, `writeFileSync` and `unlinkSync` all follow symlinks, so without this a
   *  link planted in one account's skills folder turns that account's own routes into a read, an
   *  overwrite or a delete of somebody else's skill. A path that is not there at all is fine — that is an
   *  ordinary create — but anything that IS there must canonicalize back inside. Instance and bundled
   *  scopes are shared by definition, so an operator who links a file into them keeps getting it. */
  const escapesOwnScope = (target, path) => {
    if (target.owner === null) return false;
    if (scopeRootAliased(target.owner)) return true; // the folder itself is somebody else's
    try { lstatSync(path); } catch { return false; }
    return canonicalWithin(target.dir, path) === null;
  };
  /** `skillFileIn` for a resolved request target: a personal scope never yields a file it does not own. */
  const targetFileIn = (target, name) => {
    const file = skillFileIn(target.dir, name);
    return file !== null && escapesOwnScope(target, file) ? null : file;
  };
  /** Resolve one deletable skill path and apply the same containment guards for routes and tools. */
  const deletionTargetIn = (target, name) => {
    const file = targetFileIn(target, name);
    if (file === null) return null;
    const directoryForm = basename(file).toLowerCase() === 'skill.md';
    const candidate = directoryForm ? dirname(file) : file;
    const base = resolve(target.dir);
    const path = resolve(candidate);
    if (path === base || !path.startsWith(base + sep)) return { error: 'skill path is outside the skills directory' };
    return { file, path, directoryForm };
  };
  const NON_RECURSIVE_DELETE = 'non-recursive';
  /** Delete only the skill definition. Directory-form support files are user-authored data and survive. */
  const removeSkill = (deletion, mode) => {
    if (mode !== NON_RECURSIVE_DELETE) throw new Error(`unsupported skill deletion mode: ${mode}`);
    // The refusal is about the RESOLVED target, not the name: a personal (or instance) file that merely
    // shares a name with a bundled skill is the caller's own file, not the bundled copy, and stays
    // deletable. Only when neither door resolved anything of the caller's own do we fall back to the name
    // to tell "this name is the read-only bundled skill" apart from "this name does not exist at all".
    if (deletion.target === null) {
      return skillFileIn(bundledDir, deletion.name)
        ? { error: 'bundled skills cannot be deleted', status: 400 }
        : { error: 'unknown skill', status: 404 };
    }
    if (deletion.target.error) return { error: deletion.target.error, status: 409 };
    unlinkSync(deletion.target.file);
    if (deletion.target.directoryForm) {
      try {
        rmdirSync(deletion.target.path);
      } catch (error) {
        if (error?.code !== 'ENOTEMPTY' && error?.code !== 'EEXIST') throw error;
      }
    }
    return { ok: true };
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
  // Revision changes for every editable write, including a disclosure-only toggle. It is separate from the
  // human-facing content version so two tabs cannot silently overwrite each other's operational flag.
  const skillRevision = (front) => {
    const meta = front.metadata;
    return meta && typeof meta === 'object' && !Array.isArray(meta) && Number.isSafeInteger(meta.revision) && meta.revision >= 0
      ? meta.revision : 0;
  };
  const bumpRevision = (fm, current) => {
    const meta = (fm.metadata && typeof fm.metadata === 'object' && !Array.isArray(fm.metadata)) ? { ...fm.metadata } : {};
    meta.revision = current + 1;
    fm.metadata = meta;
  };
  const buildSkillBody = (front, content) => `---\n${stringifyYaml(front).trimEnd()}\n---\n\n${content}\n`;
  const skillFieldError = (description, content) =>
    typeof description !== 'string' || description.trim() === '' || typeof content !== 'string' || content.trim() === ''
      ? 'description and content must be non-empty' : null;
  const jsonRes = (body, status = 200) => ({ status, body });

  // HTTP compatibility for clients that omit `?owner=`: preserve the route's historical auth-based target.
  // An API admin writes the instance set; anyone else writes their own set. The CreateSkill tool does NOT
  // use this fallback — its explicit `scope` is gated independently on instance-owner identity.
  /** A personal scope as a request target, refused outright when `users/<id>` is not that account's own
   *  folder. Resolved HERE so every route gets it from one place — the DESTINATION of a transfer never
   *  reaches the per-file containment check, since a rename replaces the name rather than following it. */
  const personalTarget = (id) => (scopeRootAliased(id) ? { ok: false } : { ok: true, owner: id, dir: userSkillsDir(id) });
  const legacyTarget = (isAdmin, me) => {
    if (isAdmin) return { ok: true, owner: null, dir: instanceDir };
    if (me === null) return { ok: false };
    return personalTarget(me);
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
      return me === null ? { ok: false } : personalTarget(me);
    }
    if (raw !== '') {
      if (!/^[0-9]+$/.test(raw)) return { ok: false, invalid: true };
      const id = Number(raw);
      if (id !== me && !auth.admin) return { ok: false };
      // The id has to name a REAL account. Otherwise a typo mints a folder for a person who does not
      // exist, and every later load enumerates it as somebody's skill set. Refused exactly like another
      // account's set, so a probe cannot tell a missing account from one it may not touch.
      if (id !== me && !accountExists(id)) return { ok: false };
      return personalTarget(id);
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
      name, description: parsed.description, source,
      catalogSource: source === 'bundled' ? 'bundled' : owner === null ? 'instance' : 'personal',
      scope: source === 'bundled' ? 'bundled' : owner === null ? 'instance' : 'personal',
      contributorPlugin: 'skills', pluginKey: null, owner,
      location: source === 'bundled' ? 'elowen-plugin:skills' : 'elowen-user:skills',
      active: true, effective: true, enabledForAccount: true, unavailableReason: null,
      canDelete: source === 'user' && canWrite,
      disableModelInvocation: parsed.disableModelInvocation,
      version: parsed.version,
      revision: skillRevision(parsed.front),
      ...(source === 'user' ? { content: parsed.content } : {}),
    };
  };

  const management = () => {
    const control = ctx.control?.('skillManagement');
    return control && typeof control.catalogForAccount === 'function' && typeof control.setPluginSkillEnabled === 'function'
      ? control : null;
  };

  const describeCatalogEntry = (entry, req) => {
    const localFile = entry.contributorPlugin === 'skills' && entry.source !== 'plugin';
    const source = entry.source === 'bundled' ? 'bundled'
      : entry.source === 'plugin' ? `plugin:${entry.contributorPlugin}` : 'user';
    const parsed = localFile ? readSkillFile(entry.skill.filePath) : null;
    const owner = entry.source === 'personal' ? entry.ownerUserId : null;
    const canWrite = source === 'user' && (req.auth.admin || owner === req.auth.userId);
    return {
      name: entry.skill.name,
      description: parsed?.description ?? entry.skill.description,
      source,
      catalogSource: entry.source,
      scope: entry.source,
      contributorPlugin: entry.contributorPlugin,
      pluginKey: entry.key,
      owner,
      // Source metadata is useful provenance without disclosing an absolute host path.
      location: entry.skill.sourceInfo?.source ?? `elowen-plugin:${entry.contributorPlugin}`,
      active: entry.effective,
      effective: entry.effective,
      enabledForAccount: entry.enabledForAccount,
      unavailableReason: entry.unavailableReason ?? null,
      canDelete: canWrite,
      disableModelInvocation: parsed?.disableModelInvocation ?? entry.skill.disableModelInvocation === true,
      version: parsed?.version ?? null,
      revision: parsed ? skillRevision(parsed.front) : undefined,
      ...(canWrite && parsed ? { content: parsed.content } : {}),
    };
  };

  ctx.registerApiRoute({
    rootMount: '/plugins/skills/list', path: '', method: 'GET', access: 'user',
    handler: async (req) => {
      if (req.path !== '') return jsonRes({ error: 'not found' }, 404);
      if (req.auth.userId === null) return jsonRes({ error: 'forbidden' }, 403);
      const managementView = typeof req.query?.account === 'string' && req.query.account.trim() !== '';
      const requested = managementView ? Number(req.query.account) : req.auth.userId;
      if (!Number.isSafeInteger(requested) || requested <= 0) return jsonRes({ error: 'invalid account' }, 400);
      if (managementView && !req.auth.admin) return jsonRes({ error: 'forbidden' }, 403);
      const control = management();
      if (!control) return jsonRes({ error: 'skill management is unavailable; upgrade Elowen core' }, 503);
      let entries;
      try { entries = control.catalogForAccount(requested); }
      catch (error) {
        return jsonRes({ error: error instanceof Error && error.message === 'unknown user' ? 'unknown account' : 'forbidden' }, error instanceof Error && error.message === 'unknown user' ? 404 : 403);
      }
      const visible = managementView ? entries : entries.filter((entry) => entry.effective);
      return jsonRes(visible.map((entry) => describeCatalogEntry(entry, req)));
    },
  });

  ctx.registerApiRoute({
    rootMount: '/plugins/skills/accounts', path: '', method: 'GET', access: 'admin',
    handler: async (req) => {
      if (req.path !== '') return jsonRes({ error: 'not found' }, 404);
      return jsonRes(ctx.host.stores().usersRead.list().map((user) => ({ id: user.id, username: user.username, name: user.name })));
    },
  });

  ctx.registerApiRoute({
    rootMount: '/plugins/skills/plugin-availability', path: '', method: 'PATCH', access: 'admin',
    handler: async (req) => {
      if (req.path !== '') return jsonRes({ error: 'not found' }, 404);
      let body;
      try { body = await req.json(); } catch { body = null; }
      const userId = body?.userId;
      const key = typeof body?.key === 'string' ? body.key : '';
      const enabled = body?.enabled;
      if (!Number.isSafeInteger(userId) || userId <= 0 || key === '' || typeof enabled !== 'boolean') {
        return jsonRes({ error: 'userId, key and enabled are required' }, 400);
      }
      const control = management();
      if (!control) return jsonRes({ error: 'skill management is unavailable; upgrade Elowen core' }, 503);
      const result = await control.setPluginSkillEnabled({ userId, key, enabled });
      if (result.ok) return jsonRes({ ok: true });
      if (result.reason === 'forbidden') return jsonRes({ error: 'forbidden' }, 403);
      if (result.reason === 'unknown-user') return jsonRes({ error: 'unknown account' }, 404);
      if (result.reason === 'invalid-overrides') return jsonRes({ error: 'stored plugin skill overrides are invalid' }, 409);
      return jsonRes({ error: 'unknown plugin skill' }, 400);
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
      if (!NAME_RE.test(name)) return jsonRes({ error: nameError(name) }, 400);
      if (RESERVED_NAMES.has(name)) return jsonRes({ error: `"${name}" is reserved (it collides with a core /plugins route)` }, 400);
      const fieldsError = skillFieldError(description, content);
      if (fieldsError) return jsonRes({ error: fieldsError }, 400);
      const collision = nameCollision(name, target.owner);
      if (collision) return jsonRes({ error: collision }, 400);
      // An overwrite is a legitimate part of this route, but only of the caller's OWN file: writing
      // through a link planted at that name would edit whatever it points at instead.
      const file = join(target.dir, `${name}.md`);
      if (escapesOwnScope(target, file)) return jsonRes({ error: `"${name}" resolves outside that skills directory` }, 409);
      mkdirSync(target.dir, { recursive: true });
      writeFileSync(file, buildSkillBody(applyManagedFields({}, name, description, disableModelInvocation), content), 'utf-8');
      reloadSkills();
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
      const file = targetFileIn(target, name);
      if (!file) return jsonRes({ error: 'unknown skill' }, 404);
      let b;
      try { b = await req.json(); } catch { b = null; }
      const cur = readSkillFile(file);
      const expectedRevision = b?.expectedRevision;
      const currentRevision = skillRevision(cur.front);
      if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
        return jsonRes({ error: 'expectedRevision must be a non-negative integer' }, 400);
      }
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        return jsonRes({ error: 'skill changed on the server; reload it before saving', conflict: true, current: describeSkill(name, file, 'user', target.owner, true) }, 409);
      }
      const description = typeof b?.description === 'string' ? b.description.trim() : cur.description;
      const content = typeof b?.content === 'string' ? b.content : cur.content;
      const disableModelInvocation = typeof b?.disableModelInvocation === 'boolean' ? b.disableModelInvocation : cur.disableModelInvocation;
      const fieldsError = skillFieldError(description, content);
      if (fieldsError) return jsonRes({ error: fieldsError }, 400);
      const fm = applyManagedFields(cur.front, name, description, disableModelInvocation);
      if (description !== cur.description || content !== cur.content) bumpVersion(fm);
      bumpRevision(fm, currentRevision);
      writeFileSync(file, buildSkillBody(fm, content), 'utf-8');
      reloadSkills();
      return jsonRes({ ok: true, revision: skillRevision(fm) });
    },
  });

  ctx.registerApiRoute({
    rootMount: '/plugins/skills/:name', path: '', method: 'DELETE', access: 'user',
    handler: async (req) => {
      if (req.path !== '') return jsonRes({ error: 'not found' }, 404);
      const name = req.params.name ?? '';
      if (!NAME_RE.test(name)) return jsonRes({ error: 'invalid skill name' }, 400);
      const target = resolveTarget(req);
      if (!target.ok) return jsonRes({ error: target.invalid ? 'invalid owner' : 'forbidden' }, target.invalid ? 400 : 403);
      const removed = removeSkill({ name, target: deletionTargetIn(target, name) }, NON_RECURSIVE_DELETE);
      if (removed.error) return jsonRes({ error: removed.error }, removed.status);
      reloadSkills();
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
      const file = targetFileIn(source, name);
      if (!file) return jsonRes({ error: 'unknown skill' }, 404);
      let b;
      try { b = await req.json(); } catch { b = null; }
      const raw = typeof b?.owner === 'string' ? b.owner.trim() : (typeof b?.owner === 'number' ? String(b.owner) : '');
      if (raw === '') return jsonRes({ error: 'owner is required: "instance", "me" or an account id' }, 400);
      const edit = b?.patch && typeof b.patch === 'object' && !Array.isArray(b.patch) ? b.patch : null;
      const expectedRevision = b?.expectedRevision;
      const current = edit ? readSkillFile(file) : null;
      if (edit && expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
        return jsonRes({ error: 'expectedRevision must be a non-negative integer' }, 400);
      }
      if (edit && expectedRevision !== undefined && expectedRevision !== skillRevision(current.front)) {
        return jsonRes({ error: 'skill changed on the server; reload it before saving', conflict: true, current: describeSkill(name, file, 'user', source.owner, true) }, 409);
      }
      const editedDescription = edit && typeof edit.description === 'string' ? edit.description.trim() : current?.description;
      const editedContent = edit && typeof edit.content === 'string' ? edit.content : current?.content;
      const editedDisableModelInvocation = edit && typeof edit.disableModelInvocation === 'boolean'
        ? edit.disableModelInvocation : current?.disableModelInvocation;
      const fieldsError = edit ? skillFieldError(editedDescription, editedContent) : null;
      if (fieldsError) return jsonRes({ error: fieldsError }, 400);
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
      // Directory form travels whole; a flat skill is the single .md file. When an edit accompanies the
      // move, write the destination before exposing success and restore the source if that write fails.
      const dirForm = basename(file).toLowerCase() === 'skill.md';
      const from = dirForm ? dirname(file) : file;
      const to = join(dest.dir, dirForm ? name : `${name}.md`);
      const destinationFile = dirForm ? join(to, 'SKILL.md') : to;
      mkdirSync(dest.dir, { recursive: true });
      try { renameSync(from, to); }
      catch (e) {
        ctx.logger.warn(`could not move skill '${name}': ${e instanceof Error ? e.message : e}`);
        return jsonRes({ error: 'the skill could not be moved' }, 500);
      }
      try {
        if (edit) {
          const fm = applyManagedFields(current.front, name, editedDescription, editedDisableModelInvocation);
          if (editedDescription !== current.description || editedContent !== current.content) bumpVersion(fm);
          bumpRevision(fm, skillRevision(current.front));
          writeFileSync(destinationFile, buildSkillBody(fm, editedContent), 'utf-8');
        }
      } catch (e) {
        try { renameSync(to, from); }
        catch (rollback) { ctx.logger.error(`could not roll back skill '${name}' move: ${rollback instanceof Error ? rollback.message : rollback}`); }
        ctx.logger.warn(`could not edit moved skill '${name}': ${e instanceof Error ? e.message : e}`);
        return jsonRes({ error: 'the skill could not be updated' }, 500);
      }
      reloadSkills(); // it leaves one catalog and enters another
      return jsonRes({ ok: true, owner: dest.owner, ...(edit ? { revision: skillRevision(readSkillFile(destinationFile).front) } : {}) });
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
        if (!NAME_RE.test(p.name)) return ok(`Error: ${nameError(p.name)}.`);
        if (RESERVED_NAMES.has(p.name)) return ok(`Error: "${p.name}" is reserved.`);
        const fieldsError = skillFieldError(p.description, p.content);
        if (fieldsError) return ok(`Error: ${fieldsError}.`);
        // Refuse rather than shadow: a personal skill with an instance skill's name would register twice
        // and the two would fight over the same slot in the prompt.
        const collision = nameCollision(p.name, target.owner);
        if (collision) return ok(`Error: ${collision}.`);
        // Overwriting your own skill is the documented way to edit one, but a link planted at that name
        // would send the write wherever it points — the same guard the HTTP create route applies.
        const file = join(dir, `${p.name}.md`);
        if (escapesOwnScope(target, file)) return ok(`Error: "${p.name}" resolves outside your own skills directory.`);
        // Same serializer as the HTTP create route: a hand-built `description: …` line breaks the YAML
        // parser on ': ' and the skill loads with no description, i.e. without a trigger.
        const body = buildSkillBody(applyManagedFields({}, p.name, p.description, false), p.content);
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, body, 'utf-8');
        // Applied live: the host replaces the skill set in place, so the new skill is in the
        // available-skills block from the next message, with no restart.
        reloadSkills();
        return ok(`Skill "${p.name}" saved (${wantsInstance ? 'instance-wide' : 'personal'}). It is available from your next message.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'ListSkills', label: 'List skills',
    description: [
      'List every skill available in this session — the reusable markdown procedures and workflows the agent can follow — with each name, its scope tag and the one-line description that says when it applies.',
      'Use it to check what know-how is already saved before writing a new skill with CreateSkill, to find the exact name you need for DeleteSkill, or when the user asks what you can do or what instructions you have been given. It takes no parameters.',
      'The live list includes bundled, instance-wide, personal and plugin-contributed skills after account grants and plugin-skill overrides are applied. It never reveals another account’s private skills or unavailable contributions. Entries flagged "/skill only" are hidden from automatic matching and run only when invoked explicitly; the listing shows names and descriptions, not the full instruction bodies, so use SkillLoad when you need the steps.',
    ].join(' '),
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const control = ctx.control?.('skillCatalog');
        if (!control || typeof control.visibleEntries !== 'function') {
          return ok('Error: the live skill catalog is unavailable; upgrade Elowen core.');
        }
        const rows = control.visibleEntries().map((entry) => {
          const tag = entry.source === 'plugin' ? `plugin:${entry.contributorPlugin}` : entry.source;
          const flags = entry.skill.disableModelInvocation ? ', /skill only' : '';
          return `- ${entry.skill.name} (${tag}${flags}) — ${entry.skill.description}`;
        });
        return ok(rows.length ? rows.join('\n') : 'No skills found.');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DeleteSkill', label: 'Delete skill',
    description: [
      'Permanently delete a saved skill by name, removing that reusable procedure from the agent instructions from the next message onward.',
      'Use it when a stored workflow is obsolete, wrong or was superseded — for example after the user says to forget a procedure. To change a skill rather than drop it, call CreateSkill with the same name to overwrite it, and use ListSkills first to confirm the exact name.',
      'Your own personal skills are removed directly; deleting an instance-wide skill that every session sees requires an admin session, and bundled skills that ship with the plugin cannot be deleted at all. Both flat "<name>.md" files and directory-form skills are handled. For a directory skill, only SKILL.md is removed; support files in the folder are preserved.',
      'Removing the skill definition is irreversible: it is unlinked with no backup and no undo, so confirm before deleting somebody elses shared skill. A name you may not touch, and a name that does not exist, return the same refusal.',
    ].join(' '),
    parameters: Type.Object({ name: Type.String({ description: 'The exact kebab-case skill name to delete, as shown by ListSkills, e.g. "deploy-checklist"' }) }),
    execute: async (_id, p) => {
      try {
        if (!NAME_RE.test(p.name)) return ok('Error: invalid skill name.');
        const me = callerId();
        // Personal first — an instance skill of the same name cannot exist (writes refuse it), so the order
        // only decides which directory is searched first, not which of two copies is hit.
        const personalTarget = me === null ? null : { owner: me, dir: userSkillsDir(me) };
        let deletion = personalTarget === null ? null : deletionTargetIn(personalTarget, p.name);
        if (deletion === null) {
          const instanceTarget = { owner: null, dir: instanceDir };
          deletion = deletionTargetIn(instanceTarget, p.name);
          if (deletion?.file && isPersonalPath(deletion.file)) deletion = null;
          if (deletion !== null) adminOnly();
        }
        const removed = removeSkill({ name: p.name, target: deletion }, NON_RECURSIVE_DELETE);
        if (removed.error) {
          const message = removed.status === 404 ? `no skill named "${p.name}" that you can delete` : removed.error;
          return ok(`Error: ${message}.`);
        }
        reloadSkills(); // the skill leaves the catalog from the next message
        return ok(`Skill "${p.name}" deleted.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.logger.info(`registered ${registrations.length} skill(s) + loader and management tools`);
}
