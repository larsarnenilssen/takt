# Biblioteker for PDF-import

Filene her brukes bare når en turnus importeres fra PDF. De lastes først når
importen startes, og lagres da for bruk uten nett (se `VENDOR_FILES` i
`js/version.js`). Ingen av dem sender noe ut fra telefonen.

| Mappe | Hva | Versjon | Lisens |
|---|---|---|---|
| `pdfjs/` | pdf.js fra Mozilla: åpner PDF-en og tegner siden. `openjpeg.wasm` leser JPEG 2000-bilder, som skannere ofte lager. | 6.4.195 (bygget for Firefox, hentet fra `mozilla-firefox/firefox`, `toolkit/components/pdfjs`) | Apache 2.0 (i `pdf.mjs`), OpenJPEG: BSD-2 (`LICENSE_OPENJPEG`) |
| `tesseract/` | Tesseract, tekstgjenkjenning kompilert til WebAssembly (`tesseract.js-core`, bare LSTM, med SIMD), og den engelske modellen `eng.traineddata` fra `tessdata_fast`, pakket med gzip. | tesseract.js-core 7.0.0 | Apache 2.0 (`LICENSE`) |

pdf.js-bygget for Firefox bruker noen nye JavaScript-funksjoner. De legges til
i andre nettlesere av `js/import/pdf-compat.mjs`, som lastes før pdf.js både i
appen og i pdf.js-tråden (`js/import/pdf-worker.mjs`).

Oppdateres bibliotekene, endres `VENDOR_VERSION` i `js/version.js`, og testen
`test_import_pdf_with_review` kjøres for å se at den oppdiktede planen i
`tests/fixtures` fortsatt leses riktig.
