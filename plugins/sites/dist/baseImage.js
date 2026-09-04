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
export const CONTAINERFILE = `FROM debian:bookworm-slim
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
RUN systemctl enable elowen-ingress.socket
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
    await podman.build(BASE_IMAGE_TAG, contextDir);
    return BASE_IMAGE_TAG;
}
