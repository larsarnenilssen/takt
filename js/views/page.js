'use strict';
/* ---------- siden: toppen og de fire delene (vakt, reise, hjemme, notater) ----------
   Alt gjelder dagen som vises (view). Sveip eller pilene bytter dag.
   Reisene hentes etter at siden er tegnet, og fylles inn når de kommer. */
let view = todayISO();
let lastToday = todayISO();
const shown = { to: [], home: [] };   // reisene som vises, slik at trykk finner dem igjen
const moreTrips = new Set();          // retninger der alle reisene er foldet ut

function render() {
  if (!state) return;
  renderHeader();
  renderPage();
}
function applyTheme() {
  const t = state.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.fontSize = (state.settings.textSize * 100) + '%';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bar').trim();
}
function go(n) { goTo(n === 0 ? todayISO() : addDays(view, n)); }
function goTo(date) { view = date; moreTrips.clear(); render(); window.scrollTo(0, 0); }

function renderHeader() {
  $('#date').textContent = fmtDateLong(view);
  const rel = relDay(view);
  setHtml($('#sub'), h`<span>${T.date.week(isoWeek(view))}</span>${rel ? h`<span class="dot">·</span><span class="acc">${rel}</span>` : ''}${!store.ok ? h`<span class="dot">·</span><span class="warn">${T.common.notSaved}</span>` : ''}`);
}

function renderPage() {
  setHtml($('#page'), [backupNotice(), shiftCard(view), travelCard(view), homeCard(view), itemsCard(view)]);
  fillTravel(view);
}

/* ---------- vakt ---------- */
const tonePill = (sh, cls) => h`<span class="pill ${cls || ''} tone-${sh ? sh.tone : 'none'}">${sh ? (sh.code || '•') : '–'}</span>`;
function shiftCard(date) {
  const sh = shiftFor(date);
  const hasRota = Object.keys(state.rota.codes).length > 0;
  const ws = weekStart(date), t = todayISO();
  const week = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = addDays(ws, i), s = shiftFor(d);
    return h`<button type="button" class="wk-d${d === date ? ' cur' : ''}${d === t ? ' today' : ''}" data-go="${d}" aria-label="${fmtDateLong(d)}: ${shiftText(s)}">
      <span class="wd">${wdShort(i + 1)}</span>${tonePill(s, 'sm')}</button>`;
  });
  let main;
  if (!hasRota) main = h`<div class="empty"><p>${T.shift.noRota}</p><button type="button" class="btn primary small" data-act="import">${T.shift.importRota}</button></div>`;
  else {
    const sub = !sh ? T.shift.noShiftHint : sh.kind === 'off' ? T.rota.off
      : sh.start && sh.end ? T.shift.times(sh.start, sh.end, toHM(toMin(sh.start) - state.travel.before)) : T.shift.noTimes;
    main = h`<button type="button" class="sh-main" data-act="shift" aria-label="${T.shift.editAria}">
      ${tonePill(sh, 'lg')}
      <span class="sh-txt"><span class="t1">${sh ? (sh.label || sh.code) : T.rota.none}${isManual(date) ? h` <span class="tag">${T.shift.changed}</span>` : ''}</span><span class="t2">${sub}</span></span>
      <span class="edit" aria-hidden="true">${ICON.edit}</span></button>`;
  }
  return h`<section class="card shift" aria-label="${T.shift.title}">${main}<div class="week" role="group" aria-label="${T.shift.weekAria}">${week}</div>${awayLine(date)}</section>`;
}
function awayLine(date) {
  const a = awayFor(date);
  if (!a) return '';
  const nextDay = iso(a.back) !== date;
  const mark = a.chosen.to && a.chosen.home ? T.away.chosen : a.chosen.to || a.chosen.home ? T.away.partly : T.away.estimated(a.basis === 'set');
  return h`<p class="away"><span>${T.away.line(hm(a.leave), hm(a.back) + (nextDay ? ' ' + T.date.nextDayShort : ''))}</span><span class="m">${mark}</span></p>`;
}

/* ---------- reise ---------- */
function travelCard(date) {
  const sh = shiftFor(date);
  if (!isWorkShift(sh)) return '';
  const { from, to } = dayPlaces(date);
  if (!from || !to) {
    return h`<section class="card travel"><h2 class="card-h">${T.travel.title}</h2><div class="empty"><p>${T.travel.needPlaces}</p>
      <button type="button" class="btn small" data-act="places">${T.travel.setPlaces}</button></div></section>`;
  }
  const dirs = travelOrder(date, sh);
  return h`<section class="card travel" aria-label="${T.travel.title}">${dirs.map(dir => h`<div class="tr-dir" data-dir="${dir}">
    <div class="card-h row-h"><h2>${dir === 'to' ? T.travel.toWork(placeName(to)) : T.travel.home}</h2>
      <button type="button" class="linkish" data-act="dayplaces">${T.travel.change}</button></div>
    <p class="tr-need">${needText(date, dir)}</p>
    <div class="trips" id="trips-${dir}"><p class="hint">${T.travel.loading}</p></div></div>`)}</section>`;
}
/* Etter at vakten har begynt, kommer hjemreisen først */
function travelOrder(date, sh) {
  if (date !== todayISO()) return ['to', 'home'];
  return Date.now() > shiftSpan(date, sh).start ? ['home', 'to'] : ['to', 'home'];
}
function needText(date, dir) {
  const n = travelNeed(date, dir);
  return dir === 'to' ? T.travel.arriveBy(hm(n.target), state.travel.before) : T.travel.leaveAfter(hm(n.target), state.travel.after, iso(n.target) !== date);
}
async function fillTravel(date) {
  for (const dir of ['to', 'home']) {
    const box = document.getElementById('trips-' + dir);
    if (!box) continue;
    let res;
    try { res = await planTrips(date, dir); }
    catch (e) { if (view === date && box.isConnected) setHtml(box, h`<p class="hint warn">${e instanceof UserError ? e.message : T.travel.failed}</p>`); continue; }
    if (view !== date || !box.isConnected || !res) continue;
    const list = [...res.best.map(b => ({ trip: b.trip, fav: true })), ...res.other.map(t => ({ trip: t, fav: false }))];
    shown[dir] = list.map(x => x.trip);
    // Favorittene (eller den beste reisen) vises; resten bak «Flere reiser».
    // Retningen som kommer sist (hjem om morgenen), viser bare den første.
    const second = box.closest('.tr-dir') !== box.closest('.travel').querySelector('.tr-dir');
    const keep = second ? 1 : Math.max(1, res.best.length);
    const open = moreTrips.has(dir);
    const hidden = list.length - keep;
    setHtml(box, list.length
      ? h`${list.map((x, i) => i < keep || open ? tripRow(date, dir, x.trip, i, x.fav) : '')}
        ${hidden > 0 ? h`<button type="button" class="linkish" data-more="${dir}">${open ? T.travel.fewer : T.travel.more(hidden)}</button>` : ''}<p class="stamp">${res.stale ? T.travel.offline(fmtStamp(new Date(res.at))) : T.travel.fetched(hm(new Date(res.at)))}
          <button type="button" class="linkish" data-act="refresh">${ICON.refresh}<span>${T.travel.refresh}</span></button></p>`
      : h`<p class="hint">${T.travel.noTrips}</p>`);
  }
}
const legChips = trip => trip.legs.map(l => l.mode === 'foot'
  ? h`<span class="leg walk" title="${T.travel.walkMin(l.min)}">${ICON.walk}<span>${l.min}</span></span>`
  : h`<span class="leg ride${l.cancelled ? ' cancelled' : ''}">${l.code || T.travel.mode[l.mode] || l.mode}</span>`);
function tripRow(date, dir, trip, i, fav) {
  const picked = isPicked(date, dir, trip);
  const delay = delayOf(trip);
  const need = travelNeed(date, dir);
  const slack = dir === 'to' ? minutesBetween(trip.end, need.target) : null;
  const meta = [
    dir === 'to' ? (slack > 0 ? T.travel.slack(slack) : T.travel.onTime) : T.travel.arrive(hm(trip.end)),
    delay > 1 ? T.travel.late(delay) : delay < -1 ? T.travel.early(-delay) : '',
    trip.legs.some(l => l.cancelled) ? T.travel.cancelled : '',
  ].filter(Boolean).join(' · ');
  return h`<div class="trip${picked ? ' picked' : ''}${fav ? ' fav' : ''}">
    <button type="button" class="tr-main" data-trip="${dir}:${i}">
      <span class="tr-when"><b>${hm(leaveAt(trip))}</b><span>${T.travel.arrShort(hm(trip.end))}</span></span>
      <span class="tr-body"><span class="legs">${legChips(trip)}</span><span class="tr-meta${delay > 1 || trip.legs.some(l => l.cancelled) ? ' warn' : ''}">${meta}</span></span></button>
    <button type="button" class="pick" data-pick="${dir}:${i}" aria-pressed="${picked}">${picked ? T.travel.picked : T.travel.pick}</button></div>`;
}

/* ---------- hjemme (fra Døgn) ---------- */
function homeCard(date) {
  if (!dognOn()) return '';
  const hd = homeDay(date);
  const name = state.settings.dognName || T.home.dognDefault;
  const head = h`<div class="card-h row-h"><h2>${T.home.title}</h2>${hd && hd.updated ? h`<span class="stamp${hd.old ? ' warn' : ''}">${T.home.updated(fmtStamp(hd.updated))}</span>` : ''}</div>`;
  if (!hd) return h`<section class="card home">${head}<p class="hint">${T.home.noData(name)}</p></section>`;
  if (hd.empty) return h`<section class="card home">${head}<p class="hint">${T.home.noDay}</p></section>`;
  return h`<section class="card home" aria-label="${T.home.title}">${head}
    ${hd.sick.length ? h`<p class="alert">${T.home.sick(joinNames(hd.sick))}</p>` : ''}
    ${hd.status ? h`<p class="status">${hd.status}</p>` : ''}
    ${hd.next.length ? h`<ul class="next">${hd.next.map(b => h`<li class="ty-${b.type}"><span class="t">${b.start}</span><span>${b.title}${b.meal ? h`<span class="m"> · ${b.meal}</span>` : ''}</span></li>`)}</ul>` : ''}
    ${hd.dinner && hd.dinner.dish ? h`<p class="dinner"><span class="k">${T.home.dinner}</span> ${hd.dinner.dish}<span class="m"> · ${hd.dinner.partnerEats ? T.home.youEat : T.home.youDont}</span></p>` : ''}
    ${hd.appts.map(a => h`<p class="appt"><span class="t">${a.start || '–'}</span> ${a.title}${a.where ? h`<span class="m"> · ${a.where}</span>` : ''}</p>`)}</section>`;
}

/* ---------- notater, gjøremål, avtaler og handling ---------- */
function itemsCard(date) {
  const list = itemsFor(date);
  return h`<section class="card items" aria-label="${T.items.title}"><div class="card-h row-h"><h2>${T.items.title}</h2>
      <button type="button" class="btn small" data-act="add">${T.items.add}</button></div>
    ${list.length ? h`<ul class="ilist">${list.map(itemRow)}</ul>` : h`<p class="hint">${T.items.empty}</p>`}</section>`;
}
function itemRow(x) {
  const done = isDone(x), check = x.kind === 'todo' || x.kind === 'shop';
  return h`<li class="it k-${x.kind}${done ? ' done' : ''}">
    ${check ? h`<button type="button" class="check" role="checkbox" aria-checked="${done}" data-toggle="${x.id}" aria-label="${T.items.checkAria(x.title)}"></button>`
      : h`<span class="kind">${x.kind === 'appt' ? (x.time || T.items.kindShort.appt) : T.items.kindShort.note}</span>`}
    <button type="button" class="it-main" data-item="${x.id}"><span class="it-t">${x.kind === 'shop' ? h`<span class="m">${T.items.kindShort.shop} </span>` : ''}${x.title}</span>
      ${x.note ? h`<span class="it-n">${x.note}</span>` : ''}
      ${x.shared ? h`<span class="it-s">${ICON.share}<span>${doneInDogn(x) ? T.items.doneInDogn : T.items.shared}</span></span>` : ''}</button></li>`;
}
