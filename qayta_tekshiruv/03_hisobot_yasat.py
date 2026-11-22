# -*- coding: utf-8 -*-
"""
MUKAMMAL 100% SVG VA ULTRA-MODERN PREMIUM DIZAYNDAGI HISOBOT YASAGICH
===================================================================
- 2 ta Asosiy Ko'rinish: (1) Umumiy Baza & Hujjatlar | (2) Akademik Guruhlar Jurnali
- Jadval ichidan to'g'ridan-to'g'ri Guruhni Dropdown orqali almashtirish va bir zumda saqlash
- Multi-Sheet Excel Eksport (Barcha 7 ta guruh alohida sheetlarda)
- Guruhma-guruh alohida Excel eksport (Alifbo A-Z tartibida)
"""

import openpyxl
import json
import os
import re
import sys
import shutil

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
EXCEL_PATH = os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx')
OUTPUT_HTML = os.path.join(BASE_DIR, 'qayta_tekshiruv', 'hisobot.html')
MAIN_HTML = os.path.join(BASE_DIR, 'eski_portal', 'natijalar_hisoboti.html')
ROOT_HISOBOT = os.path.join(BASE_DIR, 'eski_portal', 'hisobot.html')
INDEX_HTML = os.path.join(BASE_DIR, 'eski_portal', 'index.html')
JS_SRC = os.path.join(BASE_DIR, 'eski_portal', 'js', 'app.js')

wb = openpyxl.load_workbook(EXCEL_PATH)
ws = wb.worksheets[0]
VERIF_FILE = os.path.join(BASE_DIR, 'scripts', 'verifications.json')
verif_map = {}
if os.path.exists(VERIF_FILE):
    try:
        with open(VERIF_FILE, 'r', encoding='utf-8') as vf:
            verif_map = json.load(vf)
    except Exception as e_vf:
        print(f"verifications.json yuklash xatosi: {e_vf}")

students = []

def name_flag(m):
    """
    24-ustun ("Ism mosligi") matnidan rang belgisini aniqlaydi.
    Tartib muhim: "IMLO FARQI" ichida ham "FARQ" bor, shuning uchun
    aniqrog'i avval tekshiriladi.
    """
    u = re.sub(r"[`‘’ʻʼ´]", "'", str(m or '')).upper()
    if 'BOSHQA ODAM' in u:
        return 'boshqa'
    if 'TEKSHIRILSIN' in u:
        return 'tekshir'
    if 'IMLO FARQI' in u or 'TRANSLIT' in u:
        return 'translit'
    if 'FARQ' in u or 'TUTUQ' in u:
        return 'farq'
    if 'MOS' in u:
        return 'ok'
    return ''


def clean_w(w):
    w = (w or '').lower().strip()
    for ch in ["'", "`", "‘", "’", "ʻ", "ʼ", "-", "_", "."]:
        w = w.replace(ch, "")
    w = w.replace("abdu", "abdi").replace("zaxro", "zahro").replace("uzoq", "uzak")
    return w


def name_skeleton(w):
    """Familiyaning undosh skeleti — lotin yozuvidagi farqlarga chidamli:
    Arziqulova = Arzikulova, Xasanova = Hasanova, To'xtayeva = Tuxtayeva, Izzatulloyeva = Izatullayeva,
    Yo'ldosheva = Yuldosheva, Usmonova = Usmanova (lekin Yusupova ≠ Choriyeva)."""
    w = clean_w(w).replace('x', 'h').replace('q', 'k')
    w = re.sub(r'[aeiou]', '', w)
    return re.sub(r'(.)\1+', r'\1', w)

all_docx_files = []
files_dir = os.path.join(BASE_DIR, 'hujjatlar', 'shartnomalar')
if os.path.exists(files_dir):
    all_docx_files = [f for f in os.listdir(files_dir) if f.endswith('.docx')]

MANUAL_MAP_PATH = os.path.join(BASE_DIR, 'scripts', 'manual_file_map.json')
manual_files_map = {}
if os.path.exists(MANUAL_MAP_PATH):
    try:
        with open(MANUAL_MAP_PATH, 'r', encoding='utf-8') as mf:
            mdata = json.load(mf)
            manual_files_map = mdata.get('fayllar', mdata if isinstance(mdata, dict) else {})
    except Exception as e:
        print(f"manual_file_map yuklash xatosi: {e}")

def find_student_doc_file(shnum, ism, fish, group=""):
    shnum = str(shnum or '').strip()
    ism = str(ism or '').strip()
    fish = str(fish or '').strip()
    group = str(group or '').strip()

    # 0. Qo'lda belgilangan xarita (manual_file_map.json) - ENG USTUVOR
    for k in [f"{ism}|{group}", f"{fish}|{group}", ism, fish, f"sh_{shnum}"]:
        if k in manual_files_map:
            val = manual_files_map[k]
            mapped_file = val.get('file', '') if isinstance(val, dict) else str(val or '')
            if mapped_file:
                if os.path.exists(os.path.join(files_dir, mapped_file)):
                    return mapped_file
            else:
                return ""

    name_words = [clean_w(w) for w in ism.split() if len(clean_w(w)) >= 3]

    # 1. Shartnoma raqami VA FAMILIYA mos kelishi SHART! Raqamlar turli kurslarda takrorlanadi —
    #    faqat ism mos kelganda boshqa talabaning fayli olinardi (Yusupova Dilnura 98 ≠ Choriyeva Dilnura 98)
    if shnum and shnum.isdigit() and name_words:
        target_num = int(shnum)
        surname = name_words[0]
        sur_skel = name_skeleton(surname)
        for f in all_docx_files:
            f_clean_num = re.sub(r'\(\d+\)', '', f)
            nums = re.findall(r'\b\d{1,4}\b', f_clean_num)
            if nums and any(int(n) == target_num for n in nums):
                f_tokens = [clean_w(w) for w in re.split(r'[^a-zA-Z0-9]+', clean_w(f.lower())) if clean_w(w)]
                if surname in f_tokens or (len(sur_skel) >= 3 and any(name_skeleton(t) == sur_skel for t in f_tokens)):
                    return f

    # 2. To'liq Familiya va Ism bo'yicha qidirish (ikkala so'z ham aniq bo'lishi shart!)
    if len(name_words) >= 2:
        for f in all_docx_files:
            f_clean = clean_w(f.lower().replace('.docx', ''))
            f_tokens = [clean_w(w) for w in re.split(r'[^a-zA-Z0-9]+', f_clean) if clean_w(w)]
            
            match_all = True
            for nw in name_words:
                found = False
                for token in f_tokens:
                    if nw == token:
                        found = True
                        break
                    if nw.rstrip('va').rstrip('a') == token.rstrip('va').rstrip('a') and len(nw) >= 5:
                        found = True
                        break
                if not found:
                    match_all = False
                    break
            if match_all:
                return f

    return ""

_SHNUM_PREFIX_RE = re.compile(r'^\s*\d{2}\s*/\s*\d{2}\s*sh\s*/\s*a\s*(\d+)\s*$', re.IGNORECASE)


def normalize_shnum(v):
    """'26/27 SH/A 15' -> '15' (telegram_sync_service.normalize_shnum bilan bir xil)"""
    s_ = str(v or '').strip()
    m_ = _SHNUM_PREFIX_RE.match(s_)
    return m_.group(1) if m_ else s_


# Turli kurslarda bir xil shartnoma raqamlari bor — "sh_<raqam>" tasdiq kaliti faqat yagona raqamga ishlatiladi
_shnum_count = {}
for _r in range(2, ws.max_row + 1):
    _k = normalize_shnum(ws.cell(row=_r, column=5).value)
    if _k:
        _shnum_count[_k] = _shnum_count.get(_k, 0) + 1

for r in range(2, ws.max_row + 1):
    tr = ws.cell(row=r, column=1).value
    ism = str(ws.cell(row=r, column=2).value or '').strip()
    yon = str(ws.cell(row=r, column=3).value or '').strip()
    status_str = str(ws.cell(row=r, column=4).value or '').strip()
    shnum = normalize_shnum(ws.cell(row=r, column=5).value)
    sana_val = str(ws.cell(row=r, column=6).value or '').strip()
    sana_clean = sana_val.split()[0] if sana_val else ''
    ota = str(ws.cell(row=r, column=7).value or '').strip()
    fish = str(ws.cell(row=r, column=8).value or '').strip()
    pv = str(ws.cell(row=r, column=10).value or '').strip()
    pinfl = str(ws.cell(row=r, column=11).value or '').replace(' ', '').strip()
    ber = str(ws.cell(row=r, column=12).value or '').strip()
    dob = str(ws.cell(row=r, column=13).value or '').strip()
    sh_doc = str(ws.cell(row=r, column=15).value or '').strip()
    sh_qr = str(ws.cell(row=r, column=16).value or '').strip()
    mak = str(ws.cell(row=r, column=17).value or '').strip()
    doc_tur_val = str(ws.cell(row=r, column=18).value or 'Shahodatnoma').strip()
    yil = str(ws.cell(row=r, column=19).value or '').strip()
    tel = str(ws.cell(row=r, column=20).value or '').strip()
    group = str(ws.cell(row=r, column=23).value or '').strip()
    # Rasmiy hujjatlardagi F.I.SH — foydalanuvchi ro'yxati bilan solishtirish uchun
    pass_fish = str(ws.cell(row=r, column=9).value or '').strip()
    cert_fish = str(ws.cell(row=r, column=14).value or '').strip()
    name_match = str(ws.cell(row=r, column=24).value or '').strip()
    
    # 26–27-ustunlar: safdan chiqarish / akademik ta'til buyrug'i
    buyruq = str(ws.cell(row=r, column=26).value or '').strip()
    _bs = ws.cell(row=r, column=27).value
    buyruq_sana = _bs.strftime('%d.%m.%Y') if hasattr(_bs, 'strftime') else str(_bs or '').strip()

    # 25-ustun: Operator Tasdig'i
    raw_verified = str(ws.cell(row=r, column=25).value or 'KUTILMOQDA').strip().upper()
    verified_status = 'TASDIQLANDI' if 'TASDIQ' in raw_verified else 'KUTILMOQDA'
    
    # JSON keshdagi eng so'nggi tasdiq holati ustuvor hisoblanadi
    r_key = str(r)
    sh_key = f"sh_{shnum}" if shnum and _shnum_count.get(shnum) == 1 else None
    pin_key = f"pinfl_{pinfl}" if pinfl else None
    if pin_key and pin_key in verif_map:
        verified_status = verif_map[pin_key]
    elif sh_key and sh_key in verif_map:
        verified_status = verif_map[sh_key]
    elif r_key in verif_map:
        verified_status = verif_map[r_key]

    # 28-ustun: Bazaga kiritilganligi (standart: KIRITILDI)
    raw_baza = str(ws.cell(row=r, column=28).value or 'KIRITILDI').strip().upper()
    baza_status = 'KIRITILMAGAN' if ('MAGAN' in raw_baza or 'YOQ' in raw_baza or "YO'Q" in raw_baza) else 'KIRITILDI'
    b_r_key = f"baza_{r}"
    b_sh_key = f"baza_sh_{shnum}" if shnum and _shnum_count.get(shnum) == 1 else None
    b_pin_key = f"baza_pinfl_{pinfl}" if pinfl else None
    if b_pin_key and b_pin_key in verif_map:
        baza_status = verif_map[b_pin_key]
    elif b_sh_key and b_sh_key in verif_map:
        baza_status = verif_map[b_sh_key]
    elif b_r_key in verif_map:
        baza_status = verif_map[b_r_key]
    
    if not ism and not shnum:
        continue

    # Pasport turini aniqlash
    pass_type = "Mavjud emas"
    if pv:
        if pv.startswith(('AD', 'AE')):
            pass_type = "ID-karta"
        elif pv.startswith(('AB', 'AC', 'AA', 'FA')):
            pass_type = "Biometrik Pasport"
        else:
            pass_type = "ID-karta"

    # Statusni aniqlash
    if pv and pinfl and dob and sh_doc:
        status = "full"
    elif pv or sh_doc:
        status = "chala"
    else:
        status = "yoq"

    # Aniq va xatosiz doc_file qidirish
    doc_file = find_student_doc_file(shnum, ism, fish, group)

    students.append({
        'row': r,
        'tr': tr or len(students) + 1,
        'shnum': shnum,
        'sana': sana_clean,
        'ism': ism,
        'ota': ota,
        'fish': fish or f"{ism} {ota}".strip(),
        'yon': yon or "Hamshiralik ishi",
        'group': group,
        'pv': pv,
        'pass_type': pass_type,
        'pinfl': pinfl,
        'dob': dob,
        'ber': ber,
        'sh_doc': sh_doc,
        'sh_qr': sh_qr,
        'mak': mak,
        'doc_tur': doc_tur_val,
        'yil': yil,
        'tel': tel,
        'doc_file': doc_file,
        'status': status,
        'pass_fish': pass_fish,
        'cert_fish': cert_fish,
        'name_match': name_match,
        # Ism mosligi darajasi: ok | translit | farq | tekshir | boshqa
        'name_flag': name_flag(name_match),
        # Operator tekshiruvi va tasdig'i
        'verified': verified_status,
        # Bazaga kiritilganligi tasdig'i: KIRITILDI | KIRITILMAGAN
        'baza': baza_status,
        # Safdan chiqarish / akademik ta'til buyrug'i
        'buyruq': buyruq,
        'buyruq_sana': buyruq_sana,
    })

# Talabalar safidan chiqarilganlar (maxsus guruh) — rasmiy kontingentga kirmaydi
def is_withdrawn_group(g):
    g_clean = str(g or '').strip().lower()
    return g_clean in ['talabalar safidan chiqarilganlar', 'safdan chiqarilganlar', 'safdan chiqarilgan', 'n', 'belgilanmagan'] or 'chiqaril' in g_clean

# Talabalar ro'yxatini 1- Guruh (26-01...26-07, safdan chiqarilganlar oxirida), 2- I.F.O (A-Z) bo'yicha saralash
def student_uz_sort_key(s):
    grp = str(s.get('group') or '').strip()
    # 0 = Rasmiy guruhlar (26-01 ... 26-07), 1 = Safdan chiqarilganlar / belgilanmagan
    grp_rank = 1 if is_withdrawn_group(grp) or not grp else 0
    name = (s.get('fish') or s.get('ism') or '').strip().lower()
    for ch in ["'", "`", "‘", "’", "ʻ", "ʼ", "´", "-", "_", "."]:
        name = name.replace(ch, "")
    return (grp_rank, grp.lower(), name)

students.sort(key=student_uz_sort_key)
for idx, s in enumerate(students, 1):
    s['tr'] = idx

total = len(students)

GROUPS_LIST_OFFICIAL = ["26-01", "26-02", "26-03", "26-04", "26-05", "26-06"]
official_students = [s for s in students if s['group'] in GROUPS_LIST_OFFICIAL]
official_total = len(official_students)   # rasmiy kontingent soni (safdan chiqarilganlarsiz)
# Akademik ta'til olganlar — alohida maxsus guruh (safdan chiqarilganlarga qo'shilmaydi)
leave_students = [s for s in students if 'akademik' in str(s['group'] or '').lower()]
withdrawn_students = [s for s in students if (is_withdrawn_group(s['group']) or s['group'] not in GROUPS_LIST_OFFICIAL) and s not in leave_students]
withdrawn_count = len(withdrawn_students)

full  = sum(1 for s in official_students if s['status'] == 'full')
chala = sum(1 for s in official_students if s['status'] == 'chala')
yoq   = sum(1 for s in official_students if s['status'] == 'yoq')
id_cards = sum(1 for s in official_students if s['pass_type'] == 'ID-karta')
bio_pass = sum(1 for s in official_students if s['pass_type'] == 'Biometrik Pasport')

# Operator tasdiqlagan talabalar statistikasi (faqat rasmiy kontingent)
verified_count = sum(1 for s in official_students if s['verified'] == 'TASDIQLANDI')
pending_count  = official_total - verified_count

# Yo'nalishlar bo'yicha aniq statistika
hamshiralik_count = sum(1 for s in students if 'hamshira' in s['yon'].lower())
farmatsiya_count   = sum(1 for s in students if 'farmat' in s['yon'].lower())
feldsher_count     = sum(1 for s in students if ('feldsh' in s['yon'].lower() or 'davolash' in s['yon'].lower()))
hamshira_feldsher_count = hamshiralik_count + feldsher_count

# Guruhlar ro'yxati va rasmiy guruh rahbarlari
GROUPS_LIST = ["26-01", "26-02", "26-03", "26-04", "26-05", "26-06"]
GROUP_LEADERS = {
    "26-01": "Mirzayeva.D",
    "26-02": "Ochilov.D",
    "26-03": "A.Asraliyev",
    "26-04": "Xamdamova.M",
    "26-05": "Rayimova.X",
    "26-06": "Yuldashev.O",
    "26-07": "Asraliyev.A"
}
groups_count = {g: sum(1 for s in students if s['group'] == g) for g in GROUPS_LIST}
unassigned_count = withdrawn_count

# Guruhlar bo'yicha tasdiqlash monitoringi kartalari
group_titles_short = {
    "26-01": "Farmatsiya ishi",
    "26-02": "Hamshiralik ishi",
    "26-03": "Hamshiralik ishi",
    "26-04": "Hamshiralik ishi",
    "26-05": "Hamshiralik ishi",
    "26-06": "Hamshiralik ishi",
    "26-07": "Hamshiralik ishi"
}

# SVG Belgilar (Platformada umuman emojilar ishlatilmaydi, faqat SVG belgilardan foydalaniladi)
SVG_CALENDAR = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;display:inline-block;vertical-align:-2px;margin-right:4px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>'
SVG_AWARD = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;display:inline-block;vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>'
SVG_EDIT = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;display:inline-block;vertical-align:-2px;margin-right:4px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>'
SVG_ID_CARD = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:4px;"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle><line x1="15" y1="8" x2="17" y2="8"></line><line x1="15" y1="12" x2="17" y2="12"></line><line x1="7" y1="16" x2="17" y2="16"></line></svg>'
SVG_CHECK = '<svg class="svg-status svg-success" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
SVG_WARN  = '<svg class="svg-status svg-warning" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
SVG_CROSS = '<svg class="svg-status svg-danger" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
SVG_FILE  = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>'
SVG_LINK  = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>'
SVG_USER = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'
SVG_USERS = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'
SVG_BOOK = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>'
SVG_CHECK_CIRCLE = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" style="width:14px;height:14px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
SVG_CHECK_SM = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>'
SVG_CLOCK_SM = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>'
SVG_WARN_SM = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
SVG_CROSS_SM = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;margin-right:4px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
SVG_PHONE = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;display:inline-block;vertical-align:-2px;margin-right:4px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>'
SVG_EYE = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:4px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
SVG_CREST = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="width:22px;height:22px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>'
SVG_PHARMACY = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:6px;"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"></path><path d="m8.5 8.5 7 7"></path></svg>'
SVG_NURSING = '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:6px;"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>'

groups_stats_cards = []

# 1. Barchasi kartasi (Boshlang'ich tanlov)
v_total_all = verified_count
v_pct_all = round(v_total_all / total * 100) if total > 0 else 0
all_card_item = f'''
      <div class="grp-stat-card grp-stat-all active" id="grp-stat-card-all" onclick="filterByGroup('')" title="Barcha guruhlar talabalarini ko'rish uchun bosing">
        <div class="grp-selected-indicator">{SVG_CHECK_SM}Tanlangan</div>
        <div class="grp-stat-top">
          <span class="grp-stat-badge">Barcha Guruhlar</span>
          <span class="grp-stat-percent" id="grp-percent-all">{v_pct_all}%</span>
        </div>
        <div class="grp-stat-sub">7 ta guruh umumiy jurnali</div>
        <div class="grp-stat-leader">
          <span class="leader-icon">{SVG_USERS}</span> Barcha guruhlar
        </div>
        <div class="grp-stat-count">
          <strong id="grp-vcount-all">{v_total_all}</strong> / <span id="grp-total-all">{total}</span> tasdiqlandi
        </div>
        <div class="grp-stat-bar">
          <div class="grp-stat-bar-fill" id="grp-bar-all" style="width:{v_pct_all}%;"></div>
        </div>
      </div>'''
groups_stats_cards.append(all_card_item)

for g in GROUPS_LIST:
    g_total = groups_count.get(g, 0)
    g_verified = sum(1 for s in students if s['group'] == g and s['verified'] == 'TASDIQLANDI')
    g_percent = round((g_verified / g_total * 100)) if g_total > 0 else 0
    badge_bg = '#059669' if g == '26-01' else '#2563eb'
    completed_cls = ' grp-stat-completed' if (g_verified == g_total and g_total > 0) else ''
    g_title = group_titles_short.get(g, "Hamshiralik ishi")
    g_leader = GROUP_LEADERS.get(g, '—')

    card_item = f'''
      <div class="grp-stat-card{completed_cls}" id="grp-stat-card-{g}" onclick="filterByGroup('{g}')" title="Guruh {g} talabalarini ko'rish uchun bosing">
        <div class="grp-selected-indicator">{SVG_CHECK_SM}Tanlangan</div>
        <div class="grp-stat-top">
          <span class="grp-stat-badge" style="background:{badge_bg};">Guruh {g}</span>
          <span class="grp-stat-percent" id="grp-percent-{g}">{g_percent}%</span>
        </div>
        <div class="grp-stat-sub">{g_title}</div>
        <div class="grp-stat-leader">
          {SVG_USER} Rahbar: <strong class="leader-name">{g_leader}</strong>
        </div>
        <div class="grp-stat-count">
          <strong id="grp-vcount-{g}">{g_verified}</strong> / <span id="grp-total-{g}">{g_total}</span> tasdiqlandi
        </div>
        <div class="grp-stat-bar">
          <div class="grp-stat-bar-fill" id="grp-bar-{g}" style="width:{g_percent}%;"></div>
        </div>
      </div>'''
    groups_stats_cards.append(card_item)

groups_stats_cards_html = "\n".join(groups_stats_cards)

# 2. TALABALAR KONTINGENTI VA AKADEMIK TAQSIMOT BO'LIMI (TIBBIYOT PORTALI USLUBI)
kontingent_rows = []
for idx_g, g in enumerate(GROUPS_LIST, 1):
    cnt = groups_count.get(g, 0)
    g_ver = sum(1 for s in students if s['group'] == g and s['verified'] == 'TASDIQLANDI')
    g_pct = round(g_ver / cnt * 100) if cnt > 0 else 0
    leader = GROUP_LEADERS.get(g, '—')
    is_farmat = (g == '26-01')
    badge_cls = 'k-grp-badge-farm' if is_farmat else 'k-grp-badge-hamsh'
    badge_bg = '#059669' if is_farmat else '#2563eb'
    g_yon_short = "Farmatsiya ishi" if is_farmat else "Hamshiralik ishi"
    yon_icon = SVG_PHARMACY if is_farmat else SVG_NURSING

    # Progress ranglari (dashboard bilan to'liq uyg'un)
    if g_pct == 100:
        ver_status_cls = 'k-ver-completed'
        bar_bg = 'linear-gradient(90deg, #059669, #10b981)'
    elif g_pct >= 90:
        ver_status_cls = 'k-ver-near'
        bar_bg = 'linear-gradient(90deg, #0284c7, #38bdf8)'
    else:
        ver_status_cls = 'k-ver-pending'
        bar_bg = 'linear-gradient(90deg, #d97706, #f59e0b)'

    g_share = round(cnt / total * 100, 1) if total > 0 else 0
    k_row = f'''
            <tr class="kontingent-row" id="kontingent-row-{g}" onclick="filterByGroup('{g}')" title="Guruh {g} talabalarini ko'rish uchun bosing">
              <td class="td-tr" style="text-align:center;">
                <span class="k-num-badge">{idx_g}</span>
              </td>
              <td class="td-leader" style="font-weight:700;">
                <span class="leader-avatar">{SVG_USER}</span> {leader}
              </td>
              <td class="td-group" style="text-align:center;">
                <span class="k-grp-badge {badge_cls}" style="background:{badge_bg};">Guruh {g}</span>
              </td>
              <td class="td-yon" style="font-size:13px; font-weight:600;">
                <span class="k-yon-wrap">{yon_icon}<span>{g_yon_short}</span></span>
              </td>
              <td class="td-count" style="text-align:center;">
                <span class="k-count-pill"><strong id="kontingent-count-{g}">{cnt}</strong> nafar <span class="k-count-share">({g_share}%)</span></span>
              </td>
              <td class="td-ver" style="text-align:center;">
                <div class="k-ver-wrap">
                  <span id="kontingent-ver-{g}" class="k-ver-text {ver_status_cls}">{g_ver}/{cnt} ({g_pct}%)</span>
                  <div class="k-mini-bar"><div id="kontingent-bar-{g}" class="k-mini-bar-fill" style="width:{g_pct}%; background:{bar_bg};"></div></div>
                </div>
              </td>
              <td class="td-action" style="text-align:center;">
                <span class="k-action-btn">Saralash →</span>
              </td>
            </tr>'''
    kontingent_rows.append(k_row)

unassigned_disp = 'table-row' if unassigned_count > 0 else 'none'
unassigned_ver = sum(1 for s in students if (not s['group'] or s['group'] not in GROUPS_LIST) and s['verified'] == 'TASDIQLANDI')
unassigned_pct = round(unassigned_ver / unassigned_count * 100) if unassigned_count > 0 else 0
unassigned_share = round(unassigned_count / total * 100, 1) if total > 0 else 0
k_unassigned_row = f'''
            <tr class="kontingent-row kontingent-unassigned-row" id="kontingent-row-unassigned" onclick="filterByGroup('belgilanmagan')" title="N-guruh (noma'lum / taqsimlanmagan) talabalarni ko'rish uchun bosing" style="display:{unassigned_disp};">
              <td class="td-tr" style="text-align:center; font-weight:700; font-size:12.5px; color:#d97706;">•</td>
              <td class="td-leader" style="font-weight:700; color:#d97706;">
                <span class="leader-avatar">{SVG_WARN_SM}</span> Noma'lum / Biriktirilmagan
              </td>
              <td class="td-group" style="text-align:center;">
                <span class="k-grp-badge" style="background:#d97706;">N-Guruh</span>
              </td>
              <td class="td-yon td-yon-unassigned" style="font-size:13px; font-weight:600;">Tayinlanishi kutilmoqda</td>
              <td class="td-count" style="text-align:center;">
                <span class="k-count-pill k-count-pill-unassigned"><strong id="kontingent-count-unassigned">{unassigned_count}</strong> nafar <span class="k-count-share">({unassigned_share}%)</span></span>
              </td>
              <td class="td-ver" style="text-align:center;">
                <div class="k-ver-wrap">
                  <span id="kontingent-ver-unassigned" class="k-ver-text" style="color:#d97706;">{unassigned_ver}/{unassigned_count} ({unassigned_pct}%)</span>
                  <div class="k-mini-bar"><div id="kontingent-bar-unassigned" class="k-mini-bar-fill" style="width:{unassigned_pct}%; background:#d97706;"></div></div>
                </div>
              </td>
              <td class="td-action" style="text-align:center;">
                <span class="k-action-btn k-action-btn-unassigned">Saralash →</span>
              </td>
            </tr>'''

# N-Guruh qatori kontingent jadvaliga QO'SHILMAYDI (rasmiy emas)
# unassigned_row faqat texnik maqsadlar uchun qoldiriladi
# kontingent_rows.append(k_unassigned_row)  <- ataylab o'chirilgan


kontingent_rows_html = "\n".join(kontingent_rows)

kontingent_panel_html = f'''
    <!-- Talabalar Kontingenti va Guruh Rahbarlari Bo'limi (Tibbiyot Texnikumi Portali) -->
    <div class="kontingent-panel">
      <!-- Panel Header & KPI Badges -->
      <div class="kontingent-header">
        <div style="display:flex; align-items:center; gap:14px;">
          <div class="k-crest-box">
            {SVG_CREST}
          </div>
          <div>
            <div class="kontingent-title">
              Talabalar Kontingenti va Guruh Rahbarlari
            </div>
            <div class="kontingent-subtitle">
              Shahrisabz Tibbiyot Texnikumi rasmiy akademik taqsimoti &bull; Istalgan guruh qatorini bosib filtrlashingiz mumkin
            </div>
          </div>
        </div>
        <!-- Yuqori ko'rsatkichlar & Eksport -->
        <div class="kontingent-header-pills">
          <span class="k-header-pill k-header-pill-accreditation">Rasmiy Kontingent: 2026/2027</span>
          <span class="k-header-pill">{SVG_USERS} Jami: <strong id="k-header-total">{official_total}</strong> nafar talaba</span>
          <span class="k-header-pill">{SVG_BOOK} <strong>7</strong> ta akademik guruh</span>
          <span class="k-header-pill">{SVG_USER} <strong>7</strong> nafar guruh rahbari</span>
          <span class="k-header-pill k-header-pill-success">{SVG_CHECK_CIRCLE} <strong id="k-header-verified">{verified_count}</strong> ta tasdiqlangan</span>
          <button type="button" class="k-header-pill k-header-pill-export" onclick="exportAllGroupsMultiSheetExcel()" title="Barcha 7 ta guruhni 7 ta alohida varaq bilan bitta Excel qilib yuklash">
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Excel Eksport (.xlsx)
          </button>
          <button type="button" class="k-header-pill k-header-pill-telegram" onclick="openSendTelegramModal()" title="Har bir guruh ro'yxatini Telegram'ga yuborish">
            <svg class="svg-icon" viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
            Telegramga Yuborish
          </button>
        </div>
      </div>

      <!-- Rasmiy Kontingent Jadvali (Variant 5 Uslubi - Spaced Separated Rows) -->
      <div class="kontingent-table-card">
        <div class="kontingent-table-wrap">
          <table class="kontingent-table">
            <thead>
              <tr>
                <th style="width:55px; text-align:center;">№</th>
                <th style="text-align:left; min-width:220px;">Mas'ul murabbiy</th>
                <th style="text-align:center; width:130px;">Akademik guruh</th>
                <th style="text-align:left; min-width:200px;">Ixtisoslik (Yo'nalishi)</th>
                <th style="text-align:center; width:170px;">Talabalar soni</th>
                <th style="text-align:center; width:200px;">Hujjatlar tasdig'i</th>
                <th style="text-align:center; width:130px;">Harakat</th>
              </tr>
            </thead>
            <tbody>
{kontingent_rows_html}
            </tbody>
            <tfoot>
              <tr class="kontingent-footer" onclick="filterByGroup('')" title="Barcha talabalarni ko'rish uchun bosing">
                <td class="td-jami-label" colspan="4">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-weight:800; letter-spacing:0.5px;">JAMI TALABALAR KONTINGENTI</span>
                    <span style="font-size:11.5px; opacity:0.75; font-weight:600;">(7 ta akademik guruh)</span>
                  </div>
                </td>
                <td class="td-jami-count" style="text-align:center;">
                  <span class="k-count-pill k-count-pill-total"><strong id="kontingent-count-total">{official_total}</strong> nafar (100%)</span>
                </td>
                <td class="td-jami-ver" style="text-align:center;">
                  <strong id="kontingent-ver-total">{verified_count} / {official_total} ({round(verified_count/official_total*100, 1) if official_total else 0}%)</strong>
                </td>
                <td class="td-jami-action" style="text-align:center;">
                  <span class="k-action-btn k-action-btn-all">Barchasi →</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
'''

def format_pass_display(val):
    if not val:
        return '<span style="color:#ef4444;font-weight:700;">—</span>'
    s = str(val).strip().upper()
    return f'<span class="mono-pass">{s}</span>'

def format_pinfl_display(val):
    if not val:
        return '<span style="color:#ef4444;font-weight:700;">—</span>'
    s = re.sub(r'\D', '', str(val).strip())
    if len(s) == 14:
        p1, p2, p3 = s[0:6], s[6:10], s[10:14]
        return (f'<span class="pinfl-group">{p1}</span>'
                f'<span class="pinfl-group">{p2}</span>'
                f'<span class="pinfl-group pinfl-end">{p3}</span>')
    return f'<span class="mono-pinfl">{s}</span>'

def format_doc_display(val):
    if not val:
        return '<span style="color:#ef4444;font-weight:700;">—</span>'
    s = str(val).strip().upper()
    return f'<span class="mono-doc">{s}</span>'

# Pre-render rows & cards
table_rows = []
card_rows = []
for idx, s in enumerate(students, 1):
    status_icon = SVG_CHECK if s['status'] == 'full' else (SVG_WARN if s['status'] == 'chala' else SVG_CROSS)
    
    pass_type_tag = ''
    pass_badge = ''
    if s['pass_type'] == 'ID-karta':
        pass_type_tag = '<span class="sub-pill">ID</span>'
        pass_badge = '<span class="badge badge-id">ID-karta</span>'
    elif s['pass_type'] == 'Biometrik Pasport':
        pass_type_tag = '<span class="sub-pill">Bio</span>'
        pass_badge = '<span class="badge badge-bio">Biometrik</span>'
    else:
        pass_badge = '<span class="badge badge-none">Yo\'q</span>'
        
    if s['doc_file']:
        file_btn_mini = f'''<button type="button" class="btn-file-mini btn-file-has" onclick="openStudentModal({idx-1})" title="{s['doc_file']}">{SVG_FILE} docx</button>'''
    else:
        file_btn_mini = f'''<button type="button" class="btn-file-mini btn-file-none" onclick="openStudentModal({idx-1})" title="Fayl biriktirish">{SVG_FILE} +</button>'''
        
    qr_mini_btn = f'''<a href="{s['sh_qr']}" target="_blank" class="mini-qr-link" title="QR PDF ochish">{SVG_LINK}</a>''' if s.get('sh_qr') else ''

    pinfl_html = format_pinfl_display(s['pinfl'])
    pv_html = format_pass_display(s['pv'])
    sh_html = format_doc_display(s['sh_doc'])

    clean_fish = s['fish'] or f"{s['ism']} {s['ota']}".strip()
    is_withdrawn = is_withdrawn_group(s['group']) or (s['group'] not in GROUPS_LIST)
    if is_withdrawn:
        grp_name = "Safdan chiqarilgan"
        grp_clean = "withdrawn"
        grp_class = "grp-withdrawn"
    else:
        grp_name = s['group'] or "Noma'lum"
        grp_clean = s['group'].replace('-', '').lower() if s['group'] else 'n'
        grp_class = f"grp-{grp_clean}"

    # Operator Tasdig'i (Ixcham tugmalar)
    if s['verified'] == 'TASDIQLANDI':
        c_verified_badge = f'<span class="c-badge c-badge-verified" id="vbadge-card-{idx-1}">{SVG_CHECK_SM}TASDIQLANDI</span>'
        c_verify_btn = f'''<button type="button" class="btn-verify btn-verified" id="vbtn-card-{idx-1}" onclick="toggleStudentVerification({idx-1}, {s['row']})" title="Tasdiqni bekor qilish">{SVG_CHECK_SM}Tasdiqlangan</button>'''
        table_v_btn = f'''<button type="button" class="btn-v-mini btn-v-ok" id="vbtn-row-{idx-1}" onclick="toggleStudentVerification({idx-1}, {s['row']})" title="Tasdiqlangan. Bekor qilish uchun bosing">{SVG_CHECK_SM} OK</button>'''
    else:
        c_verified_badge = f'<span class="c-badge c-badge-pending" id="vbadge-card-{idx-1}">{SVG_CLOCK_SM}KUTILMOQDA</span>'
        c_verify_btn = f'''<button type="button" class="btn-verify btn-verify-action" id="vbtn-card-{idx-1}" onclick="toggleStudentVerification({idx-1}, {s['row']})" title="Ushbu talaba ma'lumotlarini to'g'ri deb tasdiqlash">{SVG_CHECK_SM}Ma'lumotlar to'g'ri</button>'''
        table_v_btn = f'''<button type="button" class="btn-v-mini btn-v-wait" id="vbtn-row-{idx-1}" onclick="toggleStudentVerification({idx-1}, {s['row']})" title="Ushbu talabani to'g'ri deb tasdiqlash">{SVG_CLOCK_SM} Kutilmoqda</button>'''

    # Jadval Qatori (Minimalist va Bir oynaga to'liq sig'adigan)
    row_html = f'''<tr class="student-row" id="student-row-{idx-1}"
      data-shnum="{s['shnum'].lower()}"
      data-name="{clean_fish.lower()}"
      data-group="{s['group'].lower()}"
      data-pass="{s['pv'].lower()}"
      data-passtype="{s['pass_type']}"
      data-pinfl="{s['pinfl']}"
      data-dob="{s['dob']} {s['ber']}"
      data-doc="{s['sh_doc'].lower()}"
      data-doctype="{s['doc_tur']}"
      data-mak="{s['mak'].lower()}"
      data-yil="{s['yil']}"
      data-yon="{s['yon'].lower()}"
      data-status="{s['status']}"
      data-file="{s['doc_file'].lower()}"
      data-verified="{s['verified'].lower()}">
      
      <td style="text-align:center;font-weight:700;color:#94a3b8;">{idx}</td>
      <td style="text-align:center;white-space:nowrap;">
        <span class="table-group-badge {grp_class}">{grp_name}</span>
      </td>
      <td style="text-align:center;white-space:nowrap;">
        <span class="shnum-clean" onclick="openStudentModal({idx-1})" title="Talaba oynasini ochish">#{s['shnum'] or '—'}</span>
      </td>
      <td style="cursor:pointer;" onclick="openStudentModal({idx-1})" title="Talaba ma'lumotlarini ko'rish / Fayl biriktirish">
        <div class="student-name">{clean_fish}</div>
      </td>
      <td style="white-space:nowrap;">
        {pv_html}{pass_type_tag}
      </td>
      <td style="white-space:nowrap;text-align:center;">
        {pinfl_html}
      </td>
      <td style="white-space:nowrap;text-align:center;">
        <span class="clean-dob">{s['dob'] or '—'}</span>
      </td>
      <td style="white-space:nowrap;">
        {sh_html}{qr_mini_btn}
      </td>
      <td>
        <div class="cell-school" title="{s['mak'] or '—'}">{s['mak'] or '—'}</div>
      </td>
      <td style="text-align:center;font-weight:700;font-size:12px;color:inherit;">{s['yil'] or '—'}</td>
      <td style="text-align:center;white-space:nowrap;">{file_btn_mini}</td>
      <td style="text-align:center;white-space:nowrap;">{table_v_btn}</td>
      <td style="text-align:center;">{status_icon}</td>
    </tr>'''
    table_rows.append(row_html)

    # Karta Ko'rinishi (Student Card - Dropdownli va Zamonaviy)
    if s['status'] == 'full':
        c_status_badge = f'''<span class="c-badge c-badge-full">{SVG_CHECK_SM}TO'LIQ TOPILDI</span>'''
    elif s['status'] == 'chala':
        c_status_badge = f'''<span class="c-badge c-badge-chala">{SVG_WARN_SM}QISMAN TOPILDI</span>'''
    else:
        c_status_badge = f'''<span class="c-badge c-badge-yoq">{SVG_CROSS_SM}FAYL YO'Q</span>'''

    card_qr_btn = f'''<a href="{s['sh_qr']}" target="_blank" class="btn-action btn-qr" style="display:inline-flex;padding:5px 12px;font-size:12px;" title="Rasmiy e-shahodatnoma PDF">{SVG_LINK} QR PDF ochish</a>''' if s['sh_qr'] else ''
    card_verified_class = " card-verified" if s['verified'] == 'TASDIQLANDI' else ""

    dob_badge = f'''<span class="card-meta-pill" title="Tug\'ilgan sana">{SVG_CALENDAR} {s.get("dob", "") or "—"}</span>''' if s.get('dob') else ''
    tel_badge = f'''<span class="card-meta-pill" title="Telefon raqami">{SVG_PHONE} {s.get("tel", "")}</span>''' if s.get('tel') else ''
    file_pill = f'''<span class="card-meta-pill file-pill" onclick="openStudentModal({idx-1})" title="{s['doc_file'] or 'Fayl biriktirilmagan'}">{SVG_FILE} {s['doc_file'] or 'Fayl biriktirilmagan'}</span>'''

    school_name = s['mak'] or "Ma'lumot kiritilmagan"
    doc_file_name = s['doc_file'] or "Fayl yo'q"

    card_html = f'''<div class="student-card{card_verified_class}" id="student-card-{idx-1}"
      data-shnum="{s['shnum'].lower()}"
      data-name="{clean_fish.lower()}"
      data-group="{s['group'].lower()}"
      data-pass="{s['pv'].lower()}"
      data-passtype="{s['pass_type']}"
      data-pinfl="{s['pinfl']}"
      data-dob="{s['dob']} {s['ber']}"
      data-doc="{s['sh_doc'].lower()}"
      data-doctype="{s['doc_tur']}"
      data-mak="{s['mak'].lower()}"
      data-yil="{s['yil']}"
      data-yon="{s['yon'].lower()}"
      data-status="{s['status']}"
      data-file="{s['doc_file'].lower()}"
      data-verified="{s['verified'].lower()}">
      
      <!-- 1. Karta Header: T/R, Yuqorida Guruhi, Shartnoma raqami, Holati -->
      <div class="card-header">
        <div class="card-header-left">
          <span class="card-tr-badge">#{idx}</span>
          <span class="card-group-badge {grp_class}">{grp_name}</span>
          <span class="card-shnum-pill" onclick="openStudentModal({idx-1})" title="Talaba oynasini ochish">Shartnoma #{s['shnum'] or '—'}</span>
        </div>
        <div class="card-header-right">
          {c_verified_badge}
          {c_status_badge}
        </div>
      </div>

      <!-- 2. Karta Doimiy Ko'rinadigan Qismi: Yagona F.I.SH va Meta Ma'lumotlar -->
      <div class="card-main-info">
        <div class="card-student-name" onclick="openStudentModal({idx-1})" title="Talaba oynasini ochish / tahrirlash">
          {clean_fish}
        </div>
        <div class="card-meta-tags">
          {dob_badge}
          {tel_badge}
          {file_pill}
        </div>

        <!-- 3. Dropdown Ochish / Yopish Tugmasi -->
        <button type="button" class="card-dropdown-btn" id="btn-toggle-{idx-1}" onclick="toggleCardDetails({idx-1})" title="Pasport va ta'lim hujjatlari ma'lumotlarini ko'rish / yopish">
          <span class="btn-text">
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle><line x1="15" y1="8" x2="17" y2="8"></line><line x1="15" y1="12" x2="17" y2="12"></line><line x1="7" y1="16" x2="17" y2="16"></line></svg>
            Pasport & Ta'lim Hujjatlari Tafsilotlari
          </span>
          <span class="btn-chevron" id="toggle-icon-{idx-1}">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </span>
        </button>
      </div>

      <!-- 4. Dropdown Ichidagi To'liq Ma'lumotlar Konteyneri -->
      <div class="card-dropdown-details" id="card-details-{idx-1}" style="display:none;">
        <div class="card-columns-2">
          
          <div class="card-box card-box-passport">
            <div class="box-title">
              <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle><line x1="15" y1="8" x2="17" y2="8"></line><line x1="15" y1="12" x2="17" y2="12"></line><line x1="7" y1="16" x2="17" y2="16"></line></svg>
              PASPORT VA JSHSHIR (PINFL)
            </div>
            <div class="pass-info-list">
              <div class="pass-row">
                <span class="pass-label">Pasport / ID:</span>
                <div style="display:flex; align-items:center; gap:8px;">
                  <strong class="pass-number-large">{format_pass_display(s['pv'])}</strong>
                  {pass_badge}
                </div>
              </div>
              <div class="pass-row">
                <span class="pass-label">JShShIR (PINFL):</span>
                <strong class="pinfl-number-large">{format_pinfl_display(s['pinfl'])}</strong>
              </div>
              <div class="pass-row">
                <span class="pass-label">Tug'ilgan sana (DOB):</span>
                <strong class="date-large">{s['dob'] or '—'}</strong>
              </div>
              <div class="pass-row">
                <span class="pass-label">Pasport berilgan sana:</span>
                <strong class="date-medium">{s['ber'] or '—'}</strong>
              </div>
            </div>
          </div>

          <div class="card-box card-box-doc">
            <div class="box-title">
              <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>
              TA'LIM HUJJATI (SHAHODATNOMA / DIPLOM)
            </div>
            <div class="doc-info-list">
              <div class="doc-row">
                <span class="doc-label">Hujjat Raqami:</span>
                <div style="display:flex; align-items:center; gap:8px;">
                  <strong class="doc-number-large">{format_doc_display(s['sh_doc'])}</strong>
                  <span class="doc-type-pill">{s['doc_tur']}</span>
                </div>
              </div>
              <div class="doc-row">
                <span class="doc-label">Tugatgan Muassasasi:</span>
                <span class="doc-school-text">{school_name}</span>
              </div>
              <div class="doc-row">
                <span class="doc-label">Bitirgan yili:</span>
                <strong class="doc-year-badge">{s['yil'] or '—'}-yil</strong>
              </div>
              {f'<div class="doc-row" style="margin-top:6px;">{card_qr_btn}</div>' if s['sh_qr'] else ''}
            </div>
          </div>

        </div>

        <!-- Dropdown Footer: Tugmalar (Tahrirlash va Tasdiqlash) -->
        <div class="card-footer">
          <div class="card-footer-left">
            <span class="contact-label">{SVG_FILE} Fayl:</span>
            <span class="file-name-pill" title="{s['doc_file']}">{doc_file_name}</span>
          </div>
          <div class="card-footer-right" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            {c_verify_btn}
            <button type="button" class="btn-card-action btn-card-update" onclick="openStudentModal({idx-1}, true)" title="Ma'lumotlarni va guruhni tahrirlash (ichidan almashtirish)">
              {SVG_EDIT} Tahrirlash
            </button>
            <button type="button" class="btn-card-action" onclick="openStudentModal({idx-1}, false)" title="Hujjat rasmlarini ko'rish">
              {SVG_EYE} Rasmlar
            </button>
          </div>
        </div>

      </div>
    </div>'''
    card_rows.append(card_html)

tbody_content = "\n".join(table_rows)
cards_content = "\n".join(card_rows)
students_json = json.dumps(students, ensure_ascii=False)

# Save full JSON database (talabalar_bazasi.json) for daily 18:00 Telegram Bot backup
json_db_path = os.path.join(BASE_DIR, 'data', 'talabalar_bazasi.json')
try:
    with open(json_db_path, 'w', encoding='utf-8') as jf:
        json.dump({
            'updated_at': __import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'total_students': len(students),
            'students': students
        }, jf, ensure_ascii=False, indent=2)
except Exception as e:
    print(f"[OGOHLANTIRISH] talabalar_bazasi.json saqlanmadi: {e}")

# Read JS code
with open(JS_SRC, 'r', encoding='utf-8') as f:
    js_code = f.read()

# Copy JS to qayta_tekshiruv/js/app.js
q_js_dir = os.path.join(BASE_DIR, 'qayta_tekshiruv', 'js')
os.makedirs(q_js_dir, exist_ok=True)
shutil.copy2(JS_SRC, os.path.join(q_js_dir, 'app.js'))

html = f"""<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Talabalar Shartnomalari & Akademik Guruhlar Portali</title>
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="alternate icon" type="image/png" href="favicon.png">
<link rel="shortcut icon" href="favicon.ico">
<link rel="apple-touch-icon" href="favicon.png">
<meta name="theme-color" content="#091428">
<script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  :root {{
    --primary: #0f172a;
    --primary-light: #1e293b;
    --accent: #2563eb;
    --accent-hover: #1d4ed8;
    --success: #10b981;
    --warning: #f59e0b;
    --danger: #ef4444;
    --bg: #f8fafc;
    --card: #ffffff;
    --border: #e2e8f0;
    --border-hover: #cbd5e1;
    --text-main: #0f172a;
    --text-muted: #64748b;
  }}

  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: 'Plus Jakarta Sans', sans-serif;
    background: var(--bg);
    background-image: radial-gradient(#e2e8f0 1px, transparent 1px);
    background-size: 28px 28px;
    color: var(--text-main);
    line-height: 1.5;
    font-size: 13px;
    -webkit-font-smoothing: antialiased;
  }}

  .container {{ max-width: 1780px; margin: 0 auto; padding: 24px 20px; }}

  /* SVG Ikonkalar */
  .svg-icon {{
    width: 16px; height: 16px; vertical-align: -3px; display: inline-block; stroke-width: 2; flex-shrink: 0;
  }}
  .svg-status {{
    width: 20px; height: 20px; vertical-align: middle; display: inline-block;
  }}

  /* Top Navigation & Header */
  .header {{
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
    color: white;
    padding: 22px 30px;
    border-radius: 20px;
    box-shadow: 0 10px 30px -5px rgba(15, 23, 42, 0.35);
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    position: relative;
    overflow: hidden;
  }}
  .header::after {{
    display: none;
  }}
  .brand-header-flex {{
    display: flex;
    align-items: center;
    gap: 16px;
  }}
  .brand-logo-wrap {{
    width: 54px;
    height: 54px;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.25), rgba(16, 185, 129, 0.2));
    border: 1.5px solid rgba(56, 189, 248, 0.45);
    box-shadow: 0 8px 24px rgba(37, 99, 235, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: transform 0.25s ease, box-shadow 0.25s ease;
  }}
  .brand-logo-wrap:hover {{
    transform: scale(1.06) rotate(2deg);
    box-shadow: 0 12px 30px rgba(56, 189, 248, 0.55);
  }}
  .brand-logo-img {{
    width: 44px;
    height: 44px;
    border-radius: 10px;
    object-fit: contain;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.4));
  }}
  .brand-subtitle {{
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #38bdf8;
    margin-bottom: 3px;
  }}
  .header h1 {{
    font-size: 23px; font-weight: 800; display: flex; align-items: center; gap: 12px; letter-spacing: -0.5px; margin: 0;
  }}
  .header p {{ color: #94a3b8; font-size: 13px; margin-top: 4px; font-weight: 500; display: flex; align-items: center; gap: 8px; }}

  .pulse-dot {{
    width: 8px; height: 8px; background: #10b981; border-radius: 50%; display: inline-block;
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); animation: pulseGreen 2s infinite;
  }}
  @keyframes pulseGreen {{
    0% {{ box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }}
    70% {{ box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }}
    100% {{ box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }}
  }}

  .header-actions {{ display: flex; gap: 10px; align-items: center; z-index: 2; }}
  
  /* =========================================================================
     ZAMONAVIY PILL BUTTONS DIZAYN TIZIMI (Primary, Secondary, Tertiary, Ghost)
     ========================================================================= */
  .btn {{
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 7px 20px; border-radius: 9999px; font-weight: 600; font-size: 13px;
    line-height: 1.3; cursor: pointer;
    text-decoration: none; user-select: none;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    outline: none;
    /* Standart: Secondary (Oq fon, to'q matn, nozik chegara, yumshoq soya) */
    background: #ffffff; color: #0f172a;
    border: 1.5px solid #e2e8f0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }}
  .btn:hover {{
    background: #ffffff;
    border-color: #cbd5e1;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
    transform: translateY(-1.5px);
  }}
  .btn:active {{
    transform: scale(0.97);
    border-color: #2563eb;
    color: #2563eb;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }}
  .btn:disabled, .btn[disabled] {{
    opacity: 0.45; cursor: not-allowed; pointer-events: none;
    box-shadow: none !important; transform: none !important;
  }}

  /* 1. PRIMARY BUTTONS (Yorqin rang, yumshoq pastki soya, oq matn) */
  .btn-primary, .btn-export {{
    background: #2563eb; color: #ffffff !important;
    border: 1.5px solid #2563eb;
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
  }}
  .btn-primary:hover, .btn-export:hover {{
    background: #1d4ed8; border-color: #1d4ed8;
    box-shadow: 0 6px 20px rgba(37, 99, 235, 0.42);
    transform: translateY(-1.5px);
  }}
  .btn-primary:active, .btn-export:active {{
    background: #1e40af; border-color: #1e40af;
    transform: scale(0.97);
  }}

  /* Primary Green: Talaba qo'shish va Saqlash */
  .btn-add, .btn-save-data, .btn-modal-save {{
    background: #10b981; color: #ffffff !important;
    border: 1.5px solid #10b981;
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);
  }}
  .btn-add:hover, .btn-save-data:hover, .btn-modal-save:hover {{
    background: #059669; border-color: #059669;
    box-shadow: 0 6px 20px rgba(16, 185, 129, 0.42);
    transform: translateY(-1.5px);
  }}
  .btn-add:active, .btn-save-data:active, .btn-modal-save:active {{
    background: #047857; border-color: #047857;
    transform: scale(0.97);
  }}

  /* Primary Purple: Barcha .xlsx va AI tahlil */
  .btn-multi-export, .btn-ai-purple, .btn-ai-reanalyze {{
    background: #8b5cf6; color: #ffffff !important;
    border: 1.5px solid #8b5cf6;
    box-shadow: 0 2px 6px rgba(139, 92, 246, 0.25);
  }}
  .btn-multi-export:hover, .btn-ai-purple:hover, .btn-ai-reanalyze:hover {{
    background: #7c3aed; border-color: #7c3aed;
    box-shadow: 0 6px 20px rgba(139, 92, 246, 0.42);
    transform: translateY(-1.5px);
  }}
  .btn-multi-export:active, .btn-ai-purple:active, .btn-ai-reanalyze:active {{
    background: #6d28d9; border-color: #6d28d9;
    transform: scale(0.97);
  }}

  /* Primary Blue (AI) */
  .btn-ai-blue {{
    background: #0ea5e9; color: #ffffff !important;
    border: 1.5px solid #0ea5e9;
    box-shadow: 0 2px 6px rgba(14, 165, 233, 0.25);
  }}
  .btn-ai-blue:hover {{
    background: #0284c7; border-color: #0284c7;
    box-shadow: 0 6px 20px rgba(14, 165, 233, 0.42);
    transform: translateY(-1.5px);
  }}
  .btn-ai-blue:active {{
    background: #0369a1; border-color: #0369a1;
    transform: scale(0.97);
  }}

  /* Telegram tugmasi */
  .btn-telegram {{
    background: #0284c7; color: #ffffff !important;
    border: 1.5px solid #0284c7;
    box-shadow: 0 2px 6px rgba(2, 132, 199, 0.25);
  }}
  .btn-telegram:hover {{
    background: #0369a1; border-color: #0369a1;
    box-shadow: 0 6px 20px rgba(2, 132, 199, 0.42);
    transform: translateY(-1.5px);
  }}
  .btn-telegram:active {{
    background: #075985; border-color: #075985;
    transform: scale(0.97);
  }}

  .k-header-pill-telegram {{
    background: #0284c7 !important;
    color: #ffffff !important;
    border-color: #0284c7 !important;
    cursor: pointer;
  }}
  .k-header-pill-telegram:hover {{
    background: #0369a1 !important;
    border-color: #0369a1 !important;
    box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
  }}

  /* Primary Red: PDF va O'chirish */
  .btn-danger, .btn-pdf {{
    background: #ef4444; color: #ffffff !important;
    border: 1.5px solid #ef4444;
    box-shadow: 0 2px 6px rgba(239, 68, 68, 0.25);
  }}
  .btn-danger:hover, .btn-pdf:hover {{
    background: #dc2626; border-color: #dc2626;
    box-shadow: 0 6px 20px rgba(239, 68, 68, 0.42);
    transform: translateY(-1.5px);
  }}
  .btn-danger:active, .btn-pdf:active {{
    background: #b91c1c; border-color: #b91c1c;
    transform: scale(0.97);
  }}

  /* 2. GHOST BUTTONS (Outline, transparent fon, yorqin chegara) */
  .btn-ghost {{
    background: transparent; color: #2563eb;
    border: 1.5px solid #2563eb;
  }}
  .btn-ghost:hover {{
    background: rgba(37, 99, 235, 0.08);
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.2);
    transform: translateY(-1.5px);
  }}
  .btn-ghost:active {{
    background: rgba(37, 99, 235, 0.16);
    border-color: #1d4ed8; color: #1d4ed8;
    transform: scale(0.97);
  }}

  /* Header ichidagi tugmalar (Refresh & Theme Toggle) */
  .btn-refresh, .btn-theme {{
    background: rgba(255, 255, 255, 0.12); color: #ffffff !important;
    border: 1.5px solid rgba(255, 255, 255, 0.25);
    backdrop-filter: blur(8px);
  }}
  .btn-refresh:hover, .btn-theme:hover {{
    background: rgba(255, 255, 255, 0.24);
    border-color: rgba(255, 255, 255, 0.45);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
    transform: translateY(-1.5px);
  }}
  .btn-refresh:active, .btn-theme:active {{
    background: rgba(255, 255, 255, 0.35);
    transform: scale(0.97);
  }}

  /* QO'LDA SAQLASH TUGMASI
     Oddiy holatda ko'k, saqlanmagan o'zgarish bo'lsa sariq va
     "nafas oladi" (diqqatni tortadi), yuborilayotganda ko'k-moviy. */
  body .btn.btn-save-now,
  body.dark-mode .btn.btn-save-now {{
    background: linear-gradient(135deg, #2563eb, #1d4ed8) !important; color: #ffffff !important;
    border: 1.5px solid rgba(255, 255, 255, 0.25);
  }}
  body .btn.btn-save-now:hover,
  body.dark-mode .btn.btn-save-now:hover {{
    background: linear-gradient(135deg, #1d4ed8, #1e40af) !important;
    box-shadow: 0 6px 18px rgba(37, 99, 235, 0.45);
    transform: translateY(-1.5px);
  }}
  body .btn.btn-save-now:active,
  body.dark-mode .btn.btn-save-now:active {{ transform: scale(0.97); }}

  body .btn.btn-save-now.has-pending,
  body.dark-mode .btn.btn-save-now.has-pending {{
    background: linear-gradient(135deg, #f59e0b, #d97706) !important;
    animation: saveNowPulse 1.8s ease-in-out infinite;
  }}
  body .btn.btn-save-now.has-pending:hover,
  body.dark-mode .btn.btn-save-now.has-pending:hover {{
    background: linear-gradient(135deg, #d97706, #b45309) !important;
    box-shadow: 0 6px 18px rgba(245, 158, 11, 0.5);
  }}
  body .btn.btn-save-now.is-saving,
  body.dark-mode .btn.btn-save-now.is-saving {{
    background: linear-gradient(135deg, #38bdf8, #0284c7) !important;
    cursor: progress;
  }}
  body .btn.btn-save-now:disabled,
  body.dark-mode .btn.btn-save-now:disabled {{ opacity: 0.85; transform: none; }}

  @keyframes saveNowPulse {{
    0%, 100% {{ box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.55); }}
    50% {{ box-shadow: 0 0 0 7px rgba(245, 158, 11, 0); }}
  }}
  @media (prefers-reduced-motion: reduce) {{
    .btn-save-now.has-pending {{ animation: none; }}
  }}

  /* 3. TERTIARY BUTTONS (Faqat matn va belgi) */
  .btn-tertiary {{
    background: transparent; color: #2563eb;
    border: 1.5px solid transparent; padding: 6px 14px;
    box-shadow: none;
  }}
  .btn-tertiary:hover {{
    background: rgba(37, 99, 235, 0.08);
    color: #1d4ed8; transform: translateY(-1px);
    box-shadow: none;
  }}
  .btn-tertiary:active {{
    background: rgba(37, 99, 235, 0.15);
    transform: scale(0.97);
  }}

  /* ASOSIY 2 TA REJIM SWITCH TABS */
  .view-switcher-bar {{
    display: flex; justify-content: space-between; align-items: center;
    background: #fff; border: 1px solid var(--border); border-radius: 16px;
    padding: 10px 16px; margin-bottom: 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.02);
    flex-wrap: wrap; gap: 12px;
    position: -webkit-sticky;
    position: sticky;
    top: 0;
    z-index: 1100;
  }}
  .view-switch-btns {{
    display: flex; gap: 8px;
  }}
  .view-btn {{
    padding: 8px 22px; border-radius: 9999px; font-weight: 700; font-size: 13px;
    border: 1.5px solid #cbd5e1; background: #ffffff; color: #475569; cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); display: inline-flex; align-items: center; gap: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }}
  .view-btn.active {{
    background: #2563eb; color: #fff; border-color: #2563eb;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
  }}
  .view-btn:hover:not(.active) {{
    background: #ffffff; border-color: #94a3b8; color: #0f172a;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
    transform: translateY(-1px);
  }}
  .view-btn:active {{
    transform: scale(0.97);
  }}

  /* Guruh Dropdown (Select) Jadval Ichida */
  .group-select {{
    padding: 4px 8px; border-radius: 8px; font-size: 12px; font-weight: 800;
    border: 1.5px solid #bfdbfe; background: #eff6ff; color: #1d4ed8;
    outline: none; cursor: pointer; transition: all 0.15s; font-family: inherit;
  }}
  .group-select:focus {{
    border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.2);
  }}

  /* Guruhlar Navigatsiya Paneli (Group Tabs) */
  .group-nav-container {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 12px 18px;
    margin-bottom: 20px;
    box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.03);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }}
  .group-tabs {{
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
  }}
  .group-tab-btn {{
    background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0;
    padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 700;
    cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 6px;
  }}
  .group-tab-btn:hover {{
    background: #e2e8f0; color: #0f172a; transform: translateY(-1px);
  }}
  .group-tab-btn.active {{
    background: #0f172a; color: #ffffff; border-color: #0f172a;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25);
  }}
  .group-tab-btn.tab-farmat.active {{
    background: #059669; border-color: #059669; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3);
  }}

  /* Modern Statistika Dashboard Grid */
  .stats-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 16px;
    margin-bottom: 20px;
  }}
  .stat-card {{
    background: var(--card);
    border-radius: 16px;
    padding: 16px 20px;
    box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.04);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }}
  .stat-card::before {{
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px;
  }}
  .stat-total::before {{ background: #3b82f6; }}
  .stat-hamshira::before {{ background: #0284c7; }}
  .stat-farmat::before {{ background: #10b981; }}
  .stat-full::before {{ background: #059669; }}
  .stat-id::before {{ background: #6366f1; }}

  .stat-card .val {{ font-size: 28px; font-weight: 800; line-height: 1.1; margin: 6px 0 3px 0; letter-spacing: -1px; }}
  .stat-card .lbl {{ font-size: 11.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px; }}
  
  .stat-total .val {{ color: #2563eb; }}
  .stat-hamshira .val {{ color: #0284c7; }}
  .stat-farmat .val {{ color: #059669; }}
  .stat-full .val {{ color: #10b981; }}
  .stat-id .val {{ color: #4f46e5; }}

  .stat-clickable {{ cursor: pointer; }}
  .stat-clickable:hover {{
    transform: translateY(-4px);
    box-shadow: 0 12px 28px -4px rgba(15, 23, 42, 0.08);
    border-color: #cbd5e1;
  }}

  /* Modern Filtrlar Paneli (Yuqorida Qotib Turuvchi - Sticky) */
  .filter-panel {{
    position: -webkit-sticky;
    position: sticky;
    top: 8px;
    z-index: 1000;
    background: rgba(255, 255, 255, 0.98);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1.5px solid #cbd5e1;
    border-radius: 16px;
    padding: 14px 18px;
    margin-bottom: 20px;
    box-shadow: 0 10px 25px -4px rgba(15, 23, 42, 0.1), 0 4px 6px -2px rgba(15, 23, 42, 0.05);
    transition: box-shadow 0.2s ease;
  }}
  .filter-row {{
    display: flex; gap: 14px; flex-wrap: wrap; align-items: center;
  }}
  .filter-group {{
    display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 160px;
  }}
  .filter-group label {{
    font-size: 11.5px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;
  }}
  .filter-input, .filter-select {{
    width: 100%; padding: 8px 12px; border-radius: 10px;
    border: 1px solid #cbd5e1; font-size: 12.5px; font-family: inherit; outline: none;
    transition: all 0.2s ease; background: #fff; color: #0f172a; font-weight: 500;
  }}
  .filter-input:focus, .filter-select:focus {{
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  }}

  /* Modern Jadval Konteyneri - Aniq Chiziqli Jadval (Grid Table) */
  .table-container {{
    background: var(--card);
    border: 1.5px solid #cbd5e1;
    border-radius: 14px;
    box-shadow: 0 4px 20px -4px rgba(15, 23, 42, 0.06);
    overflow: hidden;
  }}
  .table-wrapper {{
    overflow-x: auto; max-width: 100%;
  }}
  table {{
    width: 100%; border-collapse: collapse; text-align: left; min-width: 1000px;
    border: 1px solid #cbd5e1;
  }}
  
  /* 2 Qatorli Thead */
  thead tr.th-titles th {{
    background: #0f172a; color: #ffffff; font-weight: 700; font-size: 12px;
    padding: 11px 10px; border: 1px solid #334155;
    white-space: nowrap; vertical-align: middle; text-transform: uppercase; letter-spacing: 0.5px;
  }}
  thead tr.th-filters th {{
    background: #f8fafc; padding: 7px 6px;
    border: 1px solid #cbd5e1;
  }}

  td {{
    padding: 9px 10px; border: 1px solid #e2e8f0; vertical-align: middle;
  }}
  tr.student-row {{ transition: background 0.1s ease; }}
  tr.student-row:nth-child(even) td {{ background: #f8fafc; }}
  tr.student-row:nth-child(odd) td {{ background: #ffffff; }}
  tr.student-row:hover td {{ background: #eff6ff !important; }}

  /* Ustun ichidagi mini-qidiruv kataklari */
  .col-filter {{
    width: 100%; padding: 6px 8px;
    border: 1px solid #cbd5e1; border-radius: 8px; font-size: 11.5px;
    font-family: inherit; font-weight: 500; outline: none; background: #ffffff; color: #0f172a;
    box-sizing: border-box; transition: all 0.15s;
  }}
  .col-filter:focus {{
    border-color: var(--accent);
    box-shadow: 0 0 0 2.5px rgba(37, 99, 235, 0.15);
  }}

  /* Shartnoma Pill */
  .shnum-pill {{
    background: #eff6ff; color: #2563eb; padding: 4px 10px; border-radius: 8px;
    font-weight: 800; font-size: 13px; cursor: pointer; display: inline-block;
    border: 1px solid #bfdbfe; transition: all 0.15s;
  }}
  .shnum-pill:hover {{ background: #2563eb; color: #fff; transform: scale(1.05); }}

  .student-name {{
    font-weight: 700; color: #0f172a; font-size: 13.5px; letter-spacing: -0.2px;
  }}
  .student-patronymic {{
    color: #64748b; font-size: 12px; margin-top: 2px; font-weight: 500;
  }}

  .yon-badge {{
    font-size: 11px; color: #0284c7; background: #e0f2fe; padding: 3px 8px;
    border-radius: 6px; font-weight: 700; margin-top: 4px; display: inline-block;
  }}

  /* Badjlar va matnlar */
  .badge {{
    display: inline-block; padding: 3px 9px; border-radius: 20px;
    font-size: 10.5px; font-weight: 700; white-space: nowrap; letter-spacing: 0.3px;
  }}
  .badge-id {{ background: #e0e7ff; color: #3730a3; }}
  .badge-bio {{ background: #cffafe; color: #0e7490; }}
  .badge-none {{ background: #fee2e2; color: #991b1b; }}
  .badge-full {{ background: #dcfce7; color: #166534; }}
  .badge-chala {{ background: #fef9c3; color: #854d0e; }}

  .mono {{ font-family: 'JetBrains Mono', monospace; font-weight: 600; }}
  .pass-text {{ color: #1e3c72; font-weight: 700; font-size: 13px; }}
  .pinfl-text {{ color: #7c3aed; font-weight: 700; font-size: 12.5px; letter-spacing: 0.5px; }}
  .doc-text {{ color: #059669; font-weight: 700; }}

  .btn-action {{
    padding: 5px 14px; border-radius: 9999px; font-size: 11.5px;
    font-weight: 600; border: 1.5px solid transparent; cursor: pointer; display: inline-flex;
    align-items: center; gap: 6px; text-decoration: none; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    user-select: none;
  }}
  .btn-action:active {{
    transform: scale(0.97);
  }}
  .btn-view-doc {{
    background: transparent; color: #2563eb; border-color: #2563eb;
  }}
  .btn-view-doc:hover {{
    background: rgba(37, 99, 235, 0.08); color: #1d4ed8;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
    transform: translateY(-1px);
  }}
  
  .btn-attach-doc {{
    background: transparent; color: #10b981; border: 1.5px dashed #10b981;
  }}
  .btn-attach-doc:hover {{
    background: rgba(16, 185, 129, 0.08); color: #059669;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
    transform: translateY(-1px);
  }}

  .btn-qr {{
    background: #10b981; color: #fff; border-color: #10b981;
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);
  }}
  .btn-qr:hover {{
    background: #059669; border-color: #059669;
    box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
    transform: translateY(-1px);
  }}

  /* Modern MODAL */
  .modal-backdrop {{
    display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(15, 23, 42, 0.85); z-index: 99999; backdrop-filter: blur(8px);
    justify-content: center; align-items: center; padding: 14px;
  }}
  .modal-content {{
    background: #f8fafc; border-radius: 20px; width: 98vw; max-width: 1750px;
    height: 96vh; max-height: 96vh; display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.5); animation: modalZoom 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    z-index: 100000; border: 1px solid rgba(255,255,255,0.1);
  }}
  @keyframes modalZoom {{ from {{ transform: scale(0.96); opacity: 0; }} to {{ transform: scale(1); opacity: 1; }} }}

  .modal-header {{
    padding: 12px 24px; background: #0f172a; color: #fff;
    display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
  }}
  .modal-header h3 {{ font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 10px; }}
  .modal-close {{
    background: rgba(255,255,255,0.1); border: none; font-size: 20px; cursor: pointer; color: #cbd5e1;
    width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }}
  .modal-close:hover {{ background: rgba(255,255,255,0.2); color: #fff; }}

  .modal-body {{
    padding: 16px 20px; gap: 16px; flex: 1; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden;
  }}

  .modal-top-bar {{
    display: flex; justify-content: space-between; align-items: center;
    background: #fff; padding: 12px 18px; border-radius: 12px; border: 1px solid var(--border);
    flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.03);
  }}

  /* ---- 30tani Tekshirish Uslubidagi Section-Based Detalizatsiya (tekshiruv.html) ---- */
  .tekshiruv-sections-wrap {{
    display: flex; flex-direction: column; gap: 20px; padding: 4px 2px; width: 100%; box-sizing: border-box;
  }}
  .sect {{
    display: grid !important; grid-template-columns: 410px minmax(0, 1fr) !important; gap: 22px !important;
    align-items: start !important; border-bottom: 1.5px solid var(--border) !important; padding-bottom: 24px !important;
    margin-bottom: 8px !important; min-width: 0 !important; width: 100% !important; box-sizing: border-box !important;
  }}
  .sect:last-child {{ border-bottom: none !important; padding-bottom: 4px !important; margin-bottom: 0 !important; }}
  .sect > .side {{ position: sticky !important; top: 10px !important; min-width: 0 !important; width: 100% !important; overflow: hidden !important; }}
  .sect-right {{ min-width: 0 !important; width: 100% !important; display: flex !important; flex-direction: column !important; gap: 14px !important; }}
  .sechd {{
    display: flex; align-items: center; gap: 9px; margin-bottom: 12px;
    font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); font-weight: 750;
  }}
  .sechd .n {{
    display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
    border-radius: 50%; background: var(--accent); color: #fff; font-size: 12px; font-weight: 800; letter-spacing: 0; flex-shrink: 0;
  }}
  .sect-card {{
    background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 14px 16px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.03);
    min-width: 0 !important; width: 100% !important; box-sizing: border-box !important; overflow: hidden !important;
  }}
  .sect-card h4 {{
    margin: 0 0 10px; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); font-weight: 700;
  }}

  /* CRITICAL: Overriding global table min-width: 1000px for .kv tables */
  table.kv {{
    min-width: 0 !important; max-width: 100% !important; width: 100% !important;
    border: none !important; table-layout: fixed !important; margin: 0 !important;
    border-collapse: collapse !important;
  }}
  table.kv tr {{ border: none !important; }}
  table.kv td {{
    padding: 6px 0 !important; vertical-align: top !important; line-height: 1.4 !important;
    border: none !important; border-bottom: 1px solid rgba(226, 232, 240, 0.7) !important;
    box-sizing: border-box !important;
  }}
  table.kv tr:last-child td {{ border-bottom: none !important; }}
  table.kv td:first-child {{
    color: var(--text-muted) !important; width: 44% !important; padding-right: 8px !important;
    font-size: 12px !important; font-weight: 600 !important; white-space: normal !important;
  }}
  table.kv td:last-child {{
    font-weight: 700 !important; color: var(--text-main) !important; font-size: 13px !important;
    word-break: break-word !important; overflow-wrap: anywhere !important;
  }}

  /* JSHSHIR (PINFL) rangli bo'laklar */
  .pcode {{
    font-family: 'JetBrains Mono', monospace; font-size: 17px; letter-spacing: .06em;
    margin: 0 0 10px; display: flex; flex-wrap: wrap; gap: 2px;
  }}
  .pcode span {{ padding: 2px 5px; border-radius: 4px; border-bottom: 3px solid transparent; }}
  .pcode .c1 {{ border-color: #ec4899; color: #f43f5e; font-weight: 800; }}
  .pcode .c2 {{ border-color: #6366f1; color: #818cf8; font-weight: 700; }}
  .pcode .c3 {{ border-color: #059669; color: #34d399; font-weight: 700; }}
  .pcode .c4 {{ border-color: #94a3b8; color: #94a3b8; }}
  .pcode .c5 {{ border-color: #d97706; color: #fbbf24; font-weight: 800; }}

  /* Rasm Bloki (.imgblk) */
  .imgblk {{
    background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 12px; box-shadow: 0 4px 14px rgba(0,0,0,0.04);
    min-width: 0 !important; width: 100% !important; box-sizing: border-box !important;
  }}
  .imghd {{
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;
  }}
  .imghd .t {{
    font-weight: 700; font-size: 13.5px; color: var(--text-main); display: flex; align-items: center; gap: 6px;
  }}
  .btn-rot-mini {{
    background: #334155; color: #fff; border: none; border-radius: 6px; padding: 4px 10px;
    font-size: 13px; cursor: pointer; transition: all 0.15s; font-weight: 700;
  }}
  .btn-rot-mini:hover {{ background: #2563eb; transform: scale(1.05); }}
  .btn-zoom-mini {{
    background: #0284c7; color: #fff; border: none; border-radius: 6px; padding: 4px 12px;
    font-size: 12px; cursor: pointer; transition: all 0.15s; font-weight: 700; display: inline-flex; align-items: center; gap: 5px;
  }}
  .btn-zoom-mini:hover {{ background: #0369a1; }}
  .btn-nav-mini {{
    background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25); color: #ffffff;
    border-radius: 8px; padding: 5px 12px; font-size: 12.5px; font-weight: 700; cursor: pointer;
    display: inline-flex; align-items: center; gap: 4px; transition: all 0.15s; white-space: nowrap;
  }}
  .btn-nav-mini:hover:not(:disabled) {{ background: #2563eb; border-color: #3b82f6; color: #fff; transform: translateY(-1px); }}
  .btn-nav-mini:disabled {{ opacity: 0.35; cursor: not-allowed; }}
  .imgbox {{
    background: #070c18; border-radius: 10px; overflow: auto; display: flex; align-items: center;
    justify-content: center; min-height: 200px; max-height: 520px; cursor: zoom-in; position: relative;
    padding: 6px; box-sizing: border-box;
  }}
  .imgbox img.doc-img {{
    display: block; max-width: 100%; max-height: 500px; object-fit: contain;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }}
  .imgbox img.rotated-90 {{
    max-width: none; max-height: 480px;
  }}

  @media(max-width: 980px) {{
    .sect {{ grid-template-columns: 1fr !important; }}
    .sect > .side {{ position: static; }}
  }}

  /* Rasmlar Galereyasi */
  .gallery-wrapper {{
    flex: 1 1 0px; min-height: 0; background: #0f172a; border-radius: 14px;
    padding: 10px; display: flex; align-items: center; justify-content: center; overflow: hidden;
  }}
  .gallery-grid {{
    display: flex; flex-direction: row; justify-content: center; align-items: stretch;
    gap: 14px; height: 100%; width: 100%; overflow: hidden;
  }}
  .gallery-item {{
    flex: 1 1 0px; height: 100%; border: 1px solid #334155; border-radius: 10px;
    overflow: hidden; background: #1e293b; display: flex; flex-direction: column;
    padding: 6px; box-sizing: border-box;
  }}
  .gallery-img-wrap {{
    flex: 1 1 0px; width: 100%; height: 100%; display: flex; align-items: center;
    justify-content: center; overflow: hidden; cursor: zoom-in;
  }}
  .gallery-img-wrap img {{
    max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px;
    transition: transform 0.15s; background: #000;
  }}
  .gallery-img-wrap img:hover {{ transform: scale(1.02); }}
  .gallery-bar {{
    margin-top: 6px; display: flex; justify-content: space-between; align-items: center;
    padding: 0 4px; flex-shrink: 0;
  }}
  .gallery-cap {{
    font-size: 11.5px; font-weight: 700; color: #e2e8f0; display: flex; align-items: center; gap: 6px;
  }}
  .btn-zoom-mini {{
    background: #2563eb; color: #fff; padding: 4px 12px; font-size: 11.5px;
    border-radius: 9999px; font-weight: 600; border: none; cursor: pointer;
    display: inline-flex; align-items: center; gap: 5px;
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3); transition: all 0.2s;
  }}
  .btn-zoom-mini:hover {{
    background: #1d4ed8; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
    transform: translateY(-1px);
  }}

  /* Olingan Ma'lumotlar Kartalari */
  .data-wrapper {{ flex: 0 0 auto; }}
  .data-cards-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }}
  .data-card {{
    background: #fff; border: 1px solid var(--border); border-radius: 14px; padding: 12px 16px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.03);
  }}
  .data-card h4 {{
    font-size: 12.5px; font-weight: 800; color: #0f172a; margin-bottom: 6px;
    display: flex; align-items: center; gap: 6px; border-bottom: 1px solid #f1f5f9; padding-bottom: 5px;
  }}

  .btn-edit-mini {{
    background: transparent; color: #2563eb; padding: 3px 12px; font-size: 11.5px;
    border-radius: 9999px; font-weight: 600; border: 1.5px solid #2563eb; cursor: pointer;
    display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s;
  }}
  .btn-edit-mini:hover {{
    background: rgba(37, 99, 235, 0.08); box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
    transform: translateY(-1px);
  }}
  .btn-edit-main {{
    background: #ffffff; color: #0f172a; padding: 6px 18px; font-size: 12px;
    border-radius: 9999px; font-weight: 600; border: 1.5px solid #cbd5e1; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }}
  .btn-edit-main:hover {{
    border-color: #94a3b8; box-shadow: 0 4px 14px rgba(0,0,0,0.1);
    transform: translateY(-1px);
  }}
  .btn-save-data {{
    background: #10b981; color: #fff; padding: 6px 18px; font-size: 12px;
    border-radius: 9999px; font-weight: 600; border: 1.5px solid #10b981; cursor: pointer;
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3); transition: all 0.2s;
  }}
  .btn-save-data:hover {{
    background: #059669; border-color: #059669;
    box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4); transform: translateY(-1px);
  }}
  .btn-cancel-edit {{
    background: #ffffff; color: #475569; padding: 6px 16px; font-size: 12px;
    border-radius: 9999px; font-weight: 600; border: 1.5px solid #cbd5e1; cursor: pointer;
    transition: all 0.2s;
  }}
  .btn-cancel-edit:hover {{
    border-color: #94a3b8; box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    transform: translateY(-1px);
  }}

  .data-row-edit {{
    display: flex; justify-content: space-between; align-items: center; padding: 7px 0;
    border-bottom: 1px solid rgba(0,0,0,0.06); font-size: 14px; min-height: 48px;
  }}
  .data-row-edit .lbl {{ color: #334155; font-weight: 700; width: 34%; font-size: 14px; }}
  .edit-input {{
    width: 64%; height: 44px; padding: 8px 14px; border: 1.5px solid #cbd5e1; border-radius: 8px;
    font-size: 15px; font-weight: 700; color: #0f172a; outline: none; background: #fff; font-family: inherit;
    transition: all 0.2s ease;
  }}
  .edit-input:focus {{
    border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.25);
  }}
  .edit-input.mono {{
    font-family: 'JetBrains Mono', monospace; font-size: 16px; letter-spacing: 1px; font-weight: 800;
  }}
  .edit-input-lg {{
    height: 46px; font-size: 15.5px;
  }}

  
  
  
  /* =========================================================================
     YANGI TALABA QO'SHISH MODALI YANGILANGAN ULTRA-MODERN STILLARI
     ========================================================================= */
  #addStudentModal .modal-content {{
    max-width: 940px;
    height: auto;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    border-radius: 18px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.45);
    background: #ffffff;
    border: 1px solid rgba(255,255,255,0.1);
    overflow: hidden;
  }}
  body.dark-mode #addStudentModal .modal-content {{
    background: #0f172a;
    border-color: #334155;
  }}

  .add-modal-body {{
    padding: 18px 22px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    flex: 1;
  }}

  /* AI Upload Box */
  .ai-upload-box {{
    background: #f8fafc;
    border: 2px dashed #93c5fd;
    border-radius: 12px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: all 0.2s;
  }}
  .ai-upload-box.drag-active {{
    background: #eff6ff !important;
    border-color: #2563eb !important;
    box-shadow: 0 0 16px rgba(37, 99, 235, 0.25) !important;
  }}
  body.dark-mode .ai-upload-box {{
    background: #1e293b;
    border-color: #3b82f6;
  }}

  .ai-upload-top {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }}
  .ai-step-title {{
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 800;
    color: #1e293b;
  }}
  body.dark-mode .ai-step-title {{ color: #f1f5f9; }}

  .step-num {{
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #2563eb;
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
  }}
  .ai-pill-tag {{
    font-size: 10px;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 5px;
    background: #dbeafe;
    color: #1e40af;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }}
  body.dark-mode .ai-pill-tag {{
    background: rgba(37,99,235,0.25);
    color: #93c5fd;
  }}
  .ai-opt-note {{
    font-size: 11.5px;
    color: #64748b;
  }}

  .ai-upload-row {{
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }}
  .file-picker-btn {{
    flex: 1;
    min-width: 220px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    font-size: 12px;
    color: #475569;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }}
  body.dark-mode .file-picker-btn {{
    background: #0f172a;
    border-color: #334155;
    color: #cbd5e1;
  }}
  .file-picker-btn:hover {{
    border-color: #2563eb;
    color: #2563eb;
  }}

  .btn-ai-action {{
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 18px; border-radius: 9999px; font-size: 12px; font-weight: 600;
    cursor: pointer; border: 1.5px solid transparent;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); white-space: nowrap;
    text-decoration: none; user-select: none;
  }}
  .btn-ai-action:active {{
    transform: scale(0.97);
  }}
  .btn-ai-purple {{
    background: #8b5cf6; color: #ffffff;
    border-color: #8b5cf6;
    box-shadow: 0 2px 6px rgba(139, 92, 246, 0.25);
  }}
  .btn-ai-purple:hover {{
    background: #7c3aed; border-color: #7c3aed;
    box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4);
    transform: translateY(-1px);
  }}
  .btn-ai-blue {{
    background: #0ea5e9; color: #ffffff;
    border-color: #0ea5e9;
    box-shadow: 0 2px 6px rgba(14, 165, 233, 0.25);
  }}
  .btn-ai-blue:hover {{
    background: #0284c7; border-color: #0284c7;
    box-shadow: 0 4px 14px rgba(14, 165, 233, 0.4);
    transform: translateY(-1px);
  }}

  .ai-status-msg {{
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
  }}

  /* 2-Ustunli Forma */
  .add-form-container {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }}
  @media (max-width: 768px) {{
    .add-form-container {{
      grid-template-columns: 1fr;
    }}
    /* Telefonlarda sarlavha tugmalari bir qatorga sig'masdi: .header
       da overflow:hidden bo'lgani uchun "Jadvalni Eksport" va "Excel
       Eksport" tugmalari kesilib, umuman bosib bo'lmasdi. Endi ular
       yangi qatorga o'tadi. */
    .header-actions {{
      flex-wrap: wrap;
      justify-content: flex-start;
      row-gap: 8px;
    }}

    /* Xuddi shu muammo talaba kartasi modalida ham bor edi:
       .modal-body overflow:hidden bo'lgani uchun "Tahrirlash" va
       boshqa tugmalar telefonda kesilib qolardi.
       Faqat .modal-top-bar ga wrap berish yetmaydi — ichidagi tugmalar
       guruhi flex element sifatida qisqarmay 1000px+ bo'lib qolardi,
       shuning uchun bolalarini ham kenglikka cheklaymiz. */
    .modal-top-bar {{
      flex-wrap: wrap;
      row-gap: 8px;
    }}
    .modal-top-bar > * {{
      max-width: 100%;
      min-width: 0;
      flex-wrap: wrap;
    }}

    /* Modal ichidagi qolgan uchta toshish sababi (hammasi .modal-body
       overflow:hidden ostida kesilib qolardi): */

    /* 1) Uzun fayl yo'li bir qatorda cho'zilib ketardi */
    #modalFilePath {{
      white-space: normal;
      word-break: break-all;
      overflow-wrap: anywhere;
    }}

    /* 2) Hujjat rasmlari yonma-yon turib sig'masdi (3 ta x 154px = 490px) */
    #modalImagesContainer {{
      flex-wrap: wrap;
      justify-content: center;
    }}
    .gallery-grid {{
      flex-wrap: wrap;
      justify-content: center;
      max-width: 100%;
    }}

    /* 3) Ma'lumot kartalari ikki ustun bo'lib qolardi */
    .data-cards-grid {{
      grid-template-columns: 1fr;
    }}
  }}

  .form-card-box {{
    background: #ffffff;
    border: 1.5px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }}
  body.dark-mode .form-card-box {{
    background: #1e293b;
    border-color: #334155;
  }}

  .card-box-head {{
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    font-size: 12.5px;
    font-weight: 800;
    border-bottom: 1.5px solid #e2e8f0;
  }}
  .card-box-head.head-blue {{
    background: #eff6ff;
    color: #1d4ed8;
    border-bottom-color: #bfdbfe;
  }}
  body.dark-mode .card-box-head.head-blue {{
    background: rgba(37,99,235,0.15);
    color: #93c5fd;
    border-bottom-color: rgba(37,99,235,0.3);
  }}
  .card-box-head.head-green {{
    background: #f0fdf4;
    color: #15803d;
    border-bottom-color: #bbf7d0;
  }}
  body.dark-mode .card-box-head.head-green {{
    background: rgba(16,185,129,0.15);
    color: #6ee7b7;
    border-bottom-color: rgba(16,185,129,0.3);
  }}

  .form-inputs-grid {{
    padding: 12px 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
  }}
  .form-group-item {{
    display: flex;
    flex-direction: column;
    gap: 3px;
    box-sizing: border-box;
  }}
  .form-group-item.full-width {{
    width: 100%;
  }}
  .form-group-item.half-width {{
    width: calc(50% - 5px);
  }}
  .form-group-item label {{
    font-size: 11px;
    font-weight: 700;
    color: #475569;
  }}
  body.dark-mode .form-group-item label {{
    color: #94a3b8;
  }}
  .req-star {{
    color: #ef4444;
    font-weight: 800;
  }}

  .form-ctrl {{
    width: 100%;
    box-sizing: border-box;
    padding: 7px 10px;
    border: 1.5px solid #cbd5e1;
    border-radius: 7px;
    font-size: 12px;
    font-family: inherit;
    font-weight: 600;
    background: #ffffff;
    color: #0f172a;
    outline: none;
    transition: all 0.15s;
  }}
  body.dark-mode .form-ctrl {{
    background: #0f172a;
    border-color: #334155;
    color: #f1f5f9;
  }}
  .form-ctrl:focus {{
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
  }}
  .form-ctrl.mono {{
    font-family: 'JetBrains Mono', monospace;
    letter-spacing: 0.3px;
  }}
  .form-ctrl.ctrl-readonly {{
    background: #f8fafc;
    color: #64748b;
  }}
  body.dark-mode .form-ctrl.ctrl-readonly {{
    background: #162033;
    color: #94a3b8;
  }}
  .form-ctrl.input-ber {{
    border-color: #c4b5fd;
  }}
  .form-ctrl.input-ber:focus {{
    border-color: #7c3aed;
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.15);
  }}

  .info-helper-box {{
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 7px 10px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 7px;
    font-size: 11px;
    color: #64748b;
    line-height: 1.35;
    margin-top: 3px;
  }}
  body.dark-mode .info-helper-box {{
    background: #0f172a;
    border-color: #334155;
    color: #94a3b8;
  }}

  /* Modal Footer */
  .modal-footer-sticky {{
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
    padding: 11px 22px;
    background: #ffffff;
    border-top: 1px solid #e2e8f0;
    flex-shrink: 0;
  }}
  body.dark-mode .modal-footer-sticky {{
    background: #1e293b;
    border-top-color: #334155;
  }}

  .btn-modal-cancel {{
    padding: 7px 20px;
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }}
  body.dark-mode .btn-modal-cancel {{
    background: #111e38;
    border-color: #23385e;
    color: #cbd5e1;
  }}
  .btn-modal-cancel:hover {{
    background: #ffffff; border-color: #94a3b8;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
    transform: translateY(-1px);
  }}
  body.dark-mode .btn-modal-cancel:hover {{
    background: #162444; border-color: #3b82f6;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  }}
  .btn-modal-cancel:active {{
    transform: scale(0.97);
    border-color: #2563eb; color: #2563eb;
  }}

  .btn-modal-save {{
    display: inline-flex; align-items: center; gap: 7px;
    padding: 7px 22px;
    background: #10b981;
    border: 1.5px solid #10b981;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 600;
    color: #ffffff;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }}
  .btn-modal-save:hover {{
    background: #059669; border-color: #059669;
    box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4);
    transform: translateY(-1.5px);
  }}
  .btn-modal-save:active {{
    background: #047857; border-color: #047857;
    transform: scale(0.97);
  }}

  /* =========================================================================
     MINIMALIST VA BIR OYNAGA TO'LIQ SIG'ADIGAN JADVAL STILLARI
     ========================================================================= */
  .table-wrapper {{
    overflow-x: auto;
    max-width: 100%;
  }}
  table {{
    width: 100%;
    min-width: 1000px;
    max-width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }}
  td {{
    padding: 8px 6px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }}
  thead tr.th-titles th {{
    padding: 9px 6px;
    font-size: 11px;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }}
  thead tr.th-filters th {{
    padding: 5px 4px;
  }}
  .col-filter {{
    padding: 4px 6px;
    font-size: 11px;
  }}

  /* Toza monospace minimalist ma'lumotlar */
  .mono-pass {{
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: 12px;
    color: #0284c7;
    letter-spacing: 0.5px;
  }}
  body.dark-mode .mono-pass {{ color: #38bdf8; }}

  .mono-pinfl {{
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: 12px;
    color: #7c3aed;
    letter-spacing: 0.5px;
  }}
  body.dark-mode .mono-pinfl {{ color: #c084fc !important; font-weight: 700; }}

  .mono-doc {{
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: 12px;
    color: #059669;
    letter-spacing: 0.5px;
  }}
  body.dark-mode .mono-doc {{ color: #34d399; }}

  .clean-dob {{
    font-weight: 600;
    font-size: 12px;
    color: #334155;
  }}
  body.dark-mode .clean-dob {{ color: #cbd5e1; }}

  .shnum-clean {{
    font-weight: 800;
    font-size: 12px;
    color: #2563eb;
    cursor: pointer;
  }}
  body.dark-mode .shnum-clean {{ color: #60a5fa; }}
  .shnum-clean:hover {{ text-decoration: underline; }}

  .sub-pill {{
    display: inline-block;
    font-size: 9.5px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 4px;
    background: #e0e7ff;
    color: #3730a3;
    margin-left: 4px;
    vertical-align: middle;
  }}
  body.dark-mode .sub-pill {{
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
  }}

  .mini-qr-link {{
    display: inline-flex;
    align-items: center;
    color: #059669;
    margin-left: 4px;
    vertical-align: middle;
    transition: transform 0.15s;
  }}
  body.dark-mode .mini-qr-link {{ color: #34d399; }}
  .mini-qr-link:hover {{ transform: scale(1.25); }}

  .cell-school {{
    max-width: 170px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: inherit;
  }}

  .btn-file-mini {{
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 3px 6px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s;
  }}
  .btn-file-has {{
    background: #eff6ff;
    color: #2563eb;
    border-color: #bfdbfe;
  }}
  body.dark-mode .btn-file-has {{
    background: rgba(37,99,235,0.15);
    color: #60a5fa;
    border-color: rgba(37,99,235,0.3);
  }}
  .btn-file-none {{
    background: #f1f5f9;
    color: #64748b;
    border-color: #cbd5e1;
  }}
  body.dark-mode .btn-file-none {{
    background: #1e293b;
    color: #94a3b8;
    border-color: #334155;
  }}

  .btn-v-mini {{
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: 1.5px solid transparent;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    white-space: nowrap;
    user-select: none;
  }}
  .btn-v-mini:active {{
    transform: scale(0.97);
  }}
  .btn-v-ok {{
    background: #dcfce7;
    color: #166534;
    border-color: #bbf7d0;
  }}
  .btn-v-ok:hover {{
    background: #bbf7d0;
    box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
    transform: translateY(-1px);
  }}
  body.dark-mode .btn-v-ok {{
    background: rgba(16,185,129,0.15);
    color: #34d399;
    border-color: rgba(16,185,129,0.3);
  }}
  .btn-v-wait {{
    background: #fef3c7;
    color: #92400e;
    border-color: #fde68a;
  }}
  .btn-v-wait:hover {{
    background: #fde68a;
    box-shadow: 0 2px 8px rgba(245, 158, 11, 0.25);
    transform: translateY(-1px);
  }}
  body.dark-mode .btn-v-wait {{
    background: rgba(245,158,11,0.15);
    color: #fcd34d;
    border-color: rgba(245,158,11,0.3);
  }}

  /* =========================================================================
     INLINE PASPORT, DIPLOM VA PINFL TEKIS VA BO'LINMAS STILLARI
     ========================================================================= */
  .pass-inline-wrap, .doc-inline-wrap {{
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    vertical-align: middle;
  }}
  .badge-series-pill {{
    background: #1e40af;
    color: #ffffff;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 6px;
    letter-spacing: 1px;
    display: inline-block;
    border: 1px solid #3b82f6;
    margin-right: 0 !important;
  }}
  .pass-digits {{
    font-family: 'JetBrains Mono', monospace;
    font-size: 14.5px;
    font-weight: 800;
    color: #0284c7;
    letter-spacing: 1.5px;
    vertical-align: middle;
  }}
  .badge-doc-ser-pill {{
    background: #059669;
    color: #ffffff;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 6px;
    letter-spacing: 1px;
    display: inline-block;
    border: 1px solid #10b981;
    margin-right: 0 !important;
  }}
  .doc-digits {{
    font-family: 'JetBrains Mono', monospace;
    font-size: 14.5px;
    font-weight: 800;
    color: #059669;
    letter-spacing: 1.5px;
    vertical-align: middle;
  }}
  .pinfl-clean-text {{
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    font-weight: 700;
    color: #0369a1;
    background: #f0f9ff;
    border: 1.5px solid #bae6fd;
    padding: 3px 9px;
    border-radius: 6px;
    letter-spacing: 1.2px;
    display: inline-block;
    white-space: nowrap;
  }}

  /* Dark mode overrides */
  body.dark-mode .pass-digits {{ color: #38bdf8; }}
  body.dark-mode .doc-digits {{ color: #34d399; }}
  body.dark-mode .pinfl-clean-text {{
    color: #38bdf8;
    background: rgba(14, 165, 233, 0.15);
    border-color: rgba(56, 189, 248, 0.35);
  }}

  /* =========================================================================
     KARTA KO'RINISHI (STUDENT CARDS VIEW) STILLARI
     ========================================================================= */
  .view-switch-bar {{
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 18px; flex-wrap: wrap; gap: 14px;
    background: #ffffff; padding: 12px 20px; border-radius: 14px;
    border: 1px solid var(--border); box-shadow: 0 2px 8px rgba(0,0,0,0.02);
  }}
  .view-mode-toggle {{
    display: inline-flex; background: #f1f5f9; padding: 4px; border-radius: 12px; gap: 4px;
  }}
  .view-mode-btn {{
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 18px; border-radius: 9px; font-weight: 700; font-size: 13px;
    border: none; background: transparent; color: #475569; cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }}
  .view-mode-btn.active {{
    background: #ffffff; color: #1e3a8a; font-weight: 800;
    box-shadow: 0 3px 10px rgba(0,0,0,0.08);
  }}
  .view-mode-btn:hover:not(.active) {{
    color: #0f172a; background: rgba(255,255,255,0.6);
  }}

  .cards-container {{
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 18px !important;
    align-items: start !important;
  }}
  .cards-container[style*="display: none"],
  .cards-container[style*="display:none"] {{
    display: none !important;
  }}

    /* =========================================================================
     GROUP BADGES VA DROPDOWN KARTALARI YANGI STILLARI
     ========================================================================= */
  .card-group-badge {{
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 800;
    letter-spacing: 0.3px;
  }}
  .card-group-badge.grp-2601 {{ background: #e0e7ff; color: #3730a3; border: 1.5px solid #c7d2fe; }}
  .card-group-badge.grp-2602 {{ background: #dbeafe; color: #1e40af; border: 1.5px solid #bfdbfe; }}
  .card-group-badge.grp-2603 {{ background: #cffafe; color: #0e7490; border: 1.5px solid #a5f3fc; }}
  .card-group-badge.grp-2604 {{ background: #d1fae5; color: #065f46; border: 1.5px solid #a7f3d0; }}
  .card-group-badge.grp-2605 {{ background: #fef3c7; color: #92400e; border: 1.5px solid #fde68a; }}
  .card-group-badge.grp-2606 {{ background: #ffe4e6; color: #9f1239; border: 1.5px solid #fecdd3; }}
  .card-group-badge.grp-2607 {{ background: #ede9fe; color: #5b21b6; border: 1.5px solid #ddd6fe; }}
  .card-group-badge.grp-n {{ background: #f1f5f9; color: #475569; border: 1.5px solid #cbd5e1; }}
  .card-group-badge.grp-withdrawn {{
    background: rgba(239, 68, 68, 0.12) !important;
    color: #dc2626 !important;
    border: 1.5px solid rgba(239, 68, 68, 0.35) !important;
  }}

  .table-group-badge {{
    display: inline-block;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 800;
  }}
  .table-group-badge.grp-2601 {{ background: #e0e7ff; color: #3730a3; }}
  .table-group-badge.grp-2602 {{ background: #dbeafe; color: #1e40af; }}
  .table-group-badge.grp-2603 {{ background: #cffafe; color: #0e7490; }}
  .table-group-badge.grp-2604 {{ background: #d1fae5; color: #065f46; }}
  .table-group-badge.grp-2605 {{ background: #fef3c7; color: #92400e; }}
  .table-group-badge.grp-2606 {{ background: #ffe4e6; color: #9f1239; }}
  .table-group-badge.grp-2607 {{ background: #ede9fe; color: #5b21b6; }}
  .table-group-badge.grp-n {{ background: #f1f5f9; color: #475569; }}
  .table-group-badge.grp-withdrawn {{
    background: rgba(239, 68, 68, 0.12) !important;
    color: #dc2626 !important;
    border: 1px solid rgba(239, 68, 68, 0.3) !important;
  }}

  .btn-filter-withdrawn {{
    padding: 7px 15px;
    font-size: 12px;
    font-weight: 700;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
    cursor: pointer;
    transition: all 0.15s ease;
  }}
  .btn-filter-withdrawn:hover {{
    background: rgba(239, 68, 68, 0.18);
    border-color: #ef4444;
  }}
  .btn-filter-withdrawn.active {{
    background: #dc2626 !important;
    color: #ffffff !important;
    border-color: #dc2626 !important;
    box-shadow: 0 2px 8px rgba(220, 38, 38, 0.35);
  }}

  /* Card Main Info */
  .card-main-info {{
    padding: 16px 20px 14px;
  }}
  .card-student-name {{
    font-size: 19px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.35;
    margin-bottom: 10px;
    cursor: pointer;
    transition: color 0.15s ease;
  }}
  .card-student-name:hover {{
    color: #2563eb;
  }}
  .card-meta-tags {{
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 12px;
  }}
  .card-meta-pill {{
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 5px 11px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    color: #475569;
  }}
  .card-meta-pill.file-pill {{
    cursor: pointer;
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #1d4ed8;
    transition: all 0.15s;
  }}
  .card-meta-pill.file-pill:hover {{
    background: #dbeafe;
    border-color: #93c5fd;
  }}

  /* Card Dropdown Toggle Button */
  .card-dropdown-btn {{
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f8fafc;
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    padding: 9px 15px;
    font-size: 13px;
    font-weight: 700;
    color: #334155;
    cursor: pointer;
    transition: all 0.2s ease;
  }}
  .card-dropdown-btn:hover {{
    background: #f1f5f9;
    border-color: #94a3b8;
    color: #0f172a;
  }}
  .card-dropdown-btn.active {{
    background: #eff6ff;
    border-color: #93c5fd;
    color: #1d4ed8;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }}
  .card-dropdown-btn .btn-text {{
    display: flex;
    align-items: center;
    gap: 8px;
  }}
  .card-dropdown-btn .btn-chevron {{
    transition: transform 0.25s ease;
    display: flex;
    align-items: center;
  }}
  .card-dropdown-btn.active .btn-chevron {{
    transform: rotate(180deg);
  }}

  /* Card Details Dropdown Container */
  .card-dropdown-details {{
    border: 1.5px solid #93c5fd;
    border-top: none;
    border-bottom-left-radius: 12px;
    border-bottom-right-radius: 12px;
    background: #ffffff;
    padding: 16px 20px 20px;
    animation: fadeInCard 0.2s ease;
  }}

  @keyframes fadeInCard {{
    from {{ opacity: 0; transform: translateY(-4px); }}
    to {{ opacity: 1; transform: translateY(0); }}
  }}

  /* Dark mode overrides */
  body.dark-mode .card-group-badge.grp-2601 {{ background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border-color: rgba(99, 102, 241, 0.4); }}
  body.dark-mode .card-group-badge.grp-2602 {{ background: rgba(59, 130, 246, 0.2); color: #93c5fd; border-color: rgba(59, 130, 246, 0.4); }}
  body.dark-mode .card-group-badge.grp-2603 {{ background: rgba(6, 182, 212, 0.2); color: #67e8f9; border-color: rgba(6, 182, 212, 0.4); }}
  body.dark-mode .card-group-badge.grp-2604 {{ background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.4); }}
  body.dark-mode .card-group-badge.grp-2605 {{ background: rgba(245, 158, 11, 0.2); color: #fcd34d; border-color: rgba(245, 158, 11, 0.4); }}
  body.dark-mode .card-group-badge.grp-2606 {{ background: rgba(244, 63, 94, 0.2); color: #fda4af; border-color: rgba(244, 63, 94, 0.4); }}
  body.dark-mode .card-group-badge.grp-2607 {{ background: rgba(139, 92, 246, 0.2); color: #c4b5fd; border-color: rgba(139, 92, 246, 0.4); }}
  body.dark-mode .card-group-badge.grp-n {{ background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border-color: rgba(148, 163, 184, 0.4); }}

  body.dark-mode .table-group-badge.grp-2601 {{ background: rgba(99, 102, 241, 0.25); color: #a5b4fc; }}
  body.dark-mode .table-group-badge.grp-2602 {{ background: rgba(59, 130, 246, 0.25); color: #93c5fd; }}
  body.dark-mode .table-group-badge.grp-2603 {{ background: rgba(6, 182, 212, 0.25); color: #67e8f9; }}
  body.dark-mode .table-group-badge.grp-2604 {{ background: rgba(16, 185, 129, 0.25); color: #6ee7b7; }}
  body.dark-mode .table-group-badge.grp-2605 {{ background: rgba(245, 158, 11, 0.25); color: #fcd34d; }}
  body.dark-mode .table-group-badge.grp-2606 {{ background: rgba(244, 63, 94, 0.25); color: #fda4af; }}
  body.dark-mode .table-group-badge.grp-2607 {{ background: rgba(139, 92, 246, 0.25); color: #c4b5fd; }}
  body.dark-mode .table-group-badge.grp-n {{ background: rgba(148, 163, 184, 0.25); color: #cbd5e1; }}

  body.dark-mode .card-student-name {{ color: #f1f5f9; }}
  body.dark-mode .card-student-name:hover {{ color: #60a5fa; }}
  body.dark-mode .card-meta-pill {{ background: #1e293b; border-color: #334155; color: #94a3b8; }}
  body.dark-mode .card-meta-pill.file-pill {{ background: rgba(37,99,235,0.15); border-color: rgba(37,99,235,0.3); color: #60a5fa; }}
  body.dark-mode .card-dropdown-btn {{ background: #1e293b; border-color: #334155; color: #cbd5e1; }}
  body.dark-mode .card-dropdown-btn:hover {{ background: #334155; color: #f8fafc; }}
  body.dark-mode .card-dropdown-btn.active {{ background: #1e3a8a; border-color: #3b82f6; color: #93c5fd; }}
  body.dark-mode .card-dropdown-details {{ background: #0f172a; border-color: #3b82f6; }}

  .student-card {{
    background: #ffffff;
    border: 2px solid #94a3b8;
    border-left: 6px solid #2563eb;
    border-radius: 16px;
    box-shadow: 0 4px 18px rgba(15, 23, 42, 0.08);
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    overflow: hidden;
    margin-bottom: 0 !important;
  }}
  .student-card:hover {{
    border-color: #2563eb;
    border-left-color: #1d4ed8;
    box-shadow: 0 10px 28px rgba(37, 99, 235, 0.16);
  }}

  /* =========================================================================
     TASDIQLANGAN TALABALAR KARTASI (GREEN VERIFIED CARD) STILLARI
     ========================================================================= */
  .student-card.card-verified {{
    border: 2.5px solid #10b981 !important;
    border-left: 9px solid #059669 !important;
    background: #f0fdf4 !important;
    box-shadow: 0 6px 24px rgba(16, 185, 129, 0.16) !important;
  }}
  .student-card.card-verified:hover {{
    border-color: #059669 !important;
    border-left-color: #047857 !important;
    box-shadow: 0 10px 30px rgba(16, 185, 129, 0.25) !important;
  }}
  .student-card.card-verified .card-header {{
    background: linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%) !important;
    border-bottom: 2px solid #a7f3d0 !important;
  }}
  .student-card.card-verified .card-footer {{
    background: #f0fdf4 !important;
    border-top: 1.5px solid #a7f3d0 !important;
  }}
  .student-card.card-verified .card-tr-badge {{
    background: #059669 !important;
    border-color: #047857 !important;
  }}
  .student-card.card-verified .card-box-fio {{
    background: #ffffff !important;
    border-color: #86efac !important;
  }}
  .student-card.card-verified .card-box-passport {{
    background: #ffffff !important;
    border-color: #86efac !important;
  }}
  .student-card.card-verified .card-box-doc {{
    background: #ffffff !important;
    border-color: #86efac !important;
  }}

  /* Guruhlar Bo'yicha Tasdiqlash Statistikasi Paneli */
  .group-stats-panel {{
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 18px;
    padding: 18px 22px;
    margin-bottom: 22px;
    box-shadow: 0 4px 18px rgba(15, 23, 42, 0.04);
  }}
  .group-stats-header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid #f1f5f9;
  }}
  .group-stats-title {{
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 8px;
  }}
  .group-stats-subtitle {{
    font-size: 12px;
    color: #64748b;
    font-weight: 600;
  }}
  .group-stats-grid {{
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 12px;
  }}
  @media (max-width: 1550px) {{
    .group-stats-grid {{
      grid-template-columns: repeat(4, 1fr);
    }}
  }}
  @media (max-width: 768px) {{
    .group-stats-grid {{
      grid-template-columns: repeat(2, 1fr);
    }}
  }}
  @media (max-width: 480px) {{
    .group-stats-grid {{
      grid-template-columns: 1fr;
    }}
  }}
  .grp-stat-card {{
    background: #f8fafc;
    border: 1.5px solid #e2e8f0;
    border-radius: 12px;
    padding: 12px 14px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    display: flex;
    flex-direction: column;
    gap: 6px;
    user-select: none;
    position: relative;
    overflow: hidden;
  }}
  .grp-stat-card:hover {{
    transform: translateY(-3px);
    border-color: #10b981;
    box-shadow: 0 8px 20px rgba(16, 185, 129, 0.15);
    background: #ffffff;
  }}
  .grp-stat-card.grp-stat-completed {{
    border-color: #10b981;
    background: #f0fdf4;
  }}
  .grp-stat-card.active {{
    border-color: #2563eb !important;
    outline: 3px solid #3b82f6 !important;
    outline-offset: 2px;
    background: #eff6ff !important;
    transform: translateY(-3px);
    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.2), 0 10px 25px -5px rgba(37, 99, 235, 0.35) !important;
  }}
  .grp-stat-card.active .grp-selected-indicator {{
    display: inline-flex;
  }}
  .grp-selected-indicator {{
    display: none;
    position: absolute;
    top: 6px;
    right: 8px;
    background: #2563eb;
    color: #ffffff;
    font-size: 10px;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 6px;
    letter-spacing: 0.3px;
    box-shadow: 0 2px 5px rgba(37,99,235,0.4);
    z-index: 2;
  }}
  body.dark-mode .grp-stat-card.active {{
    border-color: #60a5fa !important;
    background: #1e293b !important;
    box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.25), 0 10px 25px -5px rgba(0, 0, 0, 0.6) !important;
  }}
  body.dark-mode .grp-stat-card.active .grp-selected-indicator {{
    background: #3b82f6;
  }}

  /* =========================================================================
     TALABALAR KONTINGENTI VA AKADEMIK TAQSIMOT (TIBBIYOT PORTALI USLUBI)
     ========================================================================= */
  .kontingent-panel {{
    background: #ffffff;
    border: 1.5px solid #e2e8f0;
    border-radius: 18px;
    padding: 22px 24px;
    margin-bottom: 24px;
    box-shadow: 0 4px 20px -4px rgba(15, 23, 42, 0.05);
  }}
  .kontingent-header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 18px;
    padding-bottom: 16px;
    border-bottom: 1px solid #f1f5f9;
  }}
  .k-crest-box {{
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: #eff6ff;
    border: 1.5px solid #bfdbfe;
    color: #2563eb;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.12);
  }}
  .kontingent-title {{
    font-size: 16.5px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 8px;
    letter-spacing: -0.2px;
  }}
  .kontingent-subtitle {{
    font-size: 12px;
    color: #64748b;
    font-weight: 600;
    margin-top: 2px;
  }}
  .kontingent-header-pills {{
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }}
  .k-header-pill {{
    font-size: 11.5px;
    font-weight: 700;
    color: #334155;
    background: #f1f5f9;
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }}
  .k-header-pill strong {{
    color: #0f172a;
  }}
  .k-header-pill-accreditation {{
    background: #ecfdf5 !important;
    color: #059669 !important;
    border-color: #a7f3d0 !important;
    font-weight: 800 !important;
  }}
  .k-header-pill.k-header-pill-success {{
    background: #ecfdf5;
    color: #065f46;
    border-color: #a7f3d0;
  }}
  .k-header-pill.k-header-pill-success strong {{
    color: #059669;
  }}
  .k-header-pill.k-header-pill-export {{
    background: #2563eb !important;
    color: #ffffff !important;
    border: 1px solid #2563eb !important;
    cursor: pointer;
    transition: all 0.15s ease;
    font-weight: 700;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
  }}
  .k-header-pill.k-header-pill-export:hover {{
    background: #1d4ed8 !important;
    border-color: #1d4ed8 !important;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
  }}

  .kontingent-table-card {{
    background: transparent;
    border: none;
    box-shadow: none;
    width: 100%;
    display: flex;
    flex-direction: column;
  }}
  .kontingent-table-wrap {{
    width: 100%;
    overflow-x: auto;
  }}
  .kontingent-table {{
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 8px;
    font-family: inherit;
    text-align: left;
  }}
  .kontingent-table th {{
    color: #64748b;
    font-size: 11.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    padding: 8px 16px;
    white-space: nowrap;
    border: none;
  }}
  .kontingent-row {{
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }}
  .kontingent-row td {{
    padding: 13px 16px;
    font-size: 13.5px;
    vertical-align: middle;
    border-top: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
  }}
  .kontingent-row td:first-child {{
    border-left: 1px solid #e2e8f0;
    border-top-left-radius: 10px;
    border-bottom-left-radius: 10px;
  }}
  .kontingent-row td:last-child {{
    border-right: 1px solid #e2e8f0;
    border-top-right-radius: 10px;
    border-bottom-right-radius: 10px;
  }}
  .kontingent-row:hover {{
    background: #ffffff;
    border-color: #2563eb;
    box-shadow: 0 4px 16px rgba(37, 99, 235, 0.12);
    transform: translateY(-1px);
  }}
  .kontingent-row:hover td {{
    border-color: #2563eb;
  }}
  .kontingent-row.active {{
    background: #eff6ff !important;
  }}
  .kontingent-row.active td {{
    border-color: #2563eb !important;
    background: #eff6ff !important;
  }}
  .kontingent-row.active td:first-child {{
    border-left: 3px solid #2563eb !important;
  }}
  .kontingent-row.active .k-action-btn {{
    background: #2563eb !important;
    color: #ffffff !important;
    border-color: #2563eb !important;
  }}

  .k-num-badge {{
    font-size: 12px;
    font-weight: 800;
    color: #2563eb;
    background: rgba(37, 99, 235, 0.08);
    border: 1px solid rgba(37, 99, 235, 0.2);
    padding: 3px 8px;
    border-radius: 6px;
    font-family: 'JetBrains Mono', monospace;
    display: inline-block;
  }}
  .leader-avatar {{
    color: #2563eb;
    display: inline-block;
    vertical-align: -2px;
    margin-right: 6px;
  }}
  .k-grp-badge {{
    color: #ffffff;
    font-weight: 800;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 8px;
    letter-spacing: 0.3px;
    display: inline-block;
  }}
  .k-grp-badge-farm {{
    background: #059669 !important;
    box-shadow: 0 2px 6px rgba(5, 150, 105, 0.25);
  }}
  .k-grp-badge-hamsh {{
    background: #2563eb !important;
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
  }}
  .k-yon-wrap {{
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }}
  .k-count-pill {{
    background: rgba(37, 99, 235, 0.08);
    color: #2563eb;
    font-weight: 800;
    font-size: 12.5px;
    padding: 4px 12px;
    border-radius: 12px;
    border: 1px solid rgba(37, 99, 235, 0.2);
    display: inline-block;
    white-space: nowrap;
    font-family: 'JetBrains Mono', monospace;
  }}
  .k-ver-wrap {{
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }}
  .k-ver-text {{
    font-size: 12px;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
  }}
  .k-ver-completed {{ color: #059669; }}
  .k-ver-near {{ color: #0284c7; }}
  .k-ver-pending {{ color: #d97706; }}
  .k-mini-bar {{
    width: 90px;
    height: 6px;
    background: #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
  }}
  .k-mini-bar-fill {{
    height: 100%;
    border-radius: 10px;
    transition: width 0.3s ease;
  }}
  .k-action-btn {{
    font-size: 11.5px;
    font-weight: 700;
    color: #475569;
    background: #ffffff;
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    white-space: nowrap;
    transition: all 0.15s ease;
    display: inline-block;
  }}
  .kontingent-row:hover .k-action-btn {{
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
  }}

  /* Footer */
  .kontingent-footer {{
    background: #f1f5f9;
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
  }}
  .kontingent-footer td {{
    padding: 14px 16px;
    border-top: 1.5px solid #cbd5e1;
    border-bottom: 1.5px solid #cbd5e1;
  }}
  .kontingent-footer td:first-child {{
    border-left: 1.5px solid #cbd5e1;
    border-top-left-radius: 10px;
    border-bottom-left-radius: 10px;
  }}
  .kontingent-footer td:last-child {{
    border-right: 1.5px solid #cbd5e1;
    border-top-right-radius: 10px;
    border-bottom-right-radius: 10px;
  }}
  .kontingent-footer:hover {{
    background: #e2e8f0;
    border-color: #2563eb;
  }}
  .kontingent-footer:hover td {{
    border-color: #2563eb;
  }}
  .td-jami-label {{
    font-size: 13px;
    letter-spacing: 0.5px;
    color: #0f172a;
    font-weight: 800;
    text-transform: uppercase;
  }}
  .k-count-pill-total {{
    background: #0f172a;
    color: #ffffff;
    border: none;
    padding: 5px 14px;
    font-size: 13px;
    border-radius: 10px;
  }}
  .k-action-btn-all {{
    background: #0f172a;
    color: #ffffff;
    border-color: #0f172a;
    padding: 6px 14px;
  }}

  /* Dark Mode Moslashuvi */
  body.dark-mode .kontingent-panel {{
    background: #111a28;
    border-color: #233047;
    box-shadow: 0 8px 28px -4px rgba(0, 0, 0, 0.45);
  }}
  body.dark-mode .k-crest-box {{
    background: rgba(56, 189, 248, 0.12);
    border-color: rgba(56, 189, 248, 0.3);
    color: #38bdf8;
  }}
  body.dark-mode .kontingent-title {{
    color: #f8fafc !important;
  }}
  body.dark-mode .kontingent-subtitle {{
    color: #cbd5e1 !important;
  }}
  body.dark-mode .kontingent-header {{
    border-bottom-color: #233047 !important;
  }}
  body.dark-mode .k-header-pill {{
    background: #1e293b !important;
    border-color: #334155 !important;
    color: #cbd5e1 !important;
  }}
  body.dark-mode .k-header-pill strong {{
    color: #ffffff !important;
  }}
  body.dark-mode .k-header-pill-accreditation {{
    background: rgba(16, 185, 129, 0.15) !important;
    color: #34d399 !important;
    border-color: rgba(16, 185, 129, 0.4) !important;
  }}
  body.dark-mode .k-header-pill.k-header-pill-success {{
    background: #064e3b !important;
    color: #6ee7b7 !important;
    border-color: #047857 !important;
  }}
  body.dark-mode .k-header-pill.k-header-pill-success strong {{
    color: #34d399 !important;
  }}
  body.dark-mode .kontingent-table th {{
    color: #94a3b8 !important;
  }}
  body.dark-mode .kontingent-row {{
    background: #172234;
    border-color: #283850;
    color: #f8fafc;
  }}
  body.dark-mode .kontingent-row td {{
    border-color: #283850;
    color: #f1f5f9;
  }}
  body.dark-mode .kontingent-row td:first-child {{
    border-left-color: #283850;
  }}
  body.dark-mode .kontingent-row td:last-child {{
    border-right-color: #283850;
  }}
  body.dark-mode .kontingent-row:hover {{
    background: #1e2c42;
    border-color: #38bdf8;
    box-shadow: 0 4px 16px rgba(56, 189, 248, 0.18);
  }}
  body.dark-mode .kontingent-row:hover td {{
    border-color: #38bdf8;
  }}
  body.dark-mode .kontingent-row.active {{
    background: #1e3a5f !important;
  }}
  body.dark-mode .kontingent-row.active td {{
    background: #1e3a5f !important;
    border-color: #38bdf8 !important;
  }}
  body.dark-mode .kontingent-row.active td:first-child {{
    border-left: 3px solid #38bdf8 !important;
  }}
  body.dark-mode .k-num-badge {{
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.12);
    border-color: rgba(56, 189, 248, 0.3);
  }}
  body.dark-mode .leader-avatar {{
    color: #38bdf8;
  }}
  body.dark-mode .td-leader {{
    color: #f8fafc !important;
    font-weight: 700 !important;
  }}
  body.dark-mode .td-yon {{
    color: #cbd5e1 !important;
    font-weight: 600 !important;
  }}
  body.dark-mode .k-count-pill {{
    background: rgba(56, 189, 248, 0.12);
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.3);
  }}
  body.dark-mode .k-ver-completed {{ color: #34d399; }}
  body.dark-mode .k-ver-near {{ color: #38bdf8; }}
  body.dark-mode .k-ver-pending {{ color: #fbbf24; }}
  body.dark-mode .k-mini-bar {{
    background: #0b1320;
  }}
  body.dark-mode .k-action-btn {{
    background: #1e293b;
    color: #94a3b8;
    border-color: #334155;
  }}
  body.dark-mode .kontingent-row:hover .k-action-btn {{
    background: #38bdf8;
    color: #0f172a;
    border-color: #38bdf8;
    box-shadow: 0 2px 10px rgba(56, 189, 248, 0.4);
  }}
  body.dark-mode .kontingent-footer {{
    background: #172234;
    border-color: #283850;
  }}
  body.dark-mode .kontingent-footer td {{
    border-color: #283850;
  }}
  body.dark-mode .kontingent-footer:hover {{
    background: #1e2c42;
    border-color: #38bdf8;
  }}
  body.dark-mode .kontingent-footer:hover td {{
    border-color: #38bdf8;
  }}
  body.dark-mode .td-jami-label {{
    color: #f8fafc;
  }}
  body.dark-mode .k-count-pill-total {{
    background: #38bdf8;
    color: #0f172a;
  }}
  body.dark-mode .k-action-btn-all {{
    background: #38bdf8;
    color: #0f172a;
    border-color: #38bdf8;
  }}
  body.dark-mode .k-header-pill.k-header-pill-export {{
    background: #2563eb !important;
    color: #ffffff !important;
    border-color: #3b82f6 !important;
  }}
  body.dark-mode .k-header-pill.k-header-pill-export:hover {{
    background: #1d4ed8 !important;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4) !important;
  }}
  body.dark-mode .card-group-badge.grp-withdrawn,
  body.dark-mode .table-group-badge.grp-withdrawn {{
    background: rgba(239, 68, 68, 0.2) !important;
    color: #f87171 !important;
    border-color: rgba(239, 68, 68, 0.45) !important;
  }}
  body.dark-mode .btn-filter-withdrawn {{
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
    border-color: rgba(239, 68, 68, 0.35);
  }}
  body.dark-mode .btn-filter-withdrawn:hover {{
    background: rgba(239, 68, 68, 0.25);
    color: #fca5a5;
  }}
  body.dark-mode .btn-filter-withdrawn.active {{
    background: #dc2626 !important;
    color: #ffffff !important;
  }}
  .grp-stat-top {{
    display: flex;
    justify-content: space-between;
    align-items: center;
  }}
  .grp-stat-badge {{
    color: #ffffff;
    font-size: 11.5px;
    font-weight: 800;
    padding: 3px 8px;
    border-radius: 6px;
    letter-spacing: 0.3px;
  }}
  .grp-stat-percent {{
    font-size: 14px;
    font-weight: 900;
    color: #059669;
  }}
  .grp-stat-sub {{
    font-size: 11px;
    color: #64748b;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .grp-stat-leader {{
    font-size: 11.5px;
    color: #475569;
    font-weight: 600;
    margin: 3px 0 5px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .grp-stat-leader strong,
  .grp-stat-leader .leader-name {{
    color: #0f172a;
    font-weight: 800;
  }}
  .grp-stat-all .grp-stat-badge {{
    background: #475569;
    color: #ffffff;
  }}
  .grp-stat-all .grp-stat-percent {{
    color: #2563eb;
  }}
  .grp-stat-all .grp-stat-bar-fill {{
    background: #2563eb;
  }}
  .grp-stat-count {{
    font-size: 12px;
    color: #334155;
    font-weight: 600;
  }}
  .grp-stat-count strong {{
    font-size: 14.5px;
    font-weight: 900;
    color: #0f172a;
  }}
  .grp-stat-bar {{
    width: 100%;
    height: 7px;
    background: #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
    margin-top: 4px;
  }}
  .grp-stat-bar-fill {{
    height: 100%;
    background: linear-gradient(90deg, #10b981 0%, #059669 100%);
    border-radius: 10px;
    transition: width 0.4s ease;
  }}

  .card-header {{
    background: #f1f5f9;
    border-bottom: 2px solid #cbd5e1;
    padding: 12px 20px;
    display: flex; justify-content: space-between; align-items: center;
    flex-wrap: wrap; gap: 10px;
  }}
  .card-header-left {{
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  }}
  .card-header-right {{
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }}

  .card-tr-badge {{
    background: #0f172a; color: #ffffff; font-weight: 800; font-size: 13px;
    padding: 4px 10px; border-radius: 8px; letter-spacing: 0.3px;
    border: 1px solid #334155;
  }}
  .card-shnum-pill {{
    background: #eff6ff; color: #1d4ed8; border: 2px solid #93c5fd;
    font-weight: 800; font-size: 13px; padding: 4px 12px; border-radius: 8px;
    cursor: pointer; transition: all 0.15s ease;
  }}
  .card-shnum-pill:hover {{
    background: #1d4ed8; color: #ffffff;
  }}
  .card-group-select {{
    padding: 5px 10px; border-radius: 8px; font-weight: 800; font-size: 13px;
    border: 2px solid #94a3b8; background: #ffffff; color: #1e3a8a;
    cursor: pointer; outline: none; transition: border-color 0.15s;
  }}
  .card-group-select:focus {{
    border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15);
  }}
  .card-yon-tag {{
    background: #e2e8f0; color: #334155; font-size: 11.5px; font-weight: 700;
    padding: 4px 10px; border-radius: 6px; border: 1px solid #cbd5e1;
  }}

  .c-badge {{
    padding: 5px 12px; border-radius: 20px; font-size: 11.5px; font-weight: 700;
    display: inline-flex; align-items: center; gap: 5px;
  }}
  .c-badge-full {{ background: #dcfce7; color: #15803d; border: 1.5px solid #86efac; }}
  .c-badge-chala {{ background: #fef3c7; color: #b45309; border: 1.5px solid #fcd34d; }}
  .c-badge-yoq {{ background: #fee2e2; color: #b91c1c; border: 1.5px solid #fca5a5; }}

  .card-body {{
    padding: 18px 20px; display: flex; flex-direction: column; gap: 16px;
  }}

  .card-box {{
    border-radius: 14px; border: 2px solid #cbd5e1; padding: 14px 16px;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.03);
  }}
  .box-title {{
    font-size: 12px; font-weight: 800; color: #475569; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;
  }}

  .card-box-fio {{
    background: #f8faff; border: 2px solid #94a3b8;
  }}
  .card-box-fio .box-title {{
    color: #334155;
  }}
  .fio-grid {{
    display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px;
  }}
  .fio-col {{
    background: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 10px 14px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.03);
  }}
  .fio-caption {{
    font-size: 11px; font-weight: 800; color: #64748b; display: block; margin-bottom: 4px;
    text-transform: uppercase; letter-spacing: 0.4px;
  }}
  .fio-text-main {{
    font-size: 16px; font-weight: 800; color: #0f172a; line-height: 1.35; word-break: break-word;
  }}
  .fio-text-sub {{
    font-size: 12px; color: #64748b; font-weight: 600; margin-top: 3px;
  }}

  .card-columns-2 {{
    display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px;
  }}
  .card-box-passport {{
    background: #f0fdf4; border: 2px solid #16a34a;
    box-shadow: 0 3px 10px rgba(22, 163, 74, 0.08);
  }}
  .card-box-passport .box-title {{
    color: #15803d; font-size: 12.5px; font-weight: 800;
  }}
  .card-box-doc {{
    background: #eff6ff; border: 2px solid #2563eb;
    box-shadow: 0 3px 10px rgba(37, 99, 235, 0.08);
  }}
  .card-box-doc .box-title {{
    color: #1d4ed8; font-size: 12.5px; font-weight: 800;
  }}

  .pass-info-list, .doc-info-list {{
    display: flex; flex-direction: column; gap: 14px;
  }}
  .pass-row, .doc-row {{
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;
    padding-bottom: 8px; border-bottom: 1.5px dashed rgba(0,0,0,0.1);
  }}
  .pass-row:last-child, .doc-row:last-child {{
    border-bottom: none; padding-bottom: 0;
  }}
  .pass-label, .doc-label {{
    font-size: 12.5px; font-weight: 700; color: #334155;
  }}

  /* Pasport Seriya va Raqami Uzoqroq va Aniq */
  .badge-series-pill {{
    background: #1e40af; color: #ffffff; font-family: 'JetBrains Mono', monospace;
    font-size: 14px; font-weight: 800; padding: 3px 10px; border-radius: 7px;
    letter-spacing: 1.5px; display: inline-block; vertical-align: middle;
    margin-right: 12px; border: 1px solid #3b82f6; box-shadow: 0 2px 6px rgba(30, 64, 175, 0.35);
  }}
  .pass-digits {{
    font-family: 'JetBrains Mono', monospace; font-size: 17.5px; font-weight: 800;
    color: #0284c7; letter-spacing: 3px; vertical-align: middle;
  }}
  .pass-number-large {{
    display: inline-flex; align-items: center;
  }}

  /* JShShIR Har 4 Tasi Ajratilgan */
  .pinfl-number-large {{
    font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 800;
    color: #0f172a; background: #ffffff; border: 2px solid #94a3b8; padding: 5px 12px;
    border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    display: inline-flex; align-items: center; gap: 8px;
  }}
  .pinfl-group {{
    background: #f1f5f9; color: #0f172a; padding: 3px 8px; border-radius: 6px;
    border: 1.5px solid #cbd5e1; letter-spacing: 2.5px; display: inline-block;
  }}
  .pinfl-group.pinfl-end {{
    background: #e2e8f0; color: #0f172a; font-weight: 800;
  }}

  .date-large {{
    font-size: 15px; font-weight: 800; color: #0f172a; letter-spacing: 1.2px; font-family: 'JetBrains Mono', monospace;
  }}
  .date-medium {{
    font-size: 13.5px; font-weight: 700; color: #6d28d9; letter-spacing: 1px; font-family: 'JetBrains Mono', monospace;
  }}

  /* Ta'lim Hujjati Seriya va Raqami Uzoqroq va Aniq */
  .badge-doc-ser-pill {{
    background: #059669; color: #ffffff; font-family: 'JetBrains Mono', monospace;
    font-size: 14px; font-weight: 800; padding: 3px 10px; border-radius: 7px;
    letter-spacing: 1.5px; display: inline-block; vertical-align: middle;
    margin-right: 12px; border: 1px solid #10b981; box-shadow: 0 2px 6px rgba(5, 150, 105, 0.35);
  }}
  .doc-digits {{
    font-family: 'JetBrains Mono', monospace; font-size: 17.5px; font-weight: 800;
    color: #15803d; letter-spacing: 3px; vertical-align: middle;
  }}
  .doc-number-large {{
    display: inline-flex; align-items: center;
  }}
  .doc-type-pill {{
    background: #ffffff; border: 1.5px solid #94a3b8; font-size: 11px; font-weight: 800;
    color: #334155; padding: 2px 8px; border-radius: 6px; margin-left: 6px;
  }}
  .doc-school-text {{
    font-size: 13px; font-weight: 700; color: #1e293b; line-height: 1.35; text-align: right; max-width: 65%;
  }}
  .doc-year-badge {{
    background: #ffffff; border: 1.5px solid #2563eb; color: #1d4ed8; font-size: 12px;
    font-weight: 800; padding: 2px 8px; border-radius: 6px;
  }}

  .card-footer {{
    background: #f8fafc; border: 2px solid #cbd5e1; border-radius: 12px;
    padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;
    flex-wrap: wrap; gap: 12px;
  }}
  .card-footer-left {{
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  }}
  .contact-item {{
    display: flex; align-items: center; gap: 6px; font-size: 12.5px;
  }}
  .contact-label {{ font-weight: 600; color: #64748b; }}
  .contact-val {{ font-weight: 800; color: #0f172a; font-family: 'JetBrains Mono', monospace; }}
  .file-name-pill {{
    background: #ffffff; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 6px;
    font-size: 12px; font-weight: 700; color: #1e3a8a; max-width: 320px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block;
  }}

  .btn-card-action {{
    background: #2563eb;
    color: #ffffff !important; font-weight: 600; font-size: 13px; padding: 7px 20px;
    border-radius: 9999px; border: 1.5px solid #2563eb; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px;
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    text-decoration: none; user-select: none;
  }}
  .btn-card-action:hover {{
    background: #1d4ed8; border-color: #1d4ed8;
    box-shadow: 0 6px 20px rgba(37, 99, 235, 0.42);
    transform: translateY(-1.5px);
  }}
  .btn-card-action:active {{
    background: #1e40af; border-color: #1e40af;
    transform: scale(0.97);
  }}

  /* =========================================================================
     TUNGI REJIM (DARK MODE) - KO'ZNI TOLIQTIMAYDIGAN PROFESSIONAL DIZAYN
     ========================================================================= */
  body.dark-mode {{
    --bg: #0b0f19;
    --card: #131b2a;
    --border: #233047;
    --border-hover: #3b4d6e;
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    background: #0b0f19 !important;
    background-image: radial-gradient(#1e293b 1px, transparent 1px) !important;
    color: #f8fafc !important;
  }}

  /* 1. Asosiy Konteynerlar */
  body.dark-mode .view-switcher-bar,
  body.dark-mode .group-nav-container,
  body.dark-mode .table-container,
  body.dark-mode .student-card,
  body.dark-mode .stat-card {{
    background: #131b2a !important;
    border-color: #233047 !important;
    color: #f8fafc !important;
    box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.4) !important;
  }}

  /* 2. Asosiy Rejim Switcher (View Switcher Bar) */
  body.dark-mode .view-switcher-bar {{
    background: #0f172a !important;
    border: 1.5px solid #233047 !important;
  }}
  body.dark-mode .view-switcher-desc,
  body.dark-mode .view-switcher-bar div {{
    color: #cbd5e1 !important;
  }}
  body.dark-mode .view-btn {{
    background: #1a2438 !important;
    color: #cbd5e1 !important;
    border-color: #2d3d5a !important;
  }}
  body.dark-mode .view-btn:hover:not(.active) {{
    background: #24324c !important;
    color: #ffffff !important;
  }}
  body.dark-mode .view-btn.active {{
    background: #2563eb !important;
    color: #ffffff !important;
    border-color: #2563eb !important;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4) !important;
  }}

  /* 3. Statistika Kartalari (Stats Grid) */
  body.dark-mode .stat-card {{
    border: 1.5px solid #233047 !important;
  }}
  body.dark-mode .stat-card:hover {{
    border-color: #3b4d6e !important;
    box-shadow: 0 10px 28px -2px rgba(0, 0, 0, 0.6) !important;
  }}
  body.dark-mode .stat-card .lbl {{
    color: #cbd5e1 !important;
  }}
  body.dark-mode .stat-card .stat-sub,
  body.dark-mode .stat-card div[style*="color:#64748b"] {{
    color: #cbd5e1 !important;
  }}
  body.dark-mode .stat-card .stat-sub strong,
  body.dark-mode .stat-card div[style*="color:#64748b"] strong {{
    color: #ffffff !important;
  }}
  body.dark-mode .stat-card .stat-sub strong[style*="color:#4f46e5"],
  body.dark-mode .stat-card div[style*="color:#4f46e5"] {{
    color: #818cf8 !important;
  }}

  /* 4. Guruhlar Monitoring Paneli (Group Stats Panel) */
  body.dark-mode .group-stats-panel {{
    background: #131b2a !important;
    border: 1.5px solid #233047 !important;
    box-shadow: 0 6px 24px -2px rgba(0, 0, 0, 0.5) !important;
  }}
  body.dark-mode .group-stats-title {{
    color: #f8fafc !important;
  }}
  body.dark-mode .group-stats-subtitle {{
    color: #94a3b8 !important;
  }}
  body.dark-mode .group-stats-header {{
    border-bottom-color: #233047 !important;
  }}
  body.dark-mode .grp-stat-card {{
    background: #151f32 !important;
    border: 1.5px solid #28374e !important;
    color: #e2e8f0 !important;
  }}
  body.dark-mode .grp-stat-card:hover {{
    background: #1c2b46 !important;
    border-color: #38bdf8 !important;
    box-shadow: 0 8px 24px rgba(56, 189, 248, 0.25) !important;
  }}
  body.dark-mode .grp-stat-card.active {{
    border-color: #38bdf8 !important;
    background: #1c2e4a !important;
    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.35) !important;
  }}
  body.dark-mode .grp-stat-card.grp-stat-completed {{
    background: #092c20 !important;
    border-color: #10b981 !important;
  }}
  body.dark-mode .grp-stat-percent {{
    color: #34d399 !important;
    font-weight: 900 !important;
  }}
  body.dark-mode .grp-stat-all .grp-stat-badge {{
    background: #3b82f6 !important;
    color: #ffffff !important;
  }}
  body.dark-mode .grp-stat-all .grp-stat-percent {{
    color: #60a5fa !important;
    font-weight: 900 !important;
  }}
  body.dark-mode .grp-stat-all .grp-stat-bar-fill {{
    background: #3b82f6 !important;
  }}
  body.dark-mode .grp-stat-sub {{
    color: #cbd5e1 !important;
    font-weight: 600 !important;
  }}
  body.dark-mode .grp-stat-card.grp-stat-completed .grp-stat-sub {{
    color: #a7f3d0 !important;
  }}
  body.dark-mode .grp-stat-all .grp-stat-sub {{
    color: #cbd5e1 !important;
  }}
  body.dark-mode .grp-stat-all .grp-stat-leader {{
    color: #93c5fd !important;
  }}
  body.dark-mode .grp-stat-leader {{
    color: #cbd5e1 !important;
    font-size: 11.5px !important;
    font-weight: 600 !important;
  }}
  body.dark-mode .grp-stat-leader strong,
  body.dark-mode .grp-stat-leader .leader-name {{
    color: #38bdf8 !important;
    font-weight: 800 !important;
  }}
  body.dark-mode .grp-stat-card.grp-stat-completed .grp-stat-leader strong,
  body.dark-mode .grp-stat-card.grp-stat-completed .grp-stat-leader .leader-name {{
    color: #6ee7b7 !important;
  }}
  body.dark-mode .grp-stat-count {{
    color: #cbd5e1 !important;
    font-size: 11px !important;
  }}
  body.dark-mode .grp-stat-count strong {{
    color: #ffffff !important;
    font-weight: 900 !important;
  }}
  body.dark-mode .grp-stat-count span {{
    color: #94a3b8 !important;
  }}
  body.dark-mode .grp-stat-card.grp-stat-completed .grp-stat-count {{
    color: #d1fae5 !important;
  }}
  body.dark-mode .grp-stat-card.grp-stat-completed .grp-stat-count strong {{
    color: #ffffff !important;
  }}
  body.dark-mode .grp-stat-bar {{
    background: #0b1320 !important;
  }}
  body.dark-mode .grp-stat-bar-fill {{
    background: linear-gradient(90deg, #38bdf8 0%, #2563eb 100%) !important;
  }}
  body.dark-mode .grp-stat-card.grp-stat-completed .grp-stat-bar-fill {{
    background: linear-gradient(90deg, #34d399 0%, #10b981 100%) !important;
  }}

  /* 5. Sticky Qidiruv va Guruhlar Paneli (Filter Panel) */
  body.dark-mode .filter-panel {{
    background: rgba(19, 27, 42, 0.98) !important;
    backdrop-filter: blur(16px) !important;
    -webkit-backdrop-filter: blur(16px) !important;
    border: 1.5px solid #2d3d5a !important;
    box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.6) !important;
  }}
  body.dark-mode .filter-panel div[style*="border-bottom"] {{
    border-bottom-color: #233047 !important;
  }}
  body.dark-mode .filter-section-title,
  body.dark-mode .filter-panel div[style*="color:#0f172a"] {{
    color: #f8fafc !important;
  }}

  /* Guruh Tab Tugmalari */
  body.dark-mode .group-tab-btn {{
    background: #1a2438 !important;
    color: #cbd5e1 !important;
    border-color: #2d3d5a !important;
  }}
  body.dark-mode .group-tab-btn:hover {{
    background: #24324c !important;
    color: #ffffff !important;
  }}
  body.dark-mode .group-tab-btn.active {{
    background: #2563eb !important;
    color: #ffffff !important;
    border-color: #2563eb !important;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35) !important;
  }}
  body.dark-mode .group-tab-btn.tab-farmat.active {{
    background: #059669 !important;
    border-color: #059669 !important;
    box-shadow: 0 4px 12px rgba(5, 150, 105, 0.4) !important;
  }}

  /* Filtr Label va Ikonkalari */
  body.dark-mode .filter-group label {{
    color: #cbd5e1 !important;
    font-weight: 700 !important;
  }}
  body.dark-mode .filter-group label svg {{
    stroke: #38bdf8 !important;
  }}

  /* Qidiruv Input va Selectlar */
  body.dark-mode .filter-input,
  body.dark-mode .filter-select,
  body.dark-mode .col-filter,
  body.dark-mode .group-select {{
    background: #0d1524 !important;
    color: #f8fafc !important;
    border: 1.5px solid #283956 !important;
  }}
  body.dark-mode .filter-input::placeholder {{
    color: #64748b !important;
  }}
  body.dark-mode .filter-input:focus,
  body.dark-mode .filter-select:focus,
  body.dark-mode .col-filter:focus {{
    border-color: #38bdf8 !important;
    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.25) !important;
    background: #0b111e !important;
  }}

  /* Tugmalar Tizimi (Dark Mode Moslashuvi) */
  body.dark-mode .btn {{
    background: #111e38 !important;
    color: #f8fafc !important;
    border-color: #23385e !important;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25) !important;
  }}
  body.dark-mode .btn:hover {{
    background: #162444 !important;
    border-color: #3b82f6 !important;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4) !important;
  }}
  body.dark-mode .btn:active {{
    border-color: #3b82f6 !important;
    color: #93c5fd !important;
  }}
  body.dark-mode .btn-primary,
  body.dark-mode .btn-export {{
    background: #2563eb !important;
    color: #ffffff !important;
    border-color: #2563eb !important;
  }}
  body.dark-mode .btn-primary:hover,
  body.dark-mode .btn-export:hover {{
    background: #1d4ed8 !important;
    border-color: #1d4ed8 !important;
    box-shadow: 0 6px 20px rgba(37, 99, 235, 0.45) !important;
  }}
  body.dark-mode .btn-add,
  body.dark-mode .btn-save-data,
  body.dark-mode .btn-modal-save {{
    background: #10b981 !important;
    color: #ffffff !important;
    border-color: #10b981 !important;
  }}
  body.dark-mode .btn-add:hover,
  body.dark-mode .btn-save-data:hover,
  body.dark-mode .btn-modal-save:hover {{
    background: #059669 !important;
    border-color: #059669 !important;
    box-shadow: 0 6px 20px rgba(16, 185, 129, 0.45) !important;
  }}
  body.dark-mode .btn-multi-export,
  body.dark-mode .btn-ai-purple,
  body.dark-mode .btn-ai-reanalyze {{
    background: #8b5cf6 !important;
    color: #ffffff !important;
    border-color: #8b5cf6 !important;
  }}
  body.dark-mode .btn-danger,
  body.dark-mode .btn-pdf {{
    background: #ef4444 !important;
    color: #ffffff !important;
    border-color: #ef4444 !important;
  }}
  body.dark-mode .btn-ghost {{
    background: transparent !important;
    color: #60a5fa !important;
    border-color: #3b82f6 !important;
  }}
  body.dark-mode .btn-ghost:hover {{
    background: rgba(59, 130, 246, 0.15) !important;
    box-shadow: 0 4px 14px rgba(59, 130, 246, 0.3) !important;
  }}
  body.dark-mode .view-btn {{
    background: #0b1329 !important;
    color: #cbd5e1 !important;
    border-color: #23385e !important;
  }}
  body.dark-mode .view-btn.active {{
    background: #2563eb !important;
    color: #ffffff !important;
    border-color: #2563eb !important;
    box-shadow: 0 4px 16px rgba(37, 99, 235, 0.4) !important;
  }}
  body.dark-mode .view-btn:hover:not(.active) {{
    background: #162444 !important;
    border-color: #3b82f6 !important;
    color: #ffffff !important;
  }}

  /* Tozalash Tugmasi */
  body.dark-mode .btn-reset-filters,
  body.dark-mode .filter-panel button[onclick="resetAllFilters()"] {{
    background: #111e38 !important;
    color: #f1f5f9 !important;
    border: 1.5px solid #23385e !important;
    border-radius: 9999px !important;
  }}
  body.dark-mode .btn-reset-filters:hover,
  body.dark-mode .filter-panel button[onclick="resetAllFilters()"]:hover {{
    background: #162444 !important;
    border-color: #3b82f6 !important;
    color: #ffffff !important;
  }}

  /* Ko'rsatildi X ta hisoblagichi */
  body.dark-mode .filter-count-badge,
  body.dark-mode .filter-panel div[style*="padding:6px 12px"] {{
    background: #162033 !important;
    color: #cbd5e1 !important;
    border: 1.5px solid #28374e !important;
  }}
  body.dark-mode #shownCount,
  body.dark-mode .filter-count-badge strong {{
    color: #38bdf8 !important;
    font-weight: 800 !important;
  }}

  /* Karta / Jadval Rejimi Tugmalari */
  body.dark-mode .view-mode-toggle {{
    background: #0d1524 !important;
    border: 1px solid #233047 !important;
  }}
  body.dark-mode .view-mode-btn {{
    color: #cbd5e1 !important;
  }}
  body.dark-mode .view-mode-btn:hover:not(.active) {{
    color: #ffffff !important;
    background: rgba(255, 255, 255, 0.08) !important;
  }}
  body.dark-mode .view-mode-btn.active {{
    background: #2563eb !important;
    color: #ffffff !important;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4) !important;
  }}

  /* 6. Talaba Kartasi (Student Card) */
  body.dark-mode .student-card {{
    background: #131b2a !important;
    border: 2px solid #283956 !important;
    border-left: 6px solid #2563eb !important;
    box-shadow: 0 6px 24px -2px rgba(0, 0, 0, 0.4) !important;
  }}
  body.dark-mode .student-card:hover {{
    border-color: #3b82f6 !important;
    border-left-color: #60a5fa !important;
    box-shadow: 0 10px 30px rgba(37, 99, 235, 0.25) !important;
  }}
  body.dark-mode .card-header {{
    background: #0d1524 !important;
    border-bottom: 1.5px solid #233047 !important;
  }}
  body.dark-mode .card-footer {{
    background: #0d1524 !important;
    border: 1.5px solid #233047 !important;
  }}
  body.dark-mode .card-shnum-pill {{
    background: #17243d !important;
    color: #60a5fa !important;
    border: 1.5px solid #2e477a !important;
  }}
  body.dark-mode .card-shnum-pill:hover {{
    background: #2563eb !important;
    color: #ffffff !important;
  }}
  body.dark-mode .card-group-select {{
    background: #162033 !important;
    color: #60a5fa !important;
    border-color: #28374e !important;
  }}
  body.dark-mode .card-yon-tag {{
    background: #1a2438 !important;
    color: #93c5fd !important;
    border-color: #2d3d5a !important;
  }}

  /* Karta Ichki Bloklari */
  body.dark-mode .card-box {{
    border-color: #233047 !important;
  }}
  body.dark-mode .box-title {{
    color: #cbd5e1 !important;
    font-weight: 800 !important;
  }}
  body.dark-mode .box-title svg {{
    stroke: #38bdf8 !important;
  }}

  /* F.I.SH Taqqoslash Bloki */
  body.dark-mode .card-box-fio {{
    background: #0f1828 !important;
    border-color: #233047 !important;
  }}
  body.dark-mode .fio-col {{
    background: #162033 !important;
    border: 1.5px solid #233047 !important;
  }}
  body.dark-mode .fio-caption {{
    color: #94a3b8 !important;
  }}
  body.dark-mode .fio-text-main {{
    color: #ffffff !important;
    font-weight: 700 !important;
  }}
  body.dark-mode .fio-text-sub {{
    color: #94a3b8 !important;
  }}
  body.dark-mode .fio-col-fixed {{
    background: #15233c !important;
    border: 1.5px solid #233c66 !important;
  }}
  body.dark-mode .fio-col-fixed .fio-text-main {{
    color: #60a5fa !important;
  }}
  body.dark-mode .fio-col-pass {{
    background: #0d221c !important;
    border: 1.5px solid #144e3b !important;
  }}
  body.dark-mode .fio-col-cert {{
    background: #162033 !important;
    border: 1.5px solid #28374e !important;
  }}
  body.dark-mode .fio-col-cert .fio-text-main {{
    color: #ffffff !important;
  }}

  /* Pasport va Ta'lim Hujjati Bloklari */
  body.dark-mode .card-box-passport {{
    background: #0b1e19 !important;
    border-color: #124d38 !important;
  }}
  body.dark-mode .card-box-doc {{
    background: #0d1b30 !important;
    border-color: #1a3c6e !important;
  }}
  body.dark-mode .pass-row,
  body.dark-mode .doc-row {{
    border-bottom: 1px dashed rgba(255, 255, 255, 0.08) !important;
  }}
  body.dark-mode .pass-label,
  body.dark-mode .doc-label,
  body.dark-mode .contact-label {{
    color: #94a3b8 !important;
  }}
  body.dark-mode .pass-number-large {{
    color: #60a5fa !important;
  }}
  body.dark-mode .doc-number-large {{
    color: #34d399 !important;
  }}
  body.dark-mode .date-large {{
    color: #facc15 !important;
  }}
  body.dark-mode .date-medium {{
    color: #c084fc !important;
  }}
  body.dark-mode .doc-school-text {{
    color: #f1f5f9 !important;
  }}
  body.dark-mode .doc-type-pill {{
    background: #1e293b !important;
    color: #cbd5e1 !important;
    border-color: #334155 !important;
  }}
  body.dark-mode .doc-year-badge {{
    background: #1e293b !important;
    color: #60a5fa !important;
    border-color: #2563eb !important;
  }}
  body.dark-mode .contact-val {{
    color: #ffffff !important;
  }}
  body.dark-mode .file-name-pill {{
    background: #162033 !important;
    color: #93c5fd !important;
    border-color: #28374e !important;
  }}

  /* PINFL Raqamlari */
  body.dark-mode .pinfl-number-large {{
    background: #0b1320 !important;
    border-color: #293e63 !important;
    color: #38bdf8 !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important;
  }}
  body.dark-mode .pinfl-group {{
    background: #131e33 !important;
    color: #38bdf8 !important;
    border-color: #233654 !important;
  }}
  body.dark-mode .pinfl-group.pinfl-end {{
    background: #1c2b44 !important;
    color: #7dd3fc !important;
    border-color: #38bdf8 !important;
  }}

  /* Karta Holati va Moslik Badjlari */
  body.dark-mode .c-badge-full {{
    background: rgba(16, 185, 129, 0.2) !important;
    color: #34d399 !important;
    border: 1.5px solid rgba(52, 211, 153, 0.4) !important;
  }}
  body.dark-mode .c-badge-chala {{
    background: rgba(245, 158, 11, 0.2) !important;
    color: #fbbf24 !important;
    border: 1.5px solid rgba(251, 191, 36, 0.4) !important;
  }}
  body.dark-mode .c-badge-yoq {{
    background: rgba(239, 68, 68, 0.2) !important;
    color: #f87171 !important;
    border: 1.5px solid rgba(248, 113, 113, 0.4) !important;
  }}
  body.dark-mode .c-badge-match-ok {{
    background: rgba(16, 185, 129, 0.2) !important;
    color: #34d399 !important;
    border: 1px solid rgba(52, 211, 153, 0.4) !important;
  }}
  body.dark-mode .c-badge-match-translit {{
    background: rgba(245, 158, 11, 0.2) !important;
    color: #fbbf24 !important;
    border: 1px solid rgba(251, 191, 36, 0.4) !important;
  }}
  body.dark-mode .c-badge-match-farq {{
    background: rgba(239, 68, 68, 0.2) !important;
    color: #f87171 !important;
    border: 1px solid rgba(248, 113, 113, 0.4) !important;
  }}
  body.dark-mode .c-badge-match-tekshir {{
    background: rgba(168, 85, 247, 0.2) !important;
    color: #c084fc !important;
    border: 1px solid rgba(192, 132, 252, 0.4) !important;
  }}
  body.dark-mode .c-badge-match-boshqa {{
    background: rgba(220, 38, 38, 0.2) !important;
    color: #ef4444 !important;
    border: 1px solid rgba(239, 68, 68, 0.4) !important;
  }}
  body.dark-mode .c-badge-match-none {{
    background: rgba(100, 116, 139, 0.2) !important;
    color: #94a3b8 !important;
    border: 1px solid rgba(148, 163, 184, 0.3) !important;
  }}

  /* Dark mode tasdiqlangan karta (Yashil Karta) */
  body.dark-mode .student-card.card-verified {{
    border: 2.5px solid #10b981 !important;
    border-left: 9px solid #34d399 !important;
    background: #062419 !important;
    box-shadow: 0 6px 26px rgba(16, 185, 129, 0.25) !important;
  }}
  body.dark-mode .student-card.card-verified:hover {{
    border-color: #34d399 !important;
    border-left-color: #6ee7b7 !important;
    box-shadow: 0 10px 32px rgba(16, 185, 129, 0.38) !important;
  }}
  body.dark-mode .student-card.card-verified .card-header {{
    background: linear-gradient(135deg, #093324 0%, #0d4230 100%) !important;
    border-bottom: 2px solid #059669 !important;
  }}
  body.dark-mode .student-card.card-verified .card-footer {{
    background: #062419 !important;
    border-top: 1.5px solid #059669 !important;
  }}
  body.dark-mode .student-card.card-verified .card-tr-badge {{
    background: #059669 !important;
    border-color: #34d399 !important;
  }}
  body.dark-mode .student-card.card-verified .card-box-fio {{
    background: #0b3323 !important;
    border-color: #059669 !important;
  }}
  body.dark-mode .student-card.card-verified .card-box-passport {{
    background: #0a2d1f !important;
    border-color: #059669 !important;
  }}
  body.dark-mode .student-card.card-verified .card-box-doc {{
    background: #0a2d1f !important;
    border-color: #059669 !important;
  }}

  /* 7. Asosiy Jadval (Table View) - Dark Mode Aniq Chiziqli Jadval */
  body.dark-mode .table-container {{
    background: #0b1329 !important;
    border: 1.5px solid #23385e !important;
  }}
  body.dark-mode table {{
    border: 1px solid #23385e !important;
  }}
  body.dark-mode thead tr.th-titles th {{
    background: #070c18 !important;
    border: 1px solid #23385e !important;
    color: #f8fafc !important;
  }}
  body.dark-mode thead tr.th-filters th {{
    background: #0d1629 !important;
    border: 1px solid #23385e !important;
  }}
  body.dark-mode thead tr.th-filters th .col-filter {{
    background: #080e1c !important;
    border: 1px solid #23385e !important;
    color: #f1f5f9 !important;
  }}
  body.dark-mode thead tr.th-filters th .col-filter:focus {{
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3) !important;
  }}
  body.dark-mode tr.student-row td {{
    border: 1px solid #1a273f !important;
    color: #f1f5f9 !important;
  }}
  body.dark-mode tr.student-row:nth-child(even) td {{
    background: #0d1527 !important;
  }}
  body.dark-mode tr.student-row:nth-child(odd) td {{
    background: #111a30 !important;
  }}
  body.dark-mode tr.student-row:hover td {{
    background: #1a2d52 !important;
  }}
  body.dark-mode .student-name {{
    color: #f8fafc !important;
  }}
  body.dark-mode .student-patronymic {{
    color: #94a3b8 !important;
  }}
  body.dark-mode .pass-text {{
    color: #60a5fa !important;
  }}
  body.dark-mode .pinfl-text {{
    color: #c084fc !important;
    font-weight: 700 !important;
  }}
  body.dark-mode .doc-text {{
    color: #34d399 !important;
  }}
  body.dark-mode .yon-badge {{
    color: #38bdf8 !important;
    background: rgba(2, 132, 199, 0.2) !important;
    border: 1px solid rgba(56, 189, 248, 0.3) !important;
  }}
  body.dark-mode .badge-id {{
    background: rgba(99, 102, 241, 0.2) !important;
    color: #a5b4fc !important;
  }}
  body.dark-mode .badge-bio {{
    background: rgba(6, 182, 212, 0.2) !important;
    color: #67e8f9 !important;
  }}
  body.dark-mode .badge-none {{
    background: rgba(239, 68, 68, 0.2) !important;
    color: #fca5a5 !important;
  }}
  body.dark-mode .badge-full {{
    background: rgba(34, 197, 94, 0.2) !important;
    color: #86efac !important;
  }}
  body.dark-mode .badge-chala {{
    background: rgba(234, 179, 8, 0.2) !important;
    color: #fde047 !important;
  }}
  body.dark-mode .btn-view-doc {{
    background: #172554 !important;
    color: #93c5fd !important;
    border-color: #1e40af !important;
  }}
  body.dark-mode .btn-attach-doc {{
    background: #052e16 !important;
    color: #86efac !important;
    border-color: #166534 !important;
  }}
  body.dark-mode .td-fixed-same div {{
    color: #cbd5e1 !important;
  }}
  body.dark-mode .td-fixed-diff {{
    background: rgba(37, 99, 235, 0.2) !important;
  }}
  body.dark-mode .td-fixed-diff div {{
    color: #60a5fa !important;
  }}
  body.dark-mode .td-name-cell.td-name-ok {{
    background: rgba(16, 185, 129, 0.15) !important;
  }}
  body.dark-mode .td-name-cell.td-name-ok .name-cell-text {{
    color: #34d399 !important;
  }}
  body.dark-mode .td-name-cell.td-name-translit {{
    background: rgba(245, 158, 11, 0.15) !important;
  }}
  body.dark-mode .td-name-cell.td-name-translit .name-cell-text {{
    color: #fbbf24 !important;
  }}
  body.dark-mode .td-name-cell.td-name-farq {{
    background: rgba(239, 68, 68, 0.18) !important;
  }}
  body.dark-mode .td-name-cell.td-name-farq .name-cell-text {{
    color: #f87171 !important;
  }}
  body.dark-mode .td-name-cell.td-name-tekshir {{
    background: rgba(168, 85, 247, 0.18) !important;
  }}
  body.dark-mode .td-name-cell.td-name-tekshir .name-cell-text {{
    color: #c084fc !important;
  }}
  body.dark-mode .td-name-cell.td-name-boshqa {{
    background: rgba(220, 38, 38, 0.25) !important;
  }}
  body.dark-mode .td-name-cell.td-name-boshqa .name-cell-text {{
    color: #ef4444 !important;
  }}
  body.dark-mode tr.student-row div[style*="color:#0f172a"] {{
    color: #f8fafc !important;
  }}
  body.dark-mode tr.student-row span[style*="color:#0f172a"] {{
    color: #38bdf8 !important;
  }}
  body.dark-mode tr.student-row span[style*="color:#1e3c72"] {{
    color: #60a5fa !important;
  }}

  /* 8. Section 2: Akademik Guruhlar Jurnali (Toolbar, Kartalar va Aniq Chiziqli Jadvallar) */
  .group-journal-toolbar {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 12px;
    padding: 10px 16px;
    margin-bottom: 16px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }}
  .group-journal-toolbar-title {{
    font-size: 13px;
    font-weight: 600;
    color: #24292f;
    display: flex;
    align-items: center;
    gap: 8px;
  }}
  .group-grid-card {{
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 12px;
    box-shadow: 0 4px 14px rgba(15,23,42,0.05);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }}
  .group-card-header {{
    background: #0f172a;
    color: #ffffff;
    padding: 10px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }}
  .group-journal-table {{
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 12.5px;
    table-layout: fixed;
    border: 1px solid #e2e8f0;
  }}
  .group-journal-table thead tr {{
    background: #f8fafc;
    border-bottom: 2px solid #cbd5e1;
    height: 34px;
    color: #475569;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }}
  .group-journal-table th {{
    border: 1px solid #cbd5e1;
    padding: 6px 10px;
    font-weight: 700;
  }}
  .group-journal-table td {{
    border: 1px solid #e2e8f0;
    padding: 7px 10px;
    color: #334155;
    vertical-align: middle;
  }}
  .group-journal-row {{
    cursor: pointer;
    transition: background 0.1s ease;
  }}
  .group-journal-row:nth-child(even) td {{
    background: #fafcff;
  }}
  .group-journal-row:nth-child(odd) td {{
    background: #ffffff;
  }}
  .group-journal-row:hover td {{
    background: #eff6ff !important;
  }}
  .group-grid-card-n {{
    border-color: #f59e0b !important;
  }}
  .group-journal-table-n thead tr {{
    background: #fefce8 !important;
    border-bottom-color: #fde68a !important;
    color: #92400e !important;
  }}
  .group-journal-table-n th {{
    border-color: #fde68a !important;
  }}
  .group-journal-table-n td {{
    border-color: #fef9c3 !important;
  }}

  /* Dark mode: Akademik Guruhlar Jurnali */
  body.dark-mode .groups-journal-header,
  body.dark-mode #view_groups_section > div:first-child {{
    background: #0b1329 !important;
    border: 1.5px solid #23385e !important;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
  }}
  body.dark-mode #view_groups_section h2 {{
    color: #f8fafc !important;
  }}
  body.dark-mode #view_groups_section p {{
    color: #94a3b8 !important;
  }}
  body.dark-mode .group-journal-toolbar {{
    background: #0b1329 !important;
    border-color: #23385e !important;
    box-shadow: 0 4px 14px rgba(0,0,0,0.3) !important;
  }}
  body.dark-mode .group-journal-toolbar-title {{
    color: #f8fafc !important;
  }}
  body.dark-mode .group-grid-card {{
    background: #0b1329 !important;
    border-color: #23385e !important;
    box-shadow: 0 4px 16px -2px rgba(0, 0, 0, 0.4) !important;
  }}
  body.dark-mode .group-card-header {{
    background: #070c18 !important;
    border-bottom-color: #23385e !important;
  }}
  body.dark-mode .group-journal-table {{
    border-color: #23385e !important;
  }}
  body.dark-mode .group-journal-table thead tr {{
    background: #0e172a !important;
    color: #cbd5e1 !important;
  }}
  body.dark-mode .group-journal-table th {{
    border: 1px solid #23385e !important;
    color: #cbd5e1 !important;
  }}
  body.dark-mode .group-journal-table td {{
    border: 1px solid #1a273f !important;
    color: #f1f5f9 !important;
  }}
  body.dark-mode .group-journal-row:nth-child(even) td {{
    background: #0d1527 !important;
  }}
  body.dark-mode .group-journal-row:nth-child(odd) td {{
    background: #111a30 !important;
  }}
  body.dark-mode .group-journal-row:hover td {{
    background: #1a2d52 !important;
  }}
  body.dark-mode .group-grid-card-n {{
    background: #121927 !important;
    border-color: #92400e !important;
  }}
  body.dark-mode .group-journal-table-n thead tr {{
    background: #1e1b13 !important;
    color: #fef08a !important;
  }}
  body.dark-mode .group-journal-table-n th {{
    border-color: #78350f !important;
    color: #fef08a !important;
  }}
  body.dark-mode .group-journal-table-n td {{
    border-color: #292518 !important;
    color: #fef08a !important;
  }}

  /* 9. Modallar va Talaba Qo'shish Oynasi */
  body.dark-mode .modal-content,
  body.dark-mode #addStudentModal .modal-content,
  body.dark-mode #viewerModal .modal-content {{
    background: #0b1329 !important;
    border: 1.5px solid #23385e !important;
    color: #f8fafc !important;
  }}
  body.dark-mode .modal-header {{
    background: linear-gradient(135deg, #070c18 0%, #0f172a 100%) !important;
    border-bottom: 1.5px solid #23385e !important;
  }}
  body.dark-mode .modal-top-bar {{
    background: #111e38 !important;
    border-color: #23385e !important;
  }}
  body.dark-mode .sect {{
    border-bottom-color: #23385e !important;
  }}
  body.dark-mode .sechd {{
    color: #94a3b8 !important;
  }}
  body.dark-mode .sect-card,
  body.dark-mode .imgblk {{
    background: #111e38 !important;
    border-color: #23385e !important;
  }}
  body.dark-mode table.kv td {{
    border-bottom-color: rgba(35, 56, 94, 0.6) !important;
  }}
  body.dark-mode table.kv td:first-child {{
    color: #94a3b8 !important;
  }}
  body.dark-mode table.kv td:last-child {{
    color: #f8fafc !important;
  }}
  body.dark-mode .imghd .t {{
    color: #f8fafc !important;
  }}
  body.dark-mode .gallery-wrapper,
  body.dark-mode #modalGalleryWrapper {{
    background: #0b1329 !important;
    border-color: #23385e !important;
  }}
  body.dark-mode #addStudentModal .add-modal-body {{
    background: #0b1329 !important;
  }}
  body.dark-mode #addStudentModal .ai-upload-box {{
    background: #111e38 !important;
    border: 2px dashed #2563eb !important;
  }}
  body.dark-mode .ai-upload-box.drag-active,
  body.dark-mode #addStudentModal .ai-upload-box.drag-active {{
    background: rgba(37,99,235,0.25) !important;
    border-color: #60a5fa !important;
    box-shadow: 0 0 20px rgba(59, 130, 246, 0.35) !important;
  }}
  body.dark-mode #addStudentModal .form-card-box {{
    background: #111e38 !important;
    border: 1.5px solid #23385e !important;
  }}
  body.dark-mode #addStudentModal .card-box-head {{
    border-bottom: 1.5px solid #23385e !important;
  }}
  body.dark-mode #addStudentModal .card-box-head.head-blue {{
    background: rgba(37,99,235,0.2) !important;
    color: #93c5fd !important;
  }}
  body.dark-mode #addStudentModal .card-box-head.head-green {{
    background: rgba(16,185,129,0.2) !important;
    color: #6ee7b7 !important;
  }}
  body.dark-mode #addStudentModal .form-group-item label {{
    color: #94a3b8 !important;
  }}
  body.dark-mode #addStudentModal .form-ctrl {{
    background: #0b1329 !important;
    border: 1.5px solid #23385e !important;
    color: #f8fafc !important;
  }}
  body.dark-mode #addStudentModal .form-ctrl:focus {{
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25) !important;
  }}
  body.dark-mode #addStudentModal .form-ctrl option {{
    background: #0b1329 !important;
    color: #f8fafc !important;
  }}
  body.dark-mode #addStudentModal .form-ctrl.ctrl-readonly {{
    background: #070c18 !important;
    color: #64748b !important;
    border-color: #1a273f !important;
  }}
  body.dark-mode #addStudentModal .modal-footer-sticky {{
    background: #070c18 !important;
    border-top: 1px solid #23385e !important;
  }}
  body.dark-mode #addStudentModal .info-helper-box {{
    background: #111e38 !important;
    border: 1px solid #23385e !important;
    color: #94a3b8 !important;
  }}
  body.dark-mode #addStudentModal .file-picker-btn {{
    background: #0b1329 !important;
    border: 1.5px solid #23385e !important;
    color: #cbd5e1 !important;
  }}
  body.dark-mode #addStudentModal div[style*="background: #f0f7ff"],
  body.dark-mode div[style*="background: #f0f7ff"],
  body.dark-mode div[style*="background:#f0f7ff"] {{
    background: #0f1c33 !important;
    border-color: #2b497a !important;
  }}
  body.dark-mode div[style*="color:#1e3c72"],
  body.dark-mode span[style*="color:#1e3c72"] {{
    color: #60a5fa !important;
  }}
  body.dark-mode .data-card {{
    background: #111e38 !important;
    border: 2px solid #23385e !important;
    border-radius: 12px !important;
  }}
  body.dark-mode .data-card[style*="background:#f8fbff"],
  body.dark-mode .data-card[style*="background: #f8fbff"] {{
    background: #0f1c33 !important;
    border-color: #233c66 !important;
  }}
  body.dark-mode .data-card[style*="background:#f6fef9"],
  body.dark-mode .data-card[style*="background: #f6fef9"] {{
    background: #0d241b !important;
    border-color: #1a4d3a !important;
  }}
  body.dark-mode .data-card h4 {{
    border-color: #23385e !important;
  }}
  body.dark-mode .data-card h4[style*="color:#1d4ed8"] {{
    color: #60a5fa !important;
    border-bottom-color: #233c66 !important;
  }}
  body.dark-mode .data-card h4[style*="color:#047857"] {{
    color: #34d399 !important;
    border-bottom-color: #1a4d3a !important;
  }}
  body.dark-mode .data-card-pass {{
    border-left: 5px solid #38bdf8 !important;
  }}
  body.dark-mode .data-card-doc {{
    border-left: 5px solid #34d399 !important;
  }}
  body.dark-mode .data-card-edit-pass {{
    border: 2px solid #3b82f6 !important;
    background: #0e1c38 !important;
  }}
  body.dark-mode .data-card-edit-doc {{
    border: 2px solid #10b981 !important;
    background: #09261d !important;
  }}
  body.dark-mode .data-row {{
    border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
    padding: 7px 0 !important;
    font-size: 14px !important;
  }}
  body.dark-mode .data-row .lbl {{
    color: #94a3b8 !important;
    font-weight: 700 !important;
    font-size: 14px !important;
  }}
  body.dark-mode .data-row .val {{
    color: #f8fafc !important;
    font-weight: 800 !important;
    font-size: 14.5px !important;
  }}
  body.dark-mode .data-row-edit {{
    border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
    padding: 8px 0 !important;
  }}
  body.dark-mode .data-row-edit .lbl {{
    color: #e2e8f0 !important;
    font-weight: 800 !important;
    font-size: 14.5px !important;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  }}
  body.dark-mode .edit-input {{
    background: #090e1a !important;
    color: #ffffff !important;
    border: 2px solid #334e78 !important;
    font-size: 16px !important;
    font-weight: 700 !important;
    height: 46px !important;
    padding: 8px 14px !important;
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.4) !important;
  }}
  body.dark-mode .edit-input:focus {{
    border-color: #38bdf8 !important;
    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.35) !important;
    background: #020617 !important;
  }}
  body.dark-mode .edit-input.mono {{
    font-family: 'JetBrains Mono', monospace !important;
    font-size: 17px !important;
    letter-spacing: 1.5px !important;
    font-weight: 800 !important;
    color: #38bdf8 !important;
  }}

  /* Modal ichidagi katta va yorqin qiymatlar */
  .val-large-pass {{
    font-size: 16.5px !important; font-weight: 900 !important; color: #38bdf8 !important; letter-spacing: 1.5px !important;
  }}
  .val-large-pinfl {{
    font-size: 13.5px !important; font-weight: 700 !important; color: #e2e8f0 !important; letter-spacing: 0.5px !important; font-family: 'JetBrains Mono', monospace;
  }}
  .val-large-dob {{
    font-size: 15.5px !important; font-weight: 800 !important; color: #facc15 !important;
  }}
  .val-large-ber {{
    font-size: 15px !important; font-weight: 800 !important; color: #e879f9 !important;
  }}
  .val-large-doc {{
    font-size: 16.5px !important; font-weight: 900 !important; color: #4ade80 !important; letter-spacing: 1.5px !important;
  }}

  /* Operator Tasdig'i Tugma va Badjlari */
  .c-badge-verified {{
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.4);
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 11.5px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }}
  .c-badge-pending {{
    background: rgba(245, 158, 11, 0.2);
    color: #fbbf24;
    border: 1px solid rgba(251, 191, 36, 0.4);
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 11.5px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }}
  .btn-verify {{
    padding: 7px 18px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    user-select: none;
    border: 1.5px solid transparent;
  }}
  .btn-verify:active {{
    transform: scale(0.97);
  }}
  .btn-verify-action {{
    background: #10b981;
    color: #ffffff;
    border-color: #10b981;
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);
  }}
  .btn-verify-action:hover {{
    background: #059669;
    border-color: #059669;
    box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
    transform: translateY(-1.5px);
  }}
  .btn-verified {{
    background: rgba(16, 185, 129, 0.12);
    color: #10b981;
    border: 1.5px solid #10b981;
  }}
  .btn-verified:hover {{
    background: rgba(239, 68, 68, 0.12);
    color: #ef4444;
    border-color: #ef4444;
    box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
    transform: translateY(-1px);
  }}
  .btn-verify-table {{
    padding: 4px 12px;
    border-radius: 9999px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    border: 1.5px solid transparent;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    white-space: nowrap;
    user-select: none;
  }}
  .btn-verify-table:active {{
    transform: scale(0.97);
  }}
  .btn-verify-table.btn-verify-action {{
    background: #fef3c7;
    color: #b45309;
    border: 1.5px solid #fde68a;
  }}
  .btn-verify-table.btn-verify-action:hover {{
    background: #10b981;
    color: #ffffff;
    border-color: #10b981;
    box-shadow: 0 2px 8px rgba(16, 185, 129, 0.35);
    transform: translateY(-1px);
  }}
  .btn-verify-table.btn-verified {{
    background: #dcfce7;
    color: #15803d;
    border: 1.5px solid #bbf7d0;
  }}
  .btn-verify-table.btn-verified:hover {{
    background: #fee2e2;
    color: #b91c1c;
    border-color: #fecaca;
    box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
    transform: translateY(-1px);
  }}
  .stat-verified::before {{ background: #10b981; }}
  .stat-verified .val {{ color: #10b981; }}

  .btn-theme {{
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.25);
    backdrop-filter: blur(8px);
    cursor: pointer;
  }}
  .btn-theme:hover {{
    background: rgba(255, 255, 255, 0.22);
    transform: translateY(-1px);
  }}

  /* GitHub Auto-Sync Status Chip & Spinner */
  .git-sync-chip {{
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 14px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.25s ease;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(15, 23, 42, 0.6);
    color: #e2e8f0;
    user-select: none;
    text-decoration: none;
  }}
  .git-sync-chip:hover {{
    background: rgba(30, 41, 59, 0.9);
    transform: translateY(-1px);
  }}
  .git-sync-chip.status-synced {{
    border-color: rgba(16, 185, 129, 0.5);
    color: #6ee7b7;
  }}
  .git-sync-chip.status-pending {{
    border-color: rgba(245, 158, 11, 0.5);
    color: #fcd34d;
    background: rgba(245, 158, 11, 0.12);
  }}
  .git-sync-chip.status-syncing {{
    border-color: rgba(59, 130, 246, 0.6);
    color: #93c5fd;
    background: rgba(59, 130, 246, 0.15);
    box-shadow: 0 0 14px rgba(59, 130, 246, 0.35);
  }}
  .git-sync-chip.status-error {{
    border-color: rgba(239, 68, 68, 0.6);
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.15);
  }}
  .gh-spin {{
    display: inline-block;
    width: 13px;
    height: 13px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: ghSpinAnim 0.75s linear infinite;
  }}
  @keyframes ghSpinAnim {{
    from {{ transform: rotate(0deg); }}
    to {{ transform: rotate(360deg); }}
  }}

  /* Ixcham, zamonaviy va pastki o'ng burchakdagi suzuvchi GitHub bildirishnomasi */
  .git-sync-floating-overlay {{
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 99999;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px 10px 12px;
    border-radius: 12px;
    background: rgba(15, 23, 42, 0.92);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow: 0 10px 28px -4px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.1);
    color: #ffffff;
    transform: translateY(30px) scale(0.96);
    opacity: 0;
    pointer-events: none;
    transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
    max-width: 380px;
  }}
  .git-sync-floating-overlay.active {{
    transform: translateY(0) scale(1);
    opacity: 1;
    pointer-events: auto;
  }}
  .git-sync-floating-overlay.syncing,
  .git-sync-floating-overlay.pending {{
    border-left: 3.5px solid #38bdf8;
    box-shadow: 0 10px 28px -4px rgba(0, 0, 0, 0.5), 0 0 16px -2px rgba(56, 189, 248, 0.3), 0 0 0 1px rgba(56, 189, 248, 0.2);
  }}
  .git-sync-floating-overlay.synced {{
    border-left: 3.5px solid #10b981;
    box-shadow: 0 10px 28px -4px rgba(0, 0, 0, 0.5), 0 0 16px -2px rgba(16, 185, 129, 0.3), 0 0 0 1px rgba(16, 185, 129, 0.2);
  }}
  .git-sync-floating-overlay.error {{
    border-left: 3.5px solid #ef4444;
    box-shadow: 0 10px 28px -4px rgba(0, 0, 0, 0.5), 0 0 16px -2px rgba(239, 68, 68, 0.3), 0 0 0 1px rgba(239, 68, 68, 0.2);
  }}
  .git-overlay-icon-wrap {{
    position: relative;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }}
  .git-overlay-spinner {{
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid rgba(56, 189, 248, 0.25);
    border-top-color: #38bdf8;
    animation: ghSpinAnim 0.75s linear infinite;
    display: none;
  }}
  .git-overlay-icon {{
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }}
  .git-overlay-content {{
    flex: 1;
    min-width: 0;
  }}
  .git-overlay-header {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }}
  .git-overlay-title {{
    font-weight: 700;
    font-size: 12.5px;
    color: #f8fafc;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .git-overlay-link {{
    font-size: 10.5px;
    font-weight: 600;
    color: #38bdf8;
    text-decoration: none;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(56, 189, 248, 0.12);
    border: 1px solid rgba(56, 189, 248, 0.25);
    transition: all 0.15s ease;
    white-space: nowrap;
  }}
  .git-overlay-link:hover {{
    background: rgba(56, 189, 248, 0.22);
    color: #7dd3fc;
  }}
  .git-overlay-subtitle {{
    font-size: 11px;
    color: #94a3b8;
    margin-top: 1.5px;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 250px;
  }}
  .git-overlay-close {{
    background: transparent;
    border: none;
    color: #64748b;
    padding: 4px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 2px;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }}
  .git-overlay-close:hover {{
    background: rgba(255, 255, 255, 0.1);
    color: #f1f5f9;
  }}
  @media (max-width: 640px) {{
    .git-sync-floating-overlay {{
      bottom: 16px;
      right: 16px;
      left: 16px;
      max-width: none;
    }}
  }}

  /* =========================================================================
     4 TURDAGI AI MODELLARINI TANLASH PANELI STILLARI
     ========================================================================= */
  .ai-model-selector-wrap {{
    margin: 14px 0 16px 0;
    width: 100%;
  }}
  .ai-model-header-title {{
    font-size: 12px;
    font-weight: 750;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 9px;
  }}
  body.dark-mode .ai-model-header-title {{
    color: #94a3b8;
  }}
  .ai-models-grid {{
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }}
  .ai-model-card {{
    background: #ffffff;
    border: 2px solid #cbd5e1;
    border-radius: 12px;
    padding: 10px 12px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 6px;
    user-select: none;
    position: relative;
  }}
  .ai-model-card:hover {{
    border-color: #3b82f6;
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(59, 130, 246, 0.15);
  }}
  .ai-model-card.active {{
    border-color: #2563eb;
    background: rgba(37, 99, 235, 0.05);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2), 0 6px 18px rgba(37, 99, 235, 0.15);
  }}
  body.dark-mode .ai-model-card {{
    background: #1e293b;
    border-color: #334155;
  }}
  body.dark-mode .ai-model-card:hover {{
    border-color: #60a5fa;
  }}
  body.dark-mode .ai-model-card.active {{
    border-color: #38bdf8;
    background: rgba(56, 189, 248, 0.12);
    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.25), 0 6px 18px rgba(56, 189, 248, 0.2);
  }}
  .ai-model-card-top {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }}
  .ai-model-name {{
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 6px;
  }}
  body.dark-mode .ai-model-name {{
    color: #f8fafc;
  }}
  .ai-model-badge {{
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 7px;
    border-radius: 6px;
    white-space: nowrap;
  }}
  .badge-recommended {{ background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }}
  .badge-pro {{ background: #f3e8ff; color: #6b21a8; border: 1px solid #e9d5ff; }}
  .badge-stable {{ background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }}
  .badge-openai {{ background: #ffedd5; color: #9a3412; border: 1px solid #fed7aa; }}
  body.dark-mode .badge-recommended {{ background: rgba(34, 197, 94, 0.2); color: #86efac; border-color: rgba(34, 197, 94, 0.35); }}
  body.dark-mode .badge-pro {{ background: rgba(168, 85, 247, 0.2); color: #d8b4fe; border-color: rgba(168, 85, 247, 0.35); }}
  body.dark-mode .badge-stable {{ background: rgba(14, 165, 233, 0.2); color: #7dd3fc; border-color: rgba(14, 165, 233, 0.35); }}
  body.dark-mode .badge-openai {{ background: rgba(249, 115, 22, 0.2); color: #fdba74; border-color: rgba(249, 115, 22, 0.35); }}
  .ai-model-desc {{
    font-size: 11px;
    color: #64748b;
    line-height: 1.35;
  }}
  body.dark-mode .ai-model-desc {{
    color: #94a3b8;
  }}

  /* =========================================================================
     KICHIK VA MOBIL EKRANLAR UCHUN TO'LIQ MOSLASHUV (RESPONSIVE)
     ========================================================================= */
  @media (max-width: 1024px) {{
    .cards-container {{
      grid-template-columns: 1fr !important;
      gap: 14px !important;
    }}
    .ai-models-grid {{
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }}
  }}

  @media (max-width: 768px) {{
    .modal-backdrop {{
      padding: 8px !important;
    }}
    .modal-content {{
      max-width: 100% !important;
      width: 100% !important;
      border-radius: 14px !important;
      max-height: 95vh !important;
    }}
    .modal-header {{
      padding: 12px 16px !important;
    }}
    .modal-body, .add-modal-body {{
      padding: 12px 14px !important;
    }}
    .ai-models-grid {{
      grid-template-columns: 1fr !important;
      gap: 8px !important;
    }}
    .ai-upload-row {{
      flex-direction: column !important;
      align-items: stretch !important;
      gap: 10px !important;
    }}
    .ai-upload-row .file-picker-btn,
    .ai-upload-row .btn-ai-action {{
      width: 100% !important;
      box-sizing: border-box !important;
      justify-content: center !important;
    }}
    .add-form-container {{
      grid-template-columns: 1fr !important;
      gap: 14px !important;
    }}
    .form-inputs-grid {{
      grid-template-columns: 1fr !important;
    }}
    .form-group-item.half-width {{
      grid-column: span 1 !important;
    }}
    .modal-footer-sticky {{
      padding: 12px 16px !important;
      flex-direction: column-reverse !important;
      gap: 8px !important;
    }}
    .modal-footer-sticky button {{
      width: 100% !important;
      justify-content: center !important;
    }}
    .group-tabs {{
      overflow-x: auto !important;
      flex-wrap: nowrap !important;
      -webkit-overflow-scrolling: touch !important;
      padding-bottom: 6px !important;
      max-width: 100% !important;
    }}
    .group-tab-btn {{
      white-space: nowrap !important;
      flex-shrink: 0 !important;
    }}
    .card-header {{
      flex-wrap: wrap !important;
      gap: 8px !important;
    }}
    .card-header-left, .card-header-right {{
      flex-wrap: wrap !important;
      width: 100% !important;
      justify-content: space-between !important;
    }}
    .card-footer {{
      flex-wrap: wrap !important;
      gap: 8px !important;
    }}
    .card-footer .card-actions-left,
    .card-footer .card-actions-right {{
      width: 100% !important;
      flex-wrap: wrap !important;
    }}
    .card-footer button {{
      flex: 1 1 auto !important;
      justify-content: center !important;
    }}
  }}
</style>

<!-- ASOSIY DATA VA SKRIPT -->
<script>
var RAW_STUDENTS = {students_json};
</script>
<script>
{js_code}
</script>
</head>
<body class="dark-mode">

<!-- MODAL: Hujjat Rasmlari va Undan Olingan Ma'lumotlar -->
<div id="viewerModal" class="modal-backdrop" onclick="closeModalOnBackdrop(event)">
  <div class="modal-content">
    <div class="modal-header">
      <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1;">
        <button type="button" class="btn-nav-mini" onclick="navigateStudentModal(-1)" id="btnModalPrev" title="Oldingi talaba (← strelka)">← Oldingi</button>
        <button type="button" class="btn-nav-mini" onclick="navigateStudentModal(1)" id="btnModalNext" title="Keyingi talaba (→ strelka)">Keyingi →</button>
        <h3 id="modalTitle" style="margin:0;font-size:15.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Talaba Hujjatlari Tahlili</h3>
      </div>
      <button type="button" class="modal-close" onclick="closeModal()" title="Yopish (Esc)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <div class="modal-body" id="modalBody">
      <!-- Dinamik yuklanadi -->
    </div>
  </div>
</div>

<!-- MODAL: Telegramga Guruhlar Ro'yxatini Yuborish -->
<div id="telegramSendModal" class="modal-backdrop" onclick="if(event.target === this) closeSendTelegramModal()" style="display:none;">
  <div class="modal-content" style="max-width: 580px; height: auto; max-height: 90vh;">
    
    <!-- Modal Header -->
    <div class="modal-header" style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 14px 22px; border-bottom: 1px solid rgba(255,255,255,0.12);">
      <div style="display:flex; align-items:center; gap:12px;">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:10px; background:rgba(255,255,255,0.2); color:#fff; flex-shrink:0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
        </span>
        <div>
          <h3 style="margin: 0; font-size: 15.5px; font-weight: 800; color: #ffffff; letter-spacing: -0.2px;">
            Telegramga Guruhlar Ro'yxatini Yuborish
          </h3>
          <div style="font-size: 11.5px; color: rgba(255,255,255,0.85); margin-top: 2px;">
            Guruhlarning rasmiy jurnali yuqori sifatli rasm (shartnoma №, tug'ilgan sana va imzo bilan) formatida yuboriladi
          </div>
        </div>
      </div>
      <button type="button" class="modal-close" onclick="closeSendTelegramModal()" title="Yopish (Esc)" style="color:#ffffff;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    
    <!-- Modal Body -->
    <div style="padding: 20px 24px; background: #f8fafc; display:flex; flex-direction:column; gap:16px;">
      
      <!-- Manzil Tanlash -->
      <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:14px 16px;">
        <label style="display:block; font-size:12.5px; font-weight:800; color:#1e293b; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.5px;">
          Yuborish manzili
        </label>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <label style="display:flex; align-items:center; gap:10px; padding:8px 12px; border:1.5px solid #cbd5e1; border-radius:8px; cursor:pointer; background:#ffffff; transition:all 0.2s;" onmouseover="this.style.borderColor='#0284c7'" onmouseout="if(!this.querySelector('input').checked) this.style.borderColor='#cbd5e1'">
            <input type="radio" name="tg_target_dest" value="channel" checked style="accent-color:#0284c7; width:16px; height:16px;">
            <div style="flex:1;">
              <div style="font-weight:700; font-size:13px; color:#0f172a;">Rasmiy Telegram Kanal (@shartnomsqabul_shtt)</div>
              <div style="font-size:11.5px; color:#64748b;">Qabul shartnomalari 2026-2027 kanali</div>
            </div>
          </label>
          <label style="display:flex; align-items:center; gap:10px; padding:8px 12px; border:1.5px solid #cbd5e1; border-radius:8px; cursor:pointer; background:#ffffff; transition:all 0.2s;" onmouseover="this.style.borderColor='#0284c7'" onmouseout="if(!this.querySelector('input').checked) this.style.borderColor='#cbd5e1'">
            <input type="radio" name="tg_target_dest" value="personal" style="accent-color:#0284c7; width:16px; height:16px;">
            <div style="flex:1;">
              <div style="font-weight:700; font-size:13px; color:#0f172a;">Shaxsiy bot chati (Ozodbek)</div>
              <div style="font-size:11.5px; color:#64748b;">@shartnoma_editor_bot orqali shaxsiy xabar</div>
            </div>
          </label>
          <label style="display:flex; align-items:center; gap:10px; padding:8px 12px; border:1.5px solid #cbd5e1; border-radius:8px; cursor:pointer; background:#ffffff; transition:all 0.2s;" onmouseover="this.style.borderColor='#0284c7'" onmouseout="if(!this.querySelector('input').checked) this.style.borderColor='#cbd5e1'">
            <input type="radio" name="tg_target_dest" value="both" style="accent-color:#0284c7; width:16px; height:16px;">
            <div style="flex:1;">
              <div style="font-weight:700; font-size:13px; color:#0f172a;">Ikkalasiga ham (Kanal va Shaxsiy chat)</div>
              <div style="font-size:11.5px; color:#64748b;">Kanalga ham, shaxsiy bot chatiga ham yuboriladi</div>
            </div>
          </label>
        </div>
      </div>

      <!-- Guruhni Tanlash -->
      <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:14px 16px;">
        <label style="display:block; font-size:12.5px; font-weight:800; color:#1e293b; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
          Yuboriladigan guruhlar
        </label>
        <select id="tg_select_group" style="width:100%; padding:9px 12px; border:1.5px solid #cbd5e1; border-radius:8px; font-size:13px; font-weight:600; color:#0f172a; background:#f8fafc; outline:none;">
          <option value="ALL" selected>Barcha guruhlar (7 ta rasmiy guruh + safdan chiqarilganlar)</option>
          <option value="26-01">26-01 (Farmatsiya ishi &bull; Mirzayeva.D &bull; 14 nafar)</option>
          <option value="26-02">26-02 (Hamshiralik ishi &bull; Ochilov.D &bull; 30 nafar)</option>
          <option value="26-03">26-03 (Hamshiralik ishi &bull; To'rayeva.S &bull; 29 nafar)</option>
          <option value="26-04">26-04 (Hamshiralik ishi &bull; Hamdamova.M &bull; 29 nafar)</option>
          <option value="26-05">26-05 (Hamshiralik ishi &bull; Rayimova.X &bull; 32 nafar)</option>
          <option value="26-06">26-06 (Hamshiralik ishi &bull; Yuldashev.O &bull; 28 nafar)</option>
          <option value="Talabalar safidan chiqarilganlar">Talabalar safidan chiqarilganlar (2 nafar)</option>
        </select>
      </div>

      <!-- Status / Progress Box -->
      <div id="tgSendStatusBox" style="display:none; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px 14px;">
        <div id="tgSendStatusText" style="font-size:12.5px; font-weight:700; color:#166534;">
          Yuborilmoqda...
        </div>
      </div>

    </div>

    <!-- Modal Footer -->
    <div class="modal-footer" style="padding: 12px 22px; background: #ffffff; border-top: 1px solid #e2e8f0; display:flex; justify-content:flex-end; gap:10px;">
      <button type="button" class="btn" onclick="closeSendTelegramModal()" style="padding:8px 16px; font-size:12.5px; font-weight:700; color:#64748b; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px; cursor:pointer;">
        Bekor qilish
      </button>
      <button type="button" id="btnSubmitTgSend" class="btn btn-telegram" onclick="executeSendTelegram()" style="padding:8px 22px; font-size:12.5px; font-weight:700; border-radius:8px; display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
        <svg class="svg-icon" viewBox="0 0 24 24" fill="currentColor" style="width:15px;height:15px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
        Telegramga Yuborish
      </button>
    </div>

  </div>
</div>

<!-- MODAL: Yangi Talaba Qo'shish (AI + Qo'lda) -->
<div id="addStudentModal" class="modal-backdrop" onclick="closeAddModalOnBackdrop(event)">
  <div class="modal-content" style="max-width: 940px; height: auto; max-height: 92vh;">
    
    <!-- Modal Header -->
    <div class="modal-header" style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 14px 22px; border-bottom: 1px solid rgba(255,255,255,0.08);">
      <div style="display:flex; align-items:center; gap:12px;">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color:#fff; flex-shrink:0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
        </span>
        <div>
          <h3 style="margin: 0; font-size: 15.5px; font-weight: 800; color: #ffffff; letter-spacing: -0.2px;">
            Yangi Talaba Qo'shish (AI Tahlil / Qo'lda Kiritish)
          </h3>
          <div style="font-size: 11.5px; color: #94a3b8; margin-top: 2px;">
            Word hujjatini yuklab AI orqali avtomatik to'ldiring yoki ma'lumotlarni qo'lda kiriting
          </div>
        </div>
      </div>
      <button type="button" class="modal-close" onclick="closeAddStudentModal()" title="Yopish (Esc)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    
    <!-- Modal Body (Scrollable) -->
    <div class="add-modal-body">
      
      <!-- 1. Word Fayl / Rasmni AI orqali avtomatik tahlil qilish (Drag & Drop) -->
      <div class="ai-upload-box" id="addDocDropzone"
           ondragover="event.preventDefault(); this.classList.add('drag-active');"
           ondragleave="this.classList.remove('drag-active');"
           ondrop="event.preventDefault(); this.classList.remove('drag-active'); if(event.dataTransfer.files.length) handleNewDocFileDrop(event.dataTransfer.files[0]);">
        <div class="ai-upload-top">
          <div class="ai-step-title">
            <span class="step-num">1</span>
            <span>Hujjat faylini yuklash (Word .docx yoki Rasm)</span>
            <span class="ai-pill-tag">Drag & Drop / AI Avtomatik</span>
          </div>
          <span class="ai-opt-note">Faylni bu yerga sudrab tashlang yoki tanlang</span>
        </div>

        <!-- 4 Turdagi AI Modellarini Tanlash Paneli -->
        <div class="ai-model-selector-wrap">
          <div class="ai-model-header-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 6v6l4 2"/></svg>
            <span>Qaysi AI Modeli Bilan Tekshirish Kerak? (4 Ta Model):</span>
          </div>
          <div class="ai-models-grid" id="aiModelsGrid">
            <!-- 1. Gemini 3.8 Flash -->
            <div class="ai-model-card active" data-model="google/gemini-3.8-flash" onclick="selectAiModel(this, 'google/gemini-3.8-flash', 'Gemini 3.8 Flash')">
              <div class="ai-model-card-top">
                <span class="ai-model-name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                  Gemini 3.8 Flash
                </span>
                <span class="ai-model-badge badge-recommended">Yangi & Tavsiya</span>
              </div>
              <div class="ai-model-desc">Eng aqlli yangi avlod Flash modeli (Google)</div>
            </div>

            <!-- 2. Gemini 2.5 Flash -->
            <div class="ai-model-card" data-model="google/gemini-2.5-flash" onclick="selectAiModel(this, 'google/gemini-2.5-flash', 'Gemini 2.5 Flash')">
              <div class="ai-model-card-top">
                <span class="ai-model-name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
                  Gemini 2.5 Flash
                </span>
                <span class="ai-model-badge badge-stable">Tezkor</span>
              </div>
              <div class="ai-model-desc">Tezkor va aniq avtomatik o'qish (Google)</div>
            </div>

            <!-- 3. Gemini 2.5 Pro -->
            <div class="ai-model-card" data-model="google/gemini-2.5-pro" onclick="selectAiModel(this, 'google/gemini-2.5-pro', 'Gemini 2.5 Pro')">
              <div class="ai-model-card-top">
                <span class="ai-model-name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>
                  Gemini 2.5 Pro
                </span>
                <span class="ai-model-badge badge-pro">Eng Kuchli</span>
              </div>
              <div class="ai-model-desc">Xira va murakkab hujjatlarni chuqur tahlil qilish</div>
            </div>

            <!-- 4. GPT-4o Vision -->
            <div class="ai-model-card" data-model="openai/gpt-4o" onclick="selectAiModel(this, 'openai/gpt-4o', 'GPT-4o Vision')">
              <div class="ai-model-card-top">
                <span class="ai-model-name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                  GPT-4o Vision
                </span>
                <span class="ai-model-badge badge-openai">OpenAI</span>
              </div>
              <div class="ai-model-desc">OpenAI flagman multimodal ko'rish modeli</div>
            </div>
          </div>
        </div>

        <div class="ai-upload-row">
          <label class="file-picker-btn" for="newDocFileInput" title="Word (.docx) yoki rasm faylini tanlash yoki bu yerga sudrab tashlash">
            <input type="file" id="newDocFileInput" accept=".docx,image/*" style="display:none;" onchange="handleNewDocFileSelected(this)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            <span id="selectedFileName">Word (.docx) yoki rasm tashlang / tanlang...</span>
          </label>

          <button type="button" id="btnAnalyzeNewDocPro" class="btn-ai-action btn-ai-purple" onclick="analyzeUploadedNewDoc(window.selectedAiModel)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
            <span id="btnAiAnalyzeText">QR & Gemini 3.8 Flash Bilan Tahlil</span>
          </button>
        </div>
        
        <div id="newDocStatus" class="ai-status-msg" style="display:none;"></div>
      </div>

      <!-- 2. Forma: Pasport va Ta'lim Hujjati Ma'lumotlari -->
      <div class="add-form-container">
        
        <!-- Chap Karta: Shaxsiy & Pasport Ma'lumotlari -->
        <div class="form-card-box">
          <div class="card-box-head head-blue">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle><line x1="15" y1="8" x2="17" y2="8"></line><line x1="15" y1="12" x2="17" y2="12"></line><line x1="7" y1="16" x2="17" y2="16"></line></svg>
            <span>Shaxsiy & Pasport Ma'lumotlari</span>
          </div>

          <div class="form-inputs-grid">
            <div class="form-group-item full-width">
              <label for="add_ism">Ism va Familiya <span class="req-star">*</span></label>
              <input type="text" id="add_ism" class="form-ctrl" placeholder="Masalan: Karimova Zilola">
            </div>

            <div class="form-group-item full-width">
              <label for="add_ota">Otasining ismi (Sharifi) <span class="req-star">*</span></label>
              <input type="text" id="add_ota" class="form-ctrl" placeholder="Masalan: Sherali qizi">
            </div>

            <div class="form-group-item half-width">
              <label for="add_group">Guruh (Tanlang)</label>
              <select id="add_group" class="form-ctrl">
                <option value="" selected>Guruh belgilanmagan</option>
                <option value="26-01">26-01 (Farmatsiya)</option>
                <option value="26-02">26-02 (Hamshiralik)</option>
                <option value="26-03">26-03 (Hamshiralik)</option>
                <option value="26-04">26-04 (Hamshiralik)</option>
                <option value="26-05">26-05 (Hamshiralik)</option>
                <option value="26-06">26-06 (Hamshiralik)</option>
                <option value="Talabalar safidan chiqarilganlar">Talabalar safidan chiqarilganlar (Maxsus)</option>
              </select>
            </div>

            <div class="form-group-item half-width">
              <label for="add_shnum">Shartnoma raqami</label>
              <input type="text" id="add_shnum" class="form-ctrl mono" placeholder="Masalan: 203 (Ixtiyoriy)">
            </div>

            <div class="form-group-item half-width">
              <label for="add_pv">Pasport seriya va №</label>
              <input type="text" id="add_pv" class="form-ctrl mono" oninput="this.value = this.value.toUpperCase()" placeholder="AD1234567 (Ixtiyoriy)">
            </div>

            <div class="form-group-item half-width">
              <label for="add_pinfl">JSHSHIR (PINFL - 14 xona)</label>
              <input type="text" id="add_pinfl" class="form-ctrl mono" oninput="handlePinflAutoDob(this, 'add_dob')" placeholder="604060 5572 0067 (Ixtiyoriy)" maxlength="17">
            </div>

            <div class="form-group-item half-width">
              <label for="add_dob">Tug'ilgan sana (DOB)</label>
              <input type="text" id="add_dob" class="form-ctrl mono" placeholder="DD.MM.YYYY (Ixtiyoriy)">
            </div>

            <div class="form-group-item half-width">
              <label for="add_ber">Pasport Berilgan Sana</label>
              <input type="text" id="add_ber" class="form-ctrl mono input-ber" placeholder="DD.MM.YYYY (Ixtiyoriy)">
            </div>

            <div class="form-group-item full-width">
              <label for="add_tel">Telefon raqami</label>
              <input type="text" id="add_tel" class="form-ctrl" placeholder="+998 90 123 45 67">
            </div>
          </div>
        </div>

        <!-- O'ng Karta: Ta'lim Hujjati & Yo'nalish -->
        <div class="form-card-box">
          <div class="card-box-head head-green">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>
            <span>Ta'lim Hujjati & Yo'nalish</span>
          </div>

          <div class="form-inputs-grid">
            <div class="form-group-item half-width">
              <label for="add_doctur">Hujjat turi</label>
              <select id="add_doctur" class="form-ctrl">
                <option value="Shahodatnoma">Shahodatnoma (Maktab)</option>
                <option value="Diplom">Diplom (Kollej / Litsey)</option>
              </select>
            </div>

            <div class="form-group-item half-width">
              <label for="add_shdoc">Hujjat seriya va №</label>
              <input type="text" id="add_shdoc" class="form-ctrl mono" placeholder="UM 0123456">
            </div>

            <div class="form-group-item full-width">
              <label for="add_mak">Tugatgan ta'lim muassasasi</label>
              <input type="text" id="add_mak" class="form-ctrl" placeholder="Masalan: 43-sonli umumiy o'rta ta'lim maktabi">
            </div>

            <div class="form-group-item half-width">
              <label for="add_yil">Bitirgan yili</label>
              <input type="text" id="add_yil" class="form-ctrl mono" placeholder="2024">
            </div>

            <div class="form-group-item half-width">
              <label for="add_yon">Yo'nalishi</label>
              <select id="add_yon" class="form-ctrl">
                <option value="Hamshiralik ishi - 3 yillik">Hamshiralik ishi - 3 yillik</option>
                <option value="Hamshiralik ishi - 2 yillik">Hamshiralik ishi - 2 yillik</option>
                <option value="Feldsherlik ishi">Feldsherlik ishi</option>
                <option value="Farmatsiya ishi">Farmatsiya ishi</option>
                <option value="Davolash ishi">Davolash ishi</option>
              </select>
            </div>

            <div class="form-group-item full-width">
              <label for="add_docfile">Word fayl nomi</label>
              <input type="text" id="add_docfile" class="form-ctrl ctrl-readonly" placeholder="Fayl yuklanganda avtomatik to'ldiriladi" readonly>
            </div>

            <div class="info-helper-box full-width">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              <span>Faqat <strong>Ism-Familiya</strong>, <strong>Sharif</strong> va <strong>Guruh</strong> majburiy (*). Boshqa ma'lumotlar ixtiyoriy bo'lib, keyinchalik kiritilishi ham mumkin.</span>
            </div>
          </div>
        </div>

      </div>

    </div>

    <!-- Modal Footer (Fixed Sticky) -->
    <div class="modal-footer-sticky">
      <button type="button" class="btn-modal-cancel" onclick="closeAddStudentModal()">Bekor qilish</button>
      <button type="button" id="btnSaveNewStudent" class="btn-modal-save" onclick="saveNewStudentData()">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        Bazaga Qo'shish (Excelga Saqlash)
      </button>
    </div>

  </div>
</div>

<!-- Suzuvchi GitHub yuklanish bildirishnomasi (Pastki o'ng burchakda) -->
<div id="gitSyncFloatingOverlay" class="git-sync-floating-overlay" role="alert" aria-live="polite">
  <div class="git-overlay-icon-wrap" id="gitOverlayIconWrap">
    <div id="gitOverlaySpinner" class="git-overlay-spinner"></div>
    <div id="gitOverlayIcon" class="git-overlay-icon">
      <svg viewBox="0 0 24 24" fill="#38bdf8" width="16" height="16"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
    </div>
  </div>
  <div class="git-overlay-content">
    <div class="git-overlay-header">
      <div id="gitOverlayTitle" class="git-overlay-title">GitHub: Sinxronlandi</div>
      <a href="https://github.com/ozodbeknapasov007-dotcom/talabalar-jadvali" target="_blank" class="git-overlay-link" title="GitHub repozitoriyasini ochish">
        Repozitoriy ↗
      </a>
    </div>
    <div id="gitOverlaySubtitle" class="git-overlay-subtitle">Barcha ma'lumotlar saqlandi</div>
  </div>
  <button type="button" class="git-overlay-close" onclick="GitSyncManager.dismiss(event)" title="Yopish">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
  </button>
</div>

<div class="container">

  <!-- Header -->
  <div class="header">
    <div class="brand-header-flex">
      <div class="brand-logo-wrap">
        <img src="favicon.svg" alt="Ibn Sino Logo" class="brand-logo-img">
      </div>
      <div>
        <div class="brand-subtitle">Shahrisabz Tibbiyot Texnikumi</div>
        <h1>Talabalar Shartnomalari & Akademik Guruhlar Portali</h1>
        <p>
          <span class="pulse-dot"></span> Jonli Tizim Faol &nbsp;|&nbsp; Barcha {total} talabaning 7 ta guruh bo'yicha Alifbo jurnallari va tahlil hisoboti
        </p>
      </div>
    </div>
    <div class="header-actions">
      <!-- GitHub Sinxronizatsiya Status Chip -->
      <a id="githubSyncBadge" class="git-sync-chip status-synced" href="https://github.com/ozodbeknapasov007-dotcom/talabalar-jadvali" target="_blank" title="GitHub repozitoriyasini ko'rish (Yangi oynada)">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;flex-shrink:0;"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
        <span id="ghSyncSpinner" class="gh-spin" style="display:none;"></span>
        <span id="ghSyncText">GitHub: Sinxronlangan</span>
      </a>

      <!-- Qo'lda saqlash: hisobotni qayta yaratib GitHub'ga yuboradi.
           30 soniyalik avtomatik saqlashni kutmasdan darhol jo'natadi. -->
      <button type="button" id="btnSaveNow" class="btn btn-save-now" onclick="saveAllNow()" title="O'zgarishlarni darhol saqlab GitHub'ga yuborish">
        <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        <span id="btnSaveNowText">Saqlash</span>
      </button>

      <button type="button" class="btn btn-add" onclick="openAddStudentModal()">
        <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
        Yangi Talaba
      </button>
      <!-- YAGONA EKSPORT DROPDOWN TUGMASI (4 TA BO'LIM: YUKLAB OLISH + TELEGRAMGA YUBORISH) -->
      <div id="exportDropdownWrap" style="position:relative; display:inline-block;">
        <button type="button" class="btn btn-export" style="background:linear-gradient(135deg,#059669,#047857);color:#fff;border:none;display:inline-flex;align-items:center;gap:6px;padding:8px 16px;font-weight:700;" onclick="toggleExportDropdown(event)" title="Excel (.xlsx) yuklab olish yoki Telegramga yuborish">
          <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          Eksport (.xlsx / TG)
          <svg style="width:14px;height:14px;margin-left:2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>

        <div id="exportDropdownMenu" style="display:none; position:absolute; right:0; top:calc(100% + 8px); width:460px; max-width:94vw; background:#0f172a; border:1px solid #334155; border-radius:14px; box-shadow:0 20px 40px rgba(0,0,0,0.45); padding:10px; z-index:99999;">
          <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.6px; color:#94a3b8; padding:4px 8px 8px 8px; border-bottom:1px solid #1e293b; margin-bottom:6px;">
            Excel (.xlsx) yuklab olish yoki Telegramga yuborish
          </div>

          <!-- 1. Buxgalteriya -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-radius:10px; background:#1e293b; margin-bottom:6px;">
            <div style="min-width:0;">
              <div style="font-size:13px; font-weight:700; color:#34d399;">1. Buxgalteriya</div>
              <div style="font-size:11px; color:#94a3b8;">Shartnoma № va Pasport ma'lumotlari</div>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button type="button" onclick="exportRoleExcel('buxgalteriya')" style="background:#059669; color:#fff; border:none; border-radius:7px; padding:6px 11px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Kompyuterga .xlsx yuklab olish">
                📥 .xlsx
              </button>
              <button type="button" onclick="sendRoleExcelToTelegram('buxgalteriya')" style="background:#0284c7; color:#fff; border:none; border-radius:7px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Telegram botga yuborish">
                ✈️ TG
              </button>
            </div>
          </div>

          <!-- 2. Baza administratori -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-radius:10px; background:#1e293b; margin-bottom:6px;">
            <div style="min-width:0;">
              <div style="font-size:13px; font-weight:700; color:#60a5fa;">2. Baza administratori</div>
              <div style="font-size:11px; color:#94a3b8;">Pasport va Shahodatnoma/Diplom</div>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button type="button" onclick="exportRoleExcel('admin')" style="background:#2563eb; color:#fff; border:none; border-radius:7px; padding:6px 11px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Kompyuterga .xlsx yuklab olish">
                📥 .xlsx
              </button>
              <button type="button" onclick="sendRoleExcelToTelegram('admin')" style="background:#0284c7; color:#fff; border:none; border-radius:7px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Telegram botga yuborish">
                ✈️ TG
              </button>
            </div>
          </div>

          <!-- 3. Guruh rahbarlari -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-radius:10px; background:#1e293b; margin-bottom:6px;">
            <div style="min-width:0;">
              <div style="font-size:13px; font-weight:700; color:#c084fc;">3. Guruh rahbarlari</div>
              <div style="font-size:11px; color:#94a3b8;">Tug'ilgan sana, Pasport, Shahodatnoma</div>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button type="button" onclick="exportRoleExcel('guruh_rahbari')" style="background:#7c3aed; color:#fff; border:none; border-radius:7px; padding:6px 11px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Kompyuterga .xlsx yuklab olish">
                📥 .xlsx
              </button>
              <button type="button" onclick="sendRoleExcelToTelegram('guruh_rahbari')" style="background:#0284c7; color:#fff; border:none; border-radius:7px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Telegram botga yuborish">
                ✈️ TG
              </button>
            </div>
          </div>

          <!-- 4. To'liq ma'lumotlar (O'zim uchun) -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-radius:10px; background:#1e293b; border:1px solid #475569; margin-bottom:8px;">
            <div style="min-width:0;">
              <div style="font-size:13px; font-weight:700; color:#fbbf24;">4. To'liq ma'lumotlar (O'zim uchun)</div>
              <div style="font-size:11px; color:#94a3b8;">Barcha ustunlar jamlangan to'liq baza</div>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button type="button" onclick="exportRoleExcel('toliq')" style="background:#d97706; color:#fff; border:none; border-radius:7px; padding:6px 11px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Kompyuterga .xlsx yuklab olish">
                📥 .xlsx
              </button>
              <button type="button" onclick="sendRoleExcelToTelegram('toliq')" style="background:#0284c7; color:#fff; border:none; border-radius:7px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Telegram botga yuborish">
                ✈️ TG
              </button>
            </div>
          </div>

          <!-- Guruh jurnallarini rasm sifatida Telegramga yuborish -->
          <div style="border-top:1px solid #1e293b; padding-top:8px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11.5px; color:#cbd5e1; font-weight:600; padding-left:6px;">Guruh jurnallarini (Rasm) TG kanalga:</span>
            <button type="button" onclick="document.getElementById('exportDropdownMenu').style.display='none'; openSendTelegramModal();" style="background:#0ea5e9; color:#fff; border:none; border-radius:7px; padding:6px 12px; font-size:12px; font-weight:700; cursor:pointer;">
              ✈️ Guruhlarni TG yuborish
            </button>
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-refresh" onclick="location.reload()">
        <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        Yangilash
      </button>
      <button type="button" id="themeToggleBtn" class="btn btn-theme" onclick="toggleTheme()" title="Tungi / Kunduzgi rejimni almashtirish">
        <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
        Tungi Rejim
      </button>
    </div>
  </div>

  <!-- ASOSIY REJIM SWITCHER (2 TA KATTA TAB) -->
  <div class="view-switcher-bar">
    <div class="view-switch-btns">
      <button type="button" id="btn_switch_db" class="view-btn active" onclick="switchMainView('database')">
        <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
        1. Umumiy Baza & Hujjatlar Tahlili ({total})
      </button>
      <button type="button" id="btn_switch_groups" class="view-btn" onclick="switchMainView('groups')">
        <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>
        2. Akademik Guruhlar Jurnali (7 ta Guruh)
      </button>
    </div>
    <div class="view-switcher-desc" style="font-size:12px; color:#64748b; font-weight:600;">
      Guruhlar jurnali va talabalar ro'yxatlari
    </div>
  </div>

  <!-- =========================================================================
       SECTION 1: UMUMIY BAZA VA HUJJATLAR TAHLILI JADVALI
       ========================================================================= -->
  <div id="view_database_section">
    {kontingent_panel_html}

    <!-- Boshqaruv & Filtrlar Paneli -->
    <div class="filter-panel">
      <!-- Filtrlar Boshqaruvi va Ko'rinish Rejimi Qatori -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #f1f5f9; flex-wrap:wrap; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <input type="hidden" id="filterGroup" value="">
          <button type="button" class="btn" onclick="resetAllFilters()" style="padding:7px 15px; font-size:12px; font-weight:700; border-radius:8px; display:inline-flex; align-items:center; gap:6px; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; cursor:pointer;" title="Barcha guruh va qidiruv filtrlarini dastlabki holatga qaytarish">
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Filtrlarni Tozalash
          </button>
          <button type="button" class="btn btn-filter-withdrawn" id="btn_filter_withdrawn" onclick="filterByGroup('Talabalar safidan chiqarilganlar')" title="Talabalar safidan chiqarilganlar maxsus guruhini ko'rish / filtrlash" style="{ 'display:inline-flex;' if withdrawn_count > 0 else 'display:none;' }">
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            Safdan chiqarilganlar (<strong id="withdrawn_count_badge">{withdrawn_count}</strong>)
          </button>
        </div>

        <div style="display:flex; align-items:center; gap:10px; margin-left:auto; flex-wrap:wrap;">
          <div class="view-mode-toggle">
            <button type="button" id="btnModeCards" class="view-mode-btn active" onclick="switchDisplayMode('cards')">
              <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
              Karta
            </button>
            <button type="button" id="btnModeTable" class="view-mode-btn" onclick="switchDisplayMode('table')">
              <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              Jadval
            </button>
          </div>
          <button type="button" class="btn" onclick="toggleAllCards(true)" style="padding:6px 12px; font-size:12px; font-weight:700; border-radius:8px; background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; cursor:pointer;" title="Barcha kartalarning hujjat ma'lumotlarini birdan ochish">
            Barchasini ochish
          </button>
          <button type="button" class="btn" onclick="toggleAllCards(false)" style="padding:6px 12px; font-size:12px; font-weight:700; border-radius:8px; background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; cursor:pointer;" title="Barcha kartalarning hujjat ma'lumotlarini yopish">
            Barchasini yopish
          </button>
          <div class="filter-count-badge" style="font-size: 13px; font-weight: 700; white-space:nowrap; background:#f8fafc; padding:6px 12px; border-radius:10px; border:1px solid #cbd5e1;">
            Ko'rsatildi: <strong id="shownCount" style="font-size:15px; font-weight:800;">{total}</strong> ta
          </div>
        </div>
      </div>

      <!-- Asosiy Qidiruv va Filtrlar Qatori -->
      <div class="filter-row">
        <div class="filter-group" style="flex: 2; min-width: 240px;">
          <label>
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            Umumiy Qidiruv (F.I.SH, Pasport, PINFL, Maktab)
          </label>
          <input type="text" id="globalSearch" class="filter-input" placeholder="Tezkor qidirish..." oninput="filterRows()">
        </div>
        <div class="filter-group">
          <label>
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle></svg>
            Pasport Turi
          </label>
          <select id="filterPassType" class="filter-select" onchange="filterRows()">
            <option value="">Barchasi</option>
            <option value="ID-karta">ID-karta (AD / AE)</option>
            <option value="Biometrik Pasport">Biometrik Pasport (AB / AC)</option>
            <option value="Mavjud emas">Mavjud emas (Bo'sh)</option>
          </select>
        </div>
        <div class="filter-group">
          <label>
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>
            Ta'lim Hujjati
          </label>
          <select id="filterDocType" class="filter-select" onchange="filterRows()">
            <option value="">Barchasi</option>
            <option value="Shahodatnoma">Shahodatnoma</option>
            <option value="Diplom">Diplom</option>
          </select>
        </div>
        <div class="filter-group">
          <label>
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
            Hujjat Holati
          </label>
          <select id="filterStatus" class="filter-select" onchange="filterRows()">
            <option value="">Barchasi</option>
            <option value="full">To'liq (Barcha ma'lumotlar bor)</option>
            <option value="chala">Chala (Pasport yoki Shahodatnoma yetishmaydi)</option>
            <option value="yoq">Bo'sh (Hujjat yo'q)</option>
          </select>
        </div>
        <div class="filter-group">
          <label>
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            Ism Mosligi
          </label>
          <select id="filterNameMatch" class="filter-select" onchange="filterRows()">
            <option value="">Barchasi</option>
            <option value="boshqa">Boshqa shaxs hujjati</option>
            <option value="farq">Ro'yxatdan farq bor</option>
            <option value="tekshir">Tekshirish talab etiladi</option>
            <option value="translit">Imlo / translit farqi (q/k, x/h)</option>
            <option value="ok">To'liq mos</option>
            <option value="none">Tekshirilmagan</option>
          </select>
        </div>
        <div class="filter-group">
          <label>
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            Operator Tasdig'i
          </label>
          <select id="filterVerified" class="filter-select" onchange="filterRows()">
            <option value="">Barchasi</option>
            <option value="tasdiqlandi">Tasdiqlanganlar</option>
            <option value="kutilmoqda">Kutilayotganlar</option>
          </select>
        </div>
        <div style="flex-shrink: 0; margin-top: 18px;">
          <button type="button" class="btn btn-reset-filters" onclick="resetAllFilters()">
            Tozalash
          </button>
        </div>
      </div>
    </div>

    <!-- 1. KARTALAR KONTEYNERI (Standart va Katta Ko'rinish) -->
    <div id="studentsCardsContainer" class="cards-container">
      {cards_content}
    </div>

    <!-- 2. ASOSIY JADVAL KONTEYNERI (Tanlanganda Ko'rinadi) -->
    <div class="table-container" id="studentsTableContainer" style="display:none;">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr class="th-titles">
              <th style="width: 35px; text-align: center;">T/R</th>
              <th style="width: 55px; text-align: center;">Guruh</th>
              <th style="width: 55px; text-align: center;">Shartnoma</th>
              <th style="min-width: 170px;">Talabaning To'liq F.I.SH</th>
              <th style="width: 95px;">Pasport / ID</th>
              <th style="width: 115px; text-align: center;">JSHSHIR (PINFL)</th>
              <th style="width: 80px; text-align: center;">Tug'ilgan sana</th>
              <th style="width: 105px;">Shahodatnoma</th>
              <th style="width: 160px;">Tugatgan Muassasasi</th>
              <th style="width: 45px; text-align: center;">Yil</th>
              <th style="width: 55px; text-align: center;">Fayl</th>
              <th style="width: 80px; text-align: center;">Tasdiq</th>
              <th style="width: 35px; text-align: center;">Holat</th>
            </tr>
            <tr class="th-filters">
              <th></th>
              <th><input type="text" id="col_group" class="col-filter" placeholder="Guruh" oninput="filterRows()"></th>
              <th><input type="text" id="col_shnum" class="col-filter" placeholder="№" oninput="filterRows()"></th>
              <th><input type="text" id="col_name" class="col-filter" placeholder="F.I.SH..." oninput="filterRows()"></th>
              <th><input type="text" id="col_pass" class="col-filter" placeholder="Pasport" oninput="filterRows()"></th>
              <th><input type="text" id="col_pinfl" class="col-filter" placeholder="JSHSHIR" oninput="filterRows()"></th>
              <th><input type="text" id="col_dob" class="col-filter" placeholder="Sana" oninput="filterRows()"></th>
              <th><input type="text" id="col_doc" class="col-filter" placeholder="Hujjat" oninput="filterRows()"></th>
              <th><input type="text" id="col_mak" class="col-filter" placeholder="Maktab..." oninput="filterRows()"></th>
              <th><input type="text" id="col_yil" class="col-filter" placeholder="Yil" oninput="filterRows()"></th>
              <th><input type="text" id="col_file" class="col-filter" placeholder="Fayl" oninput="filterRows()"></th>
              <th>
                <select id="col_verified" class="col-filter" onchange="filterRows()">
                  <option value="">Barchasi</option>
                  <option value="tasdiqlandi">Tasdiq</option>
                  <option value="kutilmoqda">Kutilmoqda</option>
                </select>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody id="studentsTbody">
            {tbody_content}
          </tbody>
        </table>
      </div>
    </div>

    <div style="margin-top: 16px; font-size: 12.5px; color: #64748b; display: flex; justify-content: space-between; align-items: center;">
      <div>Ko'rsatilmoqda: <strong id="shownCount" class="shown-count-val">{total}</strong> ta talaba</div>
      <div>Guruh dropdown orqali to'g'ridan-to'g'ri o'zgartiriladi va saqlanadi &bull; Barcha huquqlar himoyalangan &copy; 2026-2027</div>
    </div>

  </div>

  <!-- =========================================================================
       SECTION 2: AKADEMIK GURUHLAR JURNALI (7 TA GURUH A-Z)
       ========================================================================= -->
  <div id="view_groups_section" style="display:none;">
    
    <div class="groups-journal-header" style="background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:18px 24px; margin-bottom:24px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px; box-shadow:0 4px 16px rgba(0,0,0,0.02);">
      <div>
        <h2 class="groups-journal-title" style="font-size:18px; font-weight:800; display:flex; align-items:center; gap:8px;">
          <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>
          2026-2027 O'quv Yili Akademik Guruhlar Jurnali
        </h2>
        <p style="font-size:13px; color:#64748b; margin-top:3px;">
          Akademik guruhlar talabalari ro'yxati va rasmiy jurnallari
        </p>
      </div>
    </div>

    <!-- 7 ta Guruh Jadvallari Konteyneri (Dinamik to'ldiriladi) -->
    <div id="groupsJournalContainer"></div>

  </div>

</div>

</body>
</html>
"""

with open(OUTPUT_HTML, 'w', encoding='utf-8') as f:
    f.write(html)

with open(MAIN_HTML, 'w', encoding='utf-8') as f:
    f.write(html)

with open(ROOT_HISOBOT, 'w', encoding='utf-8') as f:
    f.write(html)

with open(INDEX_HTML, 'w', encoding='utf-8') as f:
    f.write(html)

# Next.js versiyasi (web/) uchun ma'lumot alohida JSON faylda — sahifaga
# 2.8 MB HTML ichidan ajratib olmasdan, faqat shu ~130 KB yuklanadi.
with open(os.path.join(BASE_DIR, 'data', 'students.json'), 'w', encoding='utf-8') as f:
    f.write(students_json)

# Formatlangan ko'p sahifali (8 ta guruh) Excel faylini saqlash
try:
    sys.path.insert(0, os.path.join(BASE_DIR, 'xizmatlar'))
    from telegram_sync_service import apply_full_excel_styling, build_full_multisheet_excel
    source_wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    source_ws = source_wb.worksheets[0]
    multisheet_wb = build_full_multisheet_excel(source_ws)
    # Vaqt tamg'asini qotirib qo'yamiz: aks holda openpyxl har safar
    # docProps/core.xml ga yangi sana yozadi va ma'lumot umuman o'zgarmagan
    # bo'lsa ham fayl "o'zgargan" bo'lib har bir commit ga tushaveradi.
    import datetime as _dt
    import io as _io
    import time as _time
    import zipfile as _zipfile
    _fixed = _dt.datetime(2026, 1, 1, 0, 0, 0)
    multisheet_wb.properties.created = _fixed
    multisheet_wb.properties.modified = _fixed

    raw_buf = _io.BytesIO()
    multisheet_wb.save(raw_buf)
    raw_buf.seek(0)

    pinned_buf = _io.BytesIO()
    with _zipfile.ZipFile(raw_buf, 'r') as zin, _zipfile.ZipFile(pinned_buf, 'w', _zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data_bytes = zin.read(item.filename)
            if item.filename == 'docProps/core.xml':
                data_bytes = re.sub(
                    rb'(<dcterms:modified[^>]*>)[^<]*(</dcterms:modified>)',
                    rb'\g<1>2026-01-01T00:00:00Z\g<2>',
                    data_bytes,
                )
            info = _zipfile.ZipInfo(item.filename, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = _zipfile.ZIP_DEFLATED
            info.external_attr = item.external_attr
            zout.writestr(info, data_bytes)

    xlsx_bytes = pinned_buf.getvalue()
    for _xlsx_path in (os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx'),
                       os.path.join(BASE_DIR, 'qayta_tekshiruv', 'Talabalar_Yangilangan_Royxat.xlsx')):
        for _attempt in range(3):
            try:
                with open(_xlsx_path, 'wb') as _xf:
                    _xf.write(xlsx_bytes)
                break
            except (OSError, PermissionError):
                if _attempt == 2:
                    raise
                _time.sleep(0.3)
    print("[OK] Yangilangan Excel fayli (8 ta sahifali) saqlandi!")
except Exception as e_style:
    print(f"Excel stilini qo'llashda xatolik: {e_style}")

# Guruhlar uchun toza A4 PDF jurnallarini yangilash
try:
    try:
        from generate_pdfs import build_all_group_pdfs
    except ImportError:
        from qayta_tekshiruv.generate_pdfs import build_all_group_pdfs
    build_all_group_pdfs()
    print("[OK] Guruh PDF jurnallari muvaffaqiyatli yangilandi!")
except Exception as e_pdf:
    print(f"PDF jurnallarni yaratishda xatolik: {e_pdf}")

print(f"[OK] Mukammal 2-Rejimli va Guruhlar Dropdownli hisobot yaratildi: {OUTPUT_HTML}")
