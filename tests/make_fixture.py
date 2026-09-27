"""Lager en oppdiktet, skannet kalenderplan som testene leser.

Kjøres med:  python3 tests/make_fixture.py
Gir:         tests/fixtures/kalenderplan.pdf og tests/fixtures/kalenderplan.json (fasit)

Planen ligner en kalenderplan fra GAT slik den ser ut når den er skrevet ut
og skannet: tabellen står på tvers av siden, radene er annenhver blå, noen
ruter er rosa (fravær) eller skravert (før planen starter), og bildet har
litt uskarphet, støy og skjevhet. Bildet lagres som JPEG 2000 i PDF-en, som
skanneren gjør. Ingen ekte personer eller planer er med.
"""
import datetime
import io
import json
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fixtures')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

FIRST_MONDAY = datetime.date(2026, 9, 28)
WEEKS = 12
CODES = ['D', 'D', 'D', 'D17', 'A14', 'A8', 'MV', 'M2', 'M2O', 'NP', 'N', 'F1', 'F2', 'F3', 'FU1', 'HLR', '', '']


def plan(rng):
    days = {}
    for w in range(WEEKS):
        for i in range(7):
            d = FIRST_MONDAY + datetime.timedelta(days=7 * w + i)
            if w == 0 and i == 0:
                days[d.isoformat()] = '#hatch'
            elif w == 0 and i in (1, 2):
                days[d.isoformat()] = '#absent'
            else:
                days[d.isoformat()] = rng.choice(CODES) if i < 6 else rng.choice(['F1', 'D', ''])
    return days


def draw_table(days):
    W, H = 3350, 2100                                  # tabellen tegnes liggende
    im = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, 38)
    fb = ImageFont.truetype(FONT_B, 40)
    fs = ImageFont.truetype(FONT, 31)
    title = ImageFont.truetype(FONT_B, 54)
    d.text((W // 2, 60), 'Nordmann, Kari (Kalenderplan 2026-27)', font=title, fill='black', anchor='mm')
    d.text((40, 20), 'Helse Eksempel HF', font=f, fill='black')
    x0, y0, cw0, cw, rh = 60, 150, 800, 340, 140
    cols = [x0, x0 + cw0] + [x0 + cw0 + cw * (i + 1) for i in range(7)]
    rows = [y0 + rh * i for i in range(WEEKS + 2)]
    names = ['Dato', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag']
    d.rectangle([cols[0], rows[0], cols[-1], rows[1]], fill=(250, 240, 210))
    for w in range(WEEKS):
        if w % 2:
            d.rectangle([cols[0], rows[w + 1], cols[-1], rows[w + 2]], fill=(205, 237, 254))
    for c in range(8):
        d.text(((cols[c] + cols[c + 1]) // 2, rows[0] + rh // 2), names[c], font=f, fill='black', anchor='mm')
    for w in range(WEEKS):
        mon = FIRST_MONDAY + datetime.timedelta(days=7 * w)
        sun = mon + datetime.timedelta(days=6)
        k = mon.isocalendar()[1]
        label = 'Uke a:%d / k:%d (%s - %s' % (w + 1, k, mon.strftime('%d.%m.%Y'), sun.strftime('%d.%m.%Y')[:-1])
        d.text((cols[0] + 14, rows[w + 1] + rh // 2), label, font=fs, fill='black', anchor='lm')
        for i in range(7):
            cx0, cy0, cx1, cy1 = cols[i + 1], rows[w + 1], cols[i + 2], rows[w + 2]
            v = days[(mon + datetime.timedelta(days=i)).isoformat()]
            if v == '#absent':
                d.rectangle([cx0, cy0, cx1, cy1], fill=(234, 167, 212))
            elif v == '#hatch':
                for t in range(-rh, cw, 24):
                    d.line([cx0 + t, cy1, cx0 + t + rh, cy0], fill=(90, 90, 90), width=3)
                d.rectangle([cx0, cy0, cx1, cy1], outline='black', width=0)
            elif v:
                d.text((cx0 + 22, (cy0 + cy1) // 2), v, font=fb, fill='black', anchor='lm')
    for x in cols:
        d.line([x, rows[0], x, rows[-1]], fill='black', width=4)
    for y in rows:
        d.line([cols[0], y, cols[-1], y], fill='black', width=4)
    return im


def scan(im, rng):
    page = Image.new('RGB', (2480, 3508), 'white')
    t = im.rotate(90, expand=True, fillcolor='white').rotate(0.25, expand=False, fillcolor='white', resample=Image.BICUBIC)
    page.paste(t, (120, 60))
    page = page.filter(ImageFilter.GaussianBlur(1.1))
    px = page.load()
    for _ in range(40000):
        x, y = rng.randrange(2480), rng.randrange(3508)
        v = rng.randrange(200, 256)
        px[x, y] = (v, v, v)
    return page


def pdf_with_jpx(jp2, w, h):
    """En minimal PDF med ett bilde (JPXDecode) som fyller en A4-side."""
    objs = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.2 841.92] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
        None, None,
    ]
    content = b'q 595.2 0 0 841.92 0 0 cm /Im0 Do Q'
    out = io.BytesIO()
    out.write(b'%PDF-1.6\n')
    offsets = []
    for n in range(1, 6):
        offsets.append(out.tell())
        out.write(b'%d 0 obj\n' % n)
        if n == 4:
            out.write(b'<< /Type /XObject /Subtype /Image /Width %d /Height %d /Filter /JPXDecode /Length %d >>\nstream\n' % (w, h, len(jp2)))
            out.write(jp2 + b'\nendstream')
        elif n == 5:
            out.write(b'<< /Length %d >>\nstream\n' % len(content) + content + b'\nendstream')
        else:
            out.write(objs[n - 1])
        out.write(b'\nendobj\n')
    xref = out.tell()
    out.write(b'xref\n0 6\n0000000000 65535 f \n')
    for o in offsets:
        out.write(b'%010d 00000 n \n' % o)
    out.write(b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % xref)
    return out.getvalue()


def main():
    rng = random.Random(7)
    days = plan(rng)
    page = scan(draw_table(days), rng)
    buf = io.BytesIO()
    page.save(buf, 'JPEG2000', quality_mode='rates', quality_layers=[90])
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'kalenderplan.pdf'), 'wb') as f:
        f.write(pdf_with_jpx(buf.getvalue(), page.width, page.height))
    truth = {k: v for k, v in days.items() if v != '#hatch'}
    with open(os.path.join(OUT, 'kalenderplan.json'), 'w') as f:
        json.dump(truth, f, indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
