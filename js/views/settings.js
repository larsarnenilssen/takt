'use strict';
/* ---------- meny, profil og visning, backup og deling, førstegangsoppsett ---------- */
function openMenu() {
  const back = openMenu;
  openSheet(h`${sheetHead(T.menu.title)}<div class="sh-body">
    <div class="rows">${navRow('rota', T.rota.title, T.rota.codeCount(codeList().length))}
      ${navRow('places', T.places.title, [placeName(placeByRole('home')), placeName(placeByRole('work'))].filter(Boolean).join(' → '))}
      ${navRow('profile', T.profile.title, T.profile.meta(T.profile.themes[state.settings.theme]))}
      ${undoStack.length ? navRow('undo', T.menu.undo, undoStack[undoStack.length - 1].label) : ''}</div>
    <section class="grp"><div class="rows">${navRow('calendar', T.calendar.title, calOn() ? T.calendar.statusOn : T.calendar.statusOff)}${navRow('backup', T.backup.title, backupStatus())}</div></section>
    <p class="hint version">${T.menu.version(APP_VERSION)} · <a href="personvern.html">${T.menu.privacy}</a></p>
  </div>`, (sheet, q) => {
    const nav = (k, fn) => { const b = q('[data-nav="' + k + '"]'); if (b) b.addEventListener('click', fn); };
    nav('rota', () => openRotaSheet(back));
    nav('places', () => openPlacesSheet(back));
    nav('profile', () => openProfileSheet(back));
    nav('undo', () => { closeSheet(); undoLast(); });
    nav('backup', () => openBackupSheet(back));
    nav('calendar', () => openCalendarSetupSheet(back));
  }, openMenu);
}

function openProfileSheet(back) {
  const S = state.settings;
  openSheet(h`${sheetHead(T.profile.title, !!back)}<div class="sh-body">
    <section class="grp"><label class="field"><span>${T.profile.name}</span><input type="text" id="pf-n" value="${state.profile.name}" placeholder="${T.profile.namePh}"></label>
      ${dognOn() ? h`<label class="field"><span>${T.profile.dognName}</span><input type="text" id="pf-d" value="${S.dognName}" placeholder="${T.home.dognDefault}"></label>${hint(T.profile.dognNameHint)}` : ''}</section>
    <section class="grp"><h3>${T.profile.theme}</h3>${segRow('data-theme', THEMES.map(t => [t, T.profile.themes[t]]), t => t === S.theme)}
      <h3 class="sub">${T.profile.textSize}</h3>${segRow('data-size', TEXT_SIZES.map(z => [z, T.profile.sizes[TEXT_SIZES.indexOf(z)]]), z => Number(z) === S.textSize)}</section>
  </div>${sheetFoot(T.common.save)}`, (sheet, q) => {
    bindBack(sheet, back);
    // Tema og tekststørrelse vises med en gang, og lagres når de trykkes
    sheet.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => { commit('', () => { S.theme = b.dataset.theme; }); applyTheme(); sheet.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    sheet.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => { commit('', () => { S.textSize = Number(b.dataset.size); }); applyTheme(); sheet.querySelectorAll('[data-size]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    q('[data-save]').addEventListener('click', () => {
      commit(T.common.saved, () => { state.profile.name = str(q('#pf-n').value.trim(), 60); const d = q('#pf-d'); if (d) S.dognName = str(d.value.trim(), 40); });
      if (back) back(); else closeSheet();
    });
  }, () => openProfileSheet(back));
}

/* ---------- backup og deling (valgfritt) ---------- */
function openSyncSheet(back) {
  const c = sync.cfg;
  if (!syncOn()) {
    openSheet(h`${sheetHead(T.sync.title, !!back)}<div class="sh-body">
      ${hint(T.sync.intro)}
      <section class="grp"><label class="field"><span>${T.sync.owner}</span><input type="text" id="sy-o" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span>${T.sync.repo}</span><input type="text" id="sy-r" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="repo"></label>
        <label class="field"><span>${T.sync.token}</span><input type="password" id="sy-t" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
        ${hint(T.sync.tokenHint)}
        <label class="field"><span>${T.sync.expires}</span><input type="date" id="sy-x"></label>${hint(T.sync.expiresHint)}${errBox()}</section>
    </div>${sheetFoot(T.sync.connect)}`, (sheet, q) => {
      bindBack(sheet, back);
      q('[data-save]').addEventListener('click', async () => {
        const err = q('[data-err]');
        err.hidden = true;
        try {
          const r = await connectSync(q('#sy-o').value.trim(), q('#sy-r').value.trim(), q('#sy-t').value.trim(), q('#sy-x').value);
          if (r.isPublic) toast(T.sync.publicWarn);
          openSyncSheet(back);
          await offerRestore();
          await pushShare();
          await pullDogn();
        } catch (e) { err.textContent = netMessage(e); err.hidden = false; }
      });
    }, Object.assign(() => openSyncSheet(back), { refresh: 'github' }));
    return;
  }
  const line = (label, iso8601) => h`<p class="kv"><span class="k">${label}</span><span>${iso8601 ? fmtStamp(iso8601) : T.sync.never}</span></p>`;
  openSheet(h`${sheetHead(T.sync.title, !!back)}<div class="sh-body">
    <p class="lead">${T.sync.connectedTo(c.owner + '/' + c.repo)}</p>
    ${c.lastError ? h`<p class="err">${c.lastError}</p>` : ''}
    <section class="grp">${switchBtn('data-opt', 'backup', c.backup, T.sync.optBackup)}${line(T.sync.lastBackup, c.lastPush)}
      ${switchBtn('data-opt', 'share', c.share, T.sync.optShare)}${line(T.sync.lastShare, c.lastShare)}
      ${switchBtn('data-opt', 'dogn', c.dogn, T.sync.optDogn)}${line(T.sync.lastPull, c.lastPull)}${hint(T.sync.filesHint)}</section>
    <div class="btnrow"><button type="button" class="btn small" data-now>${T.sync.now}</button><button type="button" class="btn small" data-restore>${T.sync.restore}</button></div>
    <section class="grp"><h3>${T.sync.keyHead}</h3>
      <label class="field"><span>${T.sync.expires}</span><input type="date" id="sy-x" value="${c.expires || ''}"></label>${hint(T.sync.expiresHint)}
      <label class="field"><span>${T.sync.newToken}</span><input type="password" id="sy-t" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>${hint(T.sync.newTokenHint)}
      ${errBox()}<button type="button" class="btn small" data-key>${T.sync.saveKey}</button></section>
    <section class="grp quiet"><button type="button" class="btn link danger" data-off>${T.sync.disconnect}</button>${hint(T.sync.disconnectHint)}</section>
  </div>`, (sheet, q) => {
    bindBack(sheet, back);
    sheet.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.opt;
      c[k] = !c[k];
      if (k === 'share' && c.share) c.shareDirty = true;
      if (k === 'backup' && c.backup) c.dirty = true;
      saveSync(); scheduleSync(); render();
      b.setAttribute('aria-checked', String(c[k]));
      if (k === 'dogn' && c.dogn) pullDogn();
    }));
    q('[data-now]').addEventListener('click', async () => {
      if (c.backup) await pushBackup();
      if (c.share) await pushShare();
      if (c.dogn) await pullDogn();
      toast(sync.cfg && sync.cfg.lastError ? sync.cfg.lastError : T.sync.done);
    });
    q('[data-restore]').addEventListener('click', () => offerRestore(true));
    q('[data-key]').addEventListener('click', async () => {
      const err = q('[data-err]');
      err.hidden = true;
      try { await updateSyncKey(q('#sy-t').value.trim(), q('#sy-x').value); toast(T.sync.keySaved); render(); openSyncSheet(back); }
      catch (e) { err.textContent = netMessage(e); err.hidden = false; }
    });
    q('[data-off]').addEventListener('click', () => { disconnectSync(); render(); openSyncSheet(back); });
  }, Object.assign(() => openSyncSheet(back), { refresh: 'github' }));
}
/* Finnes det en backup i repoet, kan den hentes inn (ved tilkobling bare når appen er tom) */
async function offerRestore(always) {
  if (!always && Object.keys(state.rota.codes).length) return;
  let data = null;
  try { data = await pullBackup(); } catch (e) { if (always) toast(netMessage(e)); return; }
  if (!always || confirm(T.sync.restoreQ)) {
    commit(T.sync.restored, () => { state = data; state.meta.setupDone = true; });
    applyTheme();
    // Mangler hjem eller arbeidssted (for eksempel i en startfil), fortsetter oppsettet der
    if (!always) { if (!placeByRole('home') || !placeByRole('work')) openSetupSheet(2); else closeSheet(); }
  }
}

/* ---------- førstegangsoppsett ---------- */
function openSetupSheet(step = 1) {
  const done = () => { commit(null, () => { state.meta.setupDone = true; }); closeSheet(); };
  const again = () => openSetupSheet(step);
  const next = () => openSetupSheet(step + 1);
  const steps = googleReady() ? 4 : 3;
  const dots = h`<p class="steps" aria-label="${T.setup.stepOf(step, steps)}">${Array.from({ length: steps }, (_, i) => h`<span class="${i < step ? 'on' : ''}"></span>`)}</p>`;
  if (step === 1) {
    openSheet(h`${sheetHead(T.setup.welcome)}<div class="sh-body">${dots}
      <p class="lead">${T.setup.intro}</p>
      <section class="grp"><label class="field"><span>${T.profile.name}</span><input type="text" id="su-n" value="${state.profile.name}" placeholder="${T.profile.namePh}"></label></section>
      <section class="grp quiet"><h3>${T.setup.haveData}</h3><div class="btnrow">${googleReady() ? h`<button type="button" class="btn small" data-drive>${T.setup.fromDrive}</button>` : ''}<button type="button" class="btn small" data-file>${T.setup.fromFile}</button>${githubVisible() ? h`<button type="button" class="btn small" data-gh>${T.setup.fromGithub}</button>` : ''}</div></section>
    </div>${sheetFoot(T.setup.next)}`, (sheet, q) => {
      q('[data-save]').addEventListener('click', () => { commit(null, () => { state.profile.name = str(q('#su-n').value.trim(), 60); }); next(); });
      q('[data-file]').addEventListener('click', importBackupFile);
      const dr = q('[data-drive]');
      if (dr) dr.addEventListener('click', () => openDriveSheet(again));
      const gh = q('[data-gh]');
      if (gh) gh.addEventListener('click', () => openSyncSheet(again));
    }, again);
  } else if (step === 2) {
    const row = r => { const p = placeByRole(r); return h`<button type="button" class="row" data-role="${r}"><span class="grow">${T.places.role[r]}<span class="m">${p ? p.label : T.places.notChosen}</span></span><span class="chev">›</span></button>`; };
    openSheet(h`${sheetHead(T.setup.placesTitle, true)}<div class="sh-body">${dots}
      ${hint(T.setup.placesHint)}<div class="rows">${row('home')}${row('work')}</div>
      <div class="fields two"><label class="field"><span>${T.places.before}</span><input type="number" inputmode="numeric" min="0" max="120" id="su-b" value="${state.travel.before}"></label>
        <label class="field"><span>${T.places.after}</span><input type="number" inputmode="numeric" min="0" max="120" id="su-a" value="${state.travel.after}"></label></div>
    </div>${sheetFoot(T.setup.next)}`, (sheet, q) => {
      bindBack(sheet, () => openSetupSheet(1));
      const keepTimes = () => commit(null, () => { state.travel.before = num(q('#su-b').value, 15, 0, 120); state.travel.after = num(q('#su-a').value, 15, 0, 120); });
      sheet.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => { keepTimes(); openPlaceSheet(placeByRole(b.dataset.role), b.dataset.role, again); }));
      q('[data-save]').addEventListener('click', () => { keepTimes(); next(); });
    }, again);
  } else if (step === 3) {
    openSheet(h`${sheetHead(T.setup.rotaTitle, true)}<div class="sh-body">${dots}
      ${hint(T.setup.rotaHint)}
      <div class="btnrow"><button type="button" class="btn primary" data-ics>${T.rota.importIcs}</button><button type="button" class="btn" data-pdf>${T.rota.importPdf}</button><button type="button" class="btn" data-manual>${T.rota.manual}</button><button type="button" class="btn" data-later>${steps > 3 ? T.setup.next : T.setup.later}</button></div>
    </div>`, (sheet, q) => {
      bindBack(sheet, () => openSetupSheet(2));
      q('[data-ics]').addEventListener('click', () => { commit(null, () => { state.meta.setupDone = true; }); importIcs(null); });
      q('[data-pdf]').addEventListener('click', () => { commit(null, () => { state.meta.setupDone = true; }); importPdf(null); });
      q('[data-manual]').addEventListener('click', () => { commit(null, () => { state.meta.setupDone = true; }); openRotaGridSheet(null); });
      q('[data-later]').addEventListener('click', steps > 3 ? next : done);
    }, again);
  } else {
    openSheet(h`${sheetHead(T.setup.backupTitle, true)}<div class="sh-body">${dots}
      ${hint(T.setup.backupHint)}
      <div class="btnrow"><button type="button" class="btn primary" data-drive>${T.drive.connect}</button><button type="button" class="btn" data-later>${T.setup.later}</button></div>
    </div>`, (sheet, q) => {
      bindBack(sheet, () => openSetupSheet(3));
      q('[data-drive]').addEventListener('click', () => { commit(null, () => { state.meta.setupDone = true; }); openDriveSheet(again); });
      q('[data-later]').addEventListener('click', done);
    }, again);
  }
}
