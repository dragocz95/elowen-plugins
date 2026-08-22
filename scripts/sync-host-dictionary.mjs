import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const registryRoot = resolve(import.meta.dirname, '..');
const targetPath = join(registryRoot, 'tests', 'ui', 'hostDictionary.ts');
const requireFromHere = createRequire(import.meta.url);
const packageRoot = dirname(requireFromHere.resolve('elowen/package.json'));

function objectLiteralAt(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

function looksLikeDictionaries(value) {
  return value
    && typeof value === 'object'
    && ['en', 'cs', 'sk'].every((locale) => value[locale] && typeof value[locale] === 'object')
    && typeof value.en?.nav?.home === 'string';
}

function extractPackagedDictionaries() {
  const roots = [
    join(packageRoot, 'web-dist', '.next', 'static', 'chunks'),
    join(packageRoot, 'web-dist', '.next', 'server', 'chunks', 'ssr'),
  ];
  for (const dir of roots) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.js')) continue;
      const source = readFileSync(join(dir, name), 'utf8');
      for (let at = source.indexOf('{en:{'); at >= 0; at = source.indexOf('{en:{', at + 1)) {
        const literal = objectLiteralAt(source, at);
        if (!literal || literal.length < 10_000) continue;
        try {
          const value = runInNewContext(`(${literal})`, Object.create(null), { timeout: 5_000 });
          if (looksLikeDictionaries(value)) return value;
        } catch {
          // Keep scanning emitted chunks; unrelated object literals may share the same prefix.
        }
        at += literal.length - 1;
      }
    }
  }
  throw new Error(`Could not recover the dictionary from elowen at ${packageRoot}`);
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  throw new Error(`Unsupported dictionary property name: ${node.getText()}`);
}

function unwrapExpression(node) {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    node = node.expression;
  }
  return node;
}

function exportedObject(sourceFile, exportName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
      const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
      if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
        throw new Error(`${exportName} is not initialized with an object literal`);
      }
      return initializer;
    }
  }
  throw new Error(`Could not find export const ${exportName}`);
}

function stringLiteral(value, original) {
  const quote = original.startsWith('"') ? '"' : "'";
  if (quote === '"') return JSON.stringify(value);
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')}'`;
}

function removalRange(property, source) {
  let end = property.end;
  while (end < source.length && /[ \t]/.test(source[end])) end++;
  if (source[end] === ',') end++;
  return { start: property.getFullStart(), end };
}

function collectEdits(object, authoritative, source, path, edits) {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) throw new Error(`Unsupported dictionary member: ${property.getText()}`);
    const key = propertyName(property.name);
    const childPath = path ? `${path}.${key}` : key;
    if (!(key in authoritative)) {
      edits.push({ ...removalRange(property, source), text: '', path: childPath, kind: 'removed' });
      continue;
    }

    const initializer = unwrapExpression(property.initializer);
    if (ts.isObjectLiteralExpression(initializer)) {
      if (!authoritative[key] || typeof authoritative[key] !== 'object') {
        throw new Error(`${childPath} is not an object in the packaged dictionary`);
      }
      collectEdits(initializer, authoritative[key], source, childPath, edits);
      continue;
    }

    if (!ts.isStringLiteralLike(initializer)) throw new Error(`${childPath} is not a string literal in the copy`);
    if (typeof authoritative[key] !== 'string') throw new Error(`${childPath} is not a string in the packaged dictionary`);
    if (initializer.text !== authoritative[key]) {
      edits.push({
        start: initializer.getStart(),
        end: initializer.end,
        text: stringLiteral(authoritative[key], initializer.getText()),
        path: childPath,
        kind: 'updated',
      });
    }
  }
}

const source = readFileSync(targetPath, 'utf8');
const sourceFile = ts.createSourceFile(targetPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const packaged = extractPackagedDictionaries();
const edits = [];
collectEdits(exportedObject(sourceFile, 'en'), packaged.en, source, 'en', edits);
collectEdits(exportedObject(sourceFile, 'cs'), packaged.cs, source, 'cs', edits);

let output = source;
for (const edit of edits.sort((a, b) => b.start - a.start)) {
  output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
}
writeFileSync(targetPath, output);
const removed = edits.filter((edit) => edit.kind === 'removed').length;
const updated = edits.filter((edit) => edit.kind === 'updated').length;
const version = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
console.log(`Synced ${targetPath} from elowen@${version}: ${updated} strings updated, ${removed} keys removed`);
