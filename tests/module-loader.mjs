import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sharedRoot = process.env.ELOWEN_SHARED_PACKAGE_ROOT?.trim();
const stubs = new Map([
  ['@earendil-works/pi-coding-agent', new URL('./stubs/pi-coding-agent.mjs', import.meta.url).href],
  ['typebox', new URL('./stubs/typebox.mjs', import.meta.url).href],
]);

export async function resolve(specifier, context, nextResolve) {
  const stub = stubs.get(specifier);
  if (stub) return { url: stub, shortCircuit: true };
  if (sharedRoot && specifier.startsWith('elowen-plugin-shared/')) {
    return { url: pathToFileURL(join(sharedRoot, `${specifier.slice('elowen-plugin-shared/'.length)}.mjs`)).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
