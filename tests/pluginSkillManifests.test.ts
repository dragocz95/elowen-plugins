// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

/** A plugin that owns tools ships the skill teaching the model to use them, next to the tools rather
 *  than in the skills plugin — otherwise the instruction outlives its tools and tells the model to call
 *  something nothing answers. The Elowen package holds the same rule for its bundled plugins.
 *
 *  Three things have to agree and nothing else checks them: the manifest's `provides.skills` claim, the
 *  markdown file actually parsing into a skill of that name, and the registration call that puts it in
 *  front of the model. Break any one and the plugin still loads clean — the model just never learns the
 *  tools exist. */
const registryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(registryRoot, 'plugins');

interface Manifest { entry?: string; provides?: { skills?: string[] } }

const declaring = readdirSync(pluginsDir)
  .filter((name) => existsSync(join(pluginsDir, name, 'elowen-plugin.json')))
  .map((name) => {
    const manifest = JSON.parse(readFileSync(join(pluginsDir, name, 'elowen-plugin.json'), 'utf-8')) as Manifest;
    return {
      name,
      // The file the daemon actually loads. A TypeScript plugin points this at its compiled
      // `dist/index.js`; assuming `index.mjs` would read a file that does not exist there.
      entry: manifest.entry ?? 'index.mjs',
      skills: (manifest.provides?.skills ?? [])
        // '*' is the skills plugin declaring "whatever is in my dir" — a capability, not a named skill.
        .filter((skill) => skill !== '*'),
    };
  })
  .filter((p) => p.skills.length > 0);

describe('a plugin that declares skills ships them', () => {
  it('finds the declaring plugins from their manifests', () => {
    // Read from disk so a new plugin is covered the moment it lands — and an empty read would make
    // every case below pass by doing nothing.
    expect(declaring.map((p) => p.name).sort()).toEqual(['cronjob']);
  });

  it.each(declaring)('$name has every declared skill on disk, loadable, under the declared name', ({ name, skills }) => {
    const dir = join(pluginsDir, name, 'skills');
    expect(existsSync(dir), `${name} declares skills but has no skills/ dir`).toBe(true);
    const loaded = loadSkillsFromDir({ dir, source: `elowen-plugin:${name}` }).skills.map((s) => s.name);
    for (const skill of skills) expect(loaded, `${name} declares ${skill}`).toContain(skill);
  });

  it.each(declaring)('$name registers what it declares, not merely ships it', ({ name, entry, skills }) => {
    // Read the ENTRY the manifest names, not a fixed filename: for a TypeScript plugin that is the
    // compiled artefact the marketplace installs, so this asserts against what actually runs.
    const source = readFileSync(join(pluginsDir, name, entry), 'utf-8');
    expect(source, `${name} declares ${skills.join(', ')} but never calls ctx.registerSkill`)
      .toMatch(/registerSkill\(/);
  });
});
