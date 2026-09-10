# sites

Publishes static, command and PHP sites and can run persistent rootless environments, each site with its own address and visibility rules for owners, Project members, signed-in accounts, named guests or the public.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `sites` plugin.

| | |
| --- | --- |
| Version | `0.10.9` |
| Requires core | `0.28.35` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

Fourteen `Site*` tools cover the full lifecycle: creating, inspecting, listing, updating, sharing and deleting sites, publishing a build output as a release and rolling back to an earlier one, reading logs, running commands inside a persistent environment, controlling its start and stop, and taking environment snapshots. `SitePreview` opens the running application on an isolated preview origin.

## Runtime conversion

An administrator can convert a live static, command or PHP site into a persistent environment in place, through the `conversion` API route: `register` a recipe, `prepare` the container, `flip` the runtime and `complete` the conversion.

While a conversion is in flight the container serves a staged copy of the published release rather than the site's source folder, so the flip publishes exactly the bytes that were verified. `complete` retires that staged copy: it folds it back into the site's folder in the Project, rebuilds the container on that folder, and removes the conversion's directory. From then on the site has ONE working copy — the folder `SiteGet` reports as its source, which is what agents edit and what the container serves. Files are only ever added or refreshed there, never deleted, and the recipe's secret files stay in the environment instead of being written into the Project.

A conversion that a daemon restart interrupts after its flip is completed by the periodic reconcile as soon as the site answers again, so a site is never left serving a copy nobody edits. Completion is the point of no return: `rollback` is available until it runs, and not after.

## Configuration

No field is required. The 25 optional settings group into publishing defaults and permissions, the runtimes for command, PHP and persistent environments with their network and resource limits, size and count limits, and access settings such as sign-in validity, the Sites DNS destination and the certificate contact email. No field is a secret.

## Documentation

See the "Sites" page of the Elowen user manual (`docs/site/44-sites-plugin.md` in the Elowen repository).