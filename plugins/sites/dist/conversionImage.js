import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_IMAGE_TAG, ensureBaseImage } from './baseImage.js';
/** Images a CONVERTED site runs on, derived from the shared environment base.
 *
 *  WHY DERIVATIVES RATHER THAN A FATTER BASE. The base image is what every ordinary persistent
 *  environment boots, and those users asked for a small server they administer themselves. Adding nginx
 *  and a Node runtime to it would push both onto every environment on the instance, change the one image
 *  everybody shares, and make an unrelated environment's disk and attack surface grow because some other
 *  site was converted. The derivatives are built `FROM` the base instead, so the base behaviour is
 *  untouched and the shared layers are reused rather than duplicated.
 *
 *  WHY A PINNED DIGEST AND A MULTI-STAGE COPY FOR NODE. Debian bookworm's own `nodejs` package predates
 *  `node:sqlite`, which two of the applications this exists for import directly, so the distribution
 *  package cannot satisfy them at any version. The runtime therefore comes from the official Node image,
 *  copied in at a pinned digest: a floating tag would silently change the interpreter underneath a
 *  converted site on the next rebuild, which is exactly the kind of drift a conversion must not carry.
 *  The `bookworm-slim` variant is chosen so the glibc the binary was linked against matches the base. */
/** Node 24.20.0, the current Node 24 LTS line ("Krypton", released 2026-08-26), as the official image
 *  `node:24.20.0-bookworm-slim`.
 *
 *  Verified against nodejs.org release metadata and the Docker Hub registry rather than assumed: the tag
 *  resolves to this OCI index, and the index publishes linux/amd64, which is what this fleet runs.
 *  `node:sqlite` is present in the Node 24 API and is what the two SQLite applications import.
 *
 *  Reversible by construction: change these two constants together and the derived tag changes with them,
 *  so the next conversion builds a new image and existing containers keep the one they were created on. */
export const NODE_IMAGE_REF = 'docker.io/library/node';
export const NODE_IMAGE_VERSION = '24.20.0-bookworm-slim';
const NODE_IMAGE_DIGEST = 'sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
export const NODE_IMAGE_SOURCE = `${NODE_IMAGE_REF}:${NODE_IMAGE_VERSION}@${NODE_IMAGE_DIGEST}`;
/** nginx serving the staged release on the port the base image's ingress proxy forwards to.
 *
 *  `daemon off;` because systemd supervises it, and the site root is `/workspace` because that is where
 *  the staged copy of the published release is mounted. Nothing here is site-specific: the same image
 *  serves every converted static site, and what differs is only the mount. */
export const STATIC_SITE_CONF = `server {
    listen 127.0.0.1:80 default_server;
    server_name _;
    root /workspace;
    index index.html;
    absolute_redirect off;

    # SYMLINKS ARE REFUSED, and this is the control that matters.
    #
    # A real Podman run proved the rest insufficient: a release carrying \`public-leak -> .env\` is served
    # at \`/public-leak\`, a URL with no dot in it, so a path-pattern deny never sees it. nginx follows the
    # link and returns the secret with a 200. The same trick reaches anything the link points at,
    # including targets outside the served tree entirely.
    #
    # \`from=$document_root\` scopes the check to components BELOW the root, so the host path the workspace
    # is mounted through may itself traverse a symlink while nothing inside the served tree may be one.
    # This matches the contract the legacy static path already enforces in \`resolveWithin\`, which
    # resolves the real path and refuses anything that leaves the release.
    disable_symlinks on from=$document_root;

    # Defence in depth for files that are not symlinks: dotfiles at any depth and the known credential
    # names. The staging step lifts declared secrets out, but a release can carry one nobody declared,
    # and on a static site every file in the root is a URL.
    location ~ /\\. {
        deny all;
        return 404;
    }
    location ~* /(config\\.json|auth\\.json)$ {
        deny all;
        return 404;
    }
    location / {
        try_files $uri $uri/ =404;
    }
}
`;
export const STATIC_CONTAINERFILE = `FROM ${BASE_IMAGE_TAG}
RUN apt-get update \\
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nginx \\
 && apt-get clean \\
 && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default
COPY elowen-static.conf /etc/nginx/conf.d/elowen-static.conf
RUN systemctl enable nginx
`;
/** The Node runtime copied out of the official image at a pinned digest.
 *
 *  Only the runtime tree is taken. The official image's own entrypoint, user and package manager state
 *  stay behind, because this container is booted by systemd from the base image and must not inherit a
 *  second opinion about how it starts. */
export const NODE_CONTAINERFILE = `FROM ${NODE_IMAGE_SOURCE} AS runtime

FROM ${BASE_IMAGE_TAG}
COPY --from=runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=runtime /usr/local/include/node /usr/local/include/node
RUN ln -sf /usr/local/bin/node /usr/bin/node \\
 && /usr/local/bin/node --version
`;
const digestOf = (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);
const STATIC_DIGEST = digestOf(BASE_IMAGE_TAG, STATIC_CONTAINERFILE, STATIC_SITE_CONF);
const NODE_DIGEST = digestOf(BASE_IMAGE_TAG, NODE_CONTAINERFILE);
/** Derived tags. The base tag is folded in, so a base image change re-tags the derivatives too and a
 *  stale derivative can never sit on top of a base that has moved. */
const STATIC_IMAGE_TAG = `localhost/elowen-site-static:${STATIC_DIGEST}`;
const NODE_IMAGE_TAG = `localhost/elowen-site-node:${NODE_DIGEST}`;
export const conversionImageTag = (kind) => kind === 'static' ? STATIC_IMAGE_TAG : NODE_IMAGE_TAG;
/** Build the derivative for a recipe, reusing the base image's layers.
 *
 *  The base is ensured first so the `FROM` resolves locally rather than reaching for a registry that has
 *  never heard of it. Build-once, exactly like the base: an existing tag is the same content by
 *  construction, because the tag IS the digest of what produced it. */
export async function ensureConversionImage(podman, dataDir, kind) {
    const tag = conversionImageTag(kind);
    if (await podman.imageExists(tag))
        return tag;
    await ensureBaseImage(podman, dataDir);
    const contextDir = join(dataDir, 'environment-conversion', kind === 'static' ? STATIC_DIGEST : NODE_DIGEST);
    mkdirSync(contextDir, { recursive: true, mode: 0o700 });
    if (kind === 'static') {
        writeFileSync(join(contextDir, 'Containerfile'), STATIC_CONTAINERFILE, { mode: 0o600 });
        writeFileSync(join(contextDir, 'elowen-static.conf'), STATIC_SITE_CONF, { mode: 0o600 });
    }
    else {
        writeFileSync(join(contextDir, 'Containerfile'), NODE_CONTAINERFILE, { mode: 0o600 });
    }
    await podman.build(tag, contextDir);
    return tag;
}
