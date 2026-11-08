import sys, os, datetime
sys.path.insert(0, sys.argv[1])
from lib_bh import *
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.comments import Comment

OUT = ROOT + '/Guruh hisobotlari'
os.makedirs(OUT, exist_ok=True)
S = dbget('students', 'id,fish,group,pinfl')
F = dbget('fanlar')
B = dbget('baholar')
A = dbget('malakaviy_amaliyot')
G = json.load(open(ROOT + '/data/guruhlar.json', encoding='utf-8'))
T = ('yakuniy', 'joriy', 'oraliq')
TL = {'yakuniy': 'Yakuniy', 'joriy': 'Joriy', 'oraliq': 'Oraliq'}
today = datetime.date.today().strftime('%d.%m.%Y')

FN = 'Arial'
NAVY = '1F3A5F'
f_h = Font(name=FN, bold=True, color='FFFFFF', size=10)
f_b = Font(name=FN, size=10)
f_bb = Font(name=FN, size=10, bold=True)
fill_h = PatternFill('solid', fgColor=NAVY)
RED = PatternFill('solid', fgColor='FECACA')
AMB = PatternFill('solid', fgColor='FDE68A')
GRN = PatternFill('solid', fgColor='BBF7D0')
BLU = PatternFill('solid', fgColor='BFDBFE')
GRY = PatternFill('solid', fgColor='F3F4F6')
thin = Side(style='thin', color='D1D5DB')
bd = Border(left=thin, right=thin, top=thin, bottom=thin)

byp = {s['pinfl']: s for s in S if s['pinfl']}
bh = {(r['guruh'], r['semestr'], r['fan'], r['pinfl']): r for r in B}
am = {(r['guruh'], r['semestr'], r['pinfl']): r for r in A}
fan = collections.defaultdict(list)
for r in sorted(F, key=lambda r: (r['tartib'], r['id'])):
    fan[(r['guruh'], r['semestr'])].append(r['nom'])
cnt = collections.defaultdict(collections.Counter)
for r in B:
    for t in T:
        if r[t] is not None:
            cnt[(r['guruh'], r['semestr'], r['fan'])][t] += 1
_any = collections.Counter()
for r in B:
    if any(r[t] is not None for t in T):
        _any[(r['guruh'], r['semestr'], r['fan'])] += 1
used = {}
for k, n in _any.items():
    if n >= 3:
        used[k] = {t for t in T if cnt[k][t] >= 0.5 * n}


def style_header(ws, row, ncols, h=30):
    for c in range(1, ncols + 1):
        x = ws.cell(row, c)
        x.font = f_h
        x.fill = fill_h
        x.border = bd
        x.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws.row_dimensions[row].height = h


def title(ws, text, sub):
    ws.sheet_view.showGridLines = False
    ws['A1'] = text
    ws['A1'].font = Font(name=FN, bold=True, size=14, color=NAVY)
    ws['A2'] = sub
    ws['A2'].font = Font(name=FN, italic=True, size=9, color='6B7280')


def shown(r):
    if not r:
        return None
    for k in ('r_semestr', 'yakuniy', 'joriy', 'oraliq'):
        if r[k] is not None:
            return r[k]
    return None


def lack(g, sem, f, p):
    r = bh.get((g, sem, f, p))
    u = used.get((g, sem, f), set())
    if not u:
        return None
    return [t for t in T if t in u and (not r or r[t] is None)]


index = []
for g in sorted(G, key=lambda g: (G[g]['kurs'], g)):
    info = G[g]
    cur = info['semestr']
    st = sorted([s for s in S if s['group'].strip() == g and s['pinfl']], key=lambda s: s['fish'])
    stp = {s['pinfl'] for s in st}
    wb = Workbook()
    ws0 = wb.active
    ws0.title = 'Xulosa'
    issues = []   # (sem, talaba, fan, turlar, holat)
    sem_rows = []
    sheets = []
    for sem in range(1, cur + 1):
        fans = fan.get((g, sem), [])
        if not fans:
            sem_rows.append((sem, 0, 0, 0, 0, None))
            continue
        ws = wb.create_sheet(f'{sem}-semestr')
        sheets.append(ws.title)
        title(ws, f'{g} · {sem}-semestr — baholar jadvali', f"Katakda R-semestr bahosi (bo'lmasa yakuniy). Qizil — baho yo'q, sariq — ayrim turlari yo'q. {today}")
        hdr = 5
        ws.cell(hdr, 1, '№')
        ws.cell(hdr, 2, 'Talaba')
        for j, f in enumerate(fans, 3):
            ws.cell(hdr, j, f)
        nf = len(fans)
        ws.cell(hdr, 3 + nf, 'Baholangan')
        ws.cell(hdr, 4 + nf, "To'ldirilgan %")
        style_header(ws, hdr, 4 + nf, h=170)
        for j in range(3, 3 + nf):
            ws.cell(hdr, j).alignment = Alignment(textRotation=90, horizontal='center', vertical='bottom', wrap_text=True)
            ws.column_dimensions[L(j)].width = 6.2
        ws.column_dimensions['A'].width = 5
        ws.column_dimensions['B'].width = 38
        ws.column_dimensions[L(3 + nf)].width = 11
        ws.column_dimensions[L(4 + nf)].width = 12
        r0 = hdr + 1
        expected_fans = [f for f in fans if used.get((g, sem, f))]
        for i, s in enumerate(st, 1):
            rr = r0 + i - 1
            ws.cell(rr, 1, i).font = f_b
            ws.cell(rr, 2, s['fish']).font = f_b
            for j, f in enumerate(fans, 3):
                c = ws.cell(rr, j)
                c.border = bd
                c.alignment = Alignment(horizontal='center')
                c.font = f_b
                lk = lack(g, sem, f, s['pinfl'])
                r = bh.get((g, sem, f, s['pinfl']))
                v = shown(r)
                if lk is None:   # fan hech kimda baholanmagan
                    c.fill = GRY
                elif lk:
                    if v is None:
                        c.value = None
                        c.fill = RED
                        issues.append((sem, s['fish'], f, ', '.join(TL[t] for t in lk), "Butunlay yo'q"))
                    else:
                        c.value = v
                        c.fill = AMB
                        c.comment = Comment("Yo'q turlar: " + ', '.join(TL[t] for t in lk), 'hisobot')
                        issues.append((sem, s['fish'], f, ', '.join(TL[t] for t in lk), 'Qisman'))
                else:
                    c.value = v
            first, last = L(3), L(2 + nf)
            ws.cell(rr, 3 + nf, f'=COUNT({first}{rr}:{last}{rr})').font = f_bb
            ws.cell(rr, 4 + nf, f'=IF({len(expected_fans)}=0,"",{L(3 + nf)}{rr}/{len(expected_fans)})')
            ws.cell(rr, 4 + nf).number_format = '0%'
            for cc in (1, 2, 3 + nf, 4 + nf):
                ws.cell(rr, cc).border = bd
            ws.cell(rr, 3 + nf).alignment = Alignment(horizontal='center')
            ws.cell(rr, 4 + nf).alignment = Alignment(horizontal='center')
        last_r = r0 + max(len(st), 1) - 1
        fr = last_r + 2
        ws.cell(fr, 2, 'Baholangan talaba').font = f_bb
        ws.cell(fr + 1, 2, "O'rtacha baho").font = f_bb
        for j in range(3, 3 + nf):
            ws.cell(fr, j, f'=COUNT({L(j)}{r0}:{L(j)}{last_r})').font = f_bb
            ws.cell(fr, j).alignment = Alignment(horizontal='center')
            ws.cell(fr + 1, j, f'=IFERROR(AVERAGE({L(j)}{r0}:{L(j)}{last_r}),"")').font = f_b
            ws.cell(fr + 1, j).number_format = '0.0'
            ws.cell(fr + 1, j).alignment = Alignment(horizontal='center')
        ws.freeze_panes = ws.cell(r0, 3)
        filled = sum(1 for s in st for f in fans if shown(bh.get((g, sem, f, s['pinfl']))) is not None)
        sem_rows.append((sem, len(fans), len(expected_fans), len(st), filled, ws.title, f'{L(3)}{r0}:{L(2 + nf)}{last_r}'))
    # ---------------- Xulosa
    ws = ws0
    title(ws, f'{g} guruhi — baholar hisoboti', f"Hisobot sanasi {today}. Manba: jonli baza.")
    meta = [('Guruh', g), ('Kurs', info['kurs']), ('Joriy semestr', cur), ('Rahbar', info.get('rahbar', '')), ("Yo'nalish", info.get('yonalish', '')),
            ('Talabalar soni (JSHSHIR bilan)', len(st))]
    for i, (a, b) in enumerate(meta, 4):
        ws.cell(i, 1, a).font = f_bb
        ws.cell(i, 2, b).font = f_b
        ws.cell(i, 1).fill = GRY
        for c in (1, 2):
            ws.cell(i, c).border = bd
    hr = 12
    for j, h in enumerate(['Semestr', 'Fan soni', 'Baholangan fan', 'Talaba', 'Kutilgan katak', "To'ldirilgan katak", "To'ldirilgan %", 'Holat'], 1):
        ws.cell(hr, j, h)
    style_header(ws, hr, 8)
    for i, row in enumerate(sem_rows, hr + 1):
        sem, nf_, ne, ns, filled = row[:5]
        ws.cell(i, 1, sem)
        ws.cell(i, 2, nf_)
        ws.cell(i, 3, ne)
        ws.cell(i, 4, ns)
        ws.cell(i, 5, f'=C{i}*D{i}')
        if row[5]:
            exp_cols = [f for f in fan.get((g, sem), []) if used.get((g, sem, f))]
            ws.cell(i, 6, f"=COUNT('{row[5]}'!{row[6]})")
        else:
            ws.cell(i, 6, 0)
        ws.cell(i, 7, f'=IF(E{i}=0,"",MIN(1,F{i}/E{i}))')
        ws.cell(i, 7).number_format = '0%'
        if nf_ == 0:
            h = "Fanlar ro'yxati yo'q"
        elif ne == 0:
            h = 'Joriy semestr: baholash boshlanmagan' if sem == cur else "Hech qaysi fanga baho yo'q"
        else:
            miss = sum(1 for x in issues if x[0] == sem)
            h = 'Kamchilik yo\'q' if miss == 0 else f'{miss} ta katak yetishmaydi'
        ws.cell(i, 8, h)
        for c in range(1, 9):
            x = ws.cell(i, c)
            x.border = bd
            x.font = f_b
            x.alignment = Alignment(horizontal='center' if c < 8 else 'left')
        ws.cell(i, 8).fill = (GRN if h.startswith('Kamchilik') else BLU if 'boshlanmagan' in h else RED if ('yo' in h and 'ro' in h) or 'Hech' in h else AMB)
    for c, w in zip('ABCDEFGH', [34, 12, 15, 10, 14, 16, 14, 40]):
        ws.column_dimensions[c].width = w
    # amaliyot
    ar = hr + len(sem_rows) + 3
    ws.cell(ar - 1, 1, 'Malakaviy amaliyot').font = Font(name=FN, bold=True, size=11, color=NAVY)
    for j, h in enumerate(['Semestr', 'Yozuv bor', "Yozuv yo'q", "Ball yo'q", "Joy yo'q", "Sana yo'q"], 1):
        ws.cell(ar, j, h)
    style_header(ws, ar, 6)
    am_issue = []
    ai = ar + 1
    am_sems = sorted({sem for (gg, sem, p) in am if gg == g})
    for sem in am_sems:
        rows_ = {p: am[(g, sem, p)] for p in stp if (g, sem, p) in am}
        absent = [s for s in st if s['pinfl'] not in rows_]
        nob = [s for s in st if s['pinfl'] in rows_ and rows_[s['pinfl']]['ball'] is None]
        noj = [s for s in st if s['pinfl'] in rows_ and not (rows_[s['pinfl']]['joy'] or '').strip()]
        nod = [s for s in st if s['pinfl'] in rows_ and (not rows_[s['pinfl']]['boshlanish'] or not rows_[s['pinfl']]['tugash'])]
        for j, v in enumerate([sem, len(rows_), len(absent), len(nob), len(noj), len(nod)], 1):
            c = ws.cell(ai, j, v)
            c.border = bd
            c.font = f_b
            c.alignment = Alignment(horizontal='center')
        for j in range(3, 7):
            if ws.cell(ai, j).value:
                ws.cell(ai, j).fill = RED if j == 3 else AMB
        for s in st:
            iss = []
            if s['pinfl'] not in rows_:
                iss.append("Yozuv yo'q")
            else:
                r = rows_[s['pinfl']]
                if r['ball'] is None:
                    iss.append("Ball yo'q")
                if not (r['joy'] or '').strip():
                    iss.append("Joy yo'q")
                if not r['boshlanish'] or not r['tugash']:
                    iss.append("Sana yo'q")
            if iss:
                am_issue.append((sem, s['fish'], ', '.join(iss)))
        ai += 1
    if not am_sems:
        ws.cell(ai, 1, "Amaliyot yozuvi yo'q" + (" (1-semestr, odatiy)" if cur == 1 else '')).font = f_b
    # Muammolar varag'i
    wi = wb.create_sheet('Muammolar')
    title(wi, f'{g} — yetishmayotgan baholar va amaliyot', 'Baholar jadvalidagi qizil/sariq kataklar ro\'yxati')
    for j, h in enumerate(['Semestr', 'Talaba', 'Fan', "Yo'q baho turlari", 'Holat'], 1):
        wi.cell(4, j, h)
    style_header(wi, 4, 5)
    for i, row in enumerate(issues, 5):
        for j, v in enumerate(row, 1):
            c = wi.cell(i, j, v)
            c.border = bd
            c.font = f_b
            c.alignment = Alignment(horizontal='center' if j in (1, 5) else 'left')
        wi.cell(i, 5).fill = RED if row[4] == "Butunlay yo'q" else AMB
    e = 5 + len(issues) + 1
    wi.cell(e, 1, 'Malakaviy amaliyot kamchiliklari').font = Font(name=FN, bold=True, size=11, color=NAVY)
    for j, h in enumerate(['Semestr', 'Talaba', 'Muammo'], 1):
        wi.cell(e + 1, j, h)
    style_header(wi, e + 1, 3)
    for i, row in enumerate(am_issue, e + 2):
        for j, v in enumerate(row, 1):
            c = wi.cell(i, j, v)
            c.border = bd
            c.font = f_b
    for c, w in zip('ABCDE', [10, 40, 56, 30, 16]):
        wi.column_dimensions[c].width = w
    wi.freeze_panes = 'A5'
    # Chiqqan talabalar
    former = collections.defaultdict(set)
    for r in B:
        if r['guruh'] == g and r['pinfl'] not in stp and r['pinfl'] in byp:
            former[r['pinfl']].add(r['semestr'])
    if former:
        wf = wb.create_sheet('Guruhdan chiqqan')
        title(wf, f"{g} — guruhda bahosi bor, hozir boshqa holatdagi talabalar", "Akademik ta'til, safdan chiqarilgan yoki boshqa guruhga o'tgan")
        for j, h in enumerate(['Talaba', 'Hozirgi holat / guruh', 'Baholari bor semestrlar'], 1):
            wf.cell(4, j, h)
        style_header(wf, 4, 3)
        for i, (p, sems) in enumerate(sorted(former.items(), key=lambda x: byp[x[0]]['fish']), 5):
            for j, v in enumerate([byp[p]['fish'], byp[p]['group'].strip(), ', '.join(str(x) for x in sorted(sems))], 1):
                c = wf.cell(i, j, v)
                c.border = bd
                c.font = f_b
        for c, w in zip('ABC', [42, 36, 26]):
            wf.column_dimensions[c].width = w
    fn = f"{g}_baholar_hisoboti.xlsx"
    wb.save(OUT + '/' + fn)
    miss_cells = len(issues)
    index.append((g, info['kurs'], cur, info.get('rahbar', ''), len(st), miss_cells, len(am_issue), fn))
    print(g, 'talaba', len(st), 'semestr varaqlari', len(sheets), 'kamchilik', miss_cells, 'amaliyot', len(am_issue))
import pickle
pickle.dump(index, open(sys.argv[1] + '/gindex.pkl', 'wb'))
