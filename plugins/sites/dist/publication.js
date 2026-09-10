import { request as httpRequest } from 'node:http';
/** How long an unhealthy publication waits before the Project's environment is asked for its transport
 *  again. The probe in between is cheap — a connect to a unix socket — while establishing a transport
 *  costs guest round trips, so a broken publication must not pay for one on every reconcile tick. */
const RETRY_MS = 15_000;
/** A publication request is a visitor's request, so it is allowed the transport's ordinary patience. The
 *  reconcile probe is not: it only has to notice that something is wrong. */
const REQUEST_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 2_000;
/** The port a proxy publication's application listens on inside the Project, or null when the stored
 *  target cannot be one. A row in that state is not published, and guessing it a port would be inventing
 *  a transport for whoever happens to hold that port inside the container. */
export function publicationPort(site) {
    if (!/^\d+$/.test(site.target.trim()))
        return null;
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
    deps;
    endpoints = new Map();
    nextAttempt = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    /** Where this publication answers right now, or null when nothing has adopted it yet. */
    endpointFor(siteId) {
        return this.endpoints.get(siteId) ?? null;
    }
    /** Only a managed Project has an environment to publish from. */
    projectRef(site) {
        const project = this.deps.project(site.projectId);
        if (!project || project.executionKind !== 'managed' || project.lifecycle !== 'active') {
            throw new Error(`Project ${site.projectId} is not an active managed Project, so it has no environment to publish from`);
        }
        return { kind: 'managed', projectId: site.projectId };
    }
    managed(site) {
        const project = this.deps.project(site.projectId);
        return project?.executionKind === 'managed';
    }
    /** Ask the Project's environment for the durable transport of this publication.
     *
     *  Idempotent by construction: the seam records the publication and then (re)establishes its
     *  forwarder, removing whatever socket file it finds first. That is why a socket left behind by a
     *  container that ended is never read as evidence that a forwarder is running. */
    async establish(site) {
        const control = this.deps.control();
        if (!control?.projectPublicationBinding) {
            throw new Error('the Sandbox publication transport is unavailable on this instance');
        }
        const port = publicationPort(site);
        if (port === null)
            throw new Error(`publication ${site.id} has no usable port`);
        const binding = await control.projectPublicationBinding({
            project: this.projectRef(site),
            accountUserId: site.ownerUserId,
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
    async release(site) {
        this.endpoints.delete(site.id);
        this.nextAttempt.delete(site.id);
        if (!this.managed(site))
            return;
        const control = this.deps.control();
        if (!control?.projectPublicationRelease)
            return;
        await control.projectPublicationRelease({
            project: { kind: 'managed', projectId: site.projectId },
            accountUserId: site.ownerUserId,
            publicationId: site.id,
        });
    }
    /** Remember where a publication answers, without asking the environment for anything.
     *
     *  Used by a caller that has just established the transport itself, so the very next visitor request
     *  is served through it instead of waiting for the next sweep. */
    adopt(siteId, socketPath) {
        this.endpoints.set(siteId, { kind: 'socket', path: socketPath });
    }
    /** One HTTP request through the publication transport — the same path a visitor's request takes. */
    async probe(socketPath, options = {}) {
        const path = options.path ?? '/';
        const status = await new Promise(done => {
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
    async reconcile() {
        for (const site of this.deps.store.proxySitesForReconcile()) {
            const known = this.endpoints.get(site.id);
            if (known?.kind === 'socket') {
                const probe = await this.probe(known.path, { timeoutMs: PROBE_TIMEOUT_MS });
                if (probe.answered) {
                    this.settle(site);
                    continue;
                }
                this.endpoints.delete(site.id);
            }
            const due = this.nextAttempt.get(site.id) ?? 0;
            if (Date.now() < due)
                continue;
            try {
                const binding = await this.establish(site);
                const probe = await this.probe(binding.socketPath, { timeoutMs: PROBE_TIMEOUT_MS });
                if (!probe.answered)
                    throw new Error(probe.detail);
                this.endpoints.set(site.id, { kind: 'socket', path: binding.socketPath });
                this.nextAttempt.delete(site.id);
                this.settle(site);
            }
            catch (error) {
                this.nextAttempt.set(site.id, Date.now() + RETRY_MS);
                const message = error instanceof Error ? error.message : String(error);
                // A publication that has been published stays published. Its address exists and the row is what
                // says so; an application that stopped answering is reported through `lastError` and the visitor
                // gets a 503 from the serving path, where demoting the row to `failed` would answer 404 for an
                // address that does exist. A publication that was never verified is different: `draft` is already
                // not served, and `failed` is where a refused publish puts it.
                const current = this.deps.store.siteById(site.id);
                if (current && current.lastError !== message) {
                    this.deps.store.updateSite(site.id, { lastError: message });
                }
                this.deps.logger?.warn(`site ${site.slug} publication is not answering: ${message}`);
            }
        }
    }
    /** A publication whose application answers again owes the operator no stale error — and a publish that
     *  was refused because the application had not started yet is not a permanent verdict: the row becomes
     *  live the moment the application it points at does. */
    settle(site) {
        const current = this.deps.store.siteById(site.id);
        if (!current)
            return;
        if (current.status === 'failed' || current.lastError !== null) {
            this.deps.store.updateSite(site.id, { status: 'live', lastError: null });
        }
    }
}
