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


class FakeGoogle:
    """Innlogging hos Google og en skjult app-mappe i Drive, i minnet."""

    def __init__(self):
        self.files, self.uploads, self.logins = {}, 0, 0

    def auth(self, route):
        q = parse_qs(urlparse(route.request.url).query)
        self.logins += 1
        from urllib.parse import quote
        self.scopes = q['scope'][0]
        frag = 'access_token=tok%d&token_type=Bearer&expires_in=3599&state=%s&scope=%s' % (self.logins, q['state'][0], quote(q['scope'][0]))
        route.fulfill(status=302, headers={'Location': q['redirect_uri'][0] + '#' + frag})

    def api(self, route):
        req = route.request
        u = urlparse(req.url)
        if not (req.headers.get('authorization') or '').startswith('Bearer tok'):
            return route.fulfill(status=401, body='{}')
        if '/calendar/v3/' in u.path:
            return self.calendar(route, req, u)
        m = re.search(r'/files/([^/?]+)', u.path)
        if req.method == 'GET' and not m:
            files = [{'id': k, 'modifiedTime': v['modified']} for k, v in self.files.items()]
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'files': files}))
        if req.method == 'GET':
            return route.fulfill(status=200, content_type='application/json', body=self.files[m.group(1)]['content'])
        self.uploads += 1
        if req.method == 'PATCH':
            self.files[m.group(1)] = {'content': req.post_data, 'modified': '2026-10-05T06:0%d:00Z' % min(9, self.uploads)}
            return route.fulfill(status=200, content_type='application/json', body='{}')
        body = req.post_data
        parts = [p for p in body.split('\r\n\r\n')[1:]]
        meta = json.loads(parts[0].split('\r\n')[0])
        content = parts[1].rsplit('\r\n--', 1)[0]
        assert meta['parents'] == ['appDataFolder']
        fid = 'f%d' % (len(self.files) + 1)
        self.files[fid] = {'content': content, 'modified': '2026-10-05T06:00:00Z'}
        return route.fulfill(status=200, content_type='application/json', body=json.dumps({'id': fid}))

    def only(self):
        return json.loads(next(iter(self.files.values()))['content'])

    # Google-kalenderen: kalendere appen har laget, og hendelsene i dem
    calendars = None

    limit_posts = 0      # så mange innsettinger svarer 403 rateLimitExceeded (Googles fartsgrense)
    fail_id = ''         # denne hendelsen avvises (400)

    def calendar(self, route, req, u):
        if self.calendars is None:
            self.calendars, self.cal_calls = {}, []
        parts = u.path.split('/calendar/v3/calendars')[1].strip('/').split('/')
        self.cal_calls.append((req.method, u.path))
        ok = lambda body=None: route.fulfill(status=200, content_type='application/json', body=json.dumps(body or {}))
        if parts == [''] and req.method == 'POST':
            cid = 'cal%d' % (len(self.calendars) + 1)
            self.calendars[cid] = {'summary': json.loads(req.post_data)['summary'], 'events': {}}
            return ok({'id': cid})
        from urllib.parse import unquote
        cid = unquote(parts[0])
        if cid not in self.calendars:
            return route.fulfill(status=404, body='{}')
        events = self.calendars[cid]['events']
        if len(parts) == 1 and req.method == 'DELETE':
            del self.calendars[cid]
            return ok()
        if len(parts) == 2 and req.method == 'GET':
            return ok({'items': list(events.values())})
        if len(parts) == 2 and req.method == 'POST':
            ev = json.loads(req.post_data)
            if self.limit_posts > 0:
                self.limit_posts -= 1
                return route.fulfill(status=403, content_type='application/json', body=json.dumps({'error': {'errors': [{'reason': 'rateLimitExceeded'}]}}))
            if ev['id'] == self.fail_id:
                return route.fulfill(status=400, content_type='application/json', body='{}')
            events[ev['id']] = ev
            return ok(ev)
        eid = parts[2]
        if req.method == 'PUT':
            if eid not in events:
                return route.fulfill(status=404, body='{}')
            events[eid] = json.loads(req.post_data)
            return ok(events[eid])
        if req.method == 'DELETE':
            if eid not in events:
                return route.fulfill(status=410, body='{}')
            del events[eid]
            return route.fulfill(status=204, body='')
        return route.fulfill(status=400, body='{}')

    def events(self):
        return next(iter(self.calendars.values()))['events']


# En testbruker etter oppsett: steder, vaktkoder, to uker med vakter og favoritter.
SEED_JS = """() => commit(null, () => {
  state.profile.name = 'Kari';
  state.settings.dognName = 'Ola';
  state.places = [
    { id: 'h', role: 'home', name: 'Hjem', label: 'Testveien 1, Bergen', lat: 60.33, lon: 5.36, note: '' },
    { id: 'w', role: 'work', name: 'Sykehuset', label: 'Sykehusveien 2, Bergen', lat: 60.37, lon: 5.35, note: 'Avdeling 2' },
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
    'format': 'dogn-deling', 'v': 1, 'updated': '2026-10-05T05:55:00+02:00', 'kidsWord': 'barna',
    'kids': [{'id': 'a', 'name': 'Per'}, {'id': 'b', 'name': 'Pål'}],
    'usual': {'a': {'night': 660, 'wakes': 1, 'nap': 100}, 'b': {'night': 650, 'wakes': 1, 'nap': 90}},
    'days': {'2026-10-05': {
        'blocks': [{'start': '05:00', 'end': '06:30', 'title': 'Natt', 'type': 'sleep'},
                   {'start': '06:30', 'end': '07:00', 'title': 'Forberedelser', 'type': 'prep'},
                   {'start': '07:00', 'end': '07:15', 'title': 'Henting', 'type': 'meal'},
                   {'start': '08:15', 'end': '08:45', 'title': 'Frokost', 'type': 'meal', 'meal': 'Havregrøt'}],
        'sleep': [],
        'nights': {'a': {'asleep': '19:10', 'wake': '05:40', 'net': 630, 'wakes': 1, 'up': 0}, 'b': {'asleep': '19:20', 'wake': '', 'net': 0, 'wakes': 3, 'up': 25}},
        'health': [{'kid': 'b', 'time': '05:30', 'kind': 'temp', 'value': '38,4'}, {'kid': 'b', 'time': '05:35', 'kind': 'med', 'value': 'paracet'}],
        'note': {'text': 'Pål sov urolig', 'important': False},
        'flags': [{'kind': 'fever', 'level': 'high', 'kid': 'b', 'temp': 38.4, 'time': '05:30'}, {'kind': 'med', 'level': 'note', 'kid': 'b', 'time': '05:35', 'what': 'paracet'},
                  {'kind': 'ukjent', 'level': 'high', 'kid': 'a'}],
        'lastLog': '05:40',
        'dinner': {'dish': 'Fiskegrateng', 'partnerEats': True},
        'appts': [{'title': 'Helsestasjon', 'start': '13:00', 'where': 'Bydelshuset'}], 'sick': ['Pål']},
        '2026-10-04': {'blocks': [{'start': '12:00', 'end': '13:30', 'title': 'Lur', 'type': 'sleep'}],
                       'sleep': [{'kid': 'a', 'start': '12:05', 'end': '12:25', 'night': False}, {'kid': 'b', 'start': '12:05', 'end': '13:35', 'night': False},
                                 {'kid': 'a', 'start': '19:10', 'end': '05:40', 'night': True}, {'kid': 'b', 'start': '19:20', 'end': '', 'night': True}],
                       'meals': [{'title': 'Lunsj', 'start': '11:00', 'rates': {'a': 'lite', 'b': 'godt'}}, {'title': 'Middag', 'start': '16:30', 'rates': {'a': 'lite', 'b': 'rart'}}],
                       'did': [{'start': '12:00', 'name': 'Trilletur'}],
                       'flags': [{'kind': 'nap', 'level': 'note', 'kid': 'a', 'total': 20, 'usual': 100}, {'kind': 'food', 'level': 'bad', 'kid': 'a', 'count': 2}],
                       'appts': [], 'sick': []}},
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
        self.google = FakeGoogle()
        self.route_google(self.ctx)
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.clock.set_fixed_time(NOW)

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [], 'feil i siden')

    def route_google(self, ctx):
        ctx.route('**/js/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body="const GOOGLE_CLIENT_ID = 'test-client';"))
        ctx.route('https://accounts.google.com/**', self.google.auth)
        ctx.route('https://www.googleapis.com/**', self.google.api)

    def new_phone(self):
        """En ny telefon: tom app, men samme Google-konto."""
        ctx = self.browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, locale='nb-NO', timezone_id='Europe/Oslo')
        ctx.route('https://api.entur.io/**', self._entur)
        self.route_google(ctx)
        self.addCleanup(ctx.close)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: self.errors.append(str(e)))
        pg.clock.set_fixed_time(NOW)
        pg.goto(self.base)
        pg.wait_for_function(READY)
        pg.wait_for_selector('#sheet-root.open')
        return pg

    def drive_connect(self, pg, code, again=None):
        pg.fill('#dr-c', code)
        pg.fill('#dr-c2', again or code)
        if len(code) < 6:
            pg.click('.sh-foot [data-save]')
            return
        with pg.expect_navigation(url=re.compile(r'/$')):
            pg.click('.sh-foot [data-save]')
        pg.wait_for_function(READY)

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
        self.page.click('[data-later]')          # turnus senere
        self.page.click('[data-later]')          # backup senere
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
        self.js("() => localStorage.setItem('takt-github', '1')")
        self.page.click('#tab-more')
        self.page.click('[data-nav="backup"]')
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
        card = self.page.locator('.card.home')
        # Linjene øverst: viktig (feber, med medisinen) før merk (beskjeden). Ukjente merknader forkastes.
        self.assertEqual(card.locator('.flag').all_inner_texts(), ['Pål har feber: 38,4 kl. 05:30 · paracet 05:35', 'Beskjed: Pål sov urolig'])
        self.assertEqual(card.locator('.flag.high').count(), 1)
        # Faste rader, én kolonne per barn
        rows = {r.locator('.kg-k').inner_text(): [c.inner_text() for c in r.locator('.kg-c').all()] for r in card.locator('.kg-row:not(.head)').all()}
        self.assertEqual(rows['Nå'], ['Våken fra 05:40', 'Sover fra 19:20'])
        self.assertEqual(rows['Natt'], ['10 t 30', 'sovnet 19:20'])
        self.assertEqual(rows['Lurer'], ['–', '–'])
        home = card.inner_text()
        self.assertIn('06:30Forberedelser', home.replace(' ', '').replace('\n', ''))
        self.assertIn('Fiskegrateng', home)
        self.assertIn('du spiser med', home)
        self.assertIn('Helsestasjon', home)
        self.assertIn('logget 05:40', home)
        # Hele dagen: rubrikker, helse og handleliste. I går: kort lur og dårlig matlyst.
        card.click()
        sheet = self.sheet()
        self.assertIn('Pål · temperatur 38,4', sheet.inner_text())
        self.assertIn('Handleliste · 1', sheet.inner_text())
        self.page.click('[data-hday="2026-10-04"]')
        text = self.sheet().inner_text()
        self.assertIn('Lite lur for Per: 20 min (vanlig 1 t 40)', text)
        self.assertIn('Per har spist lite til 2 måltider', text)
        self.assertIn('12:00Lur · Trilletur', text.replace('\n', '').replace('\t', ''))
        self.assertEqual(self.page.locator('.sheet .lv-note').count() >= 3, True, 'kort lur og to måltider med lite er merket')
        self.assertNotIn('Handleliste', text)
        self.js('() => closeSheet()')
        # Et delt gjøremål som er krysset av i Døgn, vises som gjort
        self.js("() => commit('', () => saveItem({ id: 'x1', kind: 'todo', title: 'Ringe', date: '2026-10-05', shared: true }))")
        self.js("() => { dogn.data.acks = { x1: { done: true } }; render(); }")
        self.assertIn('gjort i Døgn', self.page.locator('.card.items').inner_text())

    def test_backup_restore_from_github(self):
        self.open()
        self.js("() => commit('', () => saveItem({ kind: 'note', title: 'Husk', date: '2026-10-05' }))")
        self.gh.files['takt-backup.json'] = json.dumps(self.js('() => state'))
        self.js("() => { localStorage.clear(); indexedDB.deleteDatabase('takt'); }")
        # GitHub vises bare på telefoner som er åpnet med ?github
        self.page.goto(self.base + '?github')
        self.page.wait_for_function(READY)
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


    # ---------- backup til Google Drive ----------
    def test_drive_backup_and_restore_on_new_phone(self):
        self.open()
        self.page.click('#tab-more')
        self.page.click('[data-nav="backup"]')
        self.page.click('[data-nav="drive"]')
        self.drive_connect(self.page, 'kort', 'kort')
        self.assertIn('minst 6 tegn', self.sheet().inner_text())
        self.drive_connect(self.page, 'hemmelig1')
        self.page.wait_for_function('() => !!drive.cfg.lastBackup')
        saved = self.google.only()
        self.assertEqual(saved['format'], 'takt-kryptert')
        self.assertNotIn('Dagvakt', json.dumps(saved), 'backupen er kryptert')
        self.assertFalse(self.page.evaluate('() => location.hash'), 'tilgangsnøkkelen er fjernet fra adressen')
        # Endringer lagres automatisk når appen legges bort
        before = self.google.uploads
        self.js("() => commit('', () => saveItem({ kind: 'note', title: 'Ny', date: '2026-10-05' }))")
        self.js("() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }")
        self.page.wait_for_function('() => !drive.cfg.dirty')
        self.assertEqual(self.google.uploads, before + 1)

        # Ny telefon, feil kode først: ingenting lagres over backupen
        pg = self.new_phone()
        pg.click('[data-drive]')
        self.drive_connect(pg, 'feilkode1')
        pg.wait_for_selector('#sheet-root.open [data-retry]')
        self.assertIn('Koden passer ikke', pg.inner_text('#sheet-root .sheet'))
        self.assertEqual(self.google.uploads, before + 1)
        pg.fill('#dr-c', 'hemmelig1')
        pg.click('[data-retry]')
        pg.wait_for_function('() => state.items.some(x => x.title === "Ny")')
        self.assertEqual(pg.evaluate('() => state.rota.codes.D.label'), 'Dagvakt')
        self.assertEqual(self.google.uploads, before + 1, 'gjenoppretting laster ikke opp noe')

    def test_drive_asks_before_replacing_data(self):
        self.open()
        self.js("() => { drive.cfg = { on: true, code: 'hemmelig1', salt: 'AAAAAAAAAAAAAAAAAAAAAA==', fileId: '', lastBackup: '', lastError: '', dirty: true, pending: false }; google.cfg = { token: 'tok9', exp: Date.now() + 3e6, scopes: [GOOGLE.SCOPES.drive], lastError: '' }; }")
        self.js('() => driveBackup()')
        self.page.wait_for_function('() => !!drive.cfg.lastBackup')
        self.js("() => commit('', () => { state.profile.name = 'Endret'; })")
        self.js('() => driveRestoreAsk()')
        self.page.wait_for_selector('[data-fetch]')
        self.page.click('[data-fetch]')
        self.page.wait_for_function("() => state.profile.name === 'Kari'")

    def test_drive_login_reminder(self):
        self.open()
        self.js("() => { drive.cfg = { on: true, code: 'hemmelig1', salt: 'AAAAAAAAAAAAAAAAAAAAAA==', fileId: '', lastBackup: '2026-09-20T10:00:00Z', lastError: '', dirty: true, pending: false }; saveDrive(); render(); }")
        self.assertIn('venter', self.page.inner_text('.card.notice'))
        with self.page.expect_navigation(url=re.compile(r'/$')):
            self.page.click('.card.notice [data-act="drive-login"]')
        self.page.wait_for_function(READY)
        self.page.wait_for_function('() => !drive.cfg.dirty')
        self.assertEqual(self.page.locator('.card.notice').count(), 0)

    def test_file_backup_with_share_sheet_and_reminder(self):
        self.page.add_init_script("navigator.canShare = () => true; navigator.share = async d => { window.__shared = d.files[0].name; };")
        self.open()
        self.js("() => commit(null, () => { state.meta.created = '2026-09-01'; })")
        self.assertIn('ikke tatt backup', self.page.inner_text('.card.notice'))
        self.page.click('.card.notice [data-act="backup"]')
        self.page.click('[data-nav="export"]')
        self.page.wait_for_function('() => !!window.__shared')
        self.assertEqual(self.js('() => window.__shared'), 'takt-backup-2026-10-05.json')
        self.assertEqual(self.js('() => state.meta.lastExport'), '2026-10-05')
        self.js('() => { closeSheet(); render(); }')
        self.assertEqual(self.page.locator('.card.notice').count(), 0)


    # ---------- vaktene i kalenderen ----------
    def test_calendar_sync_after_explained_warning(self):
        self.open()
        self.page.click('#tab-more')
        self.page.click('[data-nav="calendar"]')
        self.page.click('[data-google]')
        text = self.sheet().inner_text()
        self.assertIn('ikke bekreftet denne appen', text)
        self.assertIn('Avansert', text)
        self.assertIn('Kalenderfil', text)
        with self.page.expect_navigation(url=re.compile(r'/$')):
            self.page.click('#sheet-root [data-google-go]')
        self.page.wait_for_function(READY)
        self.page.wait_for_function('() => !!cal.cfg.lastSync')
        self.assertIn('calendar.app.created', self.google.scopes)
        ev = self.google.events()
        self.assertEqual(len(ev), 9, 'bare vakter, ikke fridager')
        self.assertEqual(ev['tks20261005']['summary'], 'D · Dagvakt')
        night = ev['tks20261008']
        self.assertEqual((night['start']['dateTime'], night['end']['dateTime']), ('2026-10-08T21:15:00', '2026-10-09T07:30:00'))
        self.assertEqual(night['start']['timeZone'], 'Europe/Oslo')
        # Avtaler: med i kalenderen som standard, men kan holdes utenfor
        calls = len(self.google.cal_calls)
        self.assertIn('Oppdatert', self.sheet().inner_text(), 'status vises etter innlogging')
        self.js('() => closeSheet()')
        self.page.wait_for_timeout(300)
        self.page.click('#tab-add')
        self.page.click('[data-kind="appt"]')
        self.assertEqual(self.page.get_attribute('[data-cal]', 'aria-checked'), 'true')
        self.page.fill('#it-t', 'Tannlege')
        self.page.fill('#it-h', '12:00')
        self.page.click('.sh-foot [data-save]')
        self.js("() => commit('', () => saveItem({ kind: 'appt', title: 'Privat', date: '2026-10-06', time: '09:00', cal: false }))")
        # Vakten byttes for hånd: gammel vakt fjernes, bare endringene sendes
        self.js("() => commit('', () => setDayCode('2026-10-05', ''))")
        self.js('() => calSync()')
        self.page.wait_for_function("() => !cal.cfg.dirty && !cal.busy")
        ev = self.google.events()
        titles = [e['summary'] for e in ev.values()]
        self.assertIn('Tannlege', titles)
        self.assertNotIn('Privat', titles)
        self.assertNotIn('tks20261005', ev)
        self.assertEqual(len(self.google.cal_calls) - calls, 2, 'én ny avtale og én slettet vakt')


    def connect_calendar(self):
        """Kalenderen slått på med gyldig innlogging, uten å gå via Google-siden"""
        self.js("() => { google.cfg = { token: 'tok9', exp: Date.now() + 3e6, scopes: [GOOGLE.SCOPES.cal], lastError: '' }; RETRY_MS.fill(20); calConnect(); }")
        self.page.wait_for_function('() => !cal.busy && !!(cal.cfg.lastSync || cal.cfg.lastError)')

    def test_calendar_waits_and_retries_when_google_limits_speed(self):
        self.open()
        self.google.calendars, self.google.cal_calls = {}, []
        self.google.limit_posts = 5
        self.connect_calendar()
        self.assertEqual(self.js('() => cal.cfg.lastError'), '')
        self.assertEqual(len(self.google.events()), 9)
        self.assertEqual(self.js('() => cal.cfg.result'), {'shifts': 9, 'appts': 0, 'changed': 9, 'checked': False})
        # Takt husker hva som er sendt: en ny oppdatering uten endringer sender ingenting
        self.assertEqual(self.js('() => Object.keys(cal.cfg.synced).length'), 9)
        calls = len(self.google.cal_calls)
        self.js("() => { cal.cfg.dirty = true; return calSync(); }")
        self.assertEqual(len(self.google.cal_calls), calls)

    def test_calendar_error_is_explained_and_check_repairs(self):
        self.open()
        self.google.calendars, self.google.cal_calls = {}, []
        self.google.fail_id = 'tks20261008'
        self.connect_calendar()
        err = self.js('() => cal.cfg.lastError')
        self.assertIn('8 av 9 ble oppdatert', err)
        self.assertTrue(self.js('() => cal.cfg.dirty'))
        self.page.click('#tab-more')
        self.page.click('[data-nav="calendar"]')
        text = self.sheet().inner_text()
        self.assertIn('ikke ferdig oppdatert', text)
        self.assertEqual(self.page.inner_text('#cal-progress'), '', 'ingen gammel framdrift står igjen')
        # Feilen er borte hos Google. En hendelse slettes og en endres i kalenderen; kontrollen retter alt.
        self.google.fail_id = ''
        ev = self.google.events()
        del ev['tks20261005']
        ev['tks20261006']['summary'] = 'Endret i kalenderen'
        self.page.click('[data-now]')
        self.page.wait_for_function('() => !cal.busy && !cal.cfg.lastError && cal.cfg.result.checked')
        ev = self.google.events()
        self.assertEqual(len(ev), 9)
        self.assertEqual(ev['tks20261006']['summary'], 'D · Dagvakt')
        self.assertEqual(self.js('() => cal.cfg.result.changed'), 3)
        self.assertIn('Kontrollert: 9 vakter ligger i kalenderen og stemmer med Takt.', self.sheet().inner_text())

    def test_calendar_file(self):
        self.page.add_init_script("navigator.canShare = () => true; navigator.share = async d => { window.__ics = await d.files[0].text(); };")
        self.open()
        self.js("() => commit('', () => saveItem({ kind: 'appt', title: 'Kurs, del 1', date: '2026-10-07', time: '', note: 'Ta med; bok' }))")
        self.js('() => shareCalendarFile()')
        self.page.wait_for_function('() => !!window.__ics')
        ics = self.js('() => window.__ics')
        self.assertEqual(ics.count('BEGIN:VEVENT'), 10)
        self.assertIn('DTSTART:20261008T191500Z', ics)
        self.assertIn('DTSTART;VALUE=DATE:20261007', ics)
        self.assertIn('SUMMARY:Kurs\\, del 1', ics)
        self.assertTrue(all(len(line) <= 75 for line in ics.split('\r\n')))

    # ---------- GitHub: varsel når nøkkelen slutter å virke ----------
    def test_github_key_warnings(self):
        self.open()
        self.js("() => { sync.cfg = { owner: 'test', repo: 'data', token: 'x', expires: '2026-10-12', backup: true, share: false, dogn: false, lastPush: '', lastShare: '', lastPull: '', lastError: '', dirty: false, shareDirty: false }; render(); }")
        self.assertIn('utløper 12. okt. (om 7 dager)', self.page.inner_text('.card.notice'))
        self.js("() => { sync.cfg.lastError = T.sync.errors[401]; render(); }")
        self.assertIn('Nøkkelen er ugyldig eller utløpt', self.page.inner_text('.card.notice'))
        self.page.click('.card.notice [data-act="github"]')
        self.page.fill('#sy-t', 'github_pat_ny')
        self.page.fill('#sy-x', '2027-10-05')
        self.page.click('[data-key]')
        self.page.wait_for_function("() => sync.cfg.token === 'github_pat_ny' && !sync.cfg.lastError")
        self.assertEqual(self.js('() => sync.cfg.expires'), '2027-10-05')
        self.js('() => { closeSheet(); render(); }')
        self.assertEqual(self.page.locator('.card.notice').count(), 0)


    # ---------- uten GitHub: ingen spor av Døgn, deling eller handling ----------
    def test_no_dogn_features_for_other_users(self):
        self.open(seed=False)
        self.page.wait_for_selector('#sheet-root.open')
        self.assertEqual(self.page.locator('[data-gh]').count(), 0, 'ingen GitHub i oppsettet')
        self.js('() => { commit(null, () => { state.meta.setupDone = true; }); closeSheet(); }')
        self.page.wait_for_timeout(300)
        self.page.click('#tab-add')
        kinds = self.page.locator('[data-kind]').evaluate_all('els => els.map(e => e.dataset.kind)')
        self.assertEqual(kinds, ['todo', 'appt', 'note'], 'ingen handling')
        self.assertEqual(self.page.locator('[data-share]').count(), 0, 'ingen deling')
        self.js('() => closeSheet()')
        self.page.wait_for_timeout(300)
        self.page.click('#tab-more')
        self.page.click('[data-nav="profile"]')
        self.assertEqual(self.page.locator('#pf-d').count(), 0, 'ingen Døgn-navn')
        self.page.click('[data-goback]')
        self.page.click('[data-nav="backup"]')
        self.assertEqual(self.page.locator('[data-nav="sync"]').count(), 0, 'ingen GitHub i backup')
        self.assertEqual(self.page.locator('.card.home').count(), 0)
        # Ingen spor i noen av arkene i menyen
        texts = [self.page.inner_text('body')]
        for nav in ['rota', 'places', 'profile', 'calendar', 'backup']:
            self.js('() => openMenu()')
            self.page.click(f'[data-nav="{nav}"]')
            texts.append(self.sheet().inner_text())
        for word in ['Døgn', 'GitHub', 'Handl', 'hjemme', 'Lars']:
            self.assertFalse(any(word in t for t in texts), word)
        # Med ?github i adressen (for dem som bruker Døgn) kommer valget fram og huskes
        self.page.goto(self.base + '?github')
        self.page.wait_for_function(READY)
        self.page.goto(self.base)
        self.page.wait_for_function(READY)
        self.page.click('#tab-more')
        self.page.click('[data-nav="backup"]')
        self.assertEqual(self.page.locator('[data-nav="sync"]').count(), 1)

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
                   'T.places.walkSpeed.', 'T.profile.themes.', 'T.travel.mode.', 'T.sync.errors.', 'T.home.rate.', 'T.home.health.']
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
