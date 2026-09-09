// Fixtures for the Sandbox-owned container driver boundary. The concrete Podman driver now lives in the
// Sandbox plugin (the installed elowen SDK's plugins/sandbox/lib — read-only runtime source
// referenced by the linked environments checkout); these fixtures drive the REAL driver classes with an
// injected fake executor so no real engine, isolation namespace or account-default storage is ever used.
//
// Dependency statement: this suite preserves the driver-level invariants that used to live in the Sites
// PodmanClient tests. It imports the actual Sandbox driver source; when the parent combines the real
// runtime this file keeps working, and the import path is the only Sites-side coupling. It resolves
// through the installed SDK, the way every other podman-backed test here does: an absolute path into a
// task worktree stops resolving the moment that worktree is merged and removed.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PodmanClient, SpawnExecutor, cleanPodmanEnv } from 'elowen/plugins/sandbox/lib/podman.mjs';
import { createBoundSiteSpec } from 'elowen/plugins/sandbox/lib/containerSpec.mjs';

export { PodmanClient, SpawnExecutor, cleanPodmanEnv };

const SITE_ID = '123e4567-e89b-12d3-a456-426614174000';

export const IMAGE = 'localhost/elowen-site-base:0123456789abcdef';

/** A trusted host-derived Sites binding spec, built in a private temporary root. */
export function makeSiteSpec(root, overrides = {}) {
  const sitesDataDir = join(root, 'sites-data');
  const sourcePath = overrides.sourcePath ?? join(sitesDataDir, 'sources', SITE_ID);
  const brokerDir = join(root, 'broker');
  mkdirSync(sourcePath, { recursive: true });
  mkdirSync(brokerDir, { recursive: true });
  const spec = createBoundSiteSpec({
    resource: { kind: 'site', id: SITE_ID },
    generation: 1,
    image: IMAGE,
    limits: { cpus: 1.5, memoryMb: 768, pidsLimit: 300 },
    network: overrides.network ?? 'shared',
    workspaceReadOnly: false,
  }, { sitesDataDir, sourcePath, brokerDir });
  // The spec derives its storage root from the trusted binding; create the paths the driver validates.
  mkdirSync(join(spec.storageRoot, 'storage', '1', 'data'), { recursive: true });
  writeFileSync(join(spec.storageRoot, 'git-stub'), '', { mode: 0o400 });
  writeFileSync(join(spec.storageRoot, 'container.env'), '', { mode: 0o600 });
  return spec;
}

export function makeDriverRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'sites-driver-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  return root;
}

/** An executor that dispatches on argv matchers instead of a fixed call order, so each invariant names
 * its own responses. `reply` may be a value or a queue consumed per matching call. */
export class FakeExecutor {
  calls = [];
  #handlers = [];

  on(match, reply) {
    this.#handlers.push({ match, reply });
    return this;
  }

  async run(file, args, options) {
    this.calls.push({ file, args, options });
    for (const handler of this.#handlers) {
      if (handler.match(args, options)) {
        let reply = handler.reply;
        if (typeof reply === 'function') reply = reply(args, options, this.calls.length);
        else if (Array.isArray(reply)) {
          if (reply.length === 0) throw new Error(`Scripted reply queue exhausted for: podman ${args.join(' ')}`);
          reply = reply.shift();
        }
        return { stdout: '', stderr: '', code: 0, ...reply };
      }
    }
    throw new Error(`Unexpected executor call: podman ${args.join(' ')}`);
  }
}

/** A representative Podman 4.9 `inspect --type container` row in its uppercase field naming, matching
 * exactly what the driver's ownership validation expects for this spec and state. */
export const inspectRow = (spec, state = 'running') => ({
  Id: 'a'.repeat(64),
  Name: `/${spec.name}`,
  ImageName: spec.image,
  Image: `sha256:${'b'.repeat(64)}`,
  Config: { Labels: { ...spec.labels } },
  State: { Status: state },
  Mounts: spec.mounts.map((mount) => mount.type === 'volume'
    ? { Type: 'volume', Destination: mount.target, RW: !mount.readOnly, Name: mount.source }
    : { Type: 'bind', Destination: mount.target, RW: !mount.readOnly, Source: mount.source }),
  HostConfig: {
    NetworkMode: spec.network === 'none' ? 'none' : 'slirp4netns',
    NanoCpus: spec.limits.cpus * 1e9,
    Memory: spec.limits.memoryMb * 1024 * 1024,
    MemorySwap: spec.limits.memoryMb * 1024 * 1024,
    PidsLimit: spec.limits.pidsLimit,
    Privileged: false,
    ReadonlyRootfs: false,
    CapAdd: [],
    Devices: [],
    SecurityOpt: [],
    PidMode: '',
    IpcMode: spec.ipcMode,
    PortBindings: {},
  },
});

/** A `volume inspect` row for one storage component of the spec. */
export const volumeInspectRow = (spec, component) => {
  const volume = spec.volumes.find((entry) => entry.component === component);
  const labels = component === 'data' && spec.legacy
    ? { 'io.elowen.site': spec.resource.id }
    : {
      'io.elowen.runtime': 'sandbox', 'io.elowen.namespace': spec.namespace,
      'io.elowen.resource': `site:${spec.resource.id}`,
      'io.elowen.generation': String(spec.generation), 'io.elowen.component': component,
    };
  return {
    Name: volume.name, Driver: 'local', Labels: labels, Mountpoint: volume.path,
    Options: spec.legacy ? {} : { type: 'none', o: 'bind', device: volume.path },
  };
};
