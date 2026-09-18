# browser

Browser automation for linked accounts. Each account browser keeps an account-private profile on the host, with a virtual display, a VNC live view, exclusive user takeover and an enforcing network proxy around every session.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `browser` plugin.

| | |
| --- | --- |
| User-grantable | Yes |

This plugin's version, minimum core version and shared-API requirement are stated in `elowen-plugin.json` in this folder and published in `registry.json`; they are deliberately kept out of this file so it cannot go stale.

## Tools

BrowserOpen, BrowserSnapshot, BrowserNavigate, BrowserClick, BrowserFill, BrowserPressKey, BrowserScroll, BrowserWaitFor, BrowserTabs, BrowserRequestTakeover, BrowserScreenshot, BrowserEvaluate, BrowserConsole, BrowserNetwork, BrowserPerformance, BrowserAudit, BrowserClose.

## Configuration

chromeExecutable, maxActiveUsers, maxSessionsPerUser, idleTimeoutMinutes, hardSessionLimitMinutes, browserCloseGraceSeconds, maxViewportWidth, maxViewersPerSession, vncDeferMs, takeoverLeaseSeconds, maxChromeRssMb, maxTargetsPerUser, proxyConcurrency, proxyRequestsPerMinute, privateNetworkAllowlist.

## Documentation

See the [browser page in the Elowen user manual](https://github.com/dragocz95/elowen/blob/main/docs/site/40-browser-plugin.md).
