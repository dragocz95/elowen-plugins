# web

Gives the agent web research tools: `WebSearch` for search results and `WebFetch` for reading a page as text. Elowen also ships a bundled `web` plugin and a fresh installation already has it enabled, so this registry copy matters only where the bundled one was removed.

## Install

Install it from Settings -> Plugins -> Available in the Elowen web interface, or ask the assistant to install the `web` plugin.

| | |
| --- | --- |
| Version | `0.3.1` |
| Requires core | `not declared` |
| Requires shared API | `not declared` |
| User-grantable | No |

## Tools

`WebSearch` runs a web search through the configured provider and `WebFetch` fetches a public page and returns it as readable text.

## Configuration

No field is required. The 4 settings choose the search provider and set the result count, and the Tavily and Serper API keys are write-only secrets; without one of them only `WebFetch` works.

## Documentation

See the "Web Search & Fetch" page of the Elowen user manual (`docs/site/34-web-plugin.md` in the Elowen repository).