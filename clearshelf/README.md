# Clearshelf: Amazon Sponsored Listing Remover

A Manifest V3 Chrome extension that hides sponsored listings, brand banners, video ads, sponsored carousels and other paid placements on Amazon, so the organic results are what remain.

Everything happens locally in the browser. There is no build step, no runtime dependency, no analytics and no network access.

> **Read this first: what has and has not been verified.**
> Amazon is not reachable from the environment this was built in, so the extension has **never been run against live amazon.com**. It was tested in real Chromium, as a real loaded extension, against synthetic pages that reproduce Amazon's known markup patterns and several kinds of layout drift. The numbers in [docs/TESTING.md](docs/TESTING.md) measure the engine against those fixtures, not against Amazon. Selectors and label vocabulary reflect my knowledge of Amazon's markup and will need adjusting if live pages differ. The first thing to do after installing is switch on **Debug mode** and look at a real search page (see [First run](#first-run-on-real-amazon)).

## Install (Developer Mode, Load unpacked)

1. Download or clone this repository. The extension is the `clearshelf/` folder.
2. Open `chrome://extensions` in Chrome 111 or newer.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `clearshelf/` folder (the one containing `manifest.json`).
5. Pin the extension from the puzzle-piece menu if you want the toolbar icon and badge.
6. Open or reload an `amazon.com` tab. Tabs opened before installation need a reload; the popup says so.

To update after pulling new code, press the reload arrow on the extension card at `chrome://extensions`, then reload the Amazon tab.

### First run on real Amazon

1. Open the popup, go to **Settings**, switch on **Debug mode**.
2. Load an Amazon search page. Sponsored items get a red dashed outline and a label such as `SPONSORED 0.99 / product / label+class+link`. Items the engine looked at and left alone get an amber dotted outline.
3. Check that every red outline really is an ad and that nothing organic is outlined. Check that no ads are left without a red outline.
4. Use **Copy diagnostics** in the popup to capture what the engine decided. It contains element paths, class names and signal names. It contains no URLs, product titles or personal data.
5. Switch Debug mode off.

If an ad is missed or an organic item is flagged, the diagnostics tell you which signals fired. That is the information needed to adjust `src/content/vocab.js` or `src/content/resolver.js`.

## What it removes

| Placement | Examples |
|---|---|
| Sponsored products | Ad cards mixed into search and category results |
| Brand banners | Sponsored Brands headlines, store spotlights |
| Video ads | Sponsored Brands video |
| Sponsored carousels | "Sponsored products related to this item", ad rows in results |
| Display banners | Ad iframes on the homepage and product pages |
| Promoted recommendations | Sponsored tiles in recommendation grids |
| Other paid placements | Anything else clearly labelled as sponsored |

Each kind can be switched off separately, as can each page type (home, search, category, product, other).

## Design priorities

1. **Precision over recall.** Hiding an organic result is treated as a worse failure than leaving an ad. Every layer below is built so that doubt means "leave it".
2. **Do not depend on class names.** Amazon renames classes often. The primary evidence is the visible sponsored label in any of several languages, which survives restyling.
3. **Be honest when unsure.** If sponsored labels are found that cannot be removed safely, the popup, toolbar badge and an optional in-page notice say so, instead of guessing.

## Architecture

```
clearshelf/
  manifest.json                 MV3. Permission: "storage" only. No host permissions.
  src/
    shared/constants.js         Settings schema, defaults, modes, page classification, domain registry
    content/
      vocab.js                  What counts as ad evidence (labels in several languages, selectors, link patterns)
      signals.js                Collects evidence from a DOM subtree
      resolver.js               Maps evidence to a container, and decides whether hiding it is safe
      scoring.js                Combines evidence into a confidence; classifies the placement kind
      engine.js                 Orchestrates detection, applies/reverts hiding, keeps stats and a decision log
      controller.js             Page lifecycle: MutationObserver, navigation, fail-safe, reporting, messaging
      toast.js                  Dismissible in-page notice (closed shadow DOM, CSP-safe styles)
      content.css               display:none rules, instant pre-pass, debug overlay
    background/service-worker.js  Session stats, badge, icon. No network, no page content.
    popup/                      Popup UI (overview + settings)
  icons/                        SVG sources and generated PNGs (normal and disabled)
  tests/ docs/ scripts/         Dev only; not needed by Chrome
```

### Detection pipeline

```
signals -> initial container ("unit0") -> score -> mode / placement gates
        -> climb to final container -> safety checks -> hide (attribute + CSS)
```

**1. Signals, grouped into independent families.** Evidence is only ever *found*, never assumed.

| Family | Evidence | Weight |
|---|---|---|
| `label` | Visible text that is exactly "Sponsored" (and localised equivalents), or an `aria-label` such as `Sponsored Ad - ...` | 0.85 / 0.88 |
| `class` | Amazon's own sponsored markers (`.puis-sponsored-label-text`, `.AdHolder`, ...) | 0.90 |
| `link` | Ad click-through redirects (`/sspa/click`, `/gp/slredirect/`), ad tracking parameters, ad ref tags | 0.90 |
| `feedback` | "Ad feedback" and "View Sponsored information" controls | 0.85 |
| `adframe` | Iframes served from Amazon's ad system | 0.80 |
| `widget` | Ad-flavoured widget ids (`sp_detail`, `adplacements`, ...) | 0.50 |

Weak words such as a bare "Ad" score 0.55; "Sponsored by Brand" scores 0.60. Label text is normalised (case, invisible characters, info glyphs) and must make up the *entire* text of its element. A product titled "Ad Hoc Networking" or "The Sponsored Content Playbook" is not a label. Labels inside product links, navigation, forms, footers and dialogs are ignored, and hidden labels do not count.

**2. Container resolution.** A signal is attached to the nearest enclosing product *card* (search result, carousel card, or any `data-asin` element that looks like a single product), otherwise the nearest *module* (carousel, widget), otherwise a repeated grid item. A label with no safe container is **not** guessed at; it is recorded as unresolved. As a last resort a module can be *inferred* around a heading-style label, but only with a second kind of evidence and only if every product inside carries its own ad evidence.

**3. Scoring.** Confidence is a noisy-OR across families (the strongest signal per family counts once): `1 - Π(1 - weight)`. A bare label is 0.85. A label plus an Amazon ad class is 0.985.

| Mode | Threshold | Needs |
|---|---|---|
| Strict | 0.95 | two independent families |
| **Balanced** (default) | 0.80 | one strong family, such as the visible label |
| Aggressive | 0.50 | also acts on weak hints (bare "Ad", widget ids) |

**4. Climbing.** A card is widened only through wrapper elements that hold nothing else of value, so no empty padded shell is left behind. A module is widened to an enclosing module only if every product in the larger one already lives inside the smaller. After hiding, a module whose products are all hidden is hidden too (this does not depend on carousel class names).

**5. Safety checks.** Hiding is refused, and the item reported as unresolved, if the container:
- is or contains a protected landmark (page shell, nav, search box, result list, product title, buy box, refinements, any `h1`);
- contains an organic search result that is not itself flagged;
- is too large (more than 60 cards or 160 links for a module);
- contains an allowlisted element.

An element with no evidence of its own can be hidden only if every product inside it is already hidden on evidence. Structure alone never hides anything.

**6. Page-level fail-safe.** With fail-safe on (default), if 6 or more search results are present and more than 65% would be hidden, the page layout has probably changed. Hiding stops, everything is restored, and the page is marked "Fail-safe engaged" until you press Rescan or reload.

### Keeping up with a changing page

- A `MutationObserver` queues added subtrees and text changes; scans are throttled (50 ms), and only the added subtree is scanned. If a label is removed from a hidden item, that item is re-checked and restored if its evidence is gone.
- Full rescans run at load, +1.2 s and +3.5 s to catch late rendering.
- Same-document navigation (Amazon swaps content without reloading) is detected via the Navigation API with a 1 s fallback check, and resets per-page state.
- An optional CSS "instant hide" pre-pass hides only the unmistakable case (a search card containing Amazon's own sponsored label, ad redirect link or `AdHolder` class) at `document_start`, so ads do not flash. It switches itself off in Strict mode, Debug mode, when an allowlist exists, and when the fail-safe trips.

### Why hiding, not deleting nodes

Elements are hidden with a data attribute and an extension-injected stylesheet. That is instantly reversible (master switch, allowlist, placement toggles, debug), cannot break Amazon's own scripts that hold references to those nodes, and is CSP-safe because the stylesheet is declared in the manifest.

### Notifications

When sponsored labels are found that cannot be removed safely ("partly active"), the page type has no recognisable layout ("layout not recognised"), or the fail-safe trips, the extension shows: a toolbar badge (`!` or `?`), a status banner in the popup, and a small dismissible notice on the page (can be turned off). No `notifications` permission is used.

## Settings

All stored in `chrome.storage.local` and validated on every read.

| Setting | Default | Notes |
|---|---|---|
| Enabled | on | Master switch, takes effect immediately on open tabs |
| Detection mode | Balanced | Strict / Balanced / Aggressive |
| Fail-safe | on | Tripwire plus container safety checks |
| Instant hide | on | CSS pre-pass |
| Placements | all on | Per kind |
| Pages | all on | Per page type |
| Allowlist | empty | ASINs (never hide that product, or any module containing it) and CSS selectors (never hide anything matching, containing, or inside a match) |
| Notify about unsupported layouts | on | In-page notice |
| Toolbar badge | on | |
| Debug mode | off | Outline instead of hide, decision labels, console logging |

## Statistics

- **Removed this session:** across all tabs since the browser started (`chrome.storage.session`; cleared when the browser closes).
- **Removed on this page:** placements hidden on the current page view. A carousel counts once, not once per card.
- **Detected now:** placements currently hidden on the page.
- A single lifetime counter (one number) is kept in local storage and can be cleared with **Reset statistics**.

## Privacy and security

- Permission requested: `storage`. No host permissions, no `tabs`, no `activeTab`, no `scripting`, no `notifications`. Content scripts are limited by `matches` to `https://www.amazon.com/*` and `https://amazon.com/*`, top frame only.
- No `fetch`, `XMLHttpRequest`, WebSocket, beacons, remote scripts, `eval` or analytics. This is enforced by `tests/unit/package.test.js`, and an end-to-end test records every request made during a session and asserts the extension made none.
- The only message channel is from the content script to this extension's own service worker, carrying counters and a status word. Page content, URLs and product data are never sent anywhere.
- Diagnostics are produced only when you click Copy diagnostics, and go to your clipboard only.
- Extension pages use `script-src 'self'`.

## Adding another Amazon region

The code is region-ready; only the manifest gates it.

1. In `manifest.json` add the host to `content_scripts[0].matches`, for example `"https://www.amazon.co.uk/*"`.
2. In `src/shared/constants.js` change that domain's `status` from `planned` to `active` (this also makes `CS.isSupportedHost` accept it).
3. If the language is new, add its word for "Sponsored" to `STRONG_LABELS` in `src/content/vocab.js`. English, German, French, Spanish, Italian, Dutch, Swedish, Danish, Polish, Turkish and Japanese forms are already included.
4. Add fixtures for the region to `tests/fixtures` and run the suite. Check the live page with Debug mode before relying on it. Regional layouts differ and are **unverified**.

## Known limitations

- **Never run on live Amazon** (see the top of this file). Expect to tune on first contact.
- Class names, link patterns and widget ids in `vocab.js` and `resolver.js` are best-effort knowledge of Amazon's markup and will drift. The text-label layer is the durable one.
- **No visible label, no recognisable link or class: not removed.** An ad Amazon renders with no "Sponsored" text, no ad class and no ad link cannot be identified without guessing, and this extension does not guess.
- **A bare "Ad" label is weak evidence** and is only acted on in Aggressive mode (or alongside other evidence).
- **A label outside its card** (for example a "Sponsored" row that is a sibling above the card) cannot be tied to a container safely. It is reported as unresolved and left in place.
- **Label-only modules in a fully stripped page** (no widget hooks, no per-product ad links) are not removed (tested: they are reported, not guessed).
- A product or seller literally named "Sponsored" can be hidden when its name is the whole text of a non-link element. The allowlist is the escape hatch.
- Strict mode misses roughly half of the modelled ads by design.
- Hiding is cosmetic. Amazon still loads the ads, so page weight and Amazon's own tracking of ad impressions are unchanged. Blocking requests would need extra permissions and is out of scope.
- Sponsored items injected into a closed shadow root or a cross-origin iframe are only handled if their outer container carries evidence.
- Only the top frame is processed.
- Regional Amazon domains other than amazon.com are not enabled.
- Chrome only (Manifest V3, Chrome 111+). The extension has not been tested in other Chromium browsers.

## Future improvements

- Run against real captures from several accounts and categories, then fold what is learned into the fixtures.
- Optional request blocking for known ad endpoints via `declarativeNetRequest` (new permission, opt-in).
- A "never hide this" button on debug outlines that writes the ASIN or selector to the allowlist.
- Per-region enablement through optional host permissions and dynamic content script registration, so regions can be turned on without editing the manifest.
- A canary page-health report that can be pasted into an issue when a layout changes.
- Mobile (`/gp/aw`) layouts.

## Development

Dev tooling needs Node 18+ and Playwright; the extension itself needs neither.

```
npm install                 # playwright (uses its own Chromium)
npm run test:unit           # pure logic, privacy and manifest guards
npm run test:engine         # engine against fixtures in real Chromium
npm run test:e2e            # the real extension loaded into Chromium
npm run bench:accuracy      # precision / recall over a seeded corpus
npm run bench:perf          # with vs without the extension
npm run package             # clearshelf-<version>.zip (extension files only)
```

See [docs/TESTING.md](docs/TESTING.md) for the test strategy, results and what they do not show.
