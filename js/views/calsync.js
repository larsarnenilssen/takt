'use strict';
/* ---------- vaktene i kalenderen: Google-kalender eller kalenderfil ----------
   Før første innlogging forklares det at Google kan vise en advarsel, hvorfor,
   og hvilke valg brukeren har. Ingen valg er riktigere enn andre. */
function openCalendarSetupSheet(back) {
  const c = cal.cfg;
  const again = () => openCalendarSetupSheet(back);
  again.refresh = 'calendar';   // calSync() tegner arket på nytt når det står åpent
  const fileRow = h`<section class="grp"><h3>${T.calendar.fileHead}</h3>${hint(T.calendar.fileHint, true)}<button type="button" class="btn small" data-file>${T.calendar.fileBtn}</button></section>`;
  if (!calOn()) {
    openSheet(h`${sheetHead(T.calendar.title, !!back)}<div class="sh-body">
      ${hint(T.calendar.intro, true)}
      ${googleReady() ? h`<section class="grp"><h3>${T.calendar.googleHead}</h3>${hint(T.calendar.googleHint, true)}
        <button type="button" class="btn small primary" data-google>${T.calendar.googleBtn}</button></section>` : ''}
      ${fileRow}
    </div>`, (sheet, q) => {
      bindBack(sheet, back);
      const g = q('[data-google]');
      if (g) g.addEventListener('click', () => { if (googleHas('cal')) calConnect(); else openCalendarWarningSheet(again); });
      q('[data-file]').addEventListener('click', shareCalendarFile);
    }, again);
    return;
  }
  openSheet(h`${sheetHead(T.calendar.title, !!back)}<div class="sh-body">
    <p class="lead">${c.lastSync ? T.calendar.last(fmtStamp(c.lastSync)) : T.calendar.notYet}</p>
    <p class="hint" id="cal-progress">${cal.progress}</p>
    ${c.lastError ? h`<p class="err">${c.lastError}</p>` : ''}
    ${hint(calTokenOk() ? T.calendar.loggedIn : T.calendar.loggedOut)}
    <div class="btnrow">${calTokenOk() ? h`<button type="button" class="btn small" data-now>${T.calendar.now}</button>` : h`<button type="button" class="btn small primary" data-login>${T.calendar.login}</button>`}</div>
    ${fileRow}
    <section class="grp quiet"><button type="button" class="btn link danger" data-off>${T.calendar.off}</button>
      <div class="confirm" data-offq hidden>${hint(T.calendar.offQ)}<div class="btnrow"><button type="button" class="btn small danger" data-off-remove>${T.calendar.offRemove}</button><button type="button" class="btn small" data-off-keep>${T.calendar.offKeep}</button></div></div></section>
  </div>`, (sheet, q) => {
    bindBack(sheet, back);
    const on = (sel, fn) => { const b = q(sel); if (b) b.addEventListener('click', fn); };
    on('[data-now]', () => { cal.cfg.dirty = true; calSync(); });
    on('[data-login]', () => googleLogin('calendar', ['cal']));
    on('[data-file]', shareCalendarFile);
    on('[data-off]', () => { q('[data-offq]').hidden = false; q('[data-off]').hidden = true; });
    on('[data-off-remove]', async () => { await calDisconnect(true); toast(T.calendar.offDone); again(); });
    on('[data-off-keep]', async () => { await calDisconnect(false); toast(T.calendar.offDone); again(); });
  }, again);
}
function setProgress() { const el = $('#cal-progress'); if (el) el.textContent = cal.progress; }

/* Forklaring før innlogging: Google kan advare fordi appen ikke er bekreftet av Google */
function openCalendarWarningSheet(back) {
  openSheet(h`${sheetHead(T.calendar.warnTitle, true)}<div class="sh-body">
    <p>${T.calendar.warnWhat}</p><p>${T.calendar.warnWhy}</p><p>${T.calendar.warnAccess}</p>
    <section class="grp"><h3>${T.calendar.warnChoices}</h3>
      <ul class="plain"><li>${T.calendar.choiceGo}</li><li>${T.calendar.choiceFile}</li><li>${T.calendar.choiceLater}</li></ul></section>
    <div class="btnrow"><button type="button" class="btn primary" data-google-go>${T.calendar.goGoogle}</button><button type="button" class="btn" data-file>${T.calendar.fileBtn}</button></div>
  </div>`, (sheet, q) => {
    bindBack(sheet, back);
    q('[data-google-go]').addEventListener('click', calConnect);
    q('[data-file]').addEventListener('click', shareCalendarFile);
  });
}

/* Kalenderfil via delingsmenyen (Google-kalender på PC, Samsung-kalender, Outlook …), ellers nedlasting */
async function shareCalendarFile() {
  const name = T.calendar.fileName(todayISO());
  const text = calendarFile();
  const file = typeof File === 'function' ? new File([text], name, { type: 'text/calendar' }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
