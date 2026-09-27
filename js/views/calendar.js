'use strict';
/* ---------- måned: turnusen i kalender ----------
   Hver dag viser vaktkoden i vaktens farge. Prikk: notat, gjøremål eller avtale.
   Trykk på en dag for å gå dit. Sveip eller pilene bytter måned. */
function openCalendarSheet(month) {
  const m0 = month || view.slice(0, 7) + '-01';
  const first = parseISO(m0), t = todayISO();
  const start = weekStart(m0);
  const nextMonth = iso(new Date(first.getFullYear(), first.getMonth() + 1, 1));
  const prevMonth = iso(new Date(first.getFullYear(), first.getMonth() - 1, 1));
  const weeks = [];
  for (let w = start; w < nextMonth; w = addDays(w, 7)) weeks.push(w);
  const cell = d => {
    const sh = shiftFor(d), inMonth = d.slice(0, 7) === m0.slice(0, 7);
    return h`<button type="button" class="cal-d${inMonth ? '' : ' out'}${d === t ? ' today' : ''}${d === view ? ' cur' : ''}" data-day="${d}" aria-label="${fmtDateLong(d)}: ${shiftText(sh)}">
      <span class="n">${parseISO(d).getDate()}</span><span class="c tone-${sh ? sh.tone : 'none'}">${sh ? sh.code || '•' : ''}</span>${hasItems(d) ? h`<span class="dotm" aria-hidden="true"></span>` : ''}</button>`;
  };
  openSheet(h`${sheetHead(cap(T.date.mo[first.getMonth()]) + ' ' + first.getFullYear())}<div class="sh-body">
    <div class="cal-nav"><button type="button" class="icon-btn" data-month="${prevMonth}" aria-label="${T.cal.prev}">${ICON.prev}</button>
      <button type="button" class="btn small" data-today>${T.cal.today}</button>
      <button type="button" class="icon-btn" data-month="${nextMonth}" aria-label="${T.cal.next}">${ICON.next}</button></div>
    <div class="cal" role="grid"><div class="cal-r head"><span class="wk">${T.cal.wk}</span>${[1, 2, 3, 4, 5, 6, 7].map(i => h`<span>${wdShort(i)}</span>`)}</div>
      ${weeks.map(w => h`<div class="cal-r"><span class="wk">${isoWeek(w)}</span>${[0, 1, 2, 3, 4, 5, 6].map(i => cell(addDays(w, i)))}</div>`)}</div>
    ${hint(T.cal.hint)}
  </div>`, (sheet, q) => {
    sheet.querySelectorAll('[data-month]').forEach(b => b.addEventListener('click', () => openCalendarSheet(b.dataset.month)));
    q('[data-today]').addEventListener('click', () => { closeSheet(); go(0); });
    sheet.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { closeSheet(); goTo(b.dataset.day); }));
  }, () => openCalendarSheet(m0));
}
