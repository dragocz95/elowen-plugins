import { request as httpRequest } from 'node:http';
import type { Site, SitesStore } from './store.js';
import type { Endpoint } from './runtime.js';

export interface PublicationControl {
  projectPublicationBinding(input: {
    project: { kind: 'managed'; projectId: number };
    publicationId: string;
    port: number;
  }): Promise<{ socketPath: string; generation: number }>;
  projectPublicationRelease(input: {
    project: { kind: 'managed'; projectId: number };
    publicationId: string;
  }): Promise<void>;
}

/** How long an unhealthy publication waits before the Project's environment is asked for its transport
 *  again. The probe in between is cheap — a connect to a unix socket — while establishing a transport
 *  costs guest round trips, so a broken publication must not pay for one on every reconcile tick. */
const RETRY_MS = 15_000;
/** A publication request is a visitor's request, so it is allowed the transport's ordinary patience. The
 *  reconcile probe is not: it only has to notice that something is wrong. */
const REQUEST_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 2_000;

export interface PublicationDeps {
  store: SitesStore;
  /** The durable transport seam, absent on a daemon whose Sandbox does not offer it. */
  control(): PublicationControl | undefined;
  project(id: number): { executionKind: string; lifecycle: string } | null | undefined;
  logger?: { warn(message: string): void };
}

export interface PublicationProbe {
  /** Whether the transport itself answered. What it ANSWERED is a different question, reported by
   *  `status` so a caller that cares (a publish) can judge it and a caller that does not (a reconcile)
   *  can leave it alone. */
  answered: boolean;
  status: number | null;
  detail: string;
}

export interface ProjectEnvironmentView {
  state: string | null;
  lastError: string | null;
}

/** The port a proxy publication's application listens on inside the Project, or null when the stored
 *  target cannot be one. A row in that state is not published, and guessing it a port would be inventing
 *  a transport for whoever happens to hold that port inside the container. */
export function publicationPort(site: Site): number | null {
  if (!/^\d+$/.test(site.target.trim())) return null;
  const port = Number(site.target.trim());
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** The transport half of a proxy publication.
 *
 *  Deliberately not a supervisor: the container, its cgroup and its lifecycle belong to Sandbox, and a
 *  publication is a durable record plus a forwarder that Sandbox keeps alive. What this owns is the
 *  plugin's own half — asking for the transport when it is missing or stale, remembering where it
 *  answers so a request can be proxied, and ending it when the publication is deleted. */
export class ProjectPublicationService {
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly nextAttempt = new Map<string, number>();

  constructor(private readonly deps: PublicationDeps) {}

  /** Where this publication answers right now, or null when nothing has adopted it yet. */
  endpointFor(siteId: string): Endpoint | null {
    return this.endpoints.get(siteId) ?? null;
  }

  /** Only a managed Project has an environment to publish from. */
  private projectRef(site: Site): { kind: 'managed'; projectId: number } {
    const project = this.deps.project(site.projectId);
    if (!project || project.executionKind !== 'managed' || project.lifecycle !== 'active') {
      throw new Error(`Project ${site.projectId} is not an active managed Project, so it has no environment to publish from`);
    }
    return { kind: 'managed', projectId: site.projectId };
  }

  private managed(site: Site): boolean {
    const project = this.deps.project(site.projectId);
    return project?.executionKind === 'managed';
  }

  /** Ask the Project's environment for the durable transport of this publication.
   *
   *  Idempotent by construction: the seam records the publication and then (re)establishes its
   *  forwarder, removing whatever socket file it finds first. That is why a socket left behind by a
   *  container that ended is never read as evidence that a forwarder is running. */
  async establish(site: Site): Promise<{ socketPath: string; generation: number }> {
    const control = this.deps.control();
    if (!control?.projectPublicationBinding) {
      throw new Error('the Sandbox publication transport is unavailable on this instance');
    }
    const port = publicationPort(site);
    if (port === null) throw new Error(`publication ${site.id} has no usable port`);
    const binding = await control.projectPublicationBinding({
      project: this.projectRef(site),
      publicationId: site.id,
      port,
    });
    if (typeof binding?.socketPath !== 'string' || binding.socketPath === '') {
      throw new Error('the publication transport answered without a socket');
    }
    return { socketPath: binding.socketPath, generation: binding.generation };
  }

  /** End the transport of a publication that is going away.
   *
   *  A Project that is no longer managed has nowhere this publication could be running, so there is
   *  nothing to end and nothing to fail a deletion over. Anything else propagates, because a transport
   *  that cannot be stopped is a forwarder still answering for a site that no longer exists — and the
   *  same durable delete marker that got us here retries until it is gone. */
  async release(site: Site): Promise<void> {
    this.endpoints.delete(site.id);
    this.nextAttempt.delete(site.id);
    if (!this.managed(site)) return;
    const control = this.deps.control();
    if (!control?.projectPublicationRelease) return;
    await control.projectPublicationRelease({
      project: { kind: 'managed', projectId: site.projectId },
      publicationId: site.id,
    });
  }

  /** Remember where a publication answers, without asking the environment for anything.
   *
   *  Used by a caller that has just established the transport itself, so the very next visitor request
   *  is served through it instead of waiting for the next sweep. */
  adopt(siteId: string, socketPath: string): void {
    this.endpoints.set(siteId, { kind: 'socket', path: socketPath });
  }

  /** One HTTP request through the publication transport — the same path a visitor's request takes. */
  async probe(socketPath: string, options: { path?: string; timeoutMs?: number } = {}): Promise<PublicationProbe> {
    const path = options.path ?? '/';
    const status = await new Promise<number | string>(done => {
      const req = httpRequest({
        socketPath,
        path,
        headers: { host: 'localhost', 'user-agent': 'elowen-publication-readiness' },
        timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
      }, response => {
        // The body is never read: the status is the whole answer, and a publication may stream something
        // far larger than the daemon should hold.
        response.resume();
        done(response.statusCode ?? 0);
      });
      req.once('error', error => done(error.message));
      req.once('timeout', () => { req.destroy(); done('timed out'); });
      req.end();
    });
    return typeof status === 'number'
      ? { answered: true, status, detail: `GET ${path} answered ${status}` }
      : { answered: false, status: null, detail: status };
  }

  /** Keep every published proxy publication answerable.
   *
   *  The REMEMBERED transport is probed first, because that is one connect with nothing else attached.
   *  Only when it does not answer is the environment asked again, and then at most once per {@link
   *  RETRY_MS}: a container rebuilt for a new generation answers on a different socket, while an
   *  application that is merely down is a condition the environment cannot fix by being asked harder. */
  async reconcile(): Promise<void> {
    for (const site of this.deps.store.proxySitesForReconcile()) {
      const known = this.endpoints.get(site.id);
      if (known?.kind === 'socket') {
        const probe = await this.probe(known.path, { timeoutMs: PROBE_TIMEOUT_MS });
        if (probe.answered) {
          if (probe.status !== null && probe.status < 500) this.settle(site);
          else this.fail(site, probe.detail);
          continue;
        }
        this.endpoints.delete(site.id);
      }
      const due = this.nextAttempt.get(site.id) ?? 0;
      if (Date.now() < due) continue;
      try {
        const binding = await this.establish(site);
        const probe = await this.probe(binding.socketPath, { timeoutMs: PROBE_TIMEOUT_MS });
        if (!probe.answered) throw new Error(probe.detail);
        this.endpoints.set(site.id, { kind: 'socket', path: binding.socketPath });
        this.nextAttempt.delete(site.id);
        if (probe.status !== null && probe.status < 500) this.settle(site);
        else this.fail(site, probe.detail);
      } catch (error) {
        this.nextAttempt.set(site.id, Date.now() + RETRY_MS);
        this.fail(site, error instanceof Error ? error.message : String(error));
      }
    }
  }

  /** Keep the address published while making an unhealthy application visible to the operator. */
  private fail(site: Site, message: string): void {
    const current = this.deps.store.siteById(site.id);
    if (current && current.lastError !== message) this.deps.store.updateSite(site.id, { lastError: message });
    this.deps.logger?.warn(`site ${site.slug} publication is not answering: ${message}`);
  }

  /** A publication whose application answers again owes the operator no stale error — and a publish that
   *  was refused because the application had not started yet is not a permanent verdict: the row becomes
   *  live the moment the application it points at does. */
  private settle(site: Site): void {
    const current = this.deps.store.siteById(site.id);
    if (!current) return;
    if (current.status === 'failed' || current.lastError !== null) {
      this.deps.store.updateSite(site.id, { status: 'live', lastError: null });
    }
  }
}
