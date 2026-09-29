'use strict';
/* ---------- måned: turnusen i kalender ----------
   Hver dag viser vaktkoden i vaktens farge. Prikk: egne notater, gjøremål og
   avtaler. Hus: avtaler i Døgn, til orientering. Under kalenderen står det som
   skjer i måneden. Trykk på en dag for å gå dit. Sveip eller pilene bytter måned. */
/* Det som skjer i en måned: egne punkter med dato (ikke gjort) og avtalene i Døgn */
function monthList(from, to) {
  const own = state.items.filter(x => x.date >= from && x.date <= to && !isDone(x))
    .map(x => ({ date: x.date, time: x.time, text: x.title, meta: T.items.kind[x.kind], dogn: false }));
  const home = dognAppts(from, to).map(a => ({ date: a.date, time: a.start, text: a.title, meta: T.cal.fromDogn(state.settings.dognName || T.home.dognDefault), dogn: true }));
  return [...own, ...home].sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}
function openCalendarSheet(month) {
  const m0 = month || view.slice(0, 7) + '-01';
  const first = parseISO(m0), t = todayISO();
  const start = weekStart(m0);
  const nextMonth = iso(new Date(first.getFullYear(), first.getMonth() + 1, 1));
  const prevMonth = iso(new Date(first.getFullYear(), first.getMonth() - 1, 1));
  const weeks = [];
  for (let w = start; w < nextMonth; w = addDays(w, 7)) weeks.push(w);
  const homeDays = new Set(dognAppts(start, addDays(start, weeks.length * 7 - 1)).map(a => a.date));
  const list = monthList(m0, addDays(nextMonth, -1));
  const cell = d => {
    const sh = shiftFor(d), inMonth = d.slice(0, 7) === m0.slice(0, 7), home = homeDays.has(d);
    return h`<button type="button" class="cal-d${inMonth ? '' : ' out'}${d === t ? ' today' : ''}${d === view ? ' cur' : ''}" data-day="${d}" aria-label="${fmtDateLong(d)}: ${shiftText(sh)}${home ? T.cal.hasDogn : ''}">
      <span class="n">${parseISO(d).getDate()}</span><span class="c tone-${sh ? sh.tone : 'none'}">${sh ? sh.code || '•' : ''}</span>${hasItems(d) ? h`<span class="dotm" aria-hidden="true"></span>` : ''}${home ? h`<span class="homem" aria-hidden="true">${ICON.home}</span>` : ''}</button>`;
  };
  openSheet(h`${sheetHead(cap(T.date.mo[first.getMonth()]) + ' ' + first.getFullYear())}<div class="sh-body">
    <div class="cal-nav"><button type="button" class="icon-btn" data-month="${prevMonth}" aria-label="${T.cal.prev}">${ICON.prev}</button>
      <button type="button" class="btn small" data-today>${T.cal.today}</button>
      <button type="button" class="icon-btn" data-month="${nextMonth}" aria-label="${T.cal.next}">${ICON.next}</button></div>
    <div class="cal" role="grid"><div class="cal-r head"><span class="wk">${T.cal.wk}</span>${[1, 2, 3, 4, 5, 6, 7].map(i => h`<span>${wdShort(i)}</span>`)}</div>
      ${weeks.map(w => h`<div class="cal-r"><span class="wk">${isoWeek(w)}</span>${[0, 1, 2, 3, 4, 5, 6].map(i => cell(addDays(w, i)))}</div>`)}</div>
    ${hint(T.cal.hint)}
    <p class="hint legend"><span class="dotm" aria-hidden="true"></span>${T.cal.legendOwn}${dognOn() ? h`<span class="homem" aria-hidden="true">${ICON.home}</span>${T.cal.legendDogn(state.settings.dognName || T.home.dognDefault)}` : ''}</p>
    ${list.length ? h`<section class="grp"><h3>${T.cal.inMonth(T.date.mo[first.getMonth()])}</h3><div class="rows">${list.map(x => h`<button type="button" class="row${x.dogn ? ' dogn' : ''}" data-day="${x.date}">
      <span class="ml-d">${wdShort(isoWd(x.date))} ${parseISO(x.date).getDate()}.</span>
      <span class="grow"><span>${x.time ? h`<b>${x.time}</b> ` : ''}${x.text}</span><span class="m">${x.dogn ? h`<span class="homem" aria-hidden="true">${ICON.home}</span>` : ''}${x.meta}</span></span><span class="chev" aria-hidden="true">›</span></button>`)}</div></section>` : ''}
  </div>`, (sheet, q) => {
    sheet.querySelectorAll('[data-month]').forEach(b => b.addEventListener('click', () => openCalendarSheet(b.dataset.month)));
    q('[data-today]').addEventListener('click', () => { closeSheet(); go(0); });
    sheet.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { closeSheet(); goTo(b.dataset.day); }));
  }, () => openCalendarSheet(m0));
}
