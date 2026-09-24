---
title: Sites
slug: sites-plugin
order: 44
eyebrow: Workspace
group: Workspace
---

# Sites

Open **Sites** in the Web UI to see publications shared with you and Sites you own. Each Project also has a **Sites** tab. The `sites` plugin gives an application already running in a managed Project its own web address.

## Publish or preview a Project application

Create a Site for the port your application listens on inside a running managed Project, then publish it. Sites checks that the application answers before making the address live. It does not copy, build or start the application. If the Project or service stops, its Site stays listed but cannot answer until the application runs again.

`SitePreview` opens the running application on a temporary preview address. Only current Project members and administrators can open it; preview does not publish a Site.

The Sites list and details show the address, Project, target port, last publish, visits, access and named guests. A page picture is available when the browser capture service is installed. Pictures are refreshed when they are missing or out of date; if a new capture fails, the previous picture stays visible. If a Site is published but its application is not answering, its status says so; start the Project service and publish again.

Older file-based Sites keep serving their saved releases and can be restored with `SiteRollback`. New file-based publications are no longer supported. Deleting an older Site removes its address and saved releases; it does not remove the managed Project or its application.

## Choose who can open a Site

Set a Site to private for its owner, visible to Project members, available to any signed-in account, or public. New Sites use the instance's default visibility. A Site never becomes public automatically: a person must confirm **Make public** in the Sites screen. If **Allow public sites** is off in plugin settings, the public option is unavailable.

`SiteShare` and `SiteUnshare` give or remove access for a named account, regardless of the Site's visibility. Removed access stops working on the next request. Site visibility does not grant access to the Project, its source or its files; those remain governed by Project access.

## Add a custom domain

Open a Site's details and select **Add domain**. Elowen shows DNS records to prove ownership and direct traffic to the Site. Create those records with your DNS provider, then choose **Check again**. Setup may remain pending while DNS changes spread or a certificate is issued. The Site shows whether ownership, routing and HTTPS are ready. Once ready, choose **Make primary**; the generated Elowen address remains available. Removing a custom domain from Elowen does not change your DNS records.

Each Site can have at most 10 custom domains. A domain must be one complete hostname, without a scheme, path, port or wildcard. For a root domain, use the address records Elowen provides or an ALIAS or ANAME record if your DNS provider supports it; for a subdomain, CNAME is usually simplest. Add the ownership TXT record and the routing record shown for that domain. For example, connect `app.example.com`, add the displayed TXT and CNAME records, then make it primary when HTTPS is ready.

## Use Sites tools

The tools `SiteCreate`, `SitePreview`, `SitePublish`, `SiteGet`, `SiteList`, `SiteUpdate`, `SiteShare`, `SiteUnshare` and `SiteDelete` create, preview, publish, inspect and manage Sites. `SiteDomainAdd`, `SiteDomainCheck`, `SiteDomainSetPrimary` and `SiteDomainRemove` manage custom domains. `SiteRollback` restores a saved release from an older file-based Site.

Site publishing is a proxy to the Project service, not a separate application host. The service must listen on `127.0.0.1` at the selected port inside an active managed Project. Requests are not streamed: responses are buffered up to 8 MB, and each request has a 15-second limit. Upgrade headers are stripped, so WebSockets are not supported. If the application does not answer before the limit or sends a larger response, the Site cannot return that request successfully.

## Install and configure Sites

Version 0.14.11 requires Elowen 0.28.53 or newer. Install it from **Settings → Plugins → Available**. Sites is not user-grantable. An administrator can restrict who may publish in the setting below; this does not stop people from opening Sites shared with them.

Enabling, disabling, installing or changing a plugin restarts Elowen. The settings screen says, "Change saved. Elowen is restarting now to load it."

An administrator edits instance-wide settings in the plugin details under **Settings → Plugins**.

### Publishing settings

| Setting | Key | Default | What it controls |
| --- | --- | --- | --- |
| Default visibility | `defaultVisibility` | Private | Starting access for new Sites: private, Project members or signed-in accounts. |
| Allow public sites | `allowPublicSites` | On | Whether someone can make a Site public. |
| Who may publish | `publishers` | Every account | Set to every account or administrators only. |
| Sites per account | `maxSitesPerAccount` | 20 | Maximum number of Sites per account, from 1 to 500. |

### Visitor access and certificates

| Setting | Key | Default | What it controls |
| --- | --- | --- | --- |
| Sign-in validity | `sessionTtlHours` | 12 hours | How long a visitor stays signed in, from 1 to 720 hours. Access removal still applies immediately. |
| Sites DNS destination | `gatewayDnsTarget` | Not set | Hostname or IP address for public DNS; empty uses the Elowen app hostname. |
| Contact email for certificates | `contactEmail` | Not set | Email sent to the certificate authority for certificate issuance and expiry notices. |

Sites certificates require a contact email, which is sent to the certificate authority. A custom domain may stay pending until its ownership and DNS routing are verified and HTTPS is ready; use **Check again** to see the current step or error. The DNS destination must reach this Elowen host directly; an external proxy needs its own TLS support. `SiteList` and `SiteGet` are read-only and safe to use while Elowen is planning.

[Next: Skills Plugin](skills-plugin)
