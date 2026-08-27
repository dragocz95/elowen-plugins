import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.ELOWEN_LANGUAGES_ROOT
  ? resolve(process.env.ELOWEN_LANGUAGES_ROOT)
  : fileURLToPath(new URL('..', import.meta.url));
const pluginsDir = join(root, 'plugins');
const requiredLocales = ['cs', 'sk'];
const errors = [];

const pluginNames = readdirSync(pluginsDir)
  .filter((name) => statSync(join(pluginsDir, name)).isDirectory())
  .filter((name) => existsSync(join(pluginsDir, name, 'elowen-plugin.json')))
  .sort();

const hasText = (value) => typeof value === 'string' && value.trim() !== '';
const asFields = (value) => Array.isArray(value) ? value : [];

for (const name of pluginNames) {
  const dir = join(pluginsDir, name);
  const manifestFile = join(dir, 'elowen-plugin.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch {
    errors.push(`plugin ${name}: elowen-plugin.json is not valid JSON`);
    continue;
  }

  // Instance and account settings share the same translation namespace. Keeping both here is
  // deliberate: checking configSchema alone silently misses every userConfigSchema label and option.
  const schema = [...asFields(manifest.configSchema), ...asFields(manifest.userConfigSchema)];
  const fieldByKey = new Map();
  for (const field of schema) {
    if (fieldByKey.has(field.key)) errors.push(`plugin ${name}: duplicate settings field key "${field.key}"`);
    fieldByKey.set(field.key, field);
  }

  for (const locale of requiredLocales) {
    const file = join(dir, 'i18n', `${locale}.json`);
    if (!existsSync(file)) {
      errors.push(`plugin ${name}: missing i18n/${locale}.json`);
      continue;
    }

    let i18n;
    try {
      i18n = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      errors.push(`plugin ${name}: i18n/${locale}.json is not valid JSON`);
      continue;
    }

    for (const key of Object.keys(i18n)) {
      if (!['description', 'fields', 'web'].includes(key)) {
        errors.push(`plugin ${name} (${locale}): unknown top-level key "${key}"`);
      }
    }

    if (hasText(manifest.description) && !hasText(i18n.description)) {
      errors.push(`plugin ${name} (${locale}): missing description translation`);
    }
    if (hasText(i18n.description) && !hasText(manifest.description)) {
      errors.push(`plugin ${name} (${locale}): description has no matching manifest description`);
    }

    for (const [key, override] of Object.entries(i18n.fields ?? {})) {
      const field = fieldByKey.get(key);
      if (!field) {
        errors.push(`plugin ${name} (${locale}): fields.${key} has no matching settings field`);
        continue;
      }
      for (const part of Object.keys(override ?? {})) {
        if (!['label', 'hint', 'options'].includes(part)) {
          errors.push(`plugin ${name} (${locale}): unknown fields.${key}.${part} key`);
        }
      }
      if (hasText(override?.label) && !hasText(field.label)) {
        errors.push(`plugin ${name} (${locale}): fields.${key}.label has no matching manifest label`);
      }
      if (hasText(override?.hint) && !hasText(field.hint)) {
        errors.push(`plugin ${name} (${locale}): fields.${key}.hint has no matching manifest hint`);
      }
      const optionValues = new Set(asFields(field.options).map((option) => String(option.value)));
      for (const value of Object.keys(override?.options ?? {})) {
        if (!optionValues.has(value)) {
          errors.push(`plugin ${name} (${locale}): fields.${key}.options.${value} has no matching manifest option`);
        }
      }
    }

    for (const field of schema) {
      const override = i18n.fields?.[field.key];
      if (hasText(field.label) && !hasText(override?.label)) {
        errors.push(`plugin ${name} (${locale}): missing fields.${field.key}.label`);
      }
      if (hasText(field.hint) && !hasText(override?.hint)) {
        errors.push(`plugin ${name} (${locale}): missing fields.${field.key}.hint`);
      }
      for (const option of asFields(field.options)) {
        if (hasText(option.label) && !hasText(override?.options?.[String(option.value)])) {
          errors.push(`plugin ${name} (${locale}): missing fields.${field.key}.options.${option.value}`);
        }
      }
    }

    const web = i18n.web ?? {};
    for (const key of Object.keys(web)) {
      if (!['label', 'nav', 'account', 'user', 'project', 'settings', 'strings'].includes(key)) {
        errors.push(`plugin ${name} (${locale}): unknown web key "${key}"`);
      }
    }

    if (hasText(manifest.web?.label) && !hasText(web.label)) {
      errors.push(`plugin ${name} (${locale}): missing web.label translation`);
    }
    if (hasText(web.label) && !hasText(manifest.web?.label)) {
      errors.push(`plugin ${name} (${locale}): web.label has no matching manifest web.label`);
    }

    const checkSections = (kind, declaredEntries, translated = {}) => {
      const declared = new Set(declaredEntries.map((entry) => String(entry.id)));
      for (const id of Object.keys(translated)) {
        if (!declared.has(id)) errors.push(`plugin ${name} (${locale}): web.${kind}.${id} has no matching manifest id`);
      }
      for (const entry of declaredEntries) {
        if (hasText(entry.label) && !hasText(translated[String(entry.id)])) {
          errors.push(`plugin ${name} (${locale}): missing web.${kind}.${entry.id} translation`);
        }
      }
    };

    const navEntries = asFields(manifest.web?.nav);
    const navRoutes = new Map(navEntries.map((entry) => [String(entry.route ?? ''), entry]));
    for (const route of Object.keys(web.nav ?? {})) {
      if (!navRoutes.has(route)) errors.push(`plugin ${name} (${locale}): web.nav["${route}"] has no matching manifest route`);
    }
    for (const [route, entry] of navRoutes) {
      if (hasText(entry.label) && !hasText(web.nav?.[route])) {
        errors.push(`plugin ${name} (${locale}): missing web.nav["${route}"] translation`);
      }
    }

    checkSections('account', asFields(manifest.web?.account), web.account);
    checkSections('user', asFields(manifest.web?.user), web.user);
    checkSections('project', asFields(manifest.web?.project), web.project);
    checkSections('settings', asFields(manifest.web?.settings), web.settings);

    const webStrings = manifest.web?.strings ?? {};
    for (const key of Object.keys(web.strings ?? {})) {
      if (!(key in webStrings)) errors.push(`plugin ${name} (${locale}): web.strings.${key} has no matching manifest key`);
    }
    for (const [key, fallback] of Object.entries(webStrings)) {
      if (hasText(fallback) && !hasText(web.strings?.[key])) {
        errors.push(`plugin ${name} (${locale}): missing web.strings.${key} translation`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`languages-check: ${errors.length} problem(s)\n`);
  for (const error of errors) console.error(`  x ${error}`);
  process.exit(1);
}

console.log(`languages-check: OK - ${pluginNames.length} plugin(s), locales [${requiredLocales.join(', ')}]`);
