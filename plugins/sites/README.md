# sites

Publishes an address for work that already exists: a built folder, or an application running inside a managed Project's own environment. Each address has its own visibility rules for owners, Project members, signed-in accounts, named guests or the public.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `sites` plugin.

| | |
| --- | --- |
| Version | `0.10.11` |
| Requires core | `0.28.42` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Publications

A publication is one of two kinds, and `SiteCreate` takes it in `kind`.

- **static** — `SitePublish` copies a build output into a release on the host and the address serves those files. The page keeps working while the Project is stopped, and `SiteRollback` returns to an earlier release.
- **proxy** — the address forwards to an application listening on a loopback port *inside* a managed Project (`kind: "proxy"` with that port in `target`). `SitePublish` proves the application answers through the transport a visitor's request takes and then makes the address live. Nothing is copied, so the page always shows what the application serves right now.

**The Project environment is the runtime of a proxy publication.** It is created, sized, started, stopped, snapshotted and read as a Project environment — in the Sandbox plugin, on the Project's Environments panel, or through the Project environment API — and every publication of that Project shares it. Sites owns the address, the certificate, the proxy transport, the access rules and the preview origin; it owns no container of its own. That is why `SiteExec`, `SiteControl` and `SiteSnapshot` refuse a proxy publication and name the Project instead, and why `SiteUpdate` takes no resource limits for one: a limit belongs to the environment, not to an address in front of it.

Access is identical for both kinds. Visibility, named guests, session cookies and the isolated preview origin are decided per request, before anything reaches an application, and a publication somebody may not open is indistinguishable from a slug nobody took.

Sites created before this model keep working unchanged: an `environment` site keeps its own container and its own controls, and a `command` or `php` site keeps its behaviour, until that path is retired. `SiteCreate` no longer creates a per-site environment; new persistent applications run in the selected managed Project and are published as `proxy` sites.

## Tools

Fourteen `Site*` tools cover the full lifecycle: creating, inspecting, listing, updating, sharing and deleting sites, publishing (a release for a static publication, a verified address for a proxy one) and rolling back to an earlier release, reading logs, running commands inside a persistent environment, controlling its start and stop, and taking environment snapshots. `SitePreview` opens the running application on an isolated preview origin.

## Runtime conversion

An administrator can convert a live static, command or PHP site into a persistent environment in place, through the `conversion` API route: `register` a recipe, `prepare` the container, `flip` the runtime and `complete` the conversion.

While a conversion is in flight the container serves a staged copy of the published release rather than the site's source folder, so the flip publishes exactly the bytes that were verified. `complete` retires that staged copy: it folds it back into the site's folder in the Project, rebuilds the container on that folder, and removes the conversion's directory. From then on the site has ONE working copy — the folder `SiteGet` reports as its source, which is what agents edit and what the container serves. Files are only ever added or refreshed there, never deleted, and the recipe's secret files stay in the environment instead of being written into the Project.

A conversion that a daemon restart interrupts after its flip is completed by the periodic reconcile as soon as the site answers again, so a site is never left serving a copy nobody edits. Completion is the point of no return: `rollback` is available until it runs, and not after.

## Configuration

No field is required. The 25 optional settings group into publishing defaults and permissions, the runtimes for command, PHP and persistent environments with their network and resource limits, size and count limits, and access settings such as sign-in validity, the Sites DNS destination and the certificate contact email. No field is a secret.

## Documentation

See the "Sites" page of the Elowen user manual (`docs/site/44-sites-plugin.md` in the Elowen repository).