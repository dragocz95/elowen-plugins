# sites

Publishes an address for a built folder or an application running inside an explicit managed Project. Each address has independent visibility rules for owners, Project members, signed-in accounts, named guests or the public.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `sites` plugin.

| | |
| --- | --- |
| Version | `0.12.0` |
| Requires core | `0.28.45` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Publications

`SiteCreate` accepts two publication kinds.

- **static** copies a finished build output into an immutable release. The address keeps working while the Project is stopped, and `SiteRollback` restores an earlier retained release.
- **proxy** forwards to a loopback port inside an explicit managed Project. `SitePublish` establishes the durable Sandbox publication binding, verifies the application through that transport and then makes the address live. No host path fallback exists.

A static publication is always served as immutable files. Applications run in the managed Project that owns their lifecycle and are published only through the proxy kind.

Managed Project static releases are transferred through bounded Sandbox Project file operations. Regular files are read in chunks against a stable content version. Unsupported file types and symlinks are skipped, and an interrupted, inconsistent or changing transfer removes its partial release before reporting failure.

Rows from retired per-Site command, PHP and environment runtimes remain stored as dormant historical data. They are absent from ordinary lists, reads, serving, readiness and reconciliation. Their source values remain opaque audit data and never need a current Project path during plugin boot. Existing action, migration, snapshot and backup records remain available for explicit offline audit or cleanup, and no Sites operation starts, stops, restores, snapshots or executes them.

## Tools

Ten `Site*` tools create, preview, inspect, list, update, publish, roll back, share, unshare and delete publications.

## Configuration

No field is required. Settings cover publishing defaults and permissions, size and retention limits, access sessions, DNS and certificate contact details. Sites has no application lifecycle or resource settings.

## Documentation

See the "Sites" page of the Elowen user manual (`docs/site/44-sites-plugin.md` in the Elowen repository).
