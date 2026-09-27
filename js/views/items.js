'use strict';
/* ---------- nytt eller endret punkt: gjøremål, avtale, notat eller handling ---------- */
function openItemSheet(id, date) {
  const cur = id ? state.items.find(x => x.id === id) : null;
  const x = cur ? { ...cur } : { id: uid(), kind: 'todo', date: date || view, time: '', title: '', note: '', done: false, shared: false };
  const canShare = syncOn() && sync.cfg.share;
  const kinds = ITEM_KINDS.map(k => [k, T.items.kind[k]]);
  openSheet(h`${sheetHead(cur ? T.items.editTitle : T.items.newTitle)}<div class="sh-body">
    <section class="grp">${segRow('data-kind', kinds, k => k === x.kind)}
      <label class="field"><span id="it-tl">${T.items.titleLabel[x.kind]}</span><input type="text" id="it-t" value="${x.title}" maxlength="200" enterkeyhint="done"></label>
      <div class="fields two"><label class="field"><span>${T.items.date}</span><input type="date" id="it-d" value="${x.date}"></label>
        <label class="field" id="it-timef"${x.kind === 'appt' ? '' : raw(' hidden')}><span>${T.items.time}</span><input type="time" id="it-h" value="${x.time}"></label></div>
      ${hint(T.items.dateHint)}
      <label class="field"><span>${T.items.note}</span><textarea id="it-n" rows="3" maxlength="2000">${x.note}</textarea></label>
      ${canShare ? h`${switchBtn('data-share', '1', x.shared, T.items.shareWith(state.settings.dognName || T.home.dognDefault))}${hint(T.items.shareHint)}` : ''}${errBox()}</section>
    ${cur ? delConfirm(T.items.delete, T.items.deleteQ) : ''}
  </div>${sheetFoot(T.common.save)}`, (sheet, q) => {
    sheet.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
      x.kind = b.dataset.kind;
      sheet.querySelectorAll('[data-kind]').forEach(y => y.setAttribute('aria-pressed', String(y === b)));
      q('#it-timef').hidden = x.kind !== 'appt';
      q('#it-tl').textContent = T.items.titleLabel[x.kind];
      // Handling deles med Døgn som standard, så den havner på handlelisten
      if (canShare && x.kind === 'shop' && !cur) { x.shared = true; q('[data-share]').setAttribute('aria-checked', 'true'); }
    }));
    const sh = q('[data-share]');
    if (sh) sh.addEventListener('click', () => { x.shared = !x.shared; sh.setAttribute('aria-checked', String(x.shared)); });
    q('[data-save]').addEventListener('click', () => tryCommit(sheet, cur ? T.common.saved : T.items.added, () => {
      saveItem({ ...x, title: q('#it-t').value, date: q('#it-d').value, time: x.kind === 'appt' ? q('#it-h').value : '', note: q('#it-n').value });
    }, closeSheet));
    bindDelete(sheet, () => { commit(T.items.deleted, () => deleteItem(x.id)); closeSheet(); });
    if (!cur) setTimeout(() => q('#it-t').focus(), 280);
  });
}
