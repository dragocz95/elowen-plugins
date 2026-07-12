const stubs = new Map([
  ['@earendil-works/pi-coding-agent', new URL('./stubs/pi-coding-agent.mjs', import.meta.url).href],
  ['typebox', new URL('./stubs/typebox.mjs', import.meta.url).href],
]);

export async function resolve(specifier, context, nextResolve) {
  const stub = stubs.get(specifier);
  return stub ? { url: stub, shortCircuit: true } : nextResolve(specifier, context);
}
