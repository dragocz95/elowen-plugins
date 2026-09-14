# browser

Runs a managed Chrome browser the agent can open, navigate and operate through typed actions on the page's accessibility tree, with per-account profiles, a live view, exclusive user takeover and an enforcing network proxy around every session.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `browser` plugin.

| | |
| --- | --- |
| Version | `0.4.0` |
| Requires core | `0.28.46` |
| Requires shared API | `not declared` |
| User-grantable | Yes |

## Tools

Seventeen `Browser*` tools drive a session end to end: opening the browser and reading an accessibility snapshot, navigating, clicking, filling fields, pressing keys, scrolling and waiting for text to appear. Supporting tools manage tabs, take screenshots, run JavaScript in the page and read the console, network log and performance counters, while `BrowserRequestTakeover` hands exclusive control to the person and `BrowserAudit` and `BrowserClose` summarize and end the session.

## Configuration

No field is required. The 15 optional settings cover the Chrome executable and process limits, session timeouts, the live view on a virtual display, the takeover lease, per-account resource caps and the enforcing network policy, which includes an advanced private-network allowlist. No field is a secret.

## Controls

`browserCapture` renders one host-derived absolute URL in a throwaway headless context and returns the picture. It is the one way the plugin renders a page outside an account: a fresh process, a profile removed afterwards, no proxy lease and no identity of its own. Core hands it to the Sites plugin and to nobody else, which uses it for the register's picture of each published page.

## Documentation

See the "Browser" page of the Elowen user manual (`docs/site/40-browser-plugin.md` in the Elowen repository).