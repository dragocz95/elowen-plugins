import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const INGRESS_SOCKET = `[Unit]
Description=Elowen site ingress socket

[Socket]
ListenStream=/run/elowen/app.sock
SocketMode=0666
RemoveOnStop=false

[Install]
WantedBy=sockets.target
`;
export const INGRESS_SERVICE = `[Unit]
Description=Elowen site ingress proxy
Requires=elowen-ingress.socket
After=network.target

[Service]
ExecStart=/lib/systemd/systemd-socket-proxyd 127.0.0.1:80
PrivateTmp=true
NoNewPrivileges=true
`;
/** Runs a conversion's provisioning script once, at boot, if one was seeded into the data volume.
 *
 *  WHY A BOOT UNIT AND NOT `podman exec`. The base image boots `/sbin/init` and nothing else, so without
 *  this a converted site's application unit would have to be installed by an out-of-band exec after the
 *  container was already up: a step that can be skipped, that races the ingress proxy, and that leaves no
 *  record inside the container. As a boot unit it is part of the container's own startup, it re-runs
 *  identically after any restart, and its output lands in the journal `SiteLogs` already reads.
 *
 *  Ordered before the ingress proxy so the application is enabled before anything can be forwarded to it,
 *  and `ConditionPathExists` keeps it inert for a plain environment that carries no conversion. */
export const BOOTSTRAP_SERVICE = `[Unit]
Description=Elowen converted site bootstrap
ConditionPathExists=/data/.elowen-conversion/provision.sh
Before=elowen-ingress.service
After=local-fs.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh /data/.elowen-conversion/provision.sh
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
export const BASE_IMAGE_SOURCE = 'docker.io/library/debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171';
export const CONTAINERFILE = `FROM ${BASE_IMAGE_SOURCE}
ENV container=podman
RUN apt-get update \\
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \\
      systemd systemd-sysv dbus ca-certificates curl iproute2 procps less \\
 && apt-get clean \\
 && rm -rf /var/lib/apt/lists/* \\
 && mkdir -p /workspace /data /run/elowen \\
 && systemctl mask systemd-remount-fs.service getty.target
COPY elowen-ingress.socket /etc/systemd/system/elowen-ingress.socket
COPY elowen-ingress.service /etc/systemd/system/elowen-ingress.service
COPY elowen-bootstrap.service /etc/systemd/system/elowen-bootstrap.service
RUN systemctl enable elowen-ingress.socket elowen-bootstrap.service
VOLUME ["/data"]
WORKDIR /workspace
STOPSIGNAL SIGRTMIN+3
ENTRYPOINT ["/sbin/init"]
`;
const imageDigest = createHash('sha256')
    .update(CONTAINERFILE)
    .update('\0')
    .update(INGRESS_SOCKET)
    .update('\0')
    .update(INGRESS_SERVICE)
    .update('\0')
    .update(BOOTSTRAP_SERVICE)
    .digest('hex')
    .slice(0, 16);
export const BASE_IMAGE_TAG = `localhost/elowen-site-base:${imageDigest}`;
/** Materialise the deterministic build context and build only when this exact image is absent.
 * The plugin runs as the service account, so the image remains in that account's rootless Podman store. */
export async function ensureBaseImage(podman, dataDir) {
    if (await podman.imageExists(BASE_IMAGE_TAG))
        return BASE_IMAGE_TAG;
    const contextDir = join(dataDir, 'environment-base', imageDigest);
    mkdirSync(contextDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(contextDir, 'Containerfile'), CONTAINERFILE, { mode: 0o600 });
    writeFileSync(join(contextDir, 'elowen-ingress.socket'), INGRESS_SOCKET, { mode: 0o600 });
    writeFileSync(join(contextDir, 'elowen-ingress.service'), INGRESS_SERVICE, { mode: 0o600 });
    writeFileSync(join(contextDir, 'elowen-bootstrap.service'), BOOTSTRAP_SERVICE, { mode: 0o600 });
    await podman.build(BASE_IMAGE_TAG, contextDir);
    return BASE_IMAGE_TAG;
}
