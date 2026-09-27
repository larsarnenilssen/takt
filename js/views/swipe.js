'use strict';
/* ---------- sveiping (samme oppførsel som i Døgn) ----------
   Dag: siden følger fingeren, nabodagen vises i kanten, og slipper du langt nok,
   glir den over til neste eller forrige dag.
   Kalender: sveip bytter måned.
   Ark: dra arket ned for å lukke (fra toppen, eller fra innholdet når det står øverst),
   sveip fra venstre kant for «Tilbake».
   Loddrett blaing, dra-grep, skjemafelt og tabeller som ruller vannrett utløser ikke sveip. */
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const noSwipe = t => !!(t && t.closest && t.closest('input, textarea, select, .seg, .legs, .thumbs'));

/* Felles gjenkjenning: bestemmer retning etter 10 px, og rapporterer bare vannrette sveip */
function horizontalSwipe(el, { start, move, end, cancel, filter }) {
  let sx = 0, sy = 0, t0 = 0, mode = null;
  el.addEventListener('touchstart', e => {
    mode = e.touches.length !== 1 || (filter && !filter(e)) ? 'off' : null;
    if (mode) return;
    const p = e.touches[0]; sx = p.clientX; sy = p.clientY; t0 = Date.now();
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (mode === 'off') return;
    const p = e.touches[0], dx = p.clientX - sx, dy = p.clientY - sy;
    if (!mode) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'off';
      if (mode === 'x' && start) start(dx, sx);
    }
    if (mode === 'x' && move) move(dx, dy);
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (mode === 'x') { const p = e.changedTouches[0]; end(p.clientX - sx, p.clientY - sy, Date.now() - t0, sx); }
    mode = null;
  }, { passive: true });
  el.addEventListener('touchcancel', () => { if (mode === 'x' && cancel) cancel(); mode = null; }, { passive: true });
}
const isFling = (dx, ms, width) => Math.abs(dx) > Math.min(90, width * 0.22) || (Math.abs(dx) > 40 && Math.abs(dx) / Math.max(1, ms) > 0.5);

/* ---------- dag ---------- */
(() => {
  const tl = $('#page');
  let peek = null;
  const clear = () => { tl.style.transform = ''; tl.style.opacity = ''; tl.classList.remove('swiping', 'settle'); if (peek) { peek.remove(); peek = null; } };
  const settle = (x, done) => {
    tl.classList.remove('swiping'); tl.classList.add('settle');
    tl.style.transform = x ? 'translateX(' + x + 'px)' : ''; tl.style.opacity = x ? '0' : '';
    setTimeout(() => { if (done) done(); }, 180);
  };
  horizontalSwipe(tl, {
    filter: e => !noSwipe(e.target) && !sheetOpen(),
    start: () => {
      tl.classList.add('swiping');
      peek = document.createElement('div');
      peek.className = 'peek';
      peek.setAttribute('aria-hidden', 'true');
      document.body.appendChild(peek);
    },
    move: dx => {
      tl.style.transform = 'translateX(' + dx + 'px)';
      tl.style.opacity = String(1 - Math.min(0.4, Math.abs(dx) / 700));
      const dir = dx < 0 ? 1 : -1;
      peek.className = 'peek ' + (dir > 0 ? 'r' : 'l');
      peek.textContent = dir > 0 ? fmtDateShort(addDays(view, 1)) + ' ›' : '‹ ' + fmtDateShort(addDays(view, -1));
      peek.style.opacity = String(Math.min(1, Math.abs(dx) / 80));
    },
    end: (dx, dy, ms) => {
      const w = tl.clientWidth || window.innerWidth;
      if (!isFling(dx, ms, w)) { settle(0, clear); return; }
      const dir = dx < 0 ? 1 : -1;
      if (reduceMotion()) { clear(); go(dir); return; }
      settle(dx < 0 ? -w : w, () => {
        if (peek) { peek.remove(); peek = null; }
        go(dir);
        tl.classList.remove('settle');
        tl.style.transform = 'translateX(' + (dir > 0 ? w * 0.3 : -w * 0.3) + 'px)';
        void tl.offsetWidth;
        settle(0, clear);
      });
    },
    cancel: () => settle(0, clear),
  });
})();

/* ---------- kalender og ark ---------- */
(() => {
  const root = $('#sheet-root');
  // Kalender: sveip bytter måned
  horizontalSwipe(root, {
    filter: e => !!e.target.closest('.cal'),
    end: (dx, dy, ms) => {
      if (Math.abs(dx) < 50) return;
      const btns = root.querySelectorAll('.cal-nav [data-month]');
      const b = dx < 0 ? btns[btns.length - 1] : btns[0];
      if (b) b.click();
    },
  });
  // Ark: sveip fra venstre kant = «Tilbake»
  horizontalSwipe(root, {
    filter: e => e.touches[0].clientX < 28 && !!e.target.closest('.sheet'),
    end: dx => {
      if (dx < 70) return;
      const b = root.querySelector('.sheet [data-goback]');
      if (b) b.click();
    },
  });
  // Ark: dra ned for å lukke, fra toppen av arket eller fra innholdet når det står øverst
  let sy = 0, sx = 0, t0 = 0, dy = 0, sheet = null, body = null, head = false, mode = null;
  root.addEventListener('touchstart', e => {
    sheet = null; mode = null;
    const s = e.target.closest('.sheet');
    if (!s || e.touches.length !== 1 || e.target.closest('input, select, textarea')) return;
    const p = e.touches[0];
    head = !!e.target.closest('.sh-head, .grab') || p.clientY - s.getBoundingClientRect().top < 24;
    body = e.target.closest('.sh-body');
    sheet = s; sy = p.clientY; sx = p.clientX; t0 = Date.now(); dy = 0;
  }, { passive: true });
  root.addEventListener('touchmove', e => {
    if (!sheet || mode === 'off') return;
    const p = e.touches[0], ddy = p.clientY - sy, ddx = p.clientX - sx;
    if (!mode) {
      if (Math.abs(ddy) < 8 && Math.abs(ddx) < 8) return;
      const atTop = !body || body.scrollTop <= 0;
      mode = ddy > 0 && ddy > Math.abs(ddx) * 1.2 && (head || atTop) ? 'drag' : 'off';
      if (mode === 'off') return;
      sy = p.clientY;
    }
    dy = Math.max(0, p.clientY - sy);
    sheet.style.transition = 'none';
    sheet.style.transform = 'translateY(' + dy + 'px)';
  }, { passive: true });
  const release = () => {
    if (!sheet) return;
    const s = sheet, was = mode; sheet = null; mode = null;
    if (was !== 'drag') return;
    const fling = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.5;
    s.style.transition = reduceMotion() ? 'none' : '';
    if (dy > 90 || fling) { s.style.transform = 'translateY(100%)'; setTimeout(closeSheet, reduceMotion() ? 0 : 200); }
    else s.style.transform = '';
  };
  root.addEventListener('touchend', release, { passive: true });
  root.addEventListener('touchcancel', () => { dy = 0; release(); }, { passive: true });
})();

/* ---------- fast skall ----------
   Siden og arkene blar bare når det finnes mer innhold i den retningen.
   Drar du forbi toppen eller bunnen, eller der ingenting kan blas, står alt stille
   (ingen gummistrikk). Vannrette sveip og vannrett blaing i tabeller er ikke berørt. */
(() => {
  let sy = 0, sx = 0, verdict = null;
  const scroller = t => {
    for (let el = t; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
      if (el.id === 'sheet-root') return null;
    }
    const d = document.scrollingElement || document.documentElement;
    return sheetOpen() || d.scrollHeight <= d.clientHeight + 1 ? null : d;
  };
  document.addEventListener('touchstart', e => {
    verdict = null;
    if (e.touches.length === 1) { sy = e.touches[0].clientY; sx = e.touches[0].clientX; }
    else verdict = 'allow';
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (verdict === 'allow' || e.touches.length !== 1) return;
    if (verdict === 'block') { if (e.cancelable) e.preventDefault(); return; }
    const dy = e.touches[0].clientY - sy, dx = e.touches[0].clientX - sx;
    if (!dy && !dx) return;
    if (Math.abs(dx) > Math.abs(dy) || (e.target.closest && e.target.closest('input, textarea, select'))) { verdict = 'allow'; return; }
    const el = scroller(e.target);
    const top = el ? el.scrollTop <= 0 : true, bottom = el ? el.scrollTop + el.clientHeight >= el.scrollHeight - 1 : true;
    verdict = (dy > 0 && top) || (dy < 0 && bottom) ? 'block' : 'allow';
    if (verdict === 'block' && e.cancelable) e.preventDefault();
  }, { passive: false });
})();
