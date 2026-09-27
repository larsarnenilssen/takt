'use strict';
/* Takt – tekstgjenkjenning i en egen tråd, slik at appen ikke stopper opp.
   Bruker Tesseract (Apache 2.0) fra vendor/tesseract. Lastes bare ved import av turnus.
   Meldinger inn:  { id, cmd: 'init', base }  og  { id, cmd: 'read', w, h, g, psm, allow }
   Meldinger ut:   { id, ok: true, text }  eller  { id, ok: false, error } */
let core = null, api = null;

async function init(base) {
  if (api) return;
  importScripts(base + 'tesseract-core-simd-lstm.js');
  core = await self.TesseractCore({ locateFile: f => base + f });
  const res = await fetch(base + 'eng.traineddata.gz');
  if (!res.ok) throw new Error('traineddata ' + res.status);
  const data = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  core.FS.writeFile('/eng.traineddata', data);
  api = new core.TessBaseAPI();
  if (api.Init('/', 'eng', 1) !== 0) throw new Error('init');   // 1 = bare LSTM
}

function read({ w, h, g, psm, allow }) {
  api.SetVariable('tessedit_char_whitelist', allow || '');
  api.SetPageSegMode(psm);
  // Bildet skrives som PGM (gråtoner) til filsystemet i Tesseract, som leser det selv
  const head = new TextEncoder().encode('P5\n' + w + ' ' + h + '\n255\n');
  const file = new Uint8Array(head.length + g.length);
  file.set(head); file.set(g, head.length);
  core.FS.writeFile('/input', file);
  if (api.SetImageFile(1, 0) === 1) throw new Error('image');
  api.SetSourceResolution(300);
  const text = api.GetUTF8Text();
  api.Clear();
  return text.trim();
}

self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.cmd === 'init') { await init(m.base); self.postMessage({ id: m.id, ok: true }); }
    else self.postMessage({ id: m.id, ok: true, text: read(m) });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};
