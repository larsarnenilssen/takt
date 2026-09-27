'use strict';
/* ---------- turnus skrevet inn for hånd ----------
   Et rutenett med én rad per uke og én kolonne per ukedag, som arket fra
   turnuskontoret. Velg en kode («pensel») og trykk på dagene, eller dra
   vannrett over en uke. Utkastet ligger i minnet til det lagres, så det
   overlever turen innom «Ny kode». */
const GRID_WEEKS = { def: 6, max: 26 };
let rotaDraft = null;   // { start (mandag), weeks, cells: { dato: kode }, touched: Set, brush, repeat }

function newRotaDraft() {
  const start = weekStart(todayISO());
  const d = { start, weeks: GRID_WEEKS.def, cells: {}, touched: new Set(), brush: codeList()[0] || '' };
  fillDraft(d);
  return d;
}
/* Dager i perioden som ikke er fylt inn ennå, får koden de har i dag (med endringer for hånd) */
function fillDraft(d) {
  for (const day of draftDays(d)) if (!(day in d.cells)) d.cells[day] = codeOn(day);
}
const draftDays = d => Array.from({ length: d.weeks * 7 }, (_, i) => addDays(d.start, i));
const draftEnd = d => addDays(d.start, d.weeks * 7 - 1);
const draftCount = d => draftDays(d).filter(day => { const c = d.cells[day]; return c && state.rota.codes[c] && state.rota.codes[c].kind !== 'off'; }).length;
/* Gjentar de første n ukene ut perioden */
function repeatDraft(d, n) {
  const days = draftDays(d);
  for (let i = n * 7; i < days.length; i++) { d.cells[days[i]] = d.cells[days[i % (n * 7)]]; d.touched.add(days[i]); }
}

const cellInner = day => {
  const c = rotaDraft.cells[day], def = c && state.rota.codes[c];
  return h`<span class="rg-n">${parseISO(day).getDate()}</span>${c ? h`<span class="pill sm tone-${def ? toneOf(def.kind, def.start) : 'other'}">${c}</span>` : ''}${state.rota.custom[day] && !rotaDraft.touched.has(day) ? h`<span class="rg-cu" title="${T.rota.customMark}">*</span>` : ''}`;
};
const brushChip = c => {
  const d = state.rota.codes[c];
  return h`<button type="button" class="brush" data-brush="${c}" aria-pressed="${c === rotaDraft.brush}"><span class="pill sm tone-${toneOf(d.kind, d.start)}">${c}</span><span class="m">${d.kind === 'off' ? T.rota.off : d.start && d.end ? d.start + '–' + d.end : d.label}</span></button>`;
};

function openRotaGridSheet(back) {
  if (!rotaDraft) rotaDraft = newRotaDraft();
  const D = rotaDraft, today = todayISO();
  const again = () => openRotaGridSheet(back);
  const days = draftDays(D);
  const weeks = Array.from({ length: D.weeks }, (_, w) => days.slice(w * 7, w * 7 + 7));
  openSheet(h`${sheetHead(T.rota.manual, !!back)}<div class="sh-body rgrid-sheet">
    ${hint(T.rota.manualIntro)}
    <div class="fields two"><label class="field"><span>${T.rota.manualFrom}</span><input type="date" id="rg-from" value="${D.start}"></label>
      <label class="field"><span>${T.rota.manualWeeks}</span><input type="number" inputmode="numeric" min="1" max="${GRID_WEEKS.max}" id="rg-weeks" value="${D.weeks}"></label></div>
    <div class="brushes" role="group">${codeList().map(brushChip)}
      <button type="button" class="brush" data-brush="" aria-pressed="${D.brush === ''}"><span class="pill sm tone-none">–</span><span class="m">${T.rota.brushNone}</span></button>
      <button type="button" class="brush add" data-newcode>${T.rota.newCodeBtn}</button></div>
    <div class="rgrid" role="grid">
      <div class="rg-row head" role="row"><span class="rg-w"></span>${[1, 2, 3, 4, 5, 6, 7].map(n => h`<span class="rg-h" role="columnheader">${wdShort(n)}</span>`)}</div>
      ${weeks.map(w => h`<div class="rg-row" role="row"><span class="rg-w" role="rowheader">${T.rota.week(isoWeek(w[0]))}</span>${w.map(day => h`<button type="button" class="rg-c${day === today ? ' today' : ''}" data-d="${day}" aria-label="${fmtDateLong(day)}">${cellInner(day)}</button>`)}</div>`)}
    </div>
    <p class="hint" id="rg-sum">${T.rota.summary(D.weeks, draftCount(D))}</p>
    ${D.weeks > 1 ? h`<section class="grp"><div class="inline"><label for="rg-rep">${T.rota.repeat}</label><input type="number" inputmode="numeric" min="1" max="${D.weeks - 1}" id="rg-rep" value="${Math.min(D.weeks - 1, Math.max(1, D.repeat || 1))}">
      <button type="button" class="btn small" data-repeat>${T.rota.repeatBtn}</button></div>${hint(T.rota.repeatHint)}</section>` : ''}
    <section class="grp quiet">${hint(T.rota.manualKeepHint)}<button type="button" class="btn link" data-clear>${T.rota.clear}</button>${errBox()}</section>
  </div>${sheetFoot(T.rota.manualSave)}`, (sheet, q) => {
    bindBack(sheet, back);
    const sum = () => { q('#rg-sum').textContent = T.rota.summary(D.weeks, draftCount(D)); };
    const paint = el => {
      const day = el.dataset.d;
      if (D.cells[day] === D.brush && D.touched.has(day)) return;
      D.cells[day] = D.brush; D.touched.add(day);
      setHtml(el, cellInner(day));
      sum();
    };
    // Trykk maler én dag. Dra vannrett for å male flere (loddrett blar som vanlig).
    const grid = q('.rgrid');
    let painting = false;
    const stop = () => { painting = false; };
    grid.addEventListener('pointerdown', e => {
      const c = e.target.closest('[data-d]');
      if (!c) return;
      painting = true;
      paint(c);
      // Slutter når fingeren løftes, også utenfor rutenettet (ruten under fingeren tegnes på nytt underveis)
      window.addEventListener('pointerup', stop, { once: true });
      window.addEventListener('pointercancel', stop, { once: true });
    });
    grid.addEventListener('pointermove', e => {
      if (!painting) return;
      const el = document.elementFromPoint(e.clientX, e.clientY), c = el && el.closest('[data-d]');
      if (c && grid.contains(c)) paint(c);
    });
    grid.addEventListener('click', e => e.preventDefault());
    sheet.querySelectorAll('[data-brush]').forEach(b => b.addEventListener('click', () => {
      D.brush = b.dataset.brush;
      sheet.querySelectorAll('[data-brush]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    }));
    q('[data-newcode]').addEventListener('click', () => openCodeSheet(null, again));
    q('#rg-from').addEventListener('change', e => { if (isDate(e.target.value)) { D.start = weekStart(e.target.value); fillDraft(D); again(); } });
    q('#rg-weeks').addEventListener('change', e => { D.weeks = Math.round(num(e.target.value, D.weeks, 1, GRID_WEEKS.max)); fillDraft(D); again(); });
    const rep = q('[data-repeat]');
    if (rep) rep.addEventListener('click', () => {
      D.repeat = Math.round(num(q('#rg-rep').value, 1, 1, D.weeks - 1));
      repeatDraft(D, D.repeat);
      toast(T.rota.repeated(D.repeat, isoWeek(draftEnd(D))));
      again();
    });
    q('[data-clear]').addEventListener('click', () => { for (const day of draftDays(D)) { D.cells[day] = ''; D.touched.add(day); } toast(T.rota.cleared); again(); });
    q('[data-save]').addEventListener('click', () => {
      const from = D.start, to = draftEnd(D), entries = {};
      for (const day of draftDays(D)) entries[day] = D.cells[day] || '';
      tryCommit(sheet, '', () => T.rota.published(setRotaRange(entries, from, to, D.touched)), () => {
        rotaDraft = null;
        closeSheet();
        goTo(from > today ? from : today);
      });
    });
  }, again);
}
