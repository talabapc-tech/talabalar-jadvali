import json, re, glob, os, sys, urllib.request, collections, difflib
import openpyxl
sys.stdout.reconfigure(encoding='utf-8')
ROOT = "C:/Users/SAVITAR/Desktop/TG shartnomalar"
env = {}
for l in open(ROOT + '/web/.env.local', encoding='utf-8'):
    l = l.strip()
    if '=' in l and not l.startswith('#'):
        k, v = l.split('=', 1); env[k] = v.strip().strip('"\'')
U = env['NEXT_PUBLIC_SUPABASE_URL']; K = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_SERVICE_KEY')
def dbget(t, sel='*', order='id'):
    out = []; f = 0
    while True:
        r = urllib.request.Request(f"{U}/rest/v1/{t}?select={sel}&order={order}", headers={'apikey': K, 'Authorization': 'Bearer ' + K, 'Range': f'{f}-{f+999}'})
        d = json.load(urllib.request.urlopen(r)); out += d
        if len(d) < 1000: return out
        f += 1000
def nrm(s):
    s = str(s or '').lower()
    s = re.sub(r"[‘’ʻʼ`´']", '', s)
    s = s.replace('ı', 'i').replace('̇', '')
    s = re.sub(r'[^a-z0-9а-яё ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()
KEYS = ('yakuniy', 'joriy', 'oraliq', 'r_semestr')
def parse_xlsx(path, sheet='#'):
    """'#' varag'i: 4-qator fan nomlari, 5-qator semestr, 7+ talabalar. Qaytaradi: [(talaba, guruh, semestr, fan, {yakuniy,joriy,oraliq,r_semestr}, qator)]"""
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet]
    fans = []
    for c in ws[4]:
        if c.value is not None and c.column > 3:
            sem = str(ws.cell(5, c.column).value or '')
            m = re.search(r'(\d)', sem)
            fans.append((c.column, str(c.value).strip(), int(m.group(1)) if m else None))
    out = []
    for r in range(7, min(ws.max_row, 200) + 1):
        name = ws.cell(r, 2).value
        if not name or not str(name).strip(): continue
        if not re.match(r'^\d+(\.0)?$', str(ws.cell(r, 1).value or '').strip()): continue
        grp = str(ws.cell(r, 3).value or '').strip()
        for col, fan, sem in fans:
            vals = {}
            for i, k in enumerate(KEYS):
                v = ws.cell(r, col + i).value
                if v is None or str(v).strip() == '': vals[k] = None
                else:
                    try:
                        iv = int(float(str(v).strip()))
                    except ValueError:
                        iv = None
                    vals[k] = iv if iv in (2, 3, 4, 5) else ('?' + str(v))
            out.append((str(name).strip(), grp, sem, fan, vals, r))
    return out

def parse_any(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=False)
    names = wb.sheetnames; wb.close()
    out = []
    sheets = [n for n in names if re.match(r'^\d-semestr$', n)] or ['#']
    for sh in sheets:
        out += [x + (sh,) for x in parse_xlsx(path, sh)]
    return out
