"""Ende-til-ende-tester for Takt.

Kjøres med:  python3 -m unittest discover -s tests -v
Krever:      pip install playwright  og  python -m playwright install chromium
Kjøres også automatisk på GitHub (Actions) ved hver endring.

Testene starter en lokal webserver for repoet og åpner appen i mobilstørrelse
med fast klokke. Entur (reiser og adressesøk) og GitHub (backup og deling)
erstattes av små falske tjenester, slik at resultatene er stabile og ingen
ekte data brukes. Turnus-PDF-en i tests/fixtures er oppdiktet (make_fixture.py).
"""
import base64
import datetime
import functools
import http.server
import json
import os
import re
import threading
import unittest
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, 'tests', 'fixtures')
TZ = datetime.timezone(datetime.timedelta(hours=2))
NOW = datetime.datetime(2026, 10, 5, 6, 0, tzinfo=TZ)          # mandag morgen
READY = "() => typeof state !== 'undefined' && !!state && !!document.querySelector('#page .card')"


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


def _serve():
    handler = functools.partial(_Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ---------- falsk Entur ----------
# Tre linjer mellom hjem og jobb: 16E (33 min), 20 (40 min) og Bybanen 1 + buss 5 (45 min).
# Avganger hvert kvarter. Gangetappene er med, som hos Entur.
LINES = {
    '16E': [('foot', 6, None), ('bus', 23, ('SKY:Line:16E', '16E')), ('foot', 4, None)],
    '20': [('foot', 8, None), ('bus', 27, ('SKY:Line:20', '20')), ('foot', 5, None)],
    '1+5': [('foot', 5, None), ('tram', 18, ('SKY:Line:1', '1')), ('foot', 3, None), ('bus', 14, ('SKY:Line:5', '5')), ('foot', 5, None)],
}


def _pattern(sig, start):
    legs, t = [], start
    for mode, mins, line in LINES[sig]:
        end = t + datetime.timedelta(minutes=mins)
        legs.append({'mode': mode, 'duration': mins * 60, 'aimedStartTime': t.isoformat(), 'expectedStartTime': t.isoformat(),
                     'expectedEndTime': end.isoformat(), 'realtime': False, 'fromPlace': {'name': 'A'}, 'toPlace': {'name': 'B'},
                     'line': {'id': line[0], 'publicCode': line[1], 'transportMode': mode} if line else None,
                     'fromEstimatedCall': {'destinationDisplay': {'frontText': 'Sentrum'}, 'cancellation': False} if line else None})
        t = end
    walk = sum(m for mode, m, _ in LINES[sig] if mode == 'foot')
    return {'expectedStartTime': start.isoformat(), 'expectedEndTime': t.isoformat(), 'duration': int((t - start).total_seconds()), 'walkTime': walk * 60, 'legs': legs}


def fake_trips(variables):
    target = datetime.datetime.fromisoformat(variables['dateTime'].replace('Z', '+00:00')).astimezone(TZ)
    allowed = variables.get('lines')
    out = []
    for sig, legs in LINES.items():
        ids = [l[2][0] for l in legs if l[2]]
        if allowed and not set(ids) <= set(allowed):
            continue
        base = target.replace(minute=0, second=0, microsecond=0) - datetime.timedelta(hours=2)
        for k in range(24):
            p = _pattern(sig, base + datetime.timedelta(minutes=15 * k + (3 if sig == '20' else 0)))
            end = datetime.datetime.fromisoformat(p['expectedEndTime'])
            st = datetime.datetime.fromisoformat(p['expectedStartTime'])
            if (variables['arriveBy'] and end <= target) or (not variables['arriveBy'] and st >= target):
                out.append(p)
    out.sort(key=lambda p: p['expectedStartTime'])
    n = variables['n']
    out = out[-n:] if variables['arriveBy'] else out[:n]
    return {'data': {'trip': {'tripPatterns': out}}}


GEO = {'hjem': ('Testveien 1, Bergen', 60.33, 5.36), 'jobb': ('Sykehusveien 2, Bergen', 60.37, 5.35)}


def fake_geo(url):
    q = parse_qs(urlparse(url).query)
    text = (q.get('text') or ['hjem'])[0].lower()
    hits = [v for k, v in GEO.items() if k in text] or [GEO['hjem']]
    return {'features': [{'properties': {'label': l, 'name': l.split(',')[0]}, 'geometry': {'coordinates': [lon, lat]}} for l, lat, lon in hits]}


class FakeGitHub:
    """Et privat repo i minnet: filer lagres og leses som med GitHubs API."""

    def __init__(self):
        self.files, self.puts = {}, []

    def handle(self, route):
        req = route.request
        m = re.match(r'https://api\.github\.com/repos/([^/]+)/([^/]+)(/contents/(.+))?$', req.url.split('?')[0])
        if not m:
            return route.fulfill(status=404, body='{}')
        if not m.group(3):
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'private': True}))
        path = m.group(4)
        if req.method == 'PUT':
            body = json.loads(req.post_data)
            self.files[path] = base64.b64decode(body['content']).decode('utf-8')
            self.puts.append(path)
            return route.fulfill(status=200, content_type='application/json', body='{}')
        if path not in self.files:
            return route.fulfill(status=404, body='{}')
        if 'raw' in (req.headers.get('accept') or ''):
            return route.fulfill(status=200, content_type='text/plain', body=self.files[path])
        return route.fulfill(status=200, content_type='application/json', body=json.dumps({'sha': 'x' + str(len(self.files[path]))}))

    def json(self, path):
        return json.loads(self.files[path])


# En testbruker etter oppsett: steder, vaktkoder, to uker med vakter og favoritter.
SEED_JS = """() => commit(null, () => {
  state.profile.name = 'Kari';
  state.settings.dognName = 'Ola';
  state.places = [
    { id: 'h', role: 'home', name: 'Hjem', label: 'Testveien 1, Bergen', lat: 60.33, lon: 5.36, note: '' },
    { id: 'w', role: 'work', name: 'Sykehuset', label: 'Sykehusveien 2, Bergen', lat: 60.37, lon: 5.35, note: 'Post 4' },
    { id: 'k', role: '', name: 'Kurs', label: 'Kursveien 3, Bergen', lat: 60.39, lon: 5.32, note: '' } ];
  state.rota.codes = {
    D: { label: 'Dagvakt', kind: 'work', start: '07:00', end: '15:00' },
    A14: { label: 'Aftenvakt', kind: 'work', start: '14:30', end: '22:00' },
    N: { label: 'Nattevakt', kind: 'night', start: '21:15', end: '07:30' },
    F1: { label: 'Fri', kind: 'off', start: '', end: '' } };
  const plan = ['D', 'D', 'A14', 'N', 'F1', '', 'F1', 'D', 'A14', 'A14', 'D', 'D', 'F1', 'F1'];
  plan.forEach((c, i) => { if (c) state.rota.shifts[addDays('2026-10-05', i)] = c; });
  state.travel.favorites = [ { id: 'f1', lines: [{ code: '16E', id: '', mode: '' }] }, { id: 'f2', lines: [{ code: '1', id: '', mode: '' }, { code: '5', id: '', mode: '' }] } ];
  state.meta.setupDone = true;
})"""

DOGN_FILE = {
    'format': 'dogn-deling', 'v': 1, 'updated': '2026-10-05T05:55:00+02:00', 'kidsWord': 'guttene',
    'kids': [{'id': 'a', 'name': 'Per'}, {'id': 'b', 'name': 'Pål'}],
    'days': {'2026-10-05': {
        'blocks': [{'start': '05:00', 'end': '06:30', 'title': 'Natt', 'type': 'sleep'},
                   {'start': '06:30', 'end': '07:00', 'title': 'Forberedelser', 'type': 'prep'},
                   {'start': '07:00', 'end': '07:15', 'title': 'Henting', 'type': 'meal'},
                   {'start': '08:15', 'end': '08:45', 'title': 'Frokost', 'type': 'meal', 'meal': 'Havregrøt'}],
        'sleep': [],
        'dinner': {'dish': 'Fiskegrateng', 'partnerEats': True},
        'appts': [{'title': 'Helsestasjon', 'start': '13:00', 'where': 'Nesttun'}], 'sick': []},
        '2026-10-04': {'blocks': [], 'sleep': [{'kid': 'a', 'start': '19:10', 'end': '', 'night': True}, {'kid': 'b', 'start': '19:20', 'end': '', 'night': True}], 'appts': [], 'sick': []}},
    'shop': ['Melk'], 'acks': {},
}


class TaktTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = _serve()
        cls.base = 'http://127.0.0.1:%d/index.html' % cls.srv.server_address[1]
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.srv.shutdown()

    def setUp(self):
        self.gh = FakeGitHub()
        self.entur_calls = []
        self.ctx = self.browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                            locale='nb-NO', timezone_id='Europe/Oslo', color_scheme='light')
        self.ctx.route('https://api.entur.io/**', self._entur)
        self.ctx.route('https://api.github.com/**', self.gh.handle)
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.clock.set_fixed_time(NOW)

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [], 'feil i siden')

    def _entur(self, route):
        url = route.request.url
        if 'geocoder' in url:
            return route.fulfill(status=200, content_type='application/json', body=json.dumps(fake_geo(url)))
        v = json.loads(route.request.post_data)['variables']
        self.entur_calls.append(v)
        route.fulfill(status=200, content_type='application/json', body=json.dumps(fake_trips(v)))

    def open(self, seed=True):
        self.page.goto(self.base)
        self.page.wait_for_function(READY)
        if seed:
            self.page.evaluate(SEED_JS)
            self.page.evaluate('() => { closeSheet(); render(); }')
            self.page.wait_for_timeout(300)

    def js(self, expr, arg=None):
        return self.page.evaluate(expr, arg)

    def sheet(self):
        return self.page.locator('#sheet-root .sheet')

    def wait_trips(self):
        self.page.wait_for_selector('#trips-to .trip')

    # ---------- oppsett ----------
    def test_first_run_setup(self):
        self.open(seed=False)
        self.page.wait_for_selector('#sheet-root.open')
        self.page.fill('#su-n', 'Kari')
        self.page.click('.sh-foot [data-save]')
        self.page.click('[data-role="home"]')
        self.page.fill('#pl-q', 'hjem')
        self.page.click('#pl-hits [data-hit="0"]')
        self.page.click('.sh-foot [data-save]')
        self.page.click('[data-role="work"]')
        self.page.fill('#pl-q', 'jobb')
        self.page.click('#pl-hits [data-hit="0"]')
        self.page.click('.sh-foot [data-save]')
        self.page.click('.sh-foot [data-save]')
        self.page.click('[data-later]')
        s = self.js('() => state')
        self.assertTrue(s['meta']['setupDone'])
        self.assertEqual(s['profile']['name'], 'Kari')
        self.assertEqual(sorted(p['role'] for p in s['places']), ['home', 'work'])

    # ---------- vakt ----------
    def test_shift_card_and_week(self):
        self.open()
        card = self.page.locator('.card.shift')
        self.assertIn('Dagvakt', card.inner_text())
        self.assertIn('07:00–15:00 · møt 06:45', card.inner_text())
        self.assertEqual(self.page.locator('.wk-d').count(), 7)
        self.page.click('.wk-d >> nth=2')
        self.assertEqual(self.js('() => view'), '2026-10-07')
        self.assertIn('Aftenvakt', self.page.locator('.card.shift').inner_text())

    def test_change_shift_by_hand_and_back(self):
        self.open()
        self.page.click('.sh-main')
        self.page.click('.codechip[data-code="A14"]')
        self.assertEqual(self.js("() => shiftFor('2026-10-05').code"), 'A14')
        self.assertIn('endret', self.page.locator('.card.shift').inner_text())
        self.page.click('.sh-main')
        self.page.click('[data-reset]')
        self.assertEqual(self.js("() => shiftFor('2026-10-05').code"), 'D')
        self.page.click('.sh-main')
        self.page.fill('#cu-s', '08:00')
        self.page.fill('#cu-e', '12:00')
        self.page.fill('#cu-l', 'Kurs')
        self.page.click('[data-custom]')
        sh = self.js("() => shiftFor('2026-10-05')")
        self.assertEqual((sh['start'], sh['end'], sh['label']), ('08:00', '12:00', 'Kurs'))
        self.page.click('#toast [data-undo]')
        self.assertEqual(self.js("() => shiftFor('2026-10-05').label"), 'Dagvakt')

    def test_rename_code_updates_days(self):
        self.open()
        self.js("() => commit('', () => setDayCode('2026-10-06', 'A14'))")
        self.js("() => commit('', () => saveCode('A15', { label: 'Aften', kind: 'work', start: '14:30', end: '22:00' }, 'A14'))")
        self.assertEqual(self.js("() => codeOn('2026-10-07')"), 'A15')
        self.assertEqual(self.js("() => state.rota.overrides['2026-10-06']"), 'A15')
        self.assertNotIn('A14', self.js('() => state.rota.codes'))

    def test_import_pdf_with_review(self):
        self.open()
        truth = json.load(open(os.path.join(FIXTURES, 'kalenderplan.json')))
        self.js("() => commit(null, () => setDayCode('2026-10-20', 'N'))")      # endret for hånd før import
        self.page.click('#tab-more')
        self.page.click('[data-nav="rota"]')
        with self.page.expect_file_chooser() as fc:
            self.page.click('[data-nav="pdf"]')
        fc.value.set_files(os.path.join(FIXTURES, 'kalenderplan.pdf'))
        self.page.wait_for_selector('.rv-g', timeout=90000)
        # Nye koder må ha tider før publisering
        self.page.click('.sh-foot [data-save]')
        self.assertTrue(self.page.locator('.sheet [data-err]').is_visible())
        for c in self.page.locator('.rv-g.new').evaluate_all('els => els.map(e => e.dataset.g)'):
            if c.startswith('F'):
                self.page.click('[data-dkind="%s"][data-k="off"]' % c)
            else:
                self.page.fill('[data-ds="%s"]' % c, '08:00')
                self.page.fill('[data-de="%s"]' % c, '16:00')
        self.page.fill('#rv-from', '2026-09-28')
        self.page.click('.sh-foot [data-save]')
        self.page.wait_for_function('() => !!state.rota.source')
        shifts = self.js('() => state.rota.shifts')
        for d, c in truth.items():
            if c.startswith('#'):
                self.assertNotIn(d, shifts, d)
            else:
                self.assertEqual(shifts.get(d), c or 'F', d)
        self.assertEqual(self.js("() => codeOn('2026-10-20')"), 'N', 'endringen for hånd er beholdt')

    def test_import_rota_textfile(self):
        self.open()
        r = self.js("""() => { const p = parseRotaText('2026-11-02 d\\n03.11.2026 X9\\nsøppel'); return p; }""")
        self.assertEqual(r['shifts'], {'2026-11-02': 'D', '2026-11-03': 'X9'})
        with self.assertRaises(Exception):
            self.js("() => parseRotaText('ingenting her')")

    # ---------- reise og fravær ----------
    def test_trips_to_work_and_home(self):
        self.open()
        self.wait_trips()
        self.page.wait_for_selector('#trips-home .trip')
        first = self.page.locator('#trips-to .trip').first
        self.assertIn('16E', first.inner_text(), 'favoritten står først')
        self.assertIn('fram', first.inner_text())
        # Siste 16E som er fram senest 06:45 går 06:00 (fram 06:33)
        self.assertIn('06:00', first.locator('.tr-when b').inner_text())
        texts = self.page.locator('#trips-to .trip').all_inner_texts()
        self.assertTrue(any(' 5' in t.replace('\n', ' ') for t in texts), 'favoritten 1 + 5 vises')
        home = self.page.locator('#trips-home .trip').first.inner_text()
        self.assertIn('15:15', home, 'hjem tidligst 15 min etter vakten')
        # Linje-ID-ene er lært, og den raskeste reisen er husket
        self.assertTrue(all(l['id'] for f in self.js('() => state.travel.favorites') for l in f['lines']))
        self.assertEqual(self.js('() => state.travel.fastest.to'), 33)

    def test_pick_trip_sets_away_period(self):
        self.open()
        self.wait_trips()
        away = self.page.locator('.away').inner_text()
        self.assertIn('Borte 06:12–15:48', away)
        self.assertIn('raskeste', away)
        self.page.click('#trips-to [data-pick="to:0"]')
        self.page.wait_for_selector('#trips-home .trip')
        self.page.click('#trips-home [data-pick="home:0"]')
        a = self.js("() => { const a = awayFor('2026-10-05'); return [hm(a.leave), hm(a.back), a.chosen]; }")
        self.assertEqual(a[0], '06:00')
        self.assertEqual(a[2], {'to': True, 'home': True})
        self.assertIn('valgt reise', self.page.locator('.away').inner_text())
        self.assertEqual(self.page.locator('.trip.picked').count(), 2)

    def test_set_travel_time_and_night_shift(self):
        self.open()
        self.js("() => commit(null, () => { state.travel.oneWay = 40; })")
        a = self.js("() => { const a = awayFor('2026-10-08'); return [hm(a.leave), hm(a.back), iso(a.back), a.basis]; }")
        self.assertEqual(a, ['20:20', '08:25', '2026-10-09', 'set'])
        self.js("() => goTo('2026-10-08')")
        self.assertIn('(neste dag)', self.page.locator('.away').inner_text())

    def test_other_destination_for_a_day(self):
        self.open()
        self.wait_trips()
        self.page.click('[data-act="dayplaces"] >> nth=0')
        self.page.select_option('#dp-to', 'k')
        self.page.click('.sh-foot [data-save]')
        self.wait_trips()
        self.assertIn('til kurs', self.page.locator('.card.travel').inner_text().lower())
        to_work = [c for c in self.entur_calls if c['arriveBy']][-1]
        self.assertAlmostEqual(to_work['to']['coordinates']['latitude'], 60.39)
        home = [c for c in self.entur_calls if not c['arriveBy']][-1]
        self.assertAlmostEqual(home['from']['coordinates']['latitude'], 60.39)

    # ---------- notater og gjøremål ----------
    def test_items_add_toggle_and_edit(self):
        self.open()
        self.page.click('#tab-add')
        self.page.fill('#it-t', 'Hente pakke')
        self.page.click('.sh-foot [data-save]')
        self.assertIn('Hente pakke', self.page.locator('.card.items').inner_text())
        self.page.click('.card.items [data-toggle]')
        self.assertTrue(self.js('() => state.items[0].done'))
        self.page.click('.card.items [data-item]')
        self.page.click('[data-kind="appt"]')
        self.page.fill('#it-h', '12:30')
        self.page.click('.sh-foot [data-save]')
        self.assertEqual(self.js('() => [state.items[0].kind, state.items[0].time]'), ['appt', '12:30'])

    # ---------- backup og deling ----------
    def connect(self):
        self.page.click('#tab-more')
        self.page.click('[data-nav="sync"]')
        self.page.fill('#sy-o', 'test')
        self.page.fill('#sy-r', 'data')
        self.page.fill('#sy-t', 'github_pat_x')
        self.page.click('.sh-foot [data-save]')
        self.page.wait_for_function("() => sync.cfg && sync.cfg.lastShare && sync.cfg.lastPull")

    def test_share_file_for_dogn(self):
        self.gh.files['dogn-deling.json'] = json.dumps(DOGN_FILE)
        self.open()
        self.wait_trips()
        self.connect()
        share = self.gh.json('takt-deling.json')
        self.assertEqual(share['format'], 'takt-deling')
        self.assertEqual(share['rota']['shifts']['2026-10-05'], 'D')
        self.assertEqual(share['away']['2026-10-05']['leave'], '06:12')
        self.assertEqual(share['away']['2026-10-08']['backDay'], 1)
        self.assertNotIn('token', json.dumps(share))
        # Et delt punkt sendes etter en kort pause
        self.page.clock.set_fixed_time(NOW)
        self.js("() => commit('', () => saveItem({ kind: 'shop', title: 'Bleier', date: '', shared: true }))")
        self.js('() => pushShare()')
        self.page.wait_for_function("() => !sync.cfg.shareDirty")
        items = self.gh.json('takt-deling.json')['items']
        self.assertEqual([x['title'] for x in items], ['Bleier'])

    def test_home_from_dogn(self):
        self.gh.files['dogn-deling.json'] = json.dumps(DOGN_FILE)
        self.open()
        self.connect()
        self.js('() => { closeSheet(); render(); }')
        home = self.page.locator('.card.home').inner_text()
        self.assertIn('Guttene sover · siden 19:10', home)
        self.assertIn('Frokost', home)
        self.assertIn('Fiskegrateng', home)
        self.assertIn('du spiser med', home)
        self.assertIn('Helsestasjon', home)
        # Et delt gjøremål som er krysset av i Døgn, vises som gjort
        self.js("() => commit('', () => saveItem({ id: 'x1', kind: 'todo', title: 'Ringe', date: '2026-10-05', shared: true }))")
        self.js("() => { dogn.data.acks = { x1: { done: true } }; render(); }")
        self.assertIn('gjort i Døgn', self.page.locator('.card.items').inner_text())

    def test_backup_restore_from_github(self):
        self.open()
        self.js("() => commit('', () => saveItem({ kind: 'note', title: 'Husk', date: '2026-10-05' }))")
        self.gh.files['takt-backup.json'] = json.dumps(self.js('() => state'))
        self.js("() => { localStorage.clear(); indexedDB.deleteDatabase('takt'); }")
        ctx2 = self.page
        ctx2.goto(self.base)
        ctx2.wait_for_function(READY)
        self.page.wait_for_selector('#sheet-root.open')
        self.page.click('[data-gh]')
        self.page.fill('#sy-o', 'test')
        self.page.fill('#sy-r', 'data')
        self.page.fill('#sy-t', 'github_pat_x')
        self.page.click('.sh-foot [data-save]')
        self.page.wait_for_function("() => state.items.length === 1")
        self.assertEqual(self.js('() => state.profile.name'), 'Kari')

    def test_export_import_roundtrip_and_sanitize(self):
        self.open()
        bad = self.js('''() => { const s = clone(state); s.items = [{ id: 'z', kind: 'todo', title: '<img src=x onerror=alert(1)>', date: '2026-10-05' }, { title: '' }];
          s.rota.codes['<b>'] = { kind: 'work' }; s.places.push({ id: 'q', lat: 'nord' }); return JSON.stringify(s); }''')
        clean = self.js('(t) => migrate(JSON.parse(t))', bad)
        self.assertEqual(len(clean['items']), 1)
        self.assertNotIn('<b>', clean['rota']['codes'])
        self.assertEqual(len(clean['places']), 3)
        self.js('(t) => { commit(null, () => { state = migrate(JSON.parse(t)); }); }', bad)
        self.assertEqual(self.page.locator('.card.items img').count(), 0)
        self.assertIn('<img', self.page.locator('.card.items').inner_text())

    # ---------- navigasjon, sveip og visning ----------
    def test_calendar_month_and_jump(self):
        self.open()
        self.page.click('#tab-month')
        self.assertIn('Oktober 2026', self.sheet().inner_text())
        self.assertEqual(self.page.locator('.cal-d[data-day="2026-10-08"] .c').inner_text(), 'N')
        self.page.click('.cal-nav [data-month="2026-11-01"]')
        self.assertIn('November 2026', self.sheet().inner_text())
        self.page.click('.cal-d[data-day="2026-11-02"]')
        self.assertEqual(self.js('() => view'), '2026-11-02')

    def test_swipe_between_days(self):
        self.open()
        box = self.page.locator('#page').bounding_box()
        y = box['y'] + 200
        self.page.evaluate('''([y]) => {
          const el = document.querySelector('#page .card.items');
          const t = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
          el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(300)], changedTouches: [t(300)], bubbles: true }));
          for (const x of [280, 240, 180, 120]) el.dispatchEvent(new TouchEvent('touchmove', { touches: [t(x)], changedTouches: [t(x)], bubbles: true }));
          el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(120)], bubbles: true }));
        }''', [y])
        self.page.wait_for_function("() => view === '2026-10-06'")

    def test_android_back_closes_sheet(self):
        self.open()
        self.page.click('#tab-more')
        self.page.wait_for_selector('#sheet-root.open')
        self.page.go_back()
        self.page.wait_for_function("() => !document.querySelector('#sheet-root').classList.contains('open')")
        self.assertTrue(self.page.url.endswith('index.html'))
        self.page.click('#tab-more')
        self.page.click('[data-close]')
        self.page.wait_for_timeout(100)
        self.assertEqual(self.js('() => history.state'), None)

    def test_theme_and_text_size(self):
        self.open()
        self.assertEqual(self.js('() => document.documentElement.dataset.theme'), 'light')
        self.page.emulate_media(color_scheme='dark')
        self.page.wait_for_function("() => document.documentElement.dataset.theme === 'dark'")
        self.page.click('#tab-more')
        self.page.click('[data-nav="profile"]')
        self.page.click('[data-theme="light"]')
        self.assertEqual(self.js('() => document.documentElement.dataset.theme'), 'light')
        self.page.click('[data-size="1.2"]')
        self.assertEqual(self.js('() => document.documentElement.style.fontSize'), '120%')

    def test_sheets_fit_the_screen(self):
        self.open()
        for opener in ['#tab-more', '#tab-month', '#tab-add']:
            self.page.click(opener)
            self.page.wait_for_selector('#sheet-root.open')
            w = self.js('() => [document.documentElement.scrollWidth, window.innerWidth]')
            self.assertLessEqual(w[0], w[1], opener)
            self.js('() => closeSheet()')
            self.page.wait_for_timeout(300)

    # ---------- tekstgjenkjenning (rene funksjoner) ----------
    def test_code_snapping(self):
        self.open()
        vocab = '["D","D17","M2","M2O","A14","A8","F1","F2","F3","MV"]'
        cases = [(['A4', 'A14'], 'A14'), (['AS', 'AS'], 'A8'), (['M20'], 'M2O'), (['FT', 'F1'], 'F1'), (['MY', 'MV'], 'MV'), (['D17', 'D7', 'DT'], 'D17')]
        for reads, want in cases:
            got = self.js('([r, v]) => snapCode(r.map(t => ({ text: t, w: 1 })), v).code', [reads, json.loads(vocab)])
            self.assertEqual(got, want, reads)
        self.assertFalse(self.js("() => snapCode([{ text: 'XQ', w: 1 }], ['D']).sure"))

    # ---------- ryddig kode ----------
    def test_offline_file_list_is_complete(self):
        self.open(seed=False)
        files = self.js('() => APP_FILES')
        for f in files:
            if f != './':
                self.assertTrue(os.path.exists(os.path.join(ROOT, f)), f)
        own = set()
        for d, _, names in os.walk(ROOT):
            rel = os.path.relpath(d, ROOT)
            if rel.split(os.sep)[0] in ('.git', 'tests', 'vendor', 'docs', '.github'):
                continue
            for n in names:
                if n.endswith(('.js', '.mjs', '.css', '.png', '.webmanifest', '.html')) and n != 'sw.js':
                    own.add('./' + os.path.normpath(os.path.join(rel, n)).replace(os.sep, '/'))
        self.assertEqual(sorted(own - set(files)), [])
        for f in self.js('() => VENDOR_FILES'):
            self.assertTrue(os.path.exists(os.path.join(ROOT, f)), f)
        scripts = re.findall(r'<script src="([^"]+)"', _read('index.html'))
        for s in scripts:
            self.assertIn('./' + s, files)

    def test_no_dead_code(self):
        """Alle funksjoner, tekster, fargevariabler og CSS-klasser er i bruk."""
        self.open(seed=False)
        code = {p: _read(*p.split('/')) for p in [f[2:] for f in self.js('() => APP_FILES') if f.endswith(('.js', '.mjs'))]}
        allcode = '\n'.join(code.values()) + _read('index.html') + _read('sw.js')
        # Toppnivå-navn som bare nevnes der de lages
        names = set()
        for src in code.values():
            names |= set(re.findall(r'^(?:async )?function (\w+)', src, re.M))
            names |= set(re.findall(r'^(?:const|let|class) (\w+)', src, re.M))
        unused = sorted(n for n in names if len(re.findall(r'\b' + re.escape(n) + r'\b', allcode)) < 2)
        self.assertEqual(unused, [], 'ubrukte navn')
        # Tekster
        texts = self.js('''() => { const out = []; const walk = (o, p) => { for (const [k, v] of Object.entries(o)) {
            if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p + '.' + k); else out.push(p + '.' + k); } }; walk(T, 'T'); return out; }''')
        dynamic = ['T.rota.step.', 'T.rota.kind.', 'T.items.kind.', 'T.items.titleLabel.', 'T.places.role.', 'T.places.addRole.',
                   'T.places.walkSpeed.', 'T.profile.themes.', 'T.travel.mode.', 'T.sync.errors.']
        unused_t = [t for t in texts if not any(t.startswith(d) for d in dynamic) and not re.search(re.escape(t) + r'\b', allcode)]
        self.assertEqual(unused_t, [], 'ubrukte tekster')
        # Fargevariabler og andre verdier i tokens.css
        tokens, css = _read('styles', 'tokens.css'), _read('styles', 'app.css')
        defined = set(re.findall(r'(--[\w-]+)\s*:', tokens))
        used = set(re.findall(r'var\((--[\w-]+)', css + tokens + allcode))
        self.assertEqual(sorted(defined - used - {'--bar'}), [], 'ubrukte tokens')
        self.assertEqual(sorted(used - defined - {'--tone'}), [], 'udefinerte tokens')
        self.assertEqual(re.findall(r'#[0-9a-fA-F]{3,8}\b(?![^{]*\{)', re.sub(r'/\*.*?\*/', '', css, flags=re.S)), [], 'farger i app.css')
        # CSS-klasser som ikke brukes noe sted
        classes = set(re.findall(r'\.([a-zA-Z][\w-]*)', re.sub(r'/\*.*?\*/', '', css, flags=re.S)))
        # Klasser som settes sammen i koden, som tone-${…}, regnes som brukt når forstavelsen finnes
        dyn = lambda c: '-' in c and (c.rsplit('-', 1)[0] + '-${') in allcode
        unused_c = sorted(c for c in classes if not re.search(r'\b' + re.escape(c) + r'\b', allcode) and not dyn(c))
        self.assertEqual(unused_c, [], 'ubrukte CSS-klasser')


if __name__ == '__main__':
    unittest.main()
