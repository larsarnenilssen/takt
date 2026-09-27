'use strict';
/* ---------- reiser og steder: detaljer, valg for dagen, steder og favoritter ---------- */

/* En reise i detalj: hver etappe med tider, og knapper for å velge den og lagre linjene som favoritt */
function openTripSheet(date, dir, trip) {
  const picked = isPicked(date, dir, trip);
  const isFav = state.travel.favorites.some(f => favSig(f) === trip.sig);
  openSheet(h`${sheetHead(T.trip.title(hm(leaveAt(trip)), hm(trip.end)))}<div class="sh-body">
    <p class="lead">${T.trip.summary(trip.min, trip.walk)}</p>
    <ol class="legs-list">${trip.legs.map(l => h`<li class="${l.mode === 'foot' ? 'walk' : 'ride'}">
      <span class="t">${hm(l.start)}</span>
      <span class="grow">${l.mode === 'foot' ? T.trip.walk(l.min, l.to) : h`<span class="leg ride">${l.code || T.travel.mode[l.mode] || l.mode}</span> ${T.trip.ride(l.dest || l.to, l.from, l.to, l.min)}`}
        ${l.mode !== 'foot' && l.aimed && minutesBetween(l.aimed, l.start) > 1 ? h`<span class="m warn"> · ${T.travel.late(minutesBetween(l.aimed, l.start))}</span>` : ''}
        ${l.cancelled ? h`<span class="m warn"> · ${T.travel.cancelled}</span>` : ''}</span></li>`)}
      <li class="end"><span class="t">${hm(trip.end)}</span><span class="grow">${T.trip.arrive}</span></li></ol>
    ${hint(T.trip.pickHint)}
    <div class="btnrow"><button type="button" class="btn${picked ? '' : ' primary'}" data-pick>${picked ? T.trip.unpick : T.trip.pick}</button>
      ${trip.sig && !isFav ? h`<button type="button" class="btn" data-fav>${ICON.starOff}<span>${T.trip.saveFav}</span></button>` : ''}</div>
  </div>`, (sheet, q) => {
    q('[data-pick]').addEventListener('click', () => { commit(picked ? T.trip.unpicked : T.trip.pickedToast, () => setPick(date, dir, picked ? null : trip)); closeSheet(); });
    const f = q('[data-fav]');
    if (f) f.addEventListener('click', () => { commit(T.trip.favSaved(trip.sig.replace(/\+/g, ' + ')), () => { addFavorite(trip); }); closeSheet(); });
  });
}

/* Utgangspunkt og mål for én dag */
function openDayPlacesSheet(date) {
  const cur = dayPlaces(date);
  const opts = which => options(state.places.map(p => [p.id, placeName(p) + (p.role ? ' (' + T.places.role[p.role] + ')' : '')]), cur[which] && cur[which].id);
  openSheet(h`${sheetHead(T.places.dayTitle(fmtDateLong(date)))}<div class="sh-body">
    ${hint(T.places.dayHint)}
    <section class="grp"><label class="field"><span>${T.places.from}</span><select id="dp-from">${opts('from')}</select></label>
      <label class="field"><span>${T.places.to}</span><select id="dp-to">${opts('to')}</select></label></section>
    <section class="grp quiet"><button type="button" class="btn link" data-places>${T.places.manage}</button></section>
  </div>${sheetFoot(T.common.save)}`, (sheet, q) => {
    q('[data-save]').addEventListener('click', () => {
      commit(T.places.daySaved, () => { setDayPlace(date, 'from', q('#dp-from').value); setDayPlace(date, 'to', q('#dp-to').value); });
      closeSheet();
    });
    q('[data-places]').addEventListener('click', () => openPlacesSheet(() => openDayPlacesSheet(date)));
  });
}

/* Steder og reise: hjem, arbeidssted, andre steder, tid før og etter vakt, gange og favoritter */
function openPlacesSheet(back) {
  const T0 = state.travel;
  const again = () => openPlacesSheet(back);
  const placeRow = p => h`<button type="button" class="row" data-place="${p.id}"><span class="grow">${placeName(p)}${p.role ? h` <span class="tag">${T.places.role[p.role]}</span>` : ''}<span class="m">${p.label}${p.note ? ' · ' + p.note : ''}</span></span><span class="chev">›</span></button>`;
  const missing = ['home', 'work'].filter(r => !placeByRole(r));
  openSheet(h`${sheetHead(T.places.title, !!back)}<div class="sh-body">
    <section class="grp"><h3>${T.places.places}</h3>
      <div class="rows">${state.places.map(placeRow)}${missing.map(r => h`<button type="button" class="row add" data-new="${r}"><span class="grow">${T.places.addRole[r]}</span><span class="chev">+</span></button>`)}</div>
      <button type="button" class="btn small" data-new="">${T.places.addOther}</button></section>
    <section class="grp"><h3>${T.places.timing}</h3>
      <div class="fields two"><label class="field"><span>${T.places.before}</span><input type="number" inputmode="numeric" min="0" max="120" id="tv-b" value="${T0.before}"></label>
        <label class="field"><span>${T.places.after}</span><input type="number" inputmode="numeric" min="0" max="120" id="tv-a" value="${T0.after}"></label></div>
      ${hint(T.places.timingHint)}
      <label class="field"><span>${T.places.oneWay}</span><input type="number" inputmode="numeric" min="0" max="240" id="tv-o" value="${T0.oneWay || ''}" placeholder="${T0.fastest.to ? T.places.fastestPh(T0.fastest.to) : ''}"></label>
      ${hint(T.places.oneWayHint)}
      <h3 class="sub">${T.places.walk}</h3>${segRow('data-walk', Object.keys(WALK_SPEEDS).map(k => [k, T.places.walkSpeed[k]]), k => k === T0.walk)}</section>
    <section class="grp"><h3>${T.places.favs}</h3>${hint(T.places.favHint)}
      <div class="rows">${T0.favorites.map((f, i) => h`<div class="row static"><span class="legs">${f.lines.map(l => h`<span class="leg ride">${l.code}</span>`)}</span><span class="grow"></span>
        ${i > 0 ? h`<button type="button" class="btn small ghost" data-up="${f.id}" aria-label="${T.places.favUp(favName(f))}">↑</button>` : ''}
        <button type="button" class="btn small ghost" data-unfav="${f.id}" aria-label="${T.places.favRemove(favName(f))}">✕</button></div>`)}</div>
      <div class="inline"><input type="text" id="fv-new" placeholder="${T.places.favPh}" aria-label="${T.places.favAdd}"><button type="button" class="btn small" data-addfav>${T.places.favAdd}</button></div>${errBox()}</section>
  </div>${sheetFoot(T.common.save)}`, (sheet, q) => {
    bindBack(sheet, back);
    sheet.querySelectorAll('[data-place]').forEach(b => b.addEventListener('click', () => openPlaceSheet(placeById(b.dataset.place), null, again)));
    sheet.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => openPlaceSheet(null, b.dataset.new, again)));
    let walk = T0.walk;
    sheet.querySelectorAll('[data-walk]').forEach(b => b.addEventListener('click', () => { walk = b.dataset.walk; sheet.querySelectorAll('[data-walk]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    sheet.querySelectorAll('[data-unfav]').forEach(b => b.addEventListener('click', () => { commit(T.places.favRemoved, () => { state.travel.favorites = state.travel.favorites.filter(f => f.id !== b.dataset.unfav); }); again(); }));
    sheet.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => {
      commit('', () => { const L = state.travel.favorites, i = L.findIndex(f => f.id === b.dataset.up); [L[i - 1], L[i]] = [L[i], L[i - 1]]; });
      again();
    }));
    q('[data-addfav]').addEventListener('click', () => tryCommit(sheet, T.places.favAdded, () => addFavoriteCodes(q('#fv-new').value), again));
    q('[data-save]').addEventListener('click', () => {
      commit(T.common.saved, () => Object.assign(state.travel, { before: num(q('#tv-b').value, 15, 0, 120), after: num(q('#tv-a').value, 15, 0, 120), oneWay: num(q('#tv-o').value, 0, 0, 240), walk }));
      if (back) back(); else closeSheet();
    });
  }, again);
}

/* Ett sted: søk etter adresse, eller bruk der telefonen er nå */
function openPlaceSheet(place, role, back) {
  const p = place ? { ...place } : { id: uid(), role: role || '', name: role ? T.places.role[role] : '', label: '', lat: NaN, lon: NaN, note: '' };
  let found = [];
  openSheet(h`${sheetHead(place ? placeName(place) : role ? T.places.addRole[role] : T.places.addOther, true)}<div class="sh-body">
    <section class="grp"><label class="field"><span>${T.places.name}</span><input type="text" id="pl-n" value="${p.name}" placeholder="${T.places.namePh}"></label>
      <label class="field"><span>${T.places.address}</span><input type="search" id="pl-q" value="${p.label}" placeholder="${T.places.searchPh}" autocomplete="off"></label>
      <div class="rows" id="pl-hits"></div>
      <button type="button" class="btn small" data-here>${T.places.here}</button>${hint(T.places.hereHint)}
      <p class="hint" id="pl-cur">${isCoord(p.lat, p.lon) ? T.places.chosen(p.label) : T.places.notChosen}</p>
      <label class="field"><span>${T.places.note}</span><input type="text" id="pl-note" value="${p.note}" placeholder="${T.places.notePh}"></label>
      ${segRow('data-role', [['home', T.places.role.home], ['work', T.places.role.work], ['', T.places.role.none]], r => r === p.role)}${errBox()}</section>
    ${place ? delConfirm(T.places.delete, T.places.deleteQ) : ''}
  </div>${sheetFoot(T.common.save)}`, (sheet, q) => {
    bindBack(sheet, back);
    const showHits = () => setHtml(q('#pl-hits'), found.map((f, i) => h`<button type="button" class="row" data-hit="${i}"><span class="grow">${f.label}</span></button>`));
    const choose = f => { Object.assign(p, { label: f.label, lat: f.lat, lon: f.lon }); if (!q('#pl-n').value) q('#pl-n').value = f.name; q('#pl-q').value = f.label; q('#pl-cur').textContent = T.places.chosen(f.label); found = []; showHits(); };
    let timer = null;
    q('#pl-q').addEventListener('input', e => {
      clearTimeout(timer);
      const text = e.target.value.trim();
      if (text.length < 3) { found = []; showHits(); return; }
      timer = setTimeout(async () => { try { found = await searchPlaces(text); } catch (err) { found = []; toast(err.message); } showHits(); }, 350);
    });
    q('#pl-hits').addEventListener('click', e => { const b = e.target.closest('[data-hit]'); if (b) choose(found[Number(b.dataset.hit)]); });
    q('[data-here]').addEventListener('click', async () => {
      try { const pos = await hereNow(); choose(await reversePlace(pos.lat, pos.lon)); }
      catch (err) { toast(err instanceof UserError ? err.message : T.places.noGps); }
    });
    sheet.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => { p.role = b.dataset.role; sheet.querySelectorAll('[data-role]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    q('[data-save]').addEventListener('click', () => tryCommit(sheet, T.common.saved, () => { savePlace({ ...p, name: q('#pl-n').value.trim(), note: q('#pl-note').value.trim() }); }, back));
    bindDelete(sheet, () => { commit(T.places.deleted, () => deletePlace(p.id)); back(); });
  });
}
