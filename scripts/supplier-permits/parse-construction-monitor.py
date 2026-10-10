#!/usr/bin/env python3
"""Parse a Construction Monitor weekly permit report (PDF) into the JSON file the supplier-permits loader reads.

    python3 scripts/supplier-permits/parse-construction-monitor.py REPORT.pdf --out /path/outside/repo/wk40.json

Needs `pdfplumber` (pip install pdfplumber). No network. The report is licensed to one subscriber and holds owner
names, mailing addresses and phone numbers, and this repository is public: the output may only be written outside
the repository or under data/ (git-ignored), and the PDF itself must never be committed.

The report is three newspaper-style columns per page. Text is read by position (font, colour, indent), not by text
order. Every run checks itself against the report's own summary page (week totals of residential and commercial
permits, which exclude solar) and exits non-zero if the permits it found do not add up to those totals.

Output (JSON):
  edition  {week, year, start, end, region}
  report   {residential, commercial, solar}      the report's own week totals (permits over $5,000)
  ranking  [{rank, name, homes, valueCents}]    year-to-date single-family builder ranking (names are truncated)
  entries  one per permit, in report order:
           page, section (Approved|Pending), county, category, sub, type, valuation (whole dollars), pmt (permit
           number as printed), street, city, state, zip, date (MM/DD/YYYY), sf, extra[], contacts[]
           contacts: {role, lines[] (name first, then mailing lines), phone, fax, lic}
"""
import argparse
import datetime
import json
import os
import re
import sys

import pdfplumber

COLS = [(30, 218), (218, 399), (399, 600)]
DATE = re.compile(r'\b(\d{2}/\d{2}/\d{4})\b')
PHONE = re.compile(r'\b(\d{3}-\d{3}-\d{4})\b')
FAX = re.compile(r'Fax:\s*(\d{3}-\d{3}-\d{4})')
LIC = re.compile(r'lic:\s*(\S.*)$')
CITYST = re.compile(r'^(.*?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$')
MONTHS = {m: i for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], 1)}
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def refuse_public_output(path):
    target = os.path.abspath(path)
    rel = os.path.relpath(target, REPO)
    inside = not rel.startswith('..') and not os.path.isabs(rel)
    if inside and not (rel == 'data' or rel.startswith('data' + os.sep)):
        sys.exit(f'Refusing to write supplier data to "{path}": inside the repository only data/ is git-ignored. Use data/supplier-permits or a folder outside the repo.')
    return target


def col_of(x):
    for i, (a, b) in enumerate(COLS):
        if a <= x < b:
            return i
    return None


def is_blue(c):
    return len(c) >= 3 and c[0] < .2 and c[1] < .2 and c[2] > .8


def is_white(c):
    return len(c) >= 3 and all(v > .9 for v in c[:3])


def page_lines(page):
    words = page.extract_words(extra_attrs=['fontname', 'size', 'non_stroking_color'])
    words = [w for w in words if w['size'] >= 6 and w['x0'] >= 32]  # drops the rotated licence watermark
    ytop = 0
    for w in words:
        if w['text'] == 'Week' and w['size'] >= 9.5:
            ytop = max(ytop, w['bottom'] + 4)
    ybot = 10 ** 6
    for w in words:
        if w['text'] == 'Please' and w['top'] > 600:
            ybot = min(ybot, w['top'] - 2)
    words = [w for w in words if ytop <= w['top'] < ybot]
    out = []
    for ci in range(3):
        rows = []
        for w in sorted((w for w in words if col_of(w['x0']) == ci), key=lambda w: (w['top'], w['x0'])):
            if rows and abs(rows[-1]['top'] - w['top']) <= 2.2:
                rows[-1]['w'].append(w)
            else:
                rows.append({'top': w['top'], 'w': [w]})
        for r in rows:
            ws = sorted(r['w'], key=lambda w: w['x0'])
            out.append({'words': ws, 'text': ' '.join(w['text'] for w in ws), 'size': ws[0]['size'],
                        'color': tuple(ws[0]['non_stroking_color'] or ()), 'x0': ws[0]['x0'], 'colx': COLS[ci][0],
                        'bold': 'Bold' in ws[0]['fontname']})
    return out


def parse_entries(pdf):
    entries, state = [], {'county': None, 'category': None, 'sub': None, 'section': None}
    cur = None
    role = None

    def finish():
        nonlocal cur, role
        if cur:
            entries.append(cur)
        cur = None
        role = None

    for pno in range(2, len(pdf.pages)):
        for ln in page_lines(pdf.pages[pno]):
            ln['page'] = pno + 1
            t = ln['text']
            if ln['size'] >= 15:
                if t in ('Approved Permits', 'Pending Permits'):
                    finish()
                    state.update(section=t.split()[0], county=None, category=None, sub=None)
                continue
            if ln['size'] >= 11.5 and t.endswith('County'):
                finish()
                state.update(county=t, category=None, sub=None)
                continue
            if is_white(ln['color']) and ln['size'] >= 10.5:
                finish()
                state.update(category=t, sub=None)
                continue
            if abs(ln['size'] - 10) < .6 and not ln['bold'] and not is_blue(ln['color']):
                finish()
                state['sub'] = t
                continue
            if ln['bold'] and is_blue(ln['color']) and abs(ln['size'] - 8) < .6:
                if cur is not None and cur['valuation'] is None and not cur['contacts']:
                    cur['type'] += ' ' + t  # a long permit type wraps onto a second blue line
                    continue
                finish()
                cur = {'page': ln['page'], 'section': state['section'], 'county': state['county'], 'category': state['category'],
                       'sub': state['sub'], 'type': t, 'valuation': None, 'pmt': None, 'street': None, 'city': None, 'state': None,
                       'zip': None, 'date': None, 'sf': None, 'extra': [], 'contacts': []}
                continue
            if cur is None:
                continue
            if t.startswith('Valuation:'):
                m = re.match(r'Valuation:\s*\$?([\d,]+)', t)
                cur['valuation'] = int(m.group(1).replace(',', '')) if m else None
                m = re.search(r'pmt#:\s*(.*)$', t)
                cur['pmt'] = m.group(1).strip() if m else None
                continue
            if ln['bold'] and not is_blue(ln['color']) and ln['x0'] - ln['colx'] > 15 and abs(ln['size'] - 8) < .6:
                role = {'role': t, 'lines': [], 'phone': None, 'fax': None, 'lic': None}
                cur['contacts'].append(role)
                continue
            d = DATE.search(t)
            if role is None:
                if cur['street'] is None:
                    m = re.search(r'\s([\d,]+)\s+sf$', t)
                    if m:
                        cur['sf'] = int(m.group(1).replace(',', ''))
                        t = t[:m.start()]
                    cur['street'] = t.strip()
                    continue
                if cur['city'] is None:
                    t2 = DATE.sub('', t).strip()
                    if d:
                        cur['date'] = d.group(1)
                    m = CITYST.match(t2)
                    if m:
                        cur['city'], cur['state'], cur['zip'] = m.group(1), m.group(2), m.group(3)
                    else:
                        cur['street'] += ' | ' + t2  # an address that runs onto a second line
                    continue
                if d and not cur['date']:
                    cur['date'] = d.group(1)
                cur['extra'].append(DATE.sub('', t).strip())
                continue
            txt = t
            lic = LIC.search(txt)
            if lic:
                role['lic'] = lic.group(1).strip()
                txt = LIC.sub('', txt).strip()
            fx = FAX.search(txt)
            if fx:
                role['fax'] = fx.group(1)
                txt = FAX.sub('', txt).strip()
            ph = PHONE.findall(txt)
            if ph and not role['phone']:
                role['phone'] = ph[0]
            txt = PHONE.sub('', txt).strip()
            if txt:
                role['lines'].append(txt)
    finish()
    return entries


def parse_edition(pdf):
    text = pdf.pages[2].extract_text() or ''
    m = re.search(r'Week (\d+) - ([A-Za-z]+) (\d+), (\d{4}) to ([A-Za-z]+) (\d+), (\d{4})', text)
    if not m:
        sys.exit('Could not find the "Week N - Month D, YYYY to Month D, YYYY" banner on page 3.')
    wk, m1, d1, y1, m2, d2, y2 = m.groups()
    iso = lambda mo, d, y: datetime.date(int(y), MONTHS[mo], int(d)).isoformat()
    region = re.search(r'^(.*Building Permits)$', text, re.M)
    return {'week': int(wk), 'year': int(y1), 'start': iso(m1, d1, y1), 'end': iso(m2, d2, y2),
            'region': (region.group(1).replace(' Building Permits', '') if region else '')}


def parse_report_totals(pdf):
    """The week's own totals from the summary page: the second occurrence of each 'Total ... Const' line (the first is year to date)."""
    lines = (pdf.pages[1].extract_text() or '').splitlines()
    out = {}
    for key, label in (('residential', 'Total Residential Const'), ('commercial', 'Total Commercial Const'), ('solar', 'Total Solar Const')):
        hits = [l for l in lines if l.startswith(label)]
        if len(hits) < 2:
            sys.exit(f'Could not find the week total "{label}" on page 2.')
        m = re.match(re.escape(label) + r'\s+([\d,]+)\s', hits[1])
        out[key] = int(m.group(1).replace(',', ''))
    return out


def parse_ranking(pdf):
    """Year-to-date single-family builder ranking (page 2, the column under the 'Single Family Builders' header).
    The rank is glued to the name in the PDF text ('22' + '2020 Construction'), so ranks are read in sequence."""
    page = pdf.pages[1]
    words = page.extract_words()
    head = next((w for w in words if w['text'] == 'Single' and w['top'] < 60), None)
    nxt = next((w for w in words if w['text'] == 'Multi-Family' and w['top'] < 60), None)
    if not head or not nxt:
        return []
    text = page.crop((head['x0'] - 40, head['top'] + 10, nxt['x0'] - 42, page.height)).extract_text() or ''
    rows = []
    for line in text.splitlines():
        if line.startswith('Garage and Carport'):
            break
        want = str(len(rows) + 1)
        if not line.startswith(want):
            continue
        m = re.match(r'^(.+?)\s+(\d+)\s*\$([\d,]+)$', line[len(want):].strip())
        if m:
            rows.append({'rank': len(rows) + 1, 'name': m.group(1).strip(), 'homes': int(m.group(2)), 'valueCents': int(m.group(3).replace(',', '')) * 100})
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('pdf')
    ap.add_argument('--out', required=True)
    ap.add_argument('--allow-mismatch', action='store_true', help='write the file even when the totals do not match (a human must look)')
    args = ap.parse_args()
    out = refuse_public_output(args.out)
    with pdfplumber.open(args.pdf) as pdf:
        edition, report = parse_edition(pdf), parse_report_totals(pdf)
        entries, ranking = parse_entries(pdf), parse_ranking(pdf)
    approved = [e for e in entries if e['section'] == 'Approved']
    got = {'residential': sum(1 for e in approved if e['category'] == 'Residential'), 'commercial': sum(1 for e in approved if e['category'] == 'Commercial')}
    ok = got['residential'] == report['residential'] and got['commercial'] == report['commercial']
    print(f"week {edition['week']} {edition['start']} to {edition['end']}: approved {len(approved)} (residential {got['residential']} of {report['residential']}, commercial {got['commercial']} of {report['commercial']}), pending {len(entries) - len(approved)}, ranking rows {len(ranking)}")
    if not ok and not args.allow_mismatch:
        sys.exit('The permits found do not add up to the report totals. Nothing was written. Open the PDF and check the parser before using this edition.')
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'source': 'Construction Monitor', 'edition': edition, 'report': report, 'ranking': ranking, 'entries': entries}, f)
    os.chmod(out, 0o600)
    print('wrote', out)


if __name__ == '__main__':
    main()
