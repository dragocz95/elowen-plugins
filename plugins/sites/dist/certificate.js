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
 *  accepted there. Chain trust is deliberately NOT the question: whichever authority signed it, the
 *  failure this exists to catch is the gateway answering a site's hostname with ANOTHER site's
 *  certificate, which is a name mismatch and nothing else. */
export function evaluatePeerCertificate(hostname, cert, now) {
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
    return { reachable: true, covered: true, detail: `the gateway serves a certificate for ${hostname}, valid until ${cert.valid_to}` };
}
/** One TLS handshake against the local gateway, asking for a site's hostname by SNI.
 *
 *  This is the whole reason a readiness answer needs no privilege: the certificate a server presents is
 *  public by construction, so an account that cannot read the certificate directory or the nginx config
 *  can still establish what a visitor would be served. */
export const probeGatewayCertificate = (hostname) => new Promise((resolve) => {
    let settled = false;
    const settle = (observation) => {
        if (settled)
            return;
        settled = true;
        resolve(observation);
    };
    const socket = tlsConnect({
        host: GATEWAY_HOST,
        port: GATEWAY_PORT,
        servername: hostname,
        // The verdict is formed below against the hostname, not by Node's trust store: a gateway serving the
        // wrong site's certificate must be reported as such rather than collapsed into a handshake error.
        rejectUnauthorized: false,
        timeout: PROBE_TIMEOUT_MS,
    }, () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();
        settle(evaluatePeerCertificate(hostname, cert, Date.now()));
    });
    socket.once('error', (error) => {
        socket.destroy();
        settle({ reachable: false, covered: false, detail: `the local sites gateway did not answer a TLS handshake: ${messageOf(error)}` });
    });
    socket.once('timeout', () => {
        socket.destroy();
        settle({ reachable: false, covered: false, detail: `the local sites gateway did not complete a TLS handshake within ${PROBE_TIMEOUT_MS}ms` });
    });
});
/** Which live sites the gateway sweep must ask for on this pass.
 *
 *  One place, because the sweep and the cheap "is anything pending" guard in front of it have to agree: a
 *  guard that answered no to a site the sweep would have issued is how an explicit request goes unanswered
 *  until the twelve-hour renewal.
 *
 *  An explicit request outranks both skips. `issued` would otherwise skip a republication whose certificate
 *  needs renewing or reinstating, and the per-slug backoff — which exists so one misconfigured site cannot
 *  spend the authority's per-hour failure budget — would otherwise make a site unaskable for an hour after
 *  a single failure, including to the account that just published it. */
export function sitesDueForCertificate(sites, options) {
    return sites.filter((site) => {
        if (site.status !== 'live')
            return false;
        if (site.certificateRequestedAt != null)
            return true;
        if (!options.all && options.issued.has(site.slug))
            return false;
        return options.mayAttempt(site.slug);
    });
}
/** The per-site certificate operations a publish needs, and the only two it gets: ask for THIS site's
 *  certificate, and report what is true about it afterwards.
 *
 *  The split between the two processes lives here and nowhere else. In the daemon the broker is present,
 *  so issuance happens inline and its failure is reported with the authority's own reason. In a forked
 *  runner there is no broker, so the request is recorded on the site row the caller already proved it
 *  owns, and the daemon's existing gateway sweep carries it out — including for a slug its own backoff
 *  would otherwise have left alone until the hour was up.
 *
 *  Neither path waits for anything. The readiness answer is one handshake, and a hostname that is not
 *  being served yet is reported as pending rather than described as working. */
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
        if (this.deps.canIssue()) {
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
            // Issuance reported success, so anything short of a covered hostname is not a gap waiting to close:
            // the gateway holds the certificate and is not serving it, which nothing later will fix on its own.
            return observation.covered
                ? { state: 'ready', detail: observation.detail }
                : { state: 'error', detail: `the gateway reported the certificate for ${hostname} as issued but ${observation.detail}` };
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
        return {
            state: 'pending',
            detail: `${observation.detail}. ${requested
                ? 'The certificate has been requested and the daemon issues it on its next gateway sweep.'
                : 'The daemon issues it on its next gateway sweep.'}`,
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
