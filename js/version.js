/* Takt – versjon og filliste.
   Lastes både av appen og av service workeren (sw.js), slik at lageret
   for bruk uten nett får nytt navn hver gang versjonen endres.
   Legges det til en fil i appen, må den også stå i APP_FILES.
   VENDOR_FILES er store biblioteker for PDF-import. De lagres første gang
   de brukes, i et eget lager som bare byttes når VENDOR_VERSION endres. */
const APP_VERSION = '1.2.2';
const APP_FILES = [
  './', './index.html', './personvern.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png',
  './styles/tokens.css', './styles/app.css',
  './js/version.js', './js/config.js', './js/text.nb.js', './js/util.js', './js/migrate.js', './js/store.js',
  './js/domain/rota.js', './js/domain/places.js', './js/domain/travel.js', './js/domain/items.js', './js/domain/home.js', './js/domain/sync.js', './js/domain/google.js', './js/domain/drive.js', './js/domain/calendar.js',
  './js/import/grid.js', './js/import/rotapdf.js', './js/import/ocr-worker.js', './js/import/pdf-compat.mjs', './js/import/pdf-worker.mjs',
  './js/views/sheet.js', './js/views/page.js', './js/views/calendar.js', './js/views/rota.js', './js/views/travel.js', './js/views/items.js', './js/views/settings.js', './js/views/backup.js', './js/views/calsync.js', './js/views/swipe.js',
  './js/app.js',
];
const VENDOR_VERSION = 'pdfjs-6.4.195_tesseract-core-7.0.0';
const VENDOR_FILES = [
  './vendor/pdfjs/pdf.mjs', './vendor/pdfjs/pdf.worker.mjs', './vendor/pdfjs/openjpeg.wasm',
  './vendor/tesseract/tesseract-core-simd-lstm.js', './vendor/tesseract/tesseract-core-simd-lstm.wasm', './vendor/tesseract/eng.traineddata.gz',
];
