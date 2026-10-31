# Testing Clearshelf

## What the testing can and cannot show

Amazon.com is not reachable from the environment this was built in, so **nothing here was run against live Amazon**. Every test page is a *synthetic reconstruction* of Amazon's markup patterns (`tests/fixtures/markup.js`), written by the same author as the engine. That has two consequences:

- A pass means the extension behaves correctly **on the modelled markup and the drift variants I thought of**. It is strong evidence about logic, safety checks, lifecycle, storage, popup and messaging, because those ran in real Chromium as a real loaded extension.
- A pass is **not** a measurement of accuracy on real Amazon. Precision and recall below are consistency numbers against my own fixtures. They would be optimistic for any real site. Live accuracy needs the manual procedure at the end of this file.

## Layers

| Layer | Command | Count | What it covers |
|---|---|---|---|
| Unit | `npm run test:unit` | 30 | Label matching (incl. false-positive titles), scoring and modes, settings sanitising, page classification, **package guards** |
| Engine | `npm run test:engine` | 30 | The real engine in Chromium on fixture pages: placements, adversarial layouts, incremental scans, allowlist, toggles, restoration |
| End to end | `npm run test:e2e` | 21 | The unpacked extension loaded into Chromium: content script, MV3 service worker, storage, popup UI, SPA navigation, notices, badge, network |
| Accuracy bench | `npm run bench:accuracy` | 240 pages x 5 conditions | Precision, recall, organic preservation |
| Performance bench | `npm run bench:perf` | 9 runs, on vs off | Load impact, CPU, heap, mutation bursts |

All 81 functional tests pass on the final code (30 + 30 + 21).

### Package guards (`tests/unit/package.test.js`)

These make the privacy claims executable:
- manifest is MV3, `permissions` is exactly `["storage"]`, no `host_permissions`, no `externally_connectable`, no `web_accessible_resources`;
- content-script matches are `https://(www.)amazon.com/*` only, top frame only;
- every file the manifest references exists;
- shipped code contains no `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `eval(`, `new Function(`, remote `importScripts` or script tags, or analytics identifiers;
- shipped code never reads the test ground-truth attributes (`data-truth`, `data-variant`), so the engine cannot "cheat";
- the only URLs in shipped code are inert.

### Engine and adversarial scenarios

Covered (see `tests/engine/*.test.js`):

- Standard mixed search page with brand banner, video ad, sponsored carousel and 8 sponsored-card variants (current markup, legacy markup, text-only label, label with info glyph, link-only, aria-only, Spanish, German).
- Hidden items are really `display: none`; footer, nav and refinements untouched.
- **Organic items that look like ads:** titles such as "Ad Hoc Wireless Networking", "Sponsored" (a book), "The Sponsored Content Playbook", "AD&D Player's Handbook"; "Best Seller" and deal badges; `Interest-Based Ads` in the footer.
- **Ambiguous labels:** a lone "Ad" is kept in Balanced and removed only in Aggressive. Link-only and label-only ads need Aggressive/Balanced and are skipped in Strict.
- Product pages: heading-labelled and per-card-labelled sponsored carousels, organic carousel beside them, iframe banner with "Ad feedback"; buy box, title and add-to-cart verified visible.
- Homepage cards and banner.
- Mixed carousel where one card is sponsored: only that card goes.
- Allowlist by ASIN and by selector (including an invalid selector).
- Placement toggles.
- **Dynamic content:** nodes added later, a label added to an existing card, a label removed from a hidden card (it is restored), repeated scans are idempotent and do not double count, counts equal placements, `clearAll` leaves no trace.
- **Adversarial layouts built to fool the heuristics**, each run in three layout versions (as-is, all classes renamed, classes and data attributes removed) and all three modes:
  - product-less sponsored video next to an organic carousel under a shared parent (this one **failed** before the "every product must carry evidence" rule was added to inferred modules; it is the reason that rule exists);
  - "Sponsored" label sitting outside its card as a preceding sibling;
  - "Sponsored" heading above a group of organic cards;
  - a review author named "Sponsored";
  - one sponsored tile in a grid of structurally identical organic tiles;
  - twelve nested single-child wrappers around an ad;
  - ad-like widget ids wrapped around organic results.

In every adversarial case the only acceptable failure is leaving an ad in place. Hiding anything organic fails the test.

### End-to-end scenarios

Run with the extension loaded via `--load-extension` in Chromium, pages served at `https://www.amazon.com/...` by request interception: search page at load; dynamic insertion (ad hidden in **6 ms** and **42 ms** in two runs); five infinite-scroll batches; same-document navigation from search to a product page; product page; homepage; master switch off and on; live placement and page toggles; debug overlay and diagnostics (asserted to contain no URLs and no product titles); ASIN and selector allowlist; fail-safe tripwire (and fail-safe off); unsupported layout (status, toast, `?` badge); stray label (partial status, toast); toast suppression setting; session statistics and badge maintained by the service worker; popup rendering live counts, persisting every kind of setting, validating allowlist input, two-step reset; popup on a non-Amazon tab; **network audit** (no requests from the service worker, none beyond the page's own).

Popup screenshots from these runs are in `docs/screens/`.

## Accuracy results

`npm run bench:accuracy`, 240 seeded pages (about 60% search, 20% product, 20% home), 1,365 sponsored placements and 4,624 organic ones. Raw data: `docs/results/accuracy.json`.

| Condition | Precision | Recall | Organic preserved | Organic hidden |
|---|---|---|---|---|
| Baseline markup, **Balanced** (default) | 100.00% | 100.00% | 100.00% | 0 |
| Baseline markup, Strict | 100.00% | 54.14% | 100.00% | 0 |
| Baseline markup, Aggressive | 100.00% | 100.00% | 100.00% | 0 |
| All CSS classes renamed, Balanced | 100.00% | 100.00% | 100.00% | 0 |
| Classes **and** data attributes removed, Balanced | 100.00% | 97.80% | 100.00% | 0 |

How to read this:

- **100% is a property of the fixtures, not of Amazon.** The corpus contains no ad without a label, class or ad link, and no layout I did not think of. Treat it as "the engine does what I designed it to do", not "it finds 100% of ads".
- The corpus **excludes the lone weak "Ad" label**, which is tested separately (kept in Balanced, removed in Aggressive). That is why Aggressive does not beat Balanced here. With real pages, Aggressive would be expected to add some false positives, which this corpus cannot show.
- Strict recall of 54% is by design: it needs two independent kinds of evidence.
- The 2.2% recall loss in the hardest condition (30 of 1,365 placements) has two causes, both with every structural hook removed:
  - 23 per-card-labelled carousels: the sponsored **cards are hidden**, but the empty outer module shell cannot be identified without any hook, so the outer unit is counted as a miss (a visible leftover heading and spacing, no products);
  - 7 of 24 carousels marked **only** by a heading label with plain product links. They are not removed, are counted as unresolved, and trigger the "partly active" notice. This is deliberate: guessing a module boundary there previously hid an organic carousel (see adversarial tests).
- In the other conditions the per-card shell is collapsed correctly because it does not depend on carousel class names.

## Performance results

`npm run bench:perf`: identical Chromium launch configuration with and without the extension, 9 runs (median) after a warm-up, on a synthetic search page with 300 result cards (about 9,100 DOM nodes, 49 sponsored placements). Raw data: `docs/results/perf.json`.

| Metric | Without | With | Difference |
|---|---|---|---|
| DOMContentLoaded | 34.8 ms | 78.3 ms | +43.5 ms |
| Load event | 69.7 ms | 130.3 ms | +60.6 ms |
| Script time (CDP `ScriptDuration`) | about 0 ms | 56.6 ms | +56.6 ms |
| Total task time | 78.8 ms | 146.7 ms | +67.9 ms |
| Layout | 21.4 ms | 18.2 ms | -3.2 ms (hidden items are not laid out) |
| JS heap | 0.66 MB | 2.44 MB | +1.8 MB |
| Sponsored hidden | 0 / 49 | 49 / 49 | |

Engine's own counters for that page: 6 scans, 66.6 ms total, 18 ms worst single scan (a full-document pass at load), 7.3 ms for the last. Mutation stress (20 bursts of 25 cards appended 20 ms apart): no long task observed, wall time unchanged (819 ms vs 829 ms), all newly added ads hidden.

Caveats: synthetic fixtures with `data:` images and no network, on one machine, headless. Absolute figures on real Amazon (heavier pages, more scripts, real network) will differ. CPU is reported as script and task time rather than percent utilisation. Memory is the JS heap of the page's isolated world plus page; the service worker's footprint was not measured separately.

## Not tested

- Live Amazon, any region, logged in or out, any experiment bucket, A/B layout, or device.
- Pages with Amazon's real CSP, real ad scripts, or real third-party iframes.
- Browsers other than Chromium; Chrome stable specifically (tested with Playwright's bundled Chromium).
- Accessibility with a screen reader. The popup uses native controls, labelled switches, `role="tab"` / `tabpanel`, `aria-live` status and visible focus, but has only been checked visually and by the automated tests.
- Long sessions (hours) and memory growth over time.
- Service-worker eviction mid-session (state is designed to survive, but not exercised).
- Dark mode was designed for but not screenshot-verified.

## Manual verification on real Amazon (recommended before relying on it)

1. Load unpacked, turn on **Debug mode**.
2. Visit, with a few different searches: a search page, a category page, a best-sellers page, 3 or more product pages (one with a sponsored carousel), and the homepage.
3. On each: every red outline must be an ad; no organic item may be outlined; note any ad without an outline.
4. **Copy diagnostics** on any page with a miss or false positive.
5. Count: sponsored shown by Amazon (compare with the extension switched off) vs outlined.
6. Turn Debug off, repeat quickly in Balanced.
7. Leave it on for a day and watch for the "?" or "!" badge; those mark pages it could not handle.

Record failures as new fixtures in `tests/fixtures` before changing the engine, so each fix stays covered.
