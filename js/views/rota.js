'use strict';
/* ---------- turnus: vakten én dag, vaktkoder og import ---------- */
const kindPairs = () => [['work', T.rota.kind.work], ['night', T.rota.kind.night], ['off', T.rota.kind.off]];
const codeChip = (c, cur) => {
  const d = state.rota.codes[c];
  return h`<button type="button" class="codechip${c === cur ? ' on' : ''}" data-code="${c}" aria-pressed="${c === cur}">
    <span class="pill sm tone-${toneOf(d.kind, d.start)}">${c}</span><span class="cc-t">${d.kind === 'off' ? T.rota.off : d.start && d.end ? d.start + '–' + d.end : d.label}</span></button>`;
};

/* Vakten én dag: velg en annen kode, ingen vakt, egne tider, eller tilbake til turnusen */
function openShiftSheet(date) {
  const sh = shiftFor(date), cur = codeOn(date), R = state.rota;
  const imported = R.shifts[date] || '';
  const cu = R.custom[date] || { start: sh && sh.start || '', end: sh && sh.end || '', label: '' };
  openSheet(h`${sheetHead(T.shift.sheetTitle(fmtDateLong(date)))}<div class="sh-body">
    <section class="grp"><p class="lead">${shiftText(sh)}</p>
      ${isManual(date) ? h`<p class="hint">${T.shift.importedWas(imported ? imported : T.rota.none)}</p><button type="button" class="btn small" data-reset>${T.shift.reset}</button>` : ''}</section>
    <section class="grp"><h3>${T.shift.pickCode}</h3>
      ${codeList().length ? h`<div class="codechips">${codeList().map(c => codeChip(c, R.custom[date] ? null : cur))}</div>` : hint(T.shift.noCodes)}
      <button type="button" class="btn small" data-none>${T.shift.noShift}</button></section>
    <section class="grp"><h3>${T.shift.custom}</h3>${hint(T.shift.customHint)}
      <div class="fields three"><label class="field"><span>${T.common.from}</span><input type="time" id="cu-s" value="${cu.start}"></label>
        <label class="field"><span>${T.common.to}</span><input type="time" id="cu-e" value="${cu.end}"></label>
        <label class="field"><span>${T.shift.customName}</span><input type="text" id="cu-l" value="${cu.label}" placeholder="${T.shift.customPh}"></label></div>
      ${errBox()}<button type="button" class="btn small" data-custom>${T.shift.useCustom}</button></section>
    <section class="grp quiet"><button type="button" class="btn link" data-codes>${T.rota.codesTitle}</button></section>
  </div>`, (sheet, q) => {
    sheet.querySelectorAll('[data-code]').forEach(b => b.addEventListener('click', () => { commit(T.shift.set(b.dataset.code), () => setDayCode(date, b.dataset.code)); closeSheet(); }));
    q('[data-none]').addEventListener('click', () => { commit(T.shift.cleared, () => setDayCode(date, '')); closeSheet(); });
    const rs = q('[data-reset]');
    if (rs) rs.addEventListener('click', () => { commit(T.shift.resetDone, () => resetDay(date)); closeSheet(); });
    q('[data-custom]').addEventListener('click', () => tryCommit(sheet, T.shift.customSet, () => setDayCustom(date, q('#cu-s').value, q('#cu-e').value, q('#cu-l').value), closeSheet));
    q('[data-codes]').addEventListener('click', () => openCodesSheet(() => openShiftSheet(date)));
  }, () => openShiftSheet(date));
}

/* ---------- vaktkoder ---------- */
function openCodesSheet(back) {
  const list = codeList();
  openSheet(h`${sheetHead(T.rota.codesTitle, !!back)}<div class="sh-body">
    ${hint(T.rota.codesHint)}
    <div class="rows">${list.map(c => { const d = state.rota.codes[c]; return h`<button type="button" class="row" data-edit="${c}">
      <span class="pill sm tone-${toneOf(d.kind, d.start)}">${c}</span><span class="grow">${d.label || T.rota.kind[d.kind]}<span class="m">${d.kind === 'off' ? T.rota.off : (d.start || '?') + '–' + (d.end || '?')} · ${T.rota.uses(codeUses(c))}</span></span><span class="chev">›</span></button>`; })}</div>
    ${list.length ? '' : hint(T.rota.noCodesYet)}
  </div>${sheetFoot(T.rota.newCode, 'data-new')}`, (sheet, q) => {
    bindBack(sheet, back);
    sheet.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openCodeSheet(b.dataset.edit, () => openCodesSheet(back))));
    q('[data-new]').addEventListener('click', () => openCodeSheet(null, () => openCodesSheet(back)));
  }, () => openCodesSheet(back));
}
function openCodeSheet(code, back) {
  const d = code ? state.rota.codes[code] : { label: '', kind: 'work', start: '', end: '' };
  let kind = d.kind;
  openSheet(h`${sheetHead(code ? T.rota.editCode(code) : T.rota.newCode, true)}<div class="sh-body">
    <section class="grp"><div class="fields two"><label class="field"><span>${T.rota.code}</span><input type="text" id="cd-c" value="${code || ''}" maxlength="12" autocapitalize="characters"></label>
      <label class="field"><span>${T.rota.label}</span><input type="text" id="cd-l" value="${d.label}" placeholder="${T.rota.labelPh}"></label></div>
      ${segRow('data-kind', kindPairs(), k => k === kind)}
      <div class="fields two" id="cd-times"${kind === 'off' ? raw(' hidden') : ''}><label class="field"><span>${T.common.from}</span><input type="time" id="cd-s" value="${d.start}"></label>
        <label class="field"><span>${T.common.to}</span><input type="time" id="cd-e" value="${d.end}"></label></div>
      ${hint(T.rota.nightHint)}${errBox()}</section>
    ${code ? delConfirm(T.rota.deleteCode, T.rota.deleteQ(codeUses(code))) : ''}
  </div>${sheetFoot(T.common.save)}`, (sheet, q) => {
    bindBack(sheet, back);
    sheet.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
      kind = b.dataset.kind;
      sheet.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      q('#cd-times').hidden = kind === 'off';
    }));
    q('[data-save]').addEventListener('click', () => tryCommit(sheet, T.common.saved, () => { saveCode(q('#cd-c').value, { label: q('#cd-l').value, kind, start: q('#cd-s').value, end: q('#cd-e').value }, code); }, back));
    bindDelete(sheet, () => { commit(T.rota.codeDeleted(code), () => deleteCode(code)); back(); });
  });
}

/* ---------- turnus-menyen ---------- */
function openRotaSheet(back) {
  const src = state.rota.source;
  openSheet(h`${sheetHead(T.rota.title, !!back)}<div class="sh-body">
    ${src ? h`<p class="hint">${T.rota.sourceInfo(fmtDateShort(src.from), fmtDateShort(src.to), src.importedAt ? fmtStamp(src.importedAt) : '')}</p>` : hint(T.rota.intro)}
    <div class="rows">${navRow('ics', T.rota.importIcs, T.rota.importIcsMeta)}${navRow('manual', T.rota.manual, T.rota.manualMeta)}${navRow('pdf', T.rota.importPdf, T.rota.importPdfMeta)}${navRow('file', T.rota.importFile, T.rota.importFileMeta)}
      ${navRow('codes', T.rota.codesTitle, T.rota.codeCount(codeList().length))}${navRow('export', T.rota.exportFile, T.rota.exportMeta)}</div>
  </div>`, (sheet, q) => {
    bindBack(sheet, back);
    const again = () => openRotaSheet(back);
    q('[data-nav="manual"]').addEventListener('click', () => openRotaGridSheet(again));
    q('[data-nav="pdf"]').addEventListener('click', () => importPdf(again));
    q('[data-nav="ics"]').addEventListener('click', () => importIcs(again));
    q('[data-nav="file"]').addEventListener('click', async () => {
      const text = await pickFile('.json,.txt,application/json,text/plain');
      if (text == null) return;
      try {
        const r = parseRotaText(text);
        const dates = Object.keys(r.shifts).sort();
        openReviewSheet({ entries: r.shifts, codes: r.codes, from: dates[0], to: dates[dates.length - 1] }, again);
      } catch (e) { if (e instanceof UserError) toast(e.message); else throw e; }
    });
    q('[data-nav="codes"]').addEventListener('click', () => openCodesSheet(again));
    q('[data-nav="export"]').addEventListener('click', () => downloadJson(T.rota.exportName(todayISO()), rotaFile()));
  }, () => openRotaSheet(back));
}

/* ---------- import fra MinGat (kalenderfil) ---------- */
async function importIcs(back) {
  const text = await pickFile('.ics,text/calendar');
  if (text == null) return;
  try { openReviewSheet(icsProposal(parseIcs(text)), back); }
  catch (e) { if (e instanceof UserError) toast(e.message); else throw e; }
}

/* ---------- import fra PDF ----------
   Lesingen tar noen sekunder. Etterpå kommer kontrollen, der brukeren
   ser hver kode med bildene fra planen og kan rette før noe lagres. */
async function importPdf(back) {
  const bytes = await pickFile('application/pdf,.pdf', true);
  if (!bytes) return;
  openSheet(h`${sheetHead(T.rota.reading)}<div class="sh-body"><p class="lead" id="rd-step">${T.rota.step.render}</p>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span id="rd-bar"></span></div>${hint(T.rota.readingHint)}</div>`);
  const step = $('#rd-step'), bar = $('#rd-bar');
  try {
    const res = await readRotaPdf(bytes, codeList(), (s, p) => {
      if (!step.isConnected) return;
      step.textContent = T.rota.step[s];
      bar.style.width = Math.round(p * 100) + '%';
      bar.parentElement.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    });
    if (!step.isConnected) return;
    openReviewSheet(pdfProposal(res), back);
  } catch (e) {
    if (!step.isConnected) return;
    setHtml(step, e instanceof UserError ? e.message : T.rota.pdfFailed);
    console.error(e);
  }
}
/* Fra lesningen til et forslag: { entries, codes, from, to, cells } der cells har bilde og sikkerhet per dag */
function pdfProposal(res) {
  const entries = {}, cells = {};
  let from = null, to = null;
  for (const w of res.weeks) {
    w.days.forEach((c, i) => {
      const d = addDays(w.monday, i);
      if (c.kind === 'hatch') return;
      if (!from) from = d;
      to = d;
      if (c.kind === 'empty') entries[d] = EMPTY_CODE;
      else if (c.kind === 'text') { entries[d] = c.code; cells[d] = { thumb: c.thumb, sure: c.sure }; }
    });
  }
  return { entries, codes: {}, from, to, cells };
}
const EMPTY_CODE = 'F';   // tom rute i planen betyr fri, som i Døgn

/* Kontroll før import. p: { entries, codes, from, to, cells? } */
function openReviewSheet(p, back) {
  const known = state.rota.codes;
  const groups = {};
  for (const [d, c] of Object.entries(p.entries)) (groups[c] ??= []).push(d);
  const codes = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'nb', { numeric: true }));
  const unsure = Object.keys(p.cells || {}).filter(d => !p.cells[d].sure).sort();
  const isNew = c => !!c && !known[c] && !p.codes[c];
  const defs = {};
  for (const c of codes) if (isNew(c)) defs[c] = c === EMPTY_CODE ? { label: T.rota.emptyLabel, kind: 'off', start: '', end: '' } : { label: '', kind: 'work', start: '', end: '' };
  let from = p.from < todayISO() && p.to >= todayISO() ? todayISO() : p.from;
  let keep = true;

  const thumbs = c => (p.cells ? groups[c].filter(d => p.cells[d]).slice(0, 10) : []).map(d => h`<img src="${p.cells[d].thumb}" alt="" class="${p.cells[d].sure ? '' : 'unsure'}">`);
  const groupRow = c => h`<div class="rv-g${isNew(c) ? ' new' : ''}" data-g="${c}">
    <div class="rv-top"><input type="text" class="rv-code" value="${c}" data-rename="${c}" maxlength="12" aria-label="${T.rota.code}" autocapitalize="characters" placeholder="?">
      <span class="grow m">${T.rota.days(groups[c].length)}${known[c] || p.codes[c] ? ' · ' + shiftText({ ...(known[c] || p.codes[c]), code: '' }).replace(/^ · /, '') : ''}</span>
      ${c && !known[c] ? h`<span class="tag">${T.rota.newTag}</span>` : ''}</div>
    ${p.cells ? h`<div class="thumbs">${thumbs(c)}${groups[c].length > 10 ? h`<span class="m">+${groups[c].length - 10}</span>` : ''}</div>` : ''}
    ${isNew(c) ? h`<div class="rv-def">${segRow('data-dkind="' + c + '" data-k', kindPairs(), k => k === defs[c].kind)}
      <div class="fields three"${defs[c].kind === 'off' ? raw(' data-off') : ''}><label class="field"><span>${T.common.from}</span><input type="time" data-ds="${c}" value="${defs[c].start}"></label>
      <label class="field"><span>${T.common.to}</span><input type="time" data-de="${c}" value="${defs[c].end}"></label>
      <label class="field"><span>${T.rota.label}</span><input type="text" data-dl="${c}" value="${defs[c].label}"></label></div></div>` : ''}</div>`;

  openSheet(h`${sheetHead(T.rota.reviewTitle, !!back)}<div class="sh-body">
    <p class="lead">${T.rota.found(Object.keys(p.entries).length, fmtDateShort(p.from), fmtDateShort(p.to))}</p>
    ${p.custom && Object.keys(p.custom).length ? hint(T.rota.customFound(Object.keys(p.custom).length)) : ''}
    ${unsure.length ? h`<section class="grp attention"><h3>${T.rota.checkThese(unsure.length)}</h3>${hint(T.rota.checkHint)}
      ${unsure.map(d => h`<div class="rv-u"><span class="grow">${fmtDateShort(d)} <span class="m">${wdShort(isoWd(d))}</span></span>
        <img src="${p.cells[d].thumb}" alt="${T.rota.imgAlt}"><input type="text" class="rv-code" data-day="${d}" value="${p.entries[d]}" maxlength="12" aria-label="${T.rota.codeFor(fmtDateShort(d))}" autocapitalize="characters"></div>`)}</section>` : ''}
    <section class="grp"><h3>${T.rota.codesFound}</h3>${hint(p.cells ? T.rota.codesFoundHint : T.rota.codesFileHint)}${codes.map(groupRow)}</section>
    <section class="grp"><h3>${T.rota.period}</h3><div class="fields two"><label class="field"><span>${T.rota.fromDate}</span><input type="date" id="rv-from" value="${from}" min="${p.from}" max="${p.to}"></label>
      <label class="field"><span>${T.rota.toDate}</span><input type="date" value="${p.to}" disabled></label></div>
      ${switchBtn('data-keep', '1', keep, T.rota.keepManual)}${hint(T.rota.keepHint)}${errBox()}</section>
  </div>${sheetFoot(T.rota.publish)}`, (sheet, q) => {
    bindBack(sheet, back);
    sheet.querySelectorAll('[data-dkind]').forEach(b => b.addEventListener('click', () => {
      const c = b.dataset.dkind;
      defs[c].kind = b.dataset.k;
      sheet.querySelectorAll('[data-dkind="' + CSS.escape(c) + '"]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      b.closest('.rv-def').querySelector('.fields').toggleAttribute('data-off', defs[c].kind === 'off');
    }));
    q('[data-keep]').addEventListener('click', e => { keep = !keep; e.currentTarget.setAttribute('aria-checked', String(keep)); });
    q('[data-save]').addEventListener('click', () => tryCommit(sheet, '', () => {
      // Endringer i kontrollen: omdøpte grupper og rettede enkeltdager
      const entries = { ...p.entries };
      sheet.querySelectorAll('[data-rename]').forEach(inp => {
        const nc = inp.value.trim().toUpperCase(), oc = inp.dataset.rename;
        if (nc !== oc) for (const d of groups[oc]) entries[d] = nc;
      });
      sheet.querySelectorAll('[data-day]').forEach(inp => { if (inp.value.trim().toUpperCase() !== p.entries[inp.dataset.day]) entries[inp.dataset.day] = inp.value.trim().toUpperCase(); });
      const newCodes = { ...p.codes };
      for (const c of Object.keys(defs)) defs[c] = { ...defs[c], start: (q('[data-ds="' + CSS.escape(c) + '"]') || {}).value || '', end: (q('[data-de="' + CSS.escape(c) + '"]') || {}).value || '', label: (q('[data-dl="' + CSS.escape(c) + '"]') || {}).value || '' };
      for (const c of new Set(Object.values(entries))) {
        if (!c) continue;
        if (!CODE_RE.test(c)) throw new UserError(T.rota.badCodeIn(c));
        if (known[c] || newCodes[c]) continue;
        // En kode som er omdøpt til noe ukjent, bruker definisjonen fra gruppen den kom fra
        const srcGroup = Object.keys(groups).find(g => groups[g].some(d => entries[d] === c)) || c;
        const def = defs[c] || defs[srcGroup];
        if (!def) throw new UserError(T.rota.needDef(c));
        if (def.kind !== 'off' && (!isTime(def.start) || !isTime(def.end))) throw new UserError(T.rota.needDef(c));
        newCodes[c] = def;
      }
      from = q('#rv-from').value || p.from;
      const custom = {};
      for (const [d, cu] of Object.entries(p.custom || {})) if (entries[d] === p.entries[d]) custom[d] = cu;   // ikke når koden er rettet i kontrollen
      const n = applyRota(entries, newCodes, { from, to: p.to, keepManual: keep, custom });
      return T.rota.published(n);
    }, () => { closeSheet(); goTo(from > todayISO() ? from : todayISO()); }));
  });
}
