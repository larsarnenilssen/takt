'use strict';
/* ---------- turnus fra PDF: lese planen og lage et forslag ----------
   PDF-en tegnes med pdf.js, tabellen finnes med grid.js, og skriften i rutene
   leses med Tesseract i ocr-worker.js. Resultatet er et forslag som brukeren
   kontrollerer før noe lagres (se views/rotaimport.js).
   Ruter som ser like ut, leses samlet. Da blir lesningen sikrere, og
   brukeren kontrollerer én gang per kode i stedet for én gang per dag. */
const VENDOR = 'vendor/';
const OCR_ALLOW = 'ABCDEFGHJKLMNOPRSTUVWXYZ0123456789';
const DATE_ALLOW = 'Ukeak:/()0123456789.- ';
const PSM_LINE = 7, PSM_RETRY = [8, 13];

/* Tegner første side av PDF-en i 300 dpi og gir RGBA-piksler */
async function renderPdf(bytes) {
  await import(new URL('js/import/pdf-compat.mjs', document.baseURI).href);
  const pdfjs = await import(new URL(VENDOR + 'pdfjs/pdf.mjs', document.baseURI).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('js/import/pdf-worker.mjs', document.baseURI).href;
  const task = pdfjs.getDocument({ data: bytes, wasmUrl: new URL(VENDOR + 'pdfjs/', document.baseURI).href, isEvalSupported: false });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 300 / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return { rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data, w: canvas.width, h: canvas.height };
  } finally { task.destroy(); }
}

/* Tekstgjenkjenning i egen tråd. Én instans per import. */
function ocrClient() {
  const worker = new Worker('js/import/ocr-worker.js');
  const wait = new Map();
  let seq = 0;
  worker.onmessage = e => { const p = wait.get(e.data.id); wait.delete(e.data.id); e.data.ok ? p.res(e.data.text) : p.rej(new Error(e.data.error)); };
  const call = (msg, transfer) => new Promise((res, rej) => { const id = ++seq; wait.set(id, { res, rej }); worker.postMessage({ ...msg, id }, transfer || []); });
  return {
    init: () => call({ cmd: 'init', base: new URL(VENDOR + 'tesseract/', document.baseURI).href }),
    read: (img, allow, psm) => { const g = img.g.slice(); return call({ cmd: 'read', w: img.w, h: img.h, g, psm: psm || PSM_LINE, allow }, [g.buffer]); },
    close: () => worker.terminate(),
  };
}

/* Et lite bilde av gruppen, til kontrollen */
function thumbUrl(img) {
  const c = document.createElement('canvas');
  c.width = img.w; c.height = img.h;
  const ctx = c.getContext('2d'), d = ctx.createImageData(img.w, img.h);
  for (let i = 0; i < img.g.length; i++) { const v = img.g[i]; d.data.set([v, v, v, 255], i * 4); }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
}

/* Leser en turnus-PDF. vocab: kjente vaktkoder. progress(steg, andel).
   Gir { weeks: [{ monday, days: [celle × 7] }] } der en celle er
   { kind: 'text', code, sure, thumb } eller { kind: 'empty' | 'absent' | 'hatch' }.
   Hver rute leses i tre størrelser. Ruter som ser like ut, leses i tillegg
   samlet som et gjennomsnittsbilde, som teller med i avgjørelsen. */
const CELL_SCALES = [2, 1, 3];
const MEAN_WEIGHT = 0.75;
async function readRotaPdf(bytes, vocab, progress) {
  progress('render', 0);
  const page = await renderPdf(bytes);
  progress('table', 0.1);
  const table = locateTable(imageFromRgba(page.rgba, page.w, page.h));
  if (!table) throw new UserError(T.rota.pdfNoTable);
  const { img, cols, rows } = table;

  const ocr = ocrClient();
  try {
    progress('ocr', 0.15);
    await ocr.init();
    const nRows = rows.length - 1;
    const dateTexts = [];
    for (let r = 0; r < nRows; r++) {
      const c = crop(img, cols[0] + 6, rows[r] + 6, cols[1] - 6, rows[r + 1] - 6);
      dateTexts.push(await ocr.read(padScale(c, 10, 1), DATE_ALLOW));
    }
    // Overskriftsrader (uten tall) øverst hoppes over
    let first = 0;
    while (first < nRows && !/\d/.test(dateTexts[first])) first++;
    const dates = weekDates(dateTexts.slice(first));
    if (!dates) throw new UserError(T.rota.pdfNoDates);

    const weeks = [], cells = [];
    for (let r = first; r < nRows; r++) {
      const days = [];
      for (let c = 1; c <= 7; c++) {
        const cell = readCell(img, cols[c], rows[r], cols[c + 1], rows[r + 1]);
        if (cell.kind === 'text') { cell.f = features(img, cell.tight); cells.push(cell); }
        days.push(cell);
      }
      weeks.push({ monday: iso(dates[r - first]), days });
    }
    progress('ocr', 0.25);

    for (let i = 0; i < cells.length; i++) {
      const im = crop(img, ...cells[i].box);
      cells[i].reads = [];
      for (const sc of CELL_SCALES) cells[i].reads.push({ text: await ocr.read(padScale(im, 12, sc), OCR_ALLOW), w: 1 });
      // Blir ingenting lest, prøves ruten som ett ord og som rå tekst
      if (!cells[i].reads.some(r => r.text)) for (const psm of PSM_RETRY) cells[i].reads.push({ text: await ocr.read(padScale(im, 12, 2), OCR_ALLOW, psm), w: 1 });
      cells[i].thumb = thumbUrl(padScale(im, 2, 1));
      progress('ocr', 0.25 + 0.6 * (i + 1) / cells.length);
    }
    for (const gr of clusterCells(cells.map(c => ({ f: c.f, cell: c })))) {
      if (gr.items.length < 2) continue;
      const mean = meanImage(img, gr.items.map(it => it.cell.box));
      const extra = [];
      for (const sc of [2, 1]) extra.push({ text: await ocr.read(padScale(mean, 12, sc), OCR_ALLOW), w: MEAN_WEIGHT });
      gr.items.forEach(it => it.cell.reads.push(...extra));
    }
    progress('ocr', 1);
    for (const w of weeks) {
      w.days = w.days.map(c => {
        if (c.kind !== 'text') return { kind: c.kind };
        const snap = snapCode(c.reads, vocab);
        return { kind: 'text', code: snap.code, sure: snap.sure, thumb: c.thumb };
      });
    }
    return { weeks };
  } finally { ocr.close(); }
}
