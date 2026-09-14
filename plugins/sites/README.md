# sites

Publishes an address for an application running inside an explicit managed Project, and keeps a picture of every published page for the Sites register. Each address has independent visibility rules for owners, Project members, signed-in accounts, named guests or the public.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `sites` plugin.

| | |
| --- | --- |
| Version | `0.14.0` |
| Requires core | `0.28.45` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Publications

There is one publication model. `SiteCreate` requires an active managed Project and the TCP port the application listens on inside it; `SitePublish` establishes the durable Sandbox publication binding, verifies the application through that same transport and then makes the address live. Nothing is copied and nothing is started, and a host Project is refused because it has no environment to publish from.

Serving is the address: the gateway answers the site's own hostname and the request is forwarded to the application inside the Project. There is no host path fallback and no second serving mode.

Rows published under the retired file model keep serving the immutable files they already hold: the address, its visibility and its release ledger still work, `SiteRollback` restores a retained release of one, and `SiteDelete` removes it. They cannot be published again — the copier is gone, and `SitePublish` refuses rather than reviving a path that no longer exists. An operator who wants one of those pages on the one model creates a site for the application in its Project and deletes the old address.

Rows from retired per-Site command, PHP and environment runtimes remain stored as dormant historical data. They are absent from ordinary lists, reads, serving, readiness and reconciliation. Their source values remain opaque audit data and never need a current Project path during plugin boot. Existing action, migration, snapshot and backup records remain available for explicit offline audit or cleanup, and no Sites operation starts, stops, restores, snapshots or executes them.

## Page pictures

The register shows a picture of each published page. Browser 0.4.0 takes it through the site's own published HTTPS hostname in a fresh throwaway Chrome profile. Its enforcing proxy resolves and pins the public address once and permits only that exact origin for redirects, documents, assets, fetches, sockets and workers.

- A capture is authorised by a one-use grant, minted for one attempt, bound to the site and to its access generation, and spent by the first request that presents it. The grant never reaches the application inside the Project.
- Rendering is anonymous: the grant proves the right to be served, not an account, so no identity is forwarded to the application and the visit counters are left alone.
- Each site keeps ONE bounded picture. A new one replaces it atomically under a new version, which is the cache key clients fetch with.
- Pictures are renewed lazily: a register that is opened asks for the ones that are missing or older than six hours, one capture at a time, with a backoff after a failure. A publish asks for one too, and a manager can ask from the drawer at most once every 30 seconds.
- The image has its own endpoint with the site's own access rule, and it goes with the site when that is deleted. A picture that could not be taken leaves the previous one in place and says so; a page with no picture shows its monogram.

## Tools

Ten `Site*` tools create, preview, inspect, list, update, publish, roll back, share, unshare and delete publications.

## Configuration

No field is required. Settings cover publishing defaults and permissions, the per-account publication count, access sessions, DNS and certificate contact details. Retired file-size and release-retention inputs are gone because no new file publication is copied. Sites has no application lifecycle or resource settings.

## Documentation

See the "Sites" page of the Elowen user manual (`docs/site/44-sites-plugin.md` in the Elowen repository).
