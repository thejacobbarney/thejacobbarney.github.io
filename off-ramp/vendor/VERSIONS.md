# Vendored libraries

Self-hosted (not loaded from a CDN) so document parsing works offline and the
site has no third-party runtime dependency. Both are loaded lazily — only
when the Import view actually parses a PDF or DOCX — so they don't add to
the initial page weight.

| Library | Version | Source | License |
|---|---|---|---|
| pdf.js (`pdfjs-dist`) | 6.2.108 | `build/pdf.min.mjs` + `build/pdf.worker.min.mjs` from npm | Apache-2.0 |
| mammoth.js | 1.12.1 | `mammoth.browser.min.js` from npm | BSD-2-Clause |

To upgrade: `npm install pdfjs-dist@latest mammoth@latest` somewhere, then
copy the same files back into `pdfjs/` and `mammoth/` respectively.
