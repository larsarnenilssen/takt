'use strict';
/* ---------- hjemme: kortet på siden og hele dagen i et ark ----------
   Faste rader og én kolonne per barn, med sin egen dempede farge. Det som
   skiller seg ut (merknader fra Døgn og beskjeden), står som røde eller gule
   linjer øverst. Avvik i en celle får farge og en prikk. Se domain/home.js. */

/* «10 t 40» med tallene fremhevet og enhetene nedtonet */
function durHtml(m) {
  const hr = Math.floor(m / 60), mi = m % 60, u = t => h`<small>${t}</small>`;
  if (!hr) return h`<b>${mi}</b>${u(' ' + T.unit.min)}`;
  return mi ? h`<b>${hr}</b>${u(' ' + T.unit.hour + ' ')}<b>${pad(mi)}</b>` : h`<b>${hr}</b>${u(' ' + T.unit.hour)}`;
}
const dash = raw('<span class="none">–</span>');
const flagLinesHtml = lines => lines.length ? h`<div class="flags">${lines.map(l => h`<p class="flag ${l.level}">${l.text}</p>`)}</div>` : '';
/* En celle med avvik: farge etter nivå og en prikk foran */
const cell = (k, level, body) => h`<span class="kg-c tint-${k.tint}${level ? ` lv-${level}` : ''}"><span>${level ? raw('<i class="dot" aria-hidden="true"></i>') : ''}${body}</span></span>`;
/* Rutenettet: overskrift med navnene, så én rad per [etikett, (barn) => innhold, nivå] */
function kidGrid(kids, rows) {
  return h`<div class="kg" role="table">
    <div class="kg-row head" role="row"><span class="kg-k" role="columnheader"></span>${kids.map(k => h`<span class="kg-c tint-${k.tint}" role="columnheader">${k.name}</span>`)}</div>
    ${rows.map(([label, body, level]) => h`<div class="kg-row" role="row"><span class="kg-k" role="rowheader">${label}</span>${kids.map(k => cell(k, level ? level(k) : '', body(k)))}</div>`)}</div>`;
}
/* Rader med etikett til venstre: [etikett, innhold, dempet, bolktype (farger klokkeslettet)] */
const hrows = rows => h`<div class="hrows">${rows.map(([k, v, past, type]) => h`<div class="hr${type ? ` ty-${type}` : ''}${past ? ' past' : ''}"><span class="hr-k">${k}</span><span class="hr-v">${v}</span></div>`)}</div>`;

const nowCell = k => k.now.asleep ? h`${T.home.asleep} <small>${T.home.from(k.now.since)}</small>` : k.now.since ? h`${T.home.awake} <small>${T.home.from(k.now.since)}</small>` : dash;
const nightCell = k => !k.night ? dash : k.night.net ? durHtml(k.night.net) : k.night.asleep ? h`<small>${T.home.asleepAt(k.night.asleep)}</small>` : dash;
const napsCell = k => k.naps.total ? durHtml(k.naps.total) : k.naps.list.some(e => !e.end) ? h`<small>${T.home.ongoing}</small>` : dash;
const foodCell = k => k.food.rate ? cap(T.home.rate[k.food.rate]) : dash;
const apptTime = a => a.start ? a.start + (a.end ? '–' + a.end : '') : '–';
const apptRows = appts => appts.map((a, i) => [i ? '' : T.home.appts, h`<span class="t">${apptTime(a)}</span>${a.title}${a.where ? h`<small> · ${a.where}</small>` : ''}`]);
const dinnerText = d => h`${d.dish}<small> · ${d.partnerEats ? T.home.youEat : T.home.youDont}</small>`;
const stamp = hd => h`<span class="stamp${hd.old ? ' warn' : ''}">${hd.lastLog ? T.home.logged(hd.lastLog) : hd.isToday ? T.home.noLog : ''}${hd.lastLog || hd.isToday ? ' · ' : ''}${hd.updated ? T.home.updated(fmtStamp(hd.updated)) : ''}</span>`;

/* ---------- kortet på siden ---------- */
function homeCard(date) {
  if (!dognOn()) return '';
  const hd = homeDay(date);
  const head = h`<div class="card-h row-h"><h2>${T.home.title}</h2></div>`;
  if (!hd) return h`<section class="card home">${head}<p class="hint">${T.home.noData(state.settings.dognName || T.home.dognDefault)}</p></section>`;
  // Dager uten plan fra Døgn: bare avtalene, til orientering
  if (hd.empty) return h`<section class="card home">${head}${hd.appts.length ? hrows(apptRows(hd.appts)) : h`<p class="hint">${T.home.noDay}</p>`}</section>`;
  const logged = hd.kids.some(k => k.night || k.naps.list.length || k.food.rate);
  const rows = [
    ...(hd.isToday ? [[T.home.now, nowCell]] : []),
    [T.home.night, nightCell, k => k.night ? k.night.level : ''],
    [T.home.naps, napsCell, k => k.naps.level],
    [T.home.food, foodCell, k => k.food.level],
  ];
  const fam = [
    ...hd.next.map((b, i) => [i ? '' : T.home.next, h`<span class="t">${b.start}</span>${b.title}`, false, b.type]),
    ...(hd.dinner && hd.dinner.dish ? [[T.home.dinner, dinnerText(hd.dinner)]] : []),
    ...apptRows(hd.appts),
  ];
  return h`<section class="card home" data-act="home" aria-label="${T.home.title}">${head}
    ${flagLinesHtml(hd.lines)}
    ${logged || hd.isToday ? kidGrid(hd.kids, rows) : ''}
    ${fam.length ? hrows(fam) : ''}
    <div class="home-foot">${stamp(hd)}<button type="button" class="btn link" data-act="home">${T.home.whole}</button></div></section>`;
}

/* ---------- hele dagen: i går, i dag og i morgen ---------- */
function openHomeSheet(date) {
  const dates = dognDates();
  if (!dates.includes(date)) date = dates.includes(todayISO()) ? todayISO() : dates[dates.length - 1];
  const hd = date ? homeDay(date) : null;
  const again = () => openHomeSheet(date);
  again.refresh = 'home';
  const tabs = segRow('data-hday', dates.map(d => [d, cap(relDay(d) || fmtDateShort(d))]), d => d === date);
  const body = !hd || hd.empty ? h`<p class="hint">${T.home.noDay}</p>` : homeDayHtml(hd);
  openSheet(h`${sheetHead(T.home.title)}<div class="sh-body homeday">${dates.length > 1 ? tabs : ''}${body}
    ${hd && !hd.empty ? h`<div class="home-foot">${stamp(hd)}<button type="button" class="btn small" data-hpull>${ICON.refresh}<span>${T.home.refresh}</span></button></div>` : ''}</div>`, (sheet, q) => {
    sheet.querySelectorAll('[data-hday]').forEach(b => b.addEventListener('click', () => openHomeSheet(b.dataset.hday)));
    const p = q('[data-hpull]');
    if (p) p.addEventListener('click', () => { p.disabled = true; pullDogn(); });
  }, again);
}
/* Søvnstolpe: natten mot det vanlige (streken) */
function nightBar(n) {
  if (!n || !n.net || !n.usual) return '';
  const max = Math.max(n.net, n.usual) * 1.15, w = v => (v / max * 100).toFixed(1) + '%';
  return h`<span class="bar" aria-hidden="true"><i style="width:${w(n.net)}"></i><s style="left:${w(n.usual)}"></s></span>`;
}
function homeDayHtml(hd) {
  const rub = (title, inner) => inner ? h`<section class="rub"><h3>${title}</h3>${inner}</section>` : '';
  const nl = k => k.night ? k.night.level : '';
  const anySleep = hd.kids.some(k => k.night || k.naps.list.length);
  const sleep = anySleep ? h`${kidGrid(hd.kids, [
    [T.home.night, k => h`${nightCell(k)}${nightBar(k.night)}`, nl],
    [T.home.wakes, k => k.night && (k.night.net || k.night.wakes) ? h`<b>${k.night.wakes}</b>` : dash, nl],
    [T.home.fellAsleep, k => k.night && k.night.asleep ? h`<b>${k.night.asleep}</b>` : dash],
    [T.home.woke, k => k.night && k.night.wake ? h`<b>${k.night.wake}</b>` : dash],
    [T.home.naps, k => k.naps.list.length ? k.naps.list.map((e, i) => h`${i ? raw('<br>') : ''}${e.start}–${e.end}`) : dash, k => k.naps.level],
    [T.home.napTotal, napsCell, k => k.naps.level],
  ])}${hd.kids.some(k => k.night && k.night.usual) ? hint(T.home.barHint) : ''}` : '';
  const food = hd.meals.length ? kidGrid(hd.kids, hd.meals.map(m => [h`${m.title}<small>${m.start}</small>`,
    k => m.rates[k.id] ? cap(T.home.rate[m.rates[k.id]]) : dash, k => m.rates[k.id] === 'lite' ? k.food.level : ''])) : '';
  const health = hd.health.length ? hrows(hd.health.map(x => [h`<span class="t">${x.time}</span>`, h`${kidNameOf(x.kid)} · ${[T.home.health[x.kind], x.value].filter(Boolean).join(' ')}`])) : '';
  const day = hd.blocks.length ? hrows(hd.blocks.map(b => [h`<span class="t">${b.start}</span>`, h`${b.title}${b.did || b.meal ? h`<small> · ${b.did || b.meal}</small>` : ''}`, b.past, b.type])) : '';
  const din = [
    ...(hd.dinner && hd.dinner.dish ? [[T.home.dinner, dinnerText(hd.dinner)]] : []),
    ...hd.appts.map(a => [h`<span class="t">${a.start || '–'}</span>`, h`${a.title}${a.end || a.where ? h`<small>${a.end ? ' · ' + T.home.until(a.end) : ''}${a.where ? ' · ' + a.where : ''}</small>` : ''}`]),
  ];
  const shop = hd.isToday && dogn.data.shop.length ? h`<ul class="chips">${dogn.data.shop.map(s => h`<li>${s}</li>`)}</ul>` : '';
  return h`${flagLinesHtml(hd.lines)}
    ${rub(T.home.sleep, sleep)}${rub(T.home.food, food)}${rub(T.home.healthTitle, health)}
    ${rub(T.home.day, day)}${rub(T.home.dinnerAppts, din.length ? hrows(din) : '')}
    ${rub(T.home.shop(dogn.data.shop.length), shop)}`;
}
