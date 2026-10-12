# FizzFinder (Dirty Soda Library)

A static, offline-friendly drink finder at `/dirty-soda/`. No backend, no accounts, no runtime libraries.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole app: design tokens and CSS, markup, SVG icon sprite, and JavaScript. |
| `menus.js` | The drink library. One string per drink: `Name\|Base(s) joined by /\|ingredient, ingredient\|flags`. Flags: `sf`, `seasonal`, `limited`, `blended`, `board`. |
| `sw.js` | Service worker. Network first, cache fallback, so the app works offline after one visit. |
| `manifest.webmanifest` | Install metadata and icons. |
| `fonts/` | Space Grotesk (500, 700) and Inter (400, 500, 600), Latin subset, woff2. About 50 KB total. |
| `brand/` | SVG logo variants and PNG app icons (see below). |

## Data model

`makeItem()` turns a menu line into a drink: `{ id, shop, cat, name, bases, fams, ings, forms, tags, sf, caf, seasonal, blended, board }`.

- `fams` are soda base families (Dr Pepper, Coke, Mtn Dew, Lemon-Lime, Water, Energy, and so on) found by `baseFamily()`.
- `ings` are normalized ingredient keys from `canon()`. `forms[key]` records how each one is used: `flavor` (syrup shot, also the default when a menu just names a flavor), `sf`, `puree`, `frozen`, `fruit`, `fresh`, `pearls`. Peach flavor, peach puree and frozen peach stay distinct.
- `tags` count flavor traits (tropical, creamy, berry, tart, dessert, cozy, candy, floral, chocolate, orchard) from `TAG_RULES`.

## Matching and recommendations (hand-built, no AI)

- **Moods** (`MOODS`): weighted tag and base-family scores per drink.
- **Vibes** (`PROFILES`): about 45 flavor or vibe phrases mapped to weighted ingredients. Direct ingredient names also match. A drink whose name matches the search gets a bonus. Unknown phrases fall back to name and ingredient text search.
- **Match label**: relative to the best result (Strong, Good, Partial) with the reasons listed under "See why it matches".
- **Custom builds** (vibe panel and Remix) are always labeled "Custom build". Existing menu drinks are labeled "On the menu".
- **Remix**: mutates a popularity-weighted source drink (add, remove, swap, change form, swap soda). Candidates must co-occur with the remaining ingredients somewhere in the library (`PAIR`), swaps stay within a flavor family, and results that already exist on a menu are rejected.

## Browser storage (localStorage)

`ds_favs`, `ds_tried`, `ds_custom` (menus the user added), `ds_disabled` (shops switched off), `ds_filters`, `ds_remixes`. The Menus tab can copy and restore all of it as JSON. Nothing is sent anywhere.

## Brand

Colors: Deep Navy `#0A1A2F`, Electric Blue `#1E58FF`, Aqua `#12D6D0`, Grape `#A855F7`, Ice `#F1F5F9`, Slate `#CBD5E1`, Charcoal `#111827`. Blue marks primary actions and selection, aqua marks focus and discovery, grape marks flavor categories and Remix. Muted text uses a darker slate (`--muted`) for contrast.

Logo variants in `brand/`: `fizzfinder-primary` (descriptor and tagline), `fizzfinder-horizontal`, `fizzfinder-compact`, `fizzfinder-compact-dark`, `fizzfinder-icon`, `fizzfinder-app-icon`, `fizzfinder-dark`, `fizzfinder-mono`, `fizzfinder-mono-white`. The wordmark is outlined paths (Barlow Condensed 800 Italic, Space Grotesk 700 and Inter 400 for the descriptor and tagline), so it needs no font to render.

## Testing notes

Checked in headless Chromium over HTTP:

- **Layout**: no horizontal overflow at 320, 360, 390, 768, 1024 and 1280 px on all four views. Bottom navigation on phones, top navigation from 760 px.
- **Core flows**: shop, mood, soda base, must-have and skip ingredients, form, caffeine, sugar free, favorites and not-tried filters; flavor and vibe search; surprise pick; all five Remix modes; save, copy order, remix again; favorites, tried and saved remixes; add menu; backup and restore round trip.
- **Offline**: after one visit the service worker serves the page, menus, fonts and logo with the network off, and vibe search still works.
- **Accessibility**: every button has an accessible name, toggles use `aria-pressed`, panels use `aria-expanded`, focus is visible, results announce through a live region, and `prefers-reduced-motion` is respected.
- **Content**: no emoji and no em dashes in the rendered interface.
