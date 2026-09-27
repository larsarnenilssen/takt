'use strict';
/* ---------- ark (bottom sheet), melding med angre og små byggeklosser ----------
   Et ark legges i historikken, slik at tilbakeknappen på Android lukker arket
   i stedet for appen. «Tilbake» i et ark (data-goback) går til forrige ark. */
const ICON = {
  edit: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>'),
  prev: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>'),
  next: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'),
  star: raw('<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>'),
  starOff: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>'),
  refresh: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/></svg>'),
  walk: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4.5" r="1.5"/><path d="M10 21l2-6 3 3v3M9 11l3-3 3 3 3 1M12 8l-1 7"/></svg>'),
  share: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M8 11l8-4M8 13l8 4"/></svg>'),
};

let reopen = null;        // arket som skal vises igjen etter «Angre» eller en synkronisering
let sheetSeq = 0;         // hindrer at et ark som allerede er lukket, åpnes av animasjonen
let sheetInHistory = false;
let sheetShown = false;   // sant fra et ark åpnes til det lukkes (også mens det glir inn)
function openSheet(html, mount, again) {
  const root = $('#sheet-root');
  const seq = ++sheetSeq;
  const wasOpen = root.classList.contains('open');
  reopen = again || null;
  sheetShown = true;
  setHtml(root, h`<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab" aria-hidden="true"></div>${html}</div>`);
  root.hidden = false;
  document.body.classList.add('locked');
  if (!sheetInHistory) { history.pushState({ takt: 'sheet' }, ''); sheetInHistory = true; }
  if (wasOpen) root.classList.add('open');
  else requestAnimationFrame(() => requestAnimationFrame(() => { if (seq === sheetSeq) root.classList.add('open'); }));
  const sheet = root.querySelector('.sheet');
  root.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeSheet));
  sheet.querySelectorAll('form').forEach(f => f.addEventListener('submit', e => e.preventDefault()));
  sheet.addEventListener('click', e => {
    const q = e.target.closest('[data-qm]');
    if (!q) return;
    const more = q.closest('.hint').nextElementSibling;
    more.hidden = !more.hidden;
    q.setAttribute('aria-expanded', String(!more.hidden));
  });
  if (mount) mount(sheet, s => sheet.querySelector(s));
}
/* fromHistory: arket lukkes fordi brukeren trykket tilbake (historikken er allerede spolt) */
function closeSheet(fromHistory) {
  const root = $('#sheet-root');
  if (!root.classList.contains('open') && root.hidden) return;
  sheetSeq++;
  sheetShown = false;
  root.classList.remove('open');
  document.body.classList.remove('locked');
  reopen = null;
  if (sheetInHistory) { sheetInHistory = false; if (fromHistory !== true) history.back(); }
  setTimeout(() => { if (!root.classList.contains('open')) { root.hidden = true; root.innerHTML = ''; } }, 260);
}
const sheetOpen = () => sheetShown;
window.addEventListener('popstate', () => { if (sheetInHistory) { sheetInHistory = false; closeSheet(true); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });

/* Toppen av et ark: «Lukk», eller «Tilbake» til et annet ark */
function sheetHead(title, back) {
  return h`<div class="sh-head"><h2>${title}</h2>${back
    ? h`<button type="button" class="btn ghost" data-goback>${T.common.back}</button>`
    : h`<button type="button" class="btn ghost" data-close>${T.common.close}</button>`}</div>`;
}
/* Kobler «Tilbake» i arket til funksjonen som åpner forrige ark */
function bindBack(sheet, back) { const b = sheet.querySelector('[data-goback]'); if (b && back) b.addEventListener('click', back); }
const sheetFoot = (label, attr = 'data-save') => h`<div class="sh-foot"><button type="button" class="btn primary grow" ${raw(attr)}>${label}</button></div>`;
const navRow = (act, label, meta, quiet) => h`<button type="button" class="row${quiet ? ' quiet' : ''}" data-nav="${act}"><span class="grow">${label}${meta ? h`<span class="m">${meta}</span>` : ''}</span><span class="chev" aria-hidden="true">›</span></button>`;
/* Hjelpetekst: første setning vises, resten bak en liten «?». full: vis alt (for det som ikke må overses). */
function hint(text, full) {
  text = String(text);
  const m = !full && text.length > 90 && text.match(/^(.+?[.!?»])\s+(?=[A-ZÆØÅ«])([\s\S]+)$/);
  return m ? h`<p class="hint">${m[1]} <button type="button" class="qm" data-qm aria-expanded="false" aria-label="${T.common.moreInfo}">?</button></p><p class="hint more" hidden>${m[2]}</p>`
    : h`<p class="hint">${text}</p>`;
}
const switchBtn = (attr, val, on, label) => h`<button type="button" class="switch" role="switch" ${raw(attr)}="${val}" aria-checked="${on}"><span class="knob" aria-hidden="true"></span><span>${label}</span></button>`;
const segRow = (attr, pairs, cur) => h`<div class="seg" role="group">${pairs.map(([k, l]) => h`<button type="button" ${raw(attr)}="${k}" aria-pressed="${cur(k)}">${l}</button>`)}</div>`;
/* Slett-knapp som først viser en bekreftelse */
const delConfirm = (label, question) => h`<section class="grp quiet"><button type="button" class="btn link danger" data-del>${label}</button>
  <div class="confirm" data-confirm hidden><p class="hint">${question}</p><button type="button" class="btn small danger" data-del-yes>${T.common.yesDelete}</button></div></section>`;
function bindDelete(sheet, fn) {
  const del = sheet.querySelector('[data-del]');
  if (!del) return;
  const box = sheet.querySelector('[data-confirm]');
  del.addEventListener('click', () => { box.hidden = false; del.hidden = true; });
  sheet.querySelector('[data-del-yes]').addEventListener('click', fn);
}
/* Kjører en endring fra et skjema og viser feil i arket i stedet for å lukke det */
function tryCommit(sheet, label, fn, after) {
  const err = sheet.querySelector('[data-err]');
  try { commit(label, fn); if (after) after(); }
  catch (e) {
    if (!(e instanceof UserError)) throw e;
    if (err) { err.textContent = e.message; err.hidden = false; } else toast(e.message);
  }
}
const errBox = () => h`<p class="err" data-err role="alert" hidden></p>`;
/* Leser en fil som tekst eller bytes */
function pickFile(accept, asBytes) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) { res(null); return; }
      res(asBytes ? new Uint8Array(await f.arrayBuffer()) : await f.text());
    });
    inp.click();
  });
}
function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- melding nederst, med «Angre» ---------- */
let toastTimer = null;
function toast(msg, undo) {
  const t = $('#toast');
  setHtml(t, h`<span>${msg}</span>${undo ? h`<button type="button" data-undo>${T.common.undo}</button>` : ''}`);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 6000 : 2600);
}
$('#toast').addEventListener('click', e => { if (e.target.closest('[data-undo]')) { $('#toast').classList.remove('show'); undoLast(); } });
