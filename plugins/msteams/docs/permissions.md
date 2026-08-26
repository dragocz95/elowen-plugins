# msteams — Microsoft permissions reference

> Verified on 2026-08-26 against a live reference tenant: the two Entra app registrations, the Azure Bot
> resource and its OAuth connection were read back through the Microsoft Graph and Azure Resource Manager
> APIs, and every permission below was cross-checked against the call that needs it in the plugin source.
> Values that are *granted but unused* are marked as such rather than quietly repeated.

Setting this plugin up is not one consent screen. There are **four independent permission surfaces**, each
configured in a different portal and approved by a different person. Getting one right tells you nothing
about the others, and three of the four are optional — the plugin degrades to a narrower feature set
instead of failing to start.

| # | Surface | Configured in | Consented by | Optional? |
| --- | --- | --- | --- | --- |
| 1 | **Bot identity** | Azure Bot resource + Entra app | nobody (no Graph permission at all) | required |
| 2 | **Application Graph permissions** | Entra → the *bot* app → API permissions | tenant admin, once | optional (`graphLookup`) |
| 3 | **Resource-specific consent (RSC)** | the Teams app package manifest | a **team owner**, per team | optional (`channelMessagesRsc`) |
| 4 | **Delegated Graph scopes** | a **second** Entra app + Bot Framework OAuth connection | tenant admin, then each user at first sign-in | optional (`accountLinking`) |

Surface 5 is not a permission at all but is grouped here because it is the other thing an Entra admin has
to type: the **redirect URIs** for web sign-in.

---

## 1. Bot identity — needs no Graph permission

The chat itself runs entirely on the **Bot Connector**, not on Graph. Nothing in this section requires an
API permission or admin consent.

- One Entra **app registration**, `signInAudience: AzureADMyOrg` (single tenant).
  Its Application (client) ID becomes the plugin's `appId`, the directory ID becomes `tenantId`, and a
  client secret becomes `appPassword`.
- One **Azure Bot** resource with `msaAppType: SingleTenant`, bound to that app id and tenant, messaging
  endpoint `https://<public-host>/hooks/msteams/messages`, with the **Teams channel** enabled.
- Outbound calls authenticate with the fixed scope `https://api.botframework.com/.default`
  (`lib/connector.mjs:6`), issued by the tenant token endpoint from `tenantId` (`lib/token.mjs:25`).

The plugin refuses to connect at all until `appId`, `appPassword` and `tenantId` are all set — no platform,
no webhook, no tools (`index.mjs:186-190`).

With only this surface configured the bot can read and reply in any chat or channel it has been added to,
but it can only reach people it has **already seen**.

## 2. Application Graph permissions — on the bot app

These use the bot's own app-only token, so they apply tenant-wide and need **tenant admin consent**. They
exist to close exactly one gap: writing to somebody the bot has never met.

Turn the feature on with `graphLookup`. While it is off, no `GraphClient` is constructed at all
(`lib/adapter.mjs:141`), so none of these permissions are exercised.

| Permission | Required for | Call |
| --- | --- | --- |
| `User.ReadBasic.All` | Resolving an e-mail address to a tenant user | `GET /users/{address}`, then a `$filter` fallback on `mail`/`userPrincipalName` (`lib/graph.mjs:72`, `:76`) |
| `TeamsAppInstallation.ReadWriteSelfForUser.All` | Installing the Teams app for that user so a 1:1 chat can be opened | `POST /users/{id}/teamwork/installedApps` (`lib/graph.mjs:113`) |
| `ProfilePhoto.Read.All` | Directory avatars in the admin people list — **optional** | `GET /users/{id}/photos/48x48/$value` (`lib/graph.mjs:88`) |

`ProfilePhoto.Read.All` degrades gracefully: without it the photo fetch fails, the plugin logs one warning
naming the permission and everything else keeps working (`lib/graph.mjs:93`). The reference tenant does
**not** grant it, and directory avatars are simply absent there.

Path: *Entra admin center → App registrations → the bot's app → API permissions → Add a permission →
Microsoft Graph → **Application permissions** → the permission → Grant admin consent for the tenant.* On a
401/403 the plugin quotes this exact path back at you with the missing permission name filled in, instead
of forwarding a bare status code (`lib/graph.mjs:29`, `:52-53`).

**Do not over-grant.** The reference tenant also has `AppCatalog.Read.All` and `GroupMember.Read.All`
consented on the bot app, and **the plugin uses neither**. The catalog entry is supplied by configuration
(`graphCatalogAppId`), not looked up, and group membership is read through the delegated connection in
surface 4. A new instance should leave both out.

### `graphCatalogAppId` is not `appId`

Installing the app for a user binds `appCatalogs/teamsApps/{graphCatalogAppId}` (`lib/graph.mjs:114`). That
id is the app's entry in the **organisation's Teams catalog** (*Teams admin center → Manage apps → the
uploaded app*), which is a different GUID from the bot's `appId`. Leave it empty only when the app is
already pushed to users by a Teams app policy; the plugin then skips the install and opens the chat
directly (`lib/adapter.mjs:1183-1186`).

## 3. Resource-specific consent — in the Teams app package

RSC is the one surface **no tenant admin touches**. A **team owner** approves it when the app package is
installed or updated in their team, and it applies only inside that team.

Enabling `channelMessagesRsc` adds this block to the generated app package (`lib/appPackage.mjs:222-226`):

```json
"authorization": {
  "permissions": {
    "resourceSpecific": [{ "type": "Application", "name": "ChannelMessage.Read.Group" }]
  }
}
```

| Permission | Type | Buys you |
| --- | --- | --- |
| `ChannelMessage.Read.Group` | Application (RSC) | In a team where the app is installed, the bot **sees every channel message** instead of only `@mentions`, which is what fills the conversation history backfill (`historyLimit`) |

Teams accepts this **instead of** the tenant-wide `ChannelMessage.Read.All`, and it is the least-privileged
option for the job — which is the whole reason it is used (`lib/graph.mjs:18-21`).

Two traps:

- The setting alone changes nothing. The package has to be **re-downloaded and re-uploaded** into the team,
  and the team owner has to accept the new permission prompt.
- Reading a channel message still only *sees* it. In a team channel, Teams delivers a message to a bot only
  when it is `@mentioned` — that is a Teams rule and `respondWithoutMention` does not override it.

`webApplicationInfo` (`id` = the bot `appId`, `resource` = any valid URL) is required by the manifest schema
whenever RSC is declared; the `resource` value is otherwise unused (`lib/appPackage.mjs:218-222`).

## 4. Delegated Graph scopes — the second app registration

This is the surface people miss, because it lives on a **separate Entra app registration** from the bot.

It powers the Microsoft 365 tools (`MicrosoftMail`, `MicrosoftFiles`, `MicrosoftSharePoint`,
`MicrosoftCalendar`, `MicrosoftDirectory`, `MicrosoftTeams`, …). Every call runs **as the signed-in person**
with that person's own rights, never as the bot — so the tools can never reach a document the user could
not open themselves. Tokens are held by the Bot Framework Token Service, not by Elowen.

### The wiring

1. Create a **second** Entra app registration (single tenant), separate from the bot app.
   Give it the redirect URI `https://token.botframework.com/.auth/web/redirect` and a client secret.
2. Add the delegated scopes below to it and **grant admin consent** for the tenant.
3. On the **Azure Bot** resource, add a **Connection Setting**:
   - Service provider: **Azure Active Directory v2**
   - Client id / secret: from the second app
   - Tenant ID: your tenant
   - Token Exchange URL: **leave empty**
   - Scopes: the list below, space-separated
4. Put the connection's exact name into the plugin's `oauthConnectionName`, and switch `accountLinking` on.

### The scopes

The reference deployment grants these 25 delegated scopes, admin-consented for all principals:

```
openid profile email offline_access
User.Read User.Read.All People.Read
Files.ReadWrite.All Sites.ReadWrite.All
Mail.ReadWrite Mail.Send Mail.ReadWrite.Shared Mail.Send.Shared
Calendars.ReadWrite Calendars.ReadWrite.Shared
Contacts.ReadWrite Tasks.ReadWrite
Group.ReadWrite.All Notes.ReadWrite.All
Chat.ReadWrite ChatMessage.Send
Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Read.All ChannelMessage.Send
```

Mapped to what stops working without each group (the plugin's own map, `lib/microsoftTools.mjs:7-20`):

| Tool family | Delegated scope |
| --- | --- |
| identity of the signed-in person | `User.Read` |
| `MicrosoftDirectory` | `User.Read.All`, `GroupMember.Read.All` |
| people suggestions | `People.Read` |
| `MicrosoftSharePoint` | `Sites.ReadWrite.All` |
| `MicrosoftFiles` (OneDrive) | `Files.ReadWrite.All` |
| `MicrosoftOutlook` mail | `Mail.ReadWrite`, `Mail.Send` |
| calendar | `Calendars.ReadWrite` |
| contacts | `Contacts.ReadWrite` |
| to-do | `Tasks.ReadWrite` |
| Planner | `Tasks.ReadWrite`, `Group.ReadWrite.All` |
| OneNote | `Notes.ReadWrite.All` |
| `MicrosoftTeams` | `Chat.ReadWrite`, `ChannelMessage.Read.All`, `ChannelMessage.Send` |

The `.Shared` variants (`Mail.ReadWrite.Shared`, `Mail.Send.Shared`, `Calendars.ReadWrite.Shared`) are what
let a person act on a **delegated or shared mailbox** they have rights to — drop them if nobody uses one.
`openid profile email offline_access` are the sign-in basics; `offline_access` is what makes the connection
survive past the first hour, so leaving it out produces a connection that works once and then stops.

**Known gap in the reference deployment:** the plugin names `GroupMember.Read.All` for `MicrosoftDirectory`,
but the reference connection does not carry it — group-membership reads there lean on `User.Read.All` and
`Group.ReadWrite.All`. If a directory call answers 403, that is the scope to add. The plugin surfaces the
required permission name in the error text on a 403 (`lib/microsoftTools.mjs:34-37`), so the tool output
tells you which one it wanted.

**`Chat.Read.All` is deliberately absent.** Reading arbitrary chat history through Graph needs that
protected permission and a tenant admin approval process; the plugin backfills history from the Bot
Framework instead (`lib/adapter.mjs:394`).

### Scope changes need the connection rewritten, not just consented

The Azure connection stores its scope list in **two places**: the top-level `scopes` property, which is the
one actually requested, and a `parameters` entry that the portal writes on creation. They can drift — on the
reference bot the `parameters` copy still reads `openid profile offline_access User.Read` while the
effective list is the full 25. Read the top-level `scopes` when you audit; ignore the `parameters` copy.

## 5. Redirect URIs — for web sign-in

Two unrelated redirect URIs, on two different apps. Neither is a permission, both are typed in Entra.

| App | Redirect URI | Used by |
| --- | --- | --- |
| the **bot** app | `<ssoRedirectBase>/api/auth/sso/microsoft/callback` | "Sign in with Microsoft" on the Elowen login page (`ssoEnabled`) |
| the **delegated** app | `https://token.botframework.com/.auth/web/redirect` | the Bot Framework OAuth connection in surface 4 |

Register **every** public hostname the instance answers on. The reference deployment lists both the vanity
domain and the raw cloud hostname, because either can be the one a browser lands on.

## Setting up a new tenant — checklist

1. Entra → App registrations → new registration, single tenant. → `appId`, `tenantId`, client secret → `appPassword`.
2. Azure Bot resource, SingleTenant, bound to that app; messaging endpoint `https://<host>/hooks/msteams/messages`; enable the Teams channel.
3. Fill `appId`, `appPassword`, `tenantId` in the plugin and confirm it connects. **Stop here if you only need chat.**
4. Web sign-in: add `<public-url>/api/auth/sso/microsoft/callback` to the bot app's redirect URIs, set `ssoRedirectBase`, switch on `ssoEnabled`.
5. Proactive messaging: grant `User.ReadBasic.All` + `TeamsAppInstallation.ReadWriteSelfForUser.All` (Application) with admin consent, upload the app to the org Teams catalog, put its catalog id in `graphCatalogAppId`, switch on `graphLookup`.
6. Channel history: switch on `channelMessagesRsc`, re-download the app package, re-install it in each team, have a team owner accept the prompt.
7. Microsoft 365 tools: second app registration + Bot Framework OAuth connection with the 25 delegated scopes and admin consent; set `oauthConnectionName` and `accountLinking`. Choose `m365AccessMode` — `read_only` blocks every external mutation, `read_write` still previews each mutation before the agent commits it.

## Traps, collected

- **Two app registrations, not one.** The bot app and the delegated-access app are separate. Reusing the bot app for the OAuth connection means its redirect URI and consent set have to carry both jobs.
- **`ChannelMessage.Read.All` and `ChannelMessage.Read.Group` are different things.** The first is a *delegated* scope on the delegated app (surface 4). The second is an *application* RSC permission in the Teams package (surface 3). Having one does not give you the other.
- **`graphCatalogAppId` ≠ `appId`.**
- **RSC needs a package re-upload**, not just the config switch.
- **`offline_access` is not optional** in practice — without it the delegated connection dies after the first token expires.
- **Saving credentials does not reconnect.** Changing `appId`/`appPassword`/`tenantId` needs a daemon restart; plugin config changes are picked up live.
- **The plugin's config hints carry the click-path.** `graphLookup`, `oauthConnectionName`, `ssoRedirectBase`, `graphCatalogAppId` and `channelMessagesRsc` each spell out what the admin has to do, so the setting screen is usable without this page.
