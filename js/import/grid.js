'use strict';
/* ---------- turnus fra PDF: finne tabellen og rutene i et bilde ----------
   Rene funksjoner uten DOM og uten appdata, slik at de kan testes hver for seg.
   Et bilde er { w, h, g, p }: g er gråtoner (0 = svart), p markerer rosa
   bakgrunn (1 = rosa), begge Uint8Array med én verdi per piksel.

   Kalenderplanen fra GAT er en tabell med én rad per uke og kolonnene
   Dato, mandag … søndag. Skannede planer kan ligge på siden, så tabellen
   letes etter i alle fire retninger. Datokolonnen er den bredeste og står
   til venstre når bildet står riktig. */

const GRID = {
  INK: 120,          // mørkere enn dette er skrift eller strek
  INK_FAINT: 175,    // svak skrift, brukes bare for å finne hele koden
  LINE_MIN: 0.3,     // en tabellstrek er minst så lang, som andel av bildet
  LINE_GAP: 4,       // strekpiksler nærmere enn dette hører til samme strek
  SPAN_HATCH: 0.8,   // skrift som dekker så mye av bredden, er skravering
  HATCH_BLOBS: 40,   // flere mørke biter enn dette i én rute er skravering
  INK_MIN: 30,       // færre mørke piksler enn dette er en tom rute
  PINK_MIN: 0.5,     // andel rosa bakgrunn som betyr fravær
  FH: 24, FW: 64,    // størrelse på kjennetegnet som rutene sammenlignes med
  SAME: 0.08,        // største avstand mellom ruter med samme kode
};

/* Bilde fra RGBA-piksler (canvas) */
function imageFromRgba(rgba, w, h) {
  const n = w * h, g = new Uint8Array(n), p = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = rgba[j], gr = rgba[j + 1], b = rgba[j + 2];
    g[i] = (r * 299 + gr * 587 + b * 114) / 1000;
    p[i] = r > 180 && r - gr > 30 && b - gr > 10 ? 1 : 0;
  }
  return { w, h, g, p };
}

/* Roterer et kvart omdreining med klokken, q ganger */
function rotateImage(img, q) {
  q = ((q % 4) + 4) % 4;
  if (!q) return img;
  const { w, h } = img, W = q % 2 ? h : w, H = q % 2 ? w : h;
  const g = new Uint8Array(w * h), p = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let X, Y;
      if (q === 1) { X = h - 1 - y; Y = x; } else if (q === 2) { X = w - 1 - x; Y = h - 1 - y; } else { X = y; Y = w - 1 - x; }
      const s = y * w + x, d = Y * W + X;
      g[d] = img.g[s]; p[d] = img.p[s];
    }
  }
  return { w: W, h: H, g, p };
}

/* Midten av hver lange strek. horizontal: streker på tvers (én per y). */
function findLines(img, horizontal) {
  const { w, h, g } = img, n = horizontal ? h : w, len = horizontal ? w : h;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) dark[i] = g[i] < GRID.INK ? 1 : 0;
  const at = horizontal ? (i, j) => dark[i * w + j] : (i, j) => dark[j * w + i];
  const hits = [];
  for (let i = 0; i < n; i++) {
    let run = 0, best = 0;
    for (let j = 0; j < len; j++) {
      // Skannede streker kan være litt skjeve, så nabolinjene teller med
      let d = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2) && !d; k++) d = at(k, j);
      if (d) { if (++run > best) best = run; } else run = 0;
    }
    if (best >= GRID.LINE_MIN * len) hits.push(i);
  }
  const out = [];
  let grp = [];
  for (const i of hits) {
    if (grp.length && i - grp[grp.length - 1] > GRID.LINE_GAP) { out.push((grp[0] + grp[grp.length - 1]) / 2); grp = []; }
    grp.push(i);
  }
  if (grp.length) out.push((grp[0] + grp[grp.length - 1]) / 2);
  return out;
}

const similar = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(a, b);

/* Åtte kolonner: den første bredest (dato), de sju neste like brede */
function pickColumns(xs) {
  for (let s = 0; s + 8 < xs.length; s++) {
    const w = [];
    for (let k = 0; k < 8; k++) w.push(xs[s + k + 1] - xs[s + k]);
    const day = w.slice(1);
    const avg = day.reduce((a, b) => a + b, 0) / 7;
    if (day.every(x => similar(x, avg, 0.15)) && w[0] > 1.5 * avg) return xs.slice(s, s + 9);
  }
  return null;
}

/* Den lengste rekken av rader med lik høyde */
function pickRows(ys) {
  let best = [];
  for (let s = 0; s + 1 < ys.length; s++) {
    const h0 = ys[s + 1] - ys[s];
    let e = s + 1;
    while (e + 1 < ys.length && similar(ys[e + 1] - ys[e], h0, 0.2)) e++;
    if (e - s > best.length - 1) best = ys.slice(s, e + 1);
  }
  return best.length >= 3 ? best : null;
}

/* Finner tabellen og snur bildet riktig. Gir { img, cols, rows } eller null. */
function locateTable(img) {
  for (const q of [0, 1, 3, 2]) {
    const r = rotateImage(img, q);
    const cols = pickColumns(findLines(r, false));
    if (!cols) continue;
    const rows = pickRows(findLines(r, true));
    if (rows) return { img: r, cols, rows, turns: q };
  }
  return null;
}

/* ---------- rutene ---------- */
function crop(img, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
  x1 = Math.min(img.w, Math.round(x1)); y1 = Math.min(img.h, Math.round(y1));
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) g.set(img.g.subarray((y0 + y) * img.w + x0, (y0 + y) * img.w + x0 + w), y * w);
  return { w, h, g };
}

/* Sammenhengende mørke flekker i et område (4-naboer): [{ n, x0, y0, x1, y1 }] */
function blobs(img, X0, Y0, X1, Y1) {
  const w = X1 - X0, h = Y1 - Y0, seen = new Uint8Array(w * h), out = [], stack = [];
  const dark = (x, y) => img.g[(Y0 + y) * img.w + X0 + x] < GRID.INK;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !dark(x, y)) continue;
      const b = { n: 0, x0: x, y0: y, x1: x, y1: y };
      seen[y * w + x] = 1; stack.push(x, y);
      while (stack.length) {
        const cy = stack.pop(), cx = stack.pop();
        b.n++;
        if (cx < b.x0) b.x0 = cx; if (cx > b.x1) b.x1 = cx; if (cy < b.y0) b.y0 = cy; if (cy > b.y1) b.y1 = cy;
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !dark(nx, ny)) continue;
          seen[ny * w + nx] = 1; stack.push(nx, ny);
        }
      }
      out.push({ n: b.n, x0: b.x0 + X0, y0: b.y0 + Y0, x1: b.x1 + X0, y1: b.y1 + Y0 });
    }
  }
  return out;
}

/* Hva som står i en rute: tom, fravær (rosa), skravert (utenfor planen) eller skrift.
   Små flekker fra skanningen og rester av streker regnes ikke med. */
function readCell(img, x0, y0, x1, y1) {
  const m = Math.round(0.12 * (y1 - y0));
  const X0 = Math.round(x0 + m), Y0 = Math.round(y0 + m), X1 = Math.round(x1 - m), Y1 = Math.round(y1 - m);
  let pink = 0, bg = 0;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const i = y * img.w + x; if (img.g[i] >= GRID.INK) { bg++; pink += img.p[i]; } }
  const found = blobs(img, X0, Y0, X1, Y1);
  // Skravering blir til mange små biter; skrift er noen få tegn og litt støy
  if (found.length > GRID.HATCH_BLOBS) return { kind: 'hatch' };
  const all = found.filter(b => b.n >= 8);
  const tall = Math.max(0, ...all.map(b => b.y1 - b.y0 + 1));
  const marks = all.filter(b => b.y1 - b.y0 + 1 >= 0.4 * tall);
  const ink = marks.reduce((s, b) => s + b.n, 0);
  if (ink < GRID.INK_MIN) return { kind: pink / Math.max(1, bg) >= GRID.PINK_MIN ? 'absent' : 'empty' };
  let bx0 = Math.min(...marks.map(b => b.x0)), bx1 = Math.max(...marks.map(b => b.x1));
  if ((bx1 - bx0) / (X1 - X0) >= GRID.SPAN_HATCH || tall >= 0.85 * (Y1 - Y0)) return { kind: 'hatch' };
  const by0 = Math.min(...marks.map(b => b.y0)), by1 = Math.max(...marks.map(b => b.y1));
  // Tynne, lyse tegn (som «7» og «1») kan falle under grensen. Ta med svakere
  // skrift på samme linje, helt til det kommer et tomrom.
  const faint = x => { for (let y = by0; y <= by1; y++) if (img.g[y * img.w + x] < GRID.INK_FAINT) return true; return false; };
  const gap = Math.round(0.5 * (by1 - by0 + 1));
  for (const dir of [1, -1]) {
    let x = dir > 0 ? bx1 : bx0, empty = 0;
    while (empty < gap) {
      x += dir;
      if (x < X0 || x >= X1) break;
      if (faint(x)) { empty = 0; if (dir > 0) bx1 = x; else bx0 = x; } else empty++;
    }
  }
  return { kind: 'text', box: [bx0 - 4, by0 - 4, bx1 + 5, by1 + 5], tight: [bx0, by0, bx1 + 1, by1 + 1] };
}

/* Skriften skalert til fast høyde, som mørkhet 0–1 (FW × FH) */
function features(img, box) {
  const c = crop(img, ...box);
  const { FH, FW } = GRID, f = new Float32Array(FH * FW);
  const w = Math.min(FW, Math.max(1, Math.round(c.w * FH / c.h)));
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < w; x++) {
      // Snitt over området i originalen som svarer til denne pikselen
      const sx0 = Math.floor(x * c.w / w), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * c.w / w));
      const sy0 = Math.floor(y * c.h / FH), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * c.h / FH));
      let s = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) s += c.g[yy * c.w + xx];
      f[y * FW + x] = 1 - s / ((sy1 - sy0) * (sx1 - sx0) * 255);
    }
  }
  const out = blur(blur(f));
  out.used = w;
  return out;
}
/* Utjevning 3 × 3, slik at en forskyvning på én piksel betyr lite */
function blur(f) {
  const { FH, FW } = GRID, o = new Float32Array(f.length);
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < FH && xx >= 0 && xx < FW) { s += f[yy * FW + xx]; n++; }
      }
      o[y * FW + x] = s / n;
    }
  }
  return o;
}
/* Snittforskjell over bredden skriften faktisk bruker, slik at ett ulikt tegn
   (F1/F2) teller like mye i korte som i lange koder */
function distance(a, b) {
  if (!similar(a.used || GRID.FW, b.used || GRID.FW, 0.2)) return Infinity;   // ulikt antall tegn
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / (GRID.FH * Math.max(a.used || GRID.FW, b.used || GRID.FW));
}

/* Grupperer ruter som ser like ut. Hver gruppe får ett kodeforslag. */
function clusterCells(items) {
  const groups = [];
  for (const it of items) {
    let best = null, bd = Infinity;
    for (const gr of groups) { const d = distance(it.f, gr.mean); if (d < bd) { bd = d; best = gr; } }
    if (best && bd < GRID.SAME) {
      best.items.push(it);
      const n = best.items.length;
      for (let i = 0; i < best.mean.length; i++) best.mean[i] += (it.f[i] - best.mean[i]) / n;
    } else { const mean = Float32Array.from(it.f); mean.used = it.f.used; groups.push({ items: [it], mean }); }
  }
  return groups;
}

/* Gjennomsnittsbilde av rutene i en gruppe. Støy i skanningen jevnes ut. */
function meanImage(img, boxes) {
  const cs = boxes.map(b => crop(img, ...b));
  const w = Math.max(...cs.map(c => c.w)), h = Math.max(...cs.map(c => c.h));
  const acc = new Float32Array(w * h).fill(0);
  for (const c of cs) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) acc[y * w + x] += x < c.w && y < c.h ? c.g[y * c.w + x] : 255;
  }
  const g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = acc[i] / cs.length;
  return { w, h, g };
}

/* Hvit kant rundt og skalering (bilineær). Tekstgjenkjenningen liker luft og større skrift. */
function padScale(img, pad, scale) {
  const W = Math.round((img.w + 2 * pad) * scale), H = Math.round((img.h + 2 * pad) * scale);
  const g = new Uint8Array(W * H);
  const px = (x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h) ? 255 : img.g[y * img.w + x];
  for (let Y = 0; Y < H; Y++) {
    const fy = Y / scale - pad - 0.5 + 0.5 / scale, y0 = Math.floor(fy), ty = fy - y0;
    for (let X = 0; X < W; X++) {
      const fx = X / scale - pad - 0.5 + 0.5 / scale, x0 = Math.floor(fx), tx = fx - x0;
      const a = px(x0, y0) * (1 - tx) + px(x0 + 1, y0) * tx;
      const b = px(x0, y0 + 1) * (1 - tx) + px(x0 + 1, y0 + 1) * tx;
      g[Y * W + X] = a * (1 - ty) + b * ty;
    }
  }
  return { w: W, h: H, g };
}

/* ---------- fra gjenkjent tekst til vaktkode ----------
   Enkelte tegn forveksles ofte i skannede planer (1/I/T, 8/S, V/Y, O/0).
   Avstanden til hver kjent kode regnes med lavere pris for slike bytter,
   og for et tynt «1» som har falt bort eller kommet til. */
const CONFUSED = ['1ITLY7', '8SB3', 'VYW', 'O0Q', 'DO0C', '2Z', '5S', 'NM', 'HA'];
function subCost(a, b) {
  if (a === b) return 0;
  return CONFUSED.some(s => s.includes(a) && s.includes(b)) ? 0.3 : 1;
}
const indelCost = c => c === '1' ? 0.5 : 1;
function codeDistance(raw, code) {
  const a = raw, b = code, m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) d[i][0] = d[i - 1][0] + indelCost(a[i - 1]);
  for (let j = 1; j <= n; j++) d[0][j] = d[0][j - 1] + indelCost(b[j - 1]);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + indelCost(a[i - 1]), d[i][j - 1] + indelCost(b[j - 1]), d[i - 1][j - 1] + subCost(a[i - 1], b[j - 1]));
    }
  }
  return d[m][n];
}
/* Beste kode ut fra flere lesninger av samme rute. reads: [{ text, w }], der w
   er hvor mye lesningen teller. Koden med minst samlet avstand vinner.
   sure: trygg nok til å brukes uten at brukeren må se på den. */
const cleanRead = t => String(t || '').toUpperCase().replace(/[^A-ZÆØÅ0-9]/g, '');
const NEW_AGREE = 0.75;   // andel av lesningene som må være like for en ny kode
function snapCode(reads, vocab) {
  const rs = reads.map(r => ({ t: cleanRead(r.text), w: r.w })).filter(r => r.t);
  if (!rs.length) return { code: '', sure: false };
  const wsum = rs.reduce((s, r) => s + r.w, 0);
  const scored = vocab.map(code => ({ code, d: rs.reduce((s, r) => s + r.w * codeDistance(r.t, code), 0) / wsum })).sort((x, y) => x.d - y.d);
  const [a, b] = scored;
  // Et helt annet tegn (avstand 1) betyr en ny kode, ikke en feillesning
  if (a && a.d < 0.95 && (!b || b.d - a.d >= 0.3)) return { code: a.code, sure: a.d <= 0.4 && (!b || b.d - a.d >= 0.5) };
  // Ukjent kode: bruk lesningen som går igjen oftest. Er nesten alle lesningene
  // like, er det trolig en ny kode (den må uansett få tider i kontrollen).
  const count = t => rs.filter(r => r.t === t).reduce((s, r) => s + r.w, 0);
  const top = [...rs].sort((x, y) => count(y.t) - count(x.t))[0].t;
  return { code: top, sure: rs.length >= 3 && count(top) >= NEW_AGREE * wsum };
}

/* ---------- datoene i første kolonne ----------
   Hver rad starter med «Uke a:31 / k:40 (28.09.2026 - …». Radene følger
   hverandre uke for uke, så den mandagen flest rader er enige om, vinner.
   Rader som ikke kunne leses, får dato ut fra naboene. */
function parseWeekStart(text) {
  const m = String(text).replace(/[oO]/g, '0').match(/(\d{1,2})\s*[.,]\s*(\d{1,2})\s*[.,]\s*(\d{4})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (d.getDate() !== Number(m[1]) || d.getDay() !== 1) return null;
  return d;
}
function weekDates(texts) {
  const votes = new Map();
  texts.forEach((t, i) => {
    const d = parseWeekStart(t);
    if (!d) return;
    const anchor = new Date(d); anchor.setDate(anchor.getDate() - 7 * i);
    const k = anchor.getFullYear() + '-' + (anchor.getMonth() + 1) + '-' + anchor.getDate();
    votes.set(k, (votes.get(k) || { n: 0, d: anchor })); votes.get(k).n++;
  });
  if (!votes.size) return null;
  const best = [...votes.values()].sort((a, b) => b.n - a.n)[0];
  return texts.map((t, i) => { const d = new Date(best.d); d.setDate(d.getDate() + 7 * i); return d; });
}
