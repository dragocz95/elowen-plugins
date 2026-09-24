---
title: Browser
slug: browser-plugin
order: 40
eyebrow: Plugin reference
group: Plugin reference
---

# Browser

Open **Browser** in your account area to watch an agent's private Chrome session, take control, or manage your saved profile. The optional `browser` plugin adds the browser tools used by the agent. Administrators must grant it to each non-admin account.

## Browser sessions and privacy

Each account has its own persistent browser profile and Chrome process. Sign-ins and cookies remain between sessions; closing a session does not erase them. Clear saved data from your **Browser** account page. You cannot clear it while a session is running.

Browser tools work only for a linked account in a private conversation. A managed Project does not change which account owns the browser. Shared rooms and delegated child agents cannot use these tools.

The plugin also provides `browserCapture`, an internal control used only by the Sites plugin to capture a published page. It is separate from your browser sessions.

## Watch and control a browser

Open **Browser** in your account area to see active sessions, their previews and recent replies, open a live view, or close a session. The account page also shows saved profile storage and lets you clear it when no sessions are active; confirm the clear action before cookies and saved sign-ins are removed. Closing a session is not the same as clearing the profile.

Administrators can inspect runtime status in the browser plugin's **Status** panel. It shows active capacity, isolation, dependencies and limits. Its seven checks cover Chrome, browser control, virtual display, network proxy, profile storage, live-view transport and the chat card bridge. A blocked dependency prevents sessions from starting; warnings mean sessions work but a feature such as live viewing may be unavailable.

The agent and you never control a session at the same time. When the agent requests a takeover, it waits until you release control, disconnect, or the lease expires. Your browser must keep the takeover lease active; the default is 120 seconds, configurable from 30 to 600. Live view uses the full display image for every viewer, even in a small window, so more viewers use more bandwidth. The configured display width sets the virtual screen, not the exact web-page height; Chrome's tabs and address bar take part of that space.

## Use browser tools

The agent reads a page's accessibility snapshot, then uses the element references from the latest snapshot to click or fill fields. Actions return an updated snapshot. `BrowserOpen` can start at an optional URL or on a blank page; `BrowserNavigate` needs an absolute HTTP(S) address allowed by policy. Screenshots are available when explicitly requested, and oversized captures are refused rather than scaled.

Page text and diagnostics are untrusted content, not instructions. Diagnostic replies are bounded to 16 KB. Network listings show metadata only; request headers, bodies and cookies are not included, and query strings are removed from listed URLs. A response body is fetched only when explicitly requested, for one text response up to 64 KB. Waits are limited to one minute, and evaluated JavaScript to five seconds. A page error during evaluation is returned as a result; it does not mean the browser tool itself failed.

| Tool | What it does |
| --- | --- |
| `BrowserOpen`, `BrowserNavigate` | Open a session or navigate to an allowed HTTP(S) address. |
| `BrowserSnapshot`, `BrowserScreenshot` | Read the page or capture its viewport, full document or one element. |
| `BrowserClick`, `BrowserFill`, `BrowserPressKey`, `BrowserScroll` | Interact with the current page. |
| `BrowserWaitFor`, `BrowserEvaluate` | Wait for text or evaluate an expression in the page. |
| `BrowserTabs`, `BrowserClose` | List, select or close tabs; closing leaves the profile intact. |
| `BrowserRequestTakeover` | Give you exclusive control until you release it or the lease ends. |
| `BrowserConsole`, `BrowserNetwork`, `BrowserPerformance`, `BrowserAudit` | Inspect recorded diagnostics and performance. |

## Install and grant access

Install `browser` from **Settings → Plugins → Available**. It requires Elowen 0.28.50 or later. To grant access to a non-admin account:

1. Open **Users** and select the user.
2. Under **Granted plugins**, choose **Manage**.
3. Select `browser` and save.

Administrators always have access. Tool permissions may further restrict what the agent can do. Installing, enabling, disabling or saving browser plugin settings requests an Elowen restart, announced as **Restart**. If active work is still running, the change is saved and the restart may wait for that work to settle.

## Browser settings

The plugin's settings are in **Settings → Plugins → browser**. All fields are optional and use the defaults below when unset. The six section headings are not configurable values.

| Setting and key | Default | Range or choices |
| --- | --- | --- |
| Chrome executable (`chromeExecutable`) | Detect automatically | Optional path; advanced |
| Active accounts (`maxActiveUsers`) | 4 | 1–20 |
| Tab sessions per account (`maxSessionsPerUser`) | 2 | 1–8 |
| Idle timeout (`idleTimeoutMinutes`) | 10 minutes | 1–60 minutes |
| Hard session limit (`hardSessionLimitMinutes`) | 60 minutes | 5–240 minutes |
| Process close grace (`browserCloseGraceSeconds`) | 15 seconds | 0–120 seconds; advanced |
| Display width (`maxViewportWidth`) | 1280 px | 800–1920 px |
| Viewers per session (`maxViewersPerSession`) | 4 | 1–8 |
| Update coalescing (`vncDeferMs`) | 10 ms | 5–400 ms; advanced |
| Takeover lease (`takeoverLeaseSeconds`) | 120 seconds | 30–600 seconds |
| Chrome memory per account (`maxChromeRssMb`) | 768 MB | 256–2048 MB |
| Chrome targets per account (`maxTargetsPerUser`) | 12 | 4–32 |
| Proxy concurrency (`proxyConcurrency`) | 96 connections | 1–200; advanced |
| Proxy requests per minute (`proxyRequestsPerMinute`) | 3000 | 30–6000; advanced |
| Private network allowlist (`privateNetworkAllowlist`) | Empty | Hostnames or CIDRs; advanced and high risk |

An empty private-network allowlist blocks private, loopback, link-local and metadata addresses. Only add entries when you need access to a local development target.

## Network and runtime requirements

All browser traffic passes through a proxy that checks and pins destination addresses. It blocks local and private networks by default, as well as selected ports used by remote login, databases and other services. The allowlist can permit specific private destinations; it does not affect internal Site captures.

The host needs Chrome or Chromium, the browser-control library, Xvfb and x11vnc, private writable profile storage, and the network proxy. The **Status** panel checks each dependency. Missing Chrome, browser control, virtual display, proxy, or profile storage blocks session startup. If the live-view transport is unavailable, the agent can still use the browser but you cannot watch or take over. If the chat artifact bridge is missing, the session still works but no live card appears in chat.

By default, each account can keep two browser sessions open while up to four accounts use Chrome concurrently. Sessions close after the idle timeout or hard lifetime limit. Agent, user and viewer activity keeps an idle session alive, but the hard limit still applies while you have control. If Chrome exceeds its memory ceiling, the oldest idle session closes; a fresh launch keeps the account profile. A new session is refused when an account already has its maximum sessions or the instance has reached its active-account limit. Chrome also has a target limit for pages, popups and workers; new targets over that limit are closed.

## Network access and troubleshooting

The proxy permits HTTP and HTTPS only, and rejects URLs that include embedded credentials. It blocks localhost, private and link-local addresses, cloud metadata, and ports commonly used by remote login, mail relays, databases, search and caches. A refusal can look in Chrome like a failed tunnel or a missing image rather than a clear explanation. The reason is recorded in the daemon log, at most once per reason per minute for each account.

For local development, an administrator can add an exact hostname or CIDR to **Private network allowlist**. The proxy still checks and pins each resolved address. Keep the list empty unless a local target is needed: entries permit browser access to destinations that are normally blocked. This setting does not open private destinations to the internal Site capture feature.

If a session will not start, check **Settings → Plugins → browser → Status** for a blocked dependency and its suggested fix. The host status also verifies the browser sandbox and DevTools connection at first launch, so a green dependency panel alone cannot guarantee that a session will start. If only live viewing fails, check the live-view warnings separately; the agent's browser tools may continue to work.

## Example: inspect a local preview

For a development page on a private address, first have an administrator allow its exact hostname or CIDR. Then ask the agent to open that URL and check a particular page element. The agent opens a session, reads a snapshot and uses a current element reference to interact; each action returns a new snapshot. You can follow the page from **Browser** and take control if you need to finish a sign-in or check a visual detail. Remove the allowlist entry when local access is no longer needed.

## Browser proxy limits

Each account's proxy allows 96 concurrent connections and 3,000 requests per minute by default. Administrators can change these limits in **Settings → Plugins → browser**; the configured ranges are 1–200 connections and 30–6,000 requests per minute. Reaching either limit can make a page partly load or show a failed tunnel. The proxy records the reason in the daemon log, at most once per reason per minute for that account.

The proxy always blocks ports `22`, `25`, `111`, `135`, `137–139`, `445`, `2375–2376`, `3306`, `5432`, `6379`, `9200` and `11211`. This protects services commonly used for remote login, mail relays, databases and caches. A private-network allowlist entry does not permit these ports.

[Next: Scheduling Plugin](cronjob-plugin)
