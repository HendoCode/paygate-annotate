# Paygate Annotate

Chrome extension that marks links to sites you'd rather not visit (paywalled news, mostly) with your own styles.

Right-click a link → **Paygate** → pick a style (**Ban**, **Demur**, **Awesome**, or your own). The link's registrable
domain (e.g. `theatlantic.com`) is added as a rule, and every matching link on every open page is restyled: prefix/suffix
text plus whatever CSS you give the style. **Remove rule for this site** undoes it.

## Install

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder.

Click the toolbar icon (or **Paygate → Edit rules & styles…**) to manage styles and rules.

## How it works

- **Rules** (`domain` or `regex`) and **styles** (`name`, `before`, `after`, `css`) live in `chrome.storage.sync`,
  chunked to fit the 8KB per-item limit, so they follow you across signed-in Chromes.
- The content script (`src/content.js`) resolves each link's real destination, tags matches with
  `data-paygate="<styleId>"`, and injects one generated stylesheet. Page text is never rewritten; markers are
  `::before`/`::after`. Links with no text (overlays, image links) get the CSS but no markers.
- **Destination resolution**:
  - Redirect wrappers are unwrapped (`google.com/url?q=`, `l.facebook.com/l.php?u=`, DuckDuckGo `uddg=`, and any
    `url`/`u`/`target`/`dest`/… param that holds an absolute URL on a different host).
  - **Google News** `/read/…` links are opaque, so the publisher comes from the article card's
    `faviconV2?url=https://publisher` image. Regex rules see only `https://<publisher-host>/` there.
  - Shorteners like `t.co` aren't resolved (that would require fetching them).
- First matching rule wins; rules are ordered in the options page.

## Development

No build step. `npm test` runs the unit tests for the pure logic in `src/lib/core.js`.
After editing, hit the reload button on the extension's card in `chrome://extensions`.
