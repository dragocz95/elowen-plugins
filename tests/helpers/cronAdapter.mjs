/**
 * Wire a cron adapter the way the HOST does, and route its synthetic turns to `handler`.
 *
 * A platform adapter has two entries: `listen` carries ordinary ingress, `control` the out-of-band
 * relay. The scheduler runs its scheduled and manual work through `control().relay` — the only entry
 * that stamps host-relay provenance, and therefore the only one that files the job's transcript under
 * the account that scheduled it — so a suite that wired only `listen` would observe no turn at all.
 * Both entries point at the same handler here, which keeps every assertion about the turn itself
 * meaningful; a suite that needs to prove WHICH entry was used wires the two separately.
 *
 * Plain ESM, because both runners use it: `node --test` for the `.mjs` suites and vitest for the `.ts`
 * ones. The suites are transpiled rather than type-checked, so the JDOC types are documentation.
 *
 * @param {{ listen: (handler: Function) => void, control: (api: { relay: Function }) => void }} adapter
 * @param {Function} handler `(src, text, onEvent?) => Promise<string | undefined>`
 */
export function wireCronHost(adapter, handler) {
  adapter.listen(handler);
  adapter.control({ relay: (src, text, observer) => handler(src, text, observer?.onEvent) });
}
