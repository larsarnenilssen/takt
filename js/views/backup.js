'use strict';
/* ---------- backup: Google Drive, fil og GitHub (avansert) ----------
   Anbefalt for de fleste er Google Drive (se domain/drive.js). Fil passer for
   den som vil ta vare på backupen selv. GitHub brukes sammen med Døgn. */
const backupStatus = () => driveOn() ? T.drive.status(drive.cfg.lastBackup ? fmtStamp(drive.cfg.lastBackup) : '')
  : syncOn() ? T.sync.connectedTo(sync.cfg.repo)
  : state.meta.lastExport ? T.backup.fileOn(fmtDateShort(state.meta.lastExport)) : T.backup.none;

function openBackupSheet(back) {
  const again = () => openBackupSheet(back);
  openSheet(h`${sheetHead(T.backup.title, !!back)}<div class="sh-body">
    ${hint(T.backup.intro)}
    ${driveReady() ? h`<section class="grp"><h3>${T.drive.title}</h3><div class="rows">${navRow('drive', driveOn() ? T.drive.title : T.drive.connect, driveOn() ? backupStatus() : T.drive.meta)}</div></section>` : ''}
    <section class="grp"><h3>${T.backup.file}</h3><div class="rows">${navRow('export', T.backup.saveFile, T.backup.saveFileMeta)}${navRow('import', T.backup.readFile, T.backup.readFileMeta)}</div></section>
    <section class="grp quiet"><h3>${T.backup.advanced}</h3><div class="rows">${navRow('sync', T.sync.title, syncOn() ? T.sync.connectedTo(sync.cfg.repo) : T.sync.off, true)}</div></section>
  </div>`, (sheet, q) => {
    bindBack(sheet, back);
    const nav = (k, fn) => { const b = q('[data-nav="' + k + '"]'); if (b) b.addEventListener('click', fn); };
    nav('drive', () => openDriveSheet(again));
    nav('export', shareBackup);
    nav('import', importBackupFile);
    nav('sync', () => openSyncSheet(again));
  }, again);
}

/* Backup som fil: delingsmenyen på telefonen (Drive, e-post, Filer …), ellers nedlasting */
async function shareBackup() {
  const name = T.menu.backupName(todayISO());
  const text = JSON.stringify(state, null, 1);
  const file = typeof File === 'function' ? new File([text], name, { type: 'application/json' }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); }
    catch (e) { if (e && e.name === 'AbortError') return; downloadJson(name, state); }
  } else downloadJson(name, state);
  commit(null, () => { state.meta.lastExport = todayISO(); });
  toast(T.backup.fileDone);
}
async function importBackupFile() {
  const text = await pickFile('.json,application/json');
  if (text == null) return;
  try {
    const next = migrate(JSON.parse(text));
    commit(T.menu.imported, () => { state = next; });
    applyTheme();
    closeSheet();
  } catch (e) { toast(e instanceof UserError ? e.message : T.file.notTakt); }
}

/* Google Drive: slå på (velg kode og logg inn), status, logg inn igjen, slå av */
function openDriveSheet(back) {
  const c = drive.cfg;
  if (!driveOn()) {
    openSheet(h`${sheetHead(T.drive.connect, !!back)}<div class="sh-body">
      ${hint(T.drive.intro, true)}
      <section class="grp"><label class="field"><span>${T.drive.code}</span><input type="password" id="dr-c" autocomplete="new-password" minlength="${GD.MIN_CODE}"></label>
        <label class="field"><span>${T.drive.codeAgain}</span><input type="password" id="dr-c2" autocomplete="new-password"></label>
        ${hint(T.drive.codeHint, true)}${errBox()}</section>
    </div>${sheetFoot(T.drive.goLogin)}`, (sheet, q) => {
      bindBack(sheet, back);
      q('[data-save]').addEventListener('click', () => {
        const err = q('[data-err]');
        try {
          if (q('#dr-c').value !== q('#dr-c2').value) throw new UserError(T.drive.codeMismatch);
          driveConnect(q('#dr-c').value);
        } catch (e) { if (!(e instanceof UserError)) throw e; err.textContent = e.message; err.hidden = false; }
      });
    }, () => openDriveSheet(back));
    return;
  }
  const wrongCode = c.lastError === T.drive.wrongCode;
  openSheet(h`${sheetHead(T.drive.title, !!back)}<div class="sh-body">
    <p class="lead">${c.pending ? T.drive.pending : c.lastBackup ? T.drive.last(fmtStamp(c.lastBackup)) : T.drive.never}</p>
    ${c.lastError ? h`<p class="err">${c.lastError}</p>` : ''}
    ${wrongCode ? h`<section class="grp"><label class="field"><span>${T.drive.code}</span><input type="password" id="dr-c" autocomplete="current-password"></label>
      ${hint(T.drive.wrongCodeHint)}<button type="button" class="btn small primary" data-retry>${T.drive.tryCode}</button></section>` : ''}
    ${!wrongCode && c.pending ? h`<button type="button" class="btn small primary" data-continue>${T.drive.continue}</button>` : ''}
    ${!c.pending ? h`<section class="grp">${hint(tokenOk() ? T.drive.loggedIn : T.drive.loggedOut)}
      <div class="btnrow">${tokenOk() ? h`<button type="button" class="btn small" data-now>${T.drive.now}</button>` : h`<button type="button" class="btn small primary" data-login>${T.drive.login}</button>`}
      <button type="button" class="btn small" data-restore>${T.drive.restore}</button></div></section>` : ''}
    ${delConfirm(T.drive.disconnect, T.drive.disconnectQ)}
  </div>`, (sheet, q) => {
    bindBack(sheet, back);
    const on = (sel, fn) => { const b = q(sel); if (b) b.addEventListener('click', fn); };
    on('[data-now]', async () => { drive.cfg.dirty = true; const ok = await driveBackup(); toast(ok ? T.drive.saved : drive.cfg.lastError); });
    on('[data-login]', () => driveLogin('backup'));
    on('[data-continue]', () => { if (tokenOk()) driveAfterConnect(); else driveLogin('connect'); });
    on('[data-retry]', () => {
      try { driveSetCode(q('#dr-c').value); } catch (e) { toast(e.message); return; }
      if (tokenOk()) driveAfterConnect(); else driveLogin('connect');
    });
    on('[data-restore]', () => {
      if (!tokenOk()) { driveLogin('restore'); return; }
      driveRestoreAsk();
    });
    bindDelete(sheet, () => { driveDisconnect(); toast(T.drive.disconnected); render(); openBackupSheet(null); });
  }, () => openDriveSheet(back));
}
/* Hent backupen fra Drive på nytt (erstatter det som er i appen) */
async function driveRestoreAsk() {
  let found;
  try { found = await downloadBackup(); } catch (e) { toast(e.message); return; }
  if (!found) { toast(T.drive.noBackup); return; }
  openDriveChoiceSheet(found);
}
/* Det finnes både data i appen og en backup i Drive: brukeren velger */
function openDriveChoiceSheet(found) {
  openSheet(h`${sheetHead(T.drive.choiceTitle)}<div class="sh-body">
    <p class="lead">${T.drive.choiceLead(found.modified ? fmtStamp(found.modified) : '')}</p>${hint(T.drive.choiceHint)}
    <div class="btnrow"><button type="button" class="btn primary" data-fetch>${T.drive.useBackup}</button><button type="button" class="btn" data-keep>${T.drive.keepHere}</button></div>
  </div>`, (sheet, q) => {
    q('[data-fetch]').addEventListener('click', () => driveRestoreFrom(found));
    q('[data-keep]').addEventListener('click', driveKeepLocal);
  });
}
/* Påminnelse øverst på siden når backup mangler eller venter */
function backupNotice() {
  if (driveNeedsLogin()) return h`<section class="card notice"><p>${T.drive.waiting}</p><button type="button" class="btn small primary" data-act="drive-login">${T.drive.login}</button></section>`;
  if (driveOn() || syncOn() || !state.meta.setupDone || !Object.keys(state.rota.codes).length) return '';
  const since = state.meta.lastExport || state.meta.created;
  if (diffDays(since, todayISO()) < BACKUP_NAG_DAYS) return '';
  return h`<section class="card notice"><p>${state.meta.lastExport ? T.backup.old(diffDays(state.meta.lastExport, todayISO())) : T.backup.noneYet}</p>
    <button type="button" class="btn small primary" data-act="backup">${T.backup.choose}</button></section>`;
}
const BACKUP_NAG_DAYS = 14;
