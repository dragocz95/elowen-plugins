import { checkServerIdentity, connect as tlsConnect } from 'node:tls';
/** The gateway answers on the machine's own loopback interface, which is where nginx terminates TLS for
 *  every site hostname. Probing it there rather than through public DNS keeps the observation about THIS
 *  machine's configuration instead of about the resolver in front of it. */
const GATEWAY_HOST = '127.0.0.1';
const GATEWAY_PORT = 443;
const PROBE_TIMEOUT_MS = 5_000;
const messageOf = (error) => (error instanceof Error ? error.message : String(error));
/** The names a certificate claims, as a reader of a mismatch needs to see them. */
const servedNames = (cert) => {
    const alt = typeof cert.subjectaltname === 'string' ? cert.subjectaltname : '';
    if (alt)
        return alt.split(/,\s*/).map((entry) => entry.replace(/^DNS:/i, '')).join(', ');
    // A common name may legitimately repeat, so the typed shape is one name or several.
    const cn = cert.subject?.CN;
    if (Array.isArray(cn))
        return cn.join(', ') || 'an unnamed certificate';
    return cn ?? 'an unnamed certificate';
};
/** Judge one presented certificate exactly as the browser that will open the address would.
 *
 *  Name matching is `tls.checkServerIdentity`, the same function Node's own verification uses, so a
 *  wildcard lineage or a multi-name certificate is accepted here for the same reasons it would be
 *  accepted there. `trusted` carries the rest of the browser's question — whether the chain verifies
 *  against the system store — because a correctly named certificate from an authority nobody trusts is
 *  refused by a browser just as firmly as the wrong name, and the handshake answers it for free. */
export function evaluatePeerCertificate(hostname, cert, now, trust = { trusted: true }) {
    if (!cert || Object.keys(cert).length === 0) {
        return { reachable: true, covered: false, detail: 'the gateway completed the handshake without presenting a certificate' };
    }
    const mismatch = checkServerIdentity(hostname, cert);
    if (mismatch) {
        return {
            reachable: true,
            covered: false,
            detail: `the gateway answers ${hostname} with a certificate for ${servedNames(cert)}`,
        };
    }
    const from = Date.parse(cert.valid_from ?? '');
    const to = Date.parse(cert.valid_to ?? '');
    if (Number.isNaN(from) || Number.isNaN(to)) {
        return { reachable: true, covered: false, detail: `the certificate served for ${hostname} has no readable validity window` };
    }
    if (now < from || now >= to) {
        return {
            reachable: true,
            covered: false,
            detail: `the certificate served for ${hostname} is outside its validity window (${cert.valid_from} to ${cert.valid_to})`,
        };
    }
    if (!trust.trusted) {
        return {
            reachable: true,
            covered: false,
            detail: `the certificate served for ${hostname} names it but does not verify: ${trust.detail ?? 'the chain is not trusted'}`,
        };
    }
    return { reachable: true, covered: true, detail: `the gateway serves a certificate for ${hostname}, valid until ${cert.valid_to}` };
}
/** One TLS handshake against the local gateway, asking for a site's hostname by SNI.
 *
 *  This is the whole reason a readiness answer needs no privilege: the certificate a server presents is
 *  public by construction, so an account that cannot read the certificate directory or the nginx config
 *  can still establish what a visitor would be served. */
export const probeGatewayCertificate = (hostname, endpoint) => new Promise((resolve) => {
    let settled = false;
    // Declared before `settle` closes over them: an exception raised synchronously by `tls.connect` would
    // otherwise reach the settle path while both are still uninitialised.
    let deadline;
    let socket;
    const settle = (observation) => {
        if (settled)
            return;
        settled = true;
        if (deadline)
            clearTimeout(deadline);
        socket?.destroy();
        resolve(observation);
    };
    // One deadline over the WHOLE exchange. `tls.connect`'s own `timeout` option fires on socket inactivity,
    // which a TCP connect that never completes and a peer that accepts and then says nothing both survive —
    // and a publish must not hang on either.
    deadline = setTimeout(() => {
        settle({ reachable: false, covered: false, detail: `the local sites gateway did not complete a TLS handshake within ${PROBE_TIMEOUT_MS}ms` });
    }, PROBE_TIMEOUT_MS);
    deadline.unref();
    socket = tlsConnect({
        host: endpoint?.host ?? GATEWAY_HOST,
        port: endpoint?.port ?? GATEWAY_PORT,
        servername: hostname,
        // Verification still RUNS — `socket.authorized` below is its verdict — but it must not abort the
        // handshake: a gateway serving the wrong site's certificate has to be reported as exactly that rather
        // than collapsed into a connection error indistinguishable from a gateway that is down.
        rejectUnauthorized: false,
    }, () => {
        const peer = socket;
        settle(evaluatePeerCertificate(hostname, peer.getPeerCertificate(), Date.now(), {
            trusted: peer.authorized,
            ...(peer.authorizationError ? { detail: String(peer.authorizationError) } : {}),
        }));
    });
    socket.once('error', (error) => {
        settle({ reachable: false, covered: false, detail: `the local sites gateway did not answer a TLS handshake: ${messageOf(error)}` });
    });
});
/** Which live sites the gateway sweep must ask for on this pass.
 *
 *  One place, because the sweep and the cheap "is anything pending" guard in front of it have to agree: a
 *  guard that answered no to a site the sweep would have issued is how an explicit request goes unanswered
 *  until the twelve-hour renewal.
 *
 *  An explicit request outranks the `issued` skip, which would otherwise ignore a republication whose
 *  certificate needs reinstating in the gateway config. It deliberately does NOT outrank the backoff: that
 *  exists because the authority counts FAILED validations per hostname per hour against a budget every site
 *  on the instance shares, and the caller most likely to ask again in a loop is exactly the agent whose
 *  publish just reported a failure. A backed-off site reports its recorded reason instead. */
export function sitesDueForCertificate(sites, options) {
    return sites.filter((site) => {
        if (site.status !== 'live')
            return false;
        if (!options.mayAttempt(site.slug))
            return false;
        if (site.certificateRequestedAt != null)
            return true;
        return options.all || !options.issued.has(site.slug);
    });
}
/** The per-site certificate operations a publish needs, and the only two it gets: ask for THIS site's
 *  certificate, and report what is true about it afterwards.
 *
 *  The split between the two processes lives here and nowhere else. In the daemon the broker is present, so
 *  issuance happens inline and its failure is reported with the authority's own reason. In a forked runner
 *  there is no broker, so the request is recorded on the site row the caller already proved it owns, and
 *  the daemon's existing gateway sweep carries it out.
 *
 *  Neither path retries and neither polls. The readiness answer is one handshake, and a hostname that is
 *  not being served is never described as working. Issuance itself is as slow as certbot and the gateway's
 *  own lock make it, so a publish in the daemon can take as long as the authority does. */
export class SiteCertificateService {
    deps;
    probe;
    constructor(deps) {
        this.deps = deps;
        this.probe = deps.probe ?? probeGatewayCertificate;
    }
    /** Request this site's certificate and report the state that request left behind.
     *
     *  `hostname` is null wherever this process cannot derive one. That is not the same question as whether
     *  the site HAS an address, and the two are told apart below by whether the broker is present. */
    async publish(site, hostname) {
        // Recorded BEFORE the attempt, in both processes. It is how a runner asks at all, and in the daemon it
        // is what survives a crash between here and certbot returning — the sweep then finishes the job
        // instead of leaving a live site permanently uncertified.
        this.deps.store.updateSite(site.id, { certificateRequestedAt: new Date().toISOString() });
        if (hostname === null)
            return this.withoutHostname();
        // A backed-off slug is not asked again, here least of all: this is the path an agent repeats after
        // reading a failure, and spending the instance's shared per-hour validation budget on the retry loop is
        // how every OTHER site loses its certificate too. The recorded reason is what the caller needs anyway.
        if (this.deps.canIssue() && this.deps.mayAttempt(site.slug)) {
            try {
                await this.deps.issue(site.slug);
                this.deps.store.updateSite(site.id, { certificateRequestedAt: null, certificateError: null });
            }
            catch (error) {
                const detail = messageOf(error);
                this.deps.store.updateSite(site.id, { certificateRequestedAt: null, certificateError: detail });
                return { state: 'error', detail: `the certificate for ${hostname} was not issued: ${detail}` };
            }
            const observation = await this.probe(hostname);
            if (observation.covered)
                return { state: 'ready', detail: observation.detail };
            // The certificate exists and the gateway has been told to load it, but a reload returns before the
            // running workers have swapped, so a handshake this soon can still be answered by the configuration
            // that was live a moment ago. That is a transient nobody has to act on — unlike the same observation
            // on a LATER read, which `observed` reports as the fault it is.
            return {
                state: 'pending',
                detail: `the certificate for ${hostname} was issued and the gateway reloaded, but ${observation.detail}. Read the site again to confirm it is being served.`,
            };
        }
        return await this.observed(site, hostname, true);
    }
    /** What a reader opening this site would be served right now. */
    async readiness(site, hostname) {
        if (hostname === null)
            return this.withoutHostname();
        return await this.observed(site, hostname, false);
    }
    /** The state one handshake plus the recorded outcome of the daemon's last attempt establish.
     *
     *  `requested` only changes what a pending answer tells the reader to expect: a publish has just asked
     *  for this site, while a plain read has not, and conflating the two would promise a reader of an
     *  untouched site that something is already on its way. */
    async observed(site, hostname, requested) {
        const observation = await this.probe(hostname);
        if (observation.covered)
            return { state: 'ready', detail: observation.detail };
        // A recorded reason outranks the handshake: a hostname left uncertified BECAUSE the authority refused
        // it is an error, and reporting it as pending would promise a wait that never ends.
        const recorded = this.deps.store.siteById(site.id)?.certificateError ?? null;
        if (recorded)
            return { state: 'error', detail: `the last certificate attempt for ${hostname} failed: ${recorded}` };
        if (!observation.reachable)
            return { state: 'error', detail: observation.detail };
        // The certificate EXISTS and the gateway is answering this hostname with something else. Nothing is on
        // its way, so calling it pending would describe a wait that has already finished; the gateway config is
        // what is wrong. Only a process holding the broker can make this distinction, which is why the answer
        // below stays pending wherever the issued set is unreadable.
        if (this.deps.issuedSlugs()?.includes(site.slug)) {
            return {
                state: 'error',
                detail: `the gateway holds a certificate for ${hostname} but ${observation.detail}`,
            };
        }
        return {
            state: 'pending',
            detail: `${observation.detail}. ${requested
                ? 'The certificate has been requested and the daemon issues it on its next gateway sweep.'
                : 'No certificate for this hostname is being served yet.'}`,
        };
    }
    /** No hostname to probe. With the broker present that is a settled fact about the instance; without it
     *  this process simply cannot see the gateway's hostname base, and saying so beats inventing either
     *  verdict. */
    withoutHostname() {
        return this.deps.canIssue()
            ? { state: 'error', detail: 'this instance has no sites domain, so the site has no public hostname to certify' }
            : {
                state: 'pending',
                detail: 'this process holds no gateway broker, so the certificate cannot be observed here; the request is recorded and the daemon issues it on its next gateway sweep',
            };
    }
}
