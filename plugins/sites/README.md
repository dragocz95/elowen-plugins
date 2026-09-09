# sites

Publishes static, command and PHP sites and can run persistent rootless environments, each site with its own address and visibility rules for owners, Project members, signed-in accounts, named guests or the public.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `sites` plugin.

| | |
| --- | --- |
| Version | `0.10.6` |
| Requires core | `0.28.35` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

Fourteen `Site*` tools cover the full lifecycle: creating, inspecting, listing, updating, sharing and deleting sites, publishing a build output as a release and rolling back to an earlier one, reading logs, running commands inside a persistent environment, controlling its start and stop, and taking environment snapshots. `SitePreview` opens the running application on an isolated preview origin.

## Configuration

No field is required. The 25 optional settings group into publishing defaults and permissions, the runtimes for command, PHP and persistent environments with their network and resource limits, size and count limits, and access settings such as sign-in validity, the Sites DNS destination and the certificate contact email. No field is a secret.

## Documentation

See the "Sites" page of the Elowen user manual (`docs/site/44-sites-plugin.md` in the Elowen repository).