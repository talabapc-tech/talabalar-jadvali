# -*- coding: utf-8 -*-
"""
MASTER DATA REPAIR & SYNC SCRIPT
=================================
1. Asosiy talabalar bazasi git tarixidagi toza holatdan (3659f2a~1:data/students.json) olinadi.
2. "973350582 / 978635082" kabi barcha holatlar:
   - 1-raqam -> tel_shaxsiy (+998 XX XXX-XX-XX)
   - 2-raqam -> tel_otaona (+998 XX XXX-XX-XX)
   - Qarindoshligi -> tel_otaona_kim ("Otasi / Onasi")
3. Shartnoma raqami yo'q talabalar "Shaxrisabz debitorka final (107).xlsx" dan to'ldiriladi.
4. Google Sheets so'rovnomasi (data/google_sheet_survey.xlsx) to'liq, xatosiz, .0 buglarsiz o'qiladi.
   - Bir necha marta to'ldirgan talabalarning eng oxirgi (yangi) javobi olinadi.
   - 1-kurs talabalariga bog'lanadi (manzillar, shaxsiy va ota-onasi telefonlari, qatnov).
5. So'rovnoma to'ldirmagan 1-kurs talabalari ro'yxati aniqlanadi.
6. EXPORTDA t.s.ch (safidan chiqarilganlar) va akademik olgan guruhlar olinmaydi.
7. data/students.json, talabalar_bazasi.json, sorovnoma_1kurs.json, Excel fayllar va Supabase yangilanadi.
"""

import os
import sys
import json
import re
import subprocess
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
UZB_PREFIXES = ('90', '91', '92', '93', '94', '95', '97', '98', '99', '88', '77', '33', '50', '55', '70', '71', '75', '76', '78')

def clean_phone_val(val):
    """
    Har qanday qiymatdan (float, int, str) toza 9 xonali telefon raqamlarini ajratadi.
    Float .0 larni int qilib to'g'irlaydi, oxiriga 0 qo'shmaydi!
    """
    if val is None:
        return []
    if isinstance(val, (int, float)):
        val_str = str(int(val))
    else:
        val_str = str(val).strip()
        val_str = re.sub(r'\.0$', '', val_str)
        val_str = re.sub(r'(\d+)\.0\b', r'\1', val_str)

    if val_str.lower() in ('000', '00', '0', '-', '—', "yo'q", "yoq", "null", "none", "uzim", "o'zim", "onam", "otam", "yo`q"):
        return []

    parts = re.split(r'[/,;\n]|(?<=\d{9})\s+(?=\d)', val_str)
    res = []
    for p in parts:
        clean_p = p.strip()
        if not clean_p: continue
        d = re.sub(r'\D', '', clean_p)
        if d.startswith('998') and len(d) >= 12:
            d = d[3:]
        elif d.startswith('8') and len(d) == 10 and not d.startswith('88'):
            d = d[1:]
        
        if len(d) == 9 and d.startswith(UZB_PREFIXES):
            if d not in res: res.append(d)
        elif len(d) > 9:
            for i in range(len(d) - 8):
                sub = d[i:i+9]
                if sub.startswith(UZB_PREFIXES):
                    if sub not in res: res.append(sub)
                    break
        elif len(d) == 9 and not d.startswith(('00', '0')):
            if d not in res: res.append(d)
    return res

def fmt_phone(d9):
    if not d9 or len(d9) != 9:
        return ""
    return f"+998 {d9[:2]} {d9[2:5]}-{d9[5:7]}-{d9[7:]}"

def parse_relationship(text):
    t = str(text or '').lower()
    t = re.sub(r'[\d+.()/\-_]', '', t).strip()
    if any(w in t for w in ["onam", "oanm", "ayam", "oyim", "oyijon", "мама", "онам", "oman"]):
        return "Onasi"
    if any(w in t for w in ["dadam", "dada", "otam", "adam", "папа", "отам"]):
        return "Otasi"
    if any(w in t for w in ["turmush", "erim", "xujaynim", "ortog", "o'rtoq", "turmush oʻrtogʻ"]):
        return "Turmush o'rtog'i"
    if any(w in t for w in ["akam", "aka", "брат"]):
        return "Akasi"
    if any(w in t for w in ["opam", "apam", "singlim", "сестра"]):
        return "Opasi / Singlisi"
    if any(w in t for w in ["qaynonam", "qaynoman", "qaynona"]):
        return "Qaynonasi"
    if any(w in t for w in ["buvim", "buvi", "momo", "buvam"]):
        return "Buvasi"
    if any(w in t for w in ["yangam"]):
        return "Yangasi"
    if any(w in t for w in ["ozim", "uzim", "manga", "o'zim", "oʻzim", "uzimniki", "uzimga"]):
        return "O'zi"
    return "Otasi / Onasi"

def norm_name(s):
    if not s: return ""
    s = str(s).lower()
    CYR_TO_LAT = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
        'ж': 'j', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
        'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
        'ф': 'f', 'х': 'x', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sh', 'ъ': '',
        'ы': 'i', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya', 'ў': 'o', 'қ': 'q',
        'ғ': 'g', 'ҳ': 'h'
    }
    s = "".join(CYR_TO_LAT.get(ch, ch) for ch in s)
    s = s.replace("h", "x").replace("'", "").replace("ʻ", "").replace("ʼ", "").replace("`", "").replace("‘", "").replace("’", "")
    s = re.sub(r'[^a-z\s]', '', s)
    words = [w for w in s.split() if w not in ('qizi', 'ogli', 'ugli', 'kizi', 'ogʻli', 'o‘g‘li')]
    return " ".join(words)

print("=" * 60)
print("1. Asosiy talabalar bazasini git tarixidan tiklash...")
print("=" * 60)
out = subprocess.check_output(['git', 'show', '3659f2a~1:data/students.json'], text=True, errors='ignore')
students = json.loads(out)
print(f"   Git tarixidan {len(students)} ta talaba o'qildi.")

# Mavjud bazadagi tekshiruv (verified, baza) qiymatlarini saqlash
current_file = os.path.join(BASE_DIR, 'data', 'students.json')
curr_meta = {}
if os.path.exists(current_file):
    try:
        with open(current_file, 'r', encoding='utf-8') as cf:
            for item in json.load(cf):
                curr_meta[item['row']] = {
                    'verified': item.get('verified'),
                    'baza': item.get('baza'),
                    'buyruq': item.get('buyruq'),
                    'buyruq_sana': item.get('buyruq_sana'),
                }
    except Exception:
        pass

for s in students:
    r = s['row']
    if r in curr_meta:
        if curr_meta[r].get('verified'): s['verified'] = curr_meta[r]['verified']
        if curr_meta[r].get('baza'): s['baza'] = curr_meta[r]['baza']
        if curr_meta[r].get('buyruq'): s['buyruq'] = curr_meta[r]['buyruq']
        if curr_meta[r].get('buyruq_sana'): s['buyruq_sana'] = curr_meta[r]['buyruq_sana']

# Boshlang'ich telefon raqamlarini tozalash va 2 ta raqam bo'lsa ajratish
multi_split_base = 0
for s in students:
    raw_tel = str(s.get('tel', '')).strip()
    nums = clean_phone_val(raw_tel)
    if len(nums) >= 2:
        s['tel_shaxsiy'] = fmt_phone(nums[0])
        s['tel_otaona'] = fmt_phone(nums[1])
        s['tel_otaona_kim'] = parse_relationship(raw_tel)
        s['tel'] = f"{s['tel_shaxsiy']} / {s['tel_otaona']} ({s['tel_otaona_kim']})"
        multi_split_base += 1
    elif len(nums) == 1:
        s['tel_shaxsiy'] = fmt_phone(nums[0])
        s['tel_otaona'] = ''
        s['tel_otaona_kim'] = ''
        s['tel'] = s['tel_shaxsiy']
    else:
        s['tel_shaxsiy'] = ''
        s['tel_otaona'] = ''
        s['tel_otaona_kim'] = ''
        s['tel'] = ''
    
    # Boshlang'ich manzil maydonlari
    s.setdefault('manzil_tuman', '')
    s.setdefault('manzil_mfy', '')
    s.setdefault('manzil_kocha', '')
    s.setdefault('manzil_uy', '')
    s.setdefault('qatnov', '')
    s.setdefault('manzil_toliq', '')

print(f"   Bazada 2 ta telefon raqami ajratilgan talabalar: {multi_split_base} nafar")

print("\n" + "=" * 60)
print("2. Shaxrisabz debitorka final (107).xlsx dan shartnoma raqamlarini to'ldirish...")
print("=" * 60)
debitorka_path = os.path.join(BASE_DIR, 'Shaxrisabz debitorka final (107).xlsx')
shnum_added = 0
if os.path.exists(debitorka_path):
    wb_deb = openpyxl.load_workbook(debitorka_path, data_only=True)
    ws_bank = wb_deb['bank']
    deb_records = []
    for r in range(2, ws_bank.max_row + 1):
        naz = str(ws_bank.cell(r, 8).value or '')
        fish = str(ws_bank.cell(r, 9).value or '')
        m = re.search(r'(?:№\s*|No\s*|Шартнома\s*№?\s*)?(\d{2}/\d{2}\s*[Ss][Hh]/[A-Za-z0-9\s\-]+)', naz)
        if not m:
            m = re.search(r'([A-Za-z0-9\-/]+)\s*сонли\s*шартнома', naz, re.IGNORECASE)
        sh_num = m.group(1).strip() if m else ''
        if sh_num:
            m2 = re.match(r'(\d{2}/\d{2}\s*[Ss][Hh]/[A-Za-z0-9]+(?:\s*\d+)?)', sh_num)
            if m2: sh_num = m2.group(1).strip()
            # Aniq raqami bor bo'lsa (faqat "26/27 SH/A" bo'lib qolmagan bo'lsa)
            if re.search(r'\d', sh_num.split('/')[-1]):
                deb_records.append((fish, sh_num))

    for s in students:
        if not s.get('shnum'):
            s_norm = norm_name(s.get('fish', ''))
            s_words = set(s_norm.split()[:2])
            for d_fish, d_sh in deb_records:
                d_norm = norm_name(d_fish)
                d_words = set(d_norm.split()[:2])
                if len(s_words) >= 2 and len(s_words & d_words) == 2:
                    s['shnum'] = d_sh
                    shnum_added += 1
                    break
    print(f"   Debitorka faylidan {shnum_added} nafar talabaga shartnoma raqami qo'shildi.")

print("\n" + "=" * 60)
print("3. Google Sheets so'rovnomasini to'liq tahlil qilish...")
print("=" * 60)
survey_path = os.path.join(BASE_DIR, 'data', 'google_sheet_survey.xlsx')
wb_surv = openpyxl.load_workbook(survey_path, data_only=True)
ws_surv = wb_surv.active

# Har bir qatorni o'qish (oxirgi to'ldirilgan javob ustuvor bo'ladi)
survey_entries = []
for r in range(2, ws_surv.max_row + 1):
    vals = [ws_surv.cell(r, c).value for c in range(1, ws_surv.max_column + 1)]
    if not any(vals): continue
    ts = vals[0]
    grp = str(vals[1] or '').strip()
    fio = str(vals[2] or '').strip()
    dob = str(vals[3] or '').strip()
    tuman = str(vals[4] or '').strip()
    mfy = str(vals[5] or '').strip()
    kocha = str(vals[6] or '').strip()
    uy = str(vals[7] or '').strip()
    qatnov = str(vals[8] or '').strip()
    t1_raw = vals[9]
    t2_raw = vals[10]
    kim_raw = vals[11]

    t1_nums = clean_phone_val(t1_raw)
    t2_nums = clean_phone_val(t2_raw)

    tel_shaxsiy = fmt_phone(t1_nums[0]) if t1_nums else ""
    tel_otaona = ""
    if t2_nums:
        tel_otaona = fmt_phone(t2_nums[0])
    elif len(t1_nums) > 1:
        tel_otaona = fmt_phone(t1_nums[1])
    
    kim_rel = parse_relationship(f"{t2_raw or ''} {kim_raw or ''}")
    if not tel_otaona:
        kim_rel = ""

    survey_entries.append({
        'r': r,
        'timestamp': str(ts or ''),
        'group': grp,
        'fio': fio,
        'dob': dob,
        'tuman': tuman,
        'mfy': mfy,
        'kocha': kocha,
        'uy': uy,
        'qatnov': qatnov,
        'tel_shaxsiy': tel_shaxsiy,
        'tel_otaona': tel_otaona,
        'tel_otaona_kim': kim_rel
    })

print(f"   So'rovnomadan jami {len(survey_entries)} ta to'ldirilgan qator o'qildi.")

# 1-kurs talabalarini ajratib olamiz
kurs1_students = [s for s in students if str(s.get('group', '')).startswith('26-')]
print(f"   Bazada 1-kurs talabalari soni: {len(kurs1_students)} nafar.")

matched_kurs1 = {} # s['row'] -> survey_entry (oxirgi yangisi)
for surv in survey_entries:
    s_norm = norm_name(surv['fio'])
    if not s_norm: continue
    s_words = s_norm.split()[:2]
    
    best_cand = None
    for st in kurs1_students:
        db_norm = norm_name(st.get('fish', ''))
        db_words = db_norm.split()[:2]
        if s_norm == db_norm:
            best_cand = st
            break
        if len(s_words) >= 2 and len(db_words) >= 2 and s_words == db_words:
            best_cand = st
            break
    
    if best_cand:
        # Yangisi eskisi ustiga yoziladi (talaba 2 marta to'ldirgan bo'lsa, eng so'nggisi olinadi)
        matched_kurs1[best_cand['row']] = (best_cand, surv)

print(f"   So'rovnoma muvaffaqiyatli bog'langan 1-kurs talabalari: {len(matched_kurs1)} nafar.")

# So'rovnomani talabalar bazasiga qo'llash
sorovnoma_json = {}
for st in kurs1_students:
    r_id = st['row']
    if r_id in matched_kurs1:
        _, surv = matched_kurs1[r_id]
        if surv['tel_shaxsiy']:
            st['tel_shaxsiy'] = surv['tel_shaxsiy']
        if surv['tel_otaona']:
            st['tel_otaona'] = surv['tel_otaona']
            st['tel_otaona_kim'] = surv['tel_otaona_kim']
        
        # Birlashtirilgan tel
        if st.get('tel_shaxsiy') and st.get('tel_otaona'):
            rel_txt = f" ({st['tel_otaona_kim']})" if st.get('tel_otaona_kim') else ""
            st['tel'] = f"{st['tel_shaxsiy']} / {st['tel_otaona']}{rel_txt}"
        elif st.get('tel_shaxsiy'):
            st['tel'] = st['tel_shaxsiy']

        st['manzil_tuman'] = surv['tuman']
        st['manzil_mfy'] = surv['mfy']
        st['manzil_kocha'] = surv['kocha']
        st['manzil_uy'] = surv['uy']
        st['qatnov'] = surv['qatnov']
        
        m_parts = [surv['tuman'], surv['mfy'], surv['kocha'], surv['uy']]
        st['manzil_toliq'] = ", ".join([p for p in m_parts if p])

        sorovnoma_json[str(r_id)] = {
            'row': r_id,
            'fish': st.get('fish'),
            'group': st.get('group'),
            'topshirgan': True,
            'timestamp': surv['timestamp'],
            'dob': surv['dob'],
            'manzil_tuman': surv['tuman'],
            'manzil_mfy': surv['mfy'],
            'manzil_kocha': surv['kocha'],
            'manzil_uy': surv['uy'],
            'manzil_toliq': st['manzil_toliq'],
            'qatnov': surv['qatnov'],
            'tel_shaxsiy': st['tel_shaxsiy'],
            'tel_otaona': st['tel_otaona'],
            'tel_otaona_kim': st['tel_otaona_kim'],
            'tel': st['tel']
        }
    else:
        # So'rovnoma to'ldirmagan 1-kurs talabasi
        sorovnoma_json[str(r_id)] = {
            'row': r_id,
            'fish': st.get('fish'),
            'group': st.get('group'),
            'topshirgan': False,
            'tel_shaxsiy': st.get('tel_shaxsiy', ''),
            'tel_otaona': st.get('tel_otaona', ''),
            'tel_otaona_kim': st.get('tel_otaona_kim', ''),
            'tel': st.get('tel', '')
        }

unsubmitted_kurs1 = [st for st in kurs1_students if st['row'] not in matched_kurs1]
print(f"   So'rovnoma to'ldirmagan 1-kurs talabalari: {len(unsubmitted_kurs1)} nafar.")

# Barcha talabalar bo'yicha yakuniy telefon tekshiruvi (00 lik yoki xato raqam bormi?)
bad_found = 0
for s in students:
    for fld in ['tel', 'tel_shaxsiy', 'tel_otaona']:
        val = s.get(fld, '')
        d = re.sub(r'\D', '', val)
        if d.startswith('998'): d = d[3:]
        if d.startswith(('00', '0')):
            print(f"   ⚠️ OGOHLANTIRISH: Qator {s['row']} {fld}={repr(val)}")
            bad_found += 1
print(f"   Tekshiruv natijasi: 00 lik yoki xato raqamlar soni: {bad_found}")

print("\n" + "=" * 60)
print("4. JSON fayllarni saqlash...")
print("=" * 60)
with open(os.path.join(BASE_DIR, 'data', 'students.json'), 'w', encoding='utf-8') as f:
    json.dump(students, f, ensure_ascii=False, indent=2)
print("   ✅ data/students.json saqlandi.")

with open(os.path.join(BASE_DIR, 'data', 'talabalar_bazasi.json'), 'w', encoding='utf-8') as f:
    json.dump({'students': students}, f, ensure_ascii=False, indent=2)
print("   ✅ data/talabalar_bazasi.json saqlandi.")

with open(os.path.join(BASE_DIR, 'data', 'sorovnoma_1kurs.json'), 'w', encoding='utf-8') as f:
    json.dump(sorovnoma_json, f, ensure_ascii=False, indent=2)
print("   ✅ data/sorovnoma_1kurs.json saqlandi.")

print("\n" + "=" * 60)
print("5. 1-kurs So'rovnoma Ma'lumotlari hisobot Excelini yaratish...")
print("=" * 60)
# hisobotlar/1-kurs_Sorovnoma_Malumotlari.xlsx
wb_rep = openpyxl.Workbook()
ws_rep = wb_rep.active
ws_rep.title = "1-kurs So'rovnoma"

rep_headers = [
    "T/r", "Guruh", "Familiya Ism Sharif", "Holati", "Tug'ilgan sanasi",
    "Viloyat / Tuman", "MFY / Mahalla", "Ko'cha", "Uy", "To'liq Yashash Manzili",
    "Qatnov Holati", "Talaba Telefoni", "Ota-onasi Telefoni", "Qarindoshligi"
]

hdr_fill = PatternFill('solid', fgColor='1E3A8A')
hdr_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
border_thin = Border(left=Side(style='thin', color='CBD5E1'), right=Side(style='thin', color='CBD5E1'),
                     top=Side(style='thin', color='CBD5E1'), bottom=Side(style='thin', color='CBD5E1'))

for col_idx, h in enumerate(rep_headers, 1):
    c = ws_rep.cell(1, col_idx, value=h)
    c.fill = hdr_fill
    c.font = hdr_font
    c.alignment = Alignment(horizontal='center', vertical='center')
    c.border = border_thin

ws_rep.row_dimensions[1].height = 26

kurs1_sorted = sorted(kurs1_students, key=lambda x: (x.get('group', ''), x.get('fish', '')))
for tr, st in enumerate(kurs1_sorted, 1):
    r_idx = tr + 1
    topshirgan = st['row'] in matched_kurs1
    status_str = "To'ldirgan" if topshirgan else "To'ldirmagan"
    vals = [
        tr,
        st.get('group', ''),
        st.get('fish', ''),
        status_str,
        st.get('dob', ''),
        st.get('manzil_tuman', ''),
        st.get('manzil_mfy', ''),
        st.get('manzil_kocha', ''),
        st.get('manzil_uy', ''),
        st.get('manzil_toliq', ''),
        st.get('qatnov', ''),
        st.get('tel_shaxsiy', ''),
        st.get('tel_otaona', ''),
        st.get('tel_otaona_kim', '')
    ]
    row_fill = PatternFill('solid', fgColor='F8FAFC' if tr % 2 == 0 else 'FFFFFF')
    if not topshirgan:
        row_fill = PatternFill('solid', fgColor='FEE2E2')
    
    for c_idx, val in enumerate(vals, 1):
        cell = ws_rep.cell(r_idx, c_idx, value=val)
        cell.fill = row_fill
        cell.border = border_thin
        cell.font = Font(name='Calibri', size=10, bold=(c_idx in (2, 3, 4)))
        cell.alignment = Alignment(horizontal='center' if c_idx in (1, 2, 4, 5, 11, 12, 13) else 'left', vertical='center')
    ws_rep.row_dimensions[r_idx].height = 20

# Column widths
for col in ws_rep.columns:
    max_len = max(len(str(cell.value or '')) for cell in col)
    col_letter = get_column_letter(col[0].column)
    ws_rep.column_dimensions[col_letter].width = max(max_len + 3, 10)

sorov_out = os.path.join(BASE_DIR, 'hisobotlar', '1-kurs_Sorovnoma_Malumotlari.xlsx')
wb_rep.save(sorov_out)
print(f"   ✅ {sorov_out} yaratildi.")

print("\n" + "=" * 60)
print("6. Barcha 4 ta rol Excel hisobotlarini qayta generatsiya qilish...")
print("=" * 60)
# telegram_sync_service orqali build_all_4_role_excels()
import xizmatlar.telegram_sync_service as tss
role_paths = tss.build_all_4_role_excels()
for r, p in role_paths.items():
    print(f"   ✅ {r}: {p}")

print("\n" + "=" * 60)
print("7. Supabase bilan to'liq sinxronlash...")
print("=" * 60)
try:
    import urllib.request
    for env_path in (os.path.join(BASE_DIR, '.env'), os.path.join(BASE_DIR, 'web', '.env.local')):
        if os.path.exists(env_path):
            with open(env_path, 'r', encoding='utf-8') as ef:
                for line in ef:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        ek, ev = line.split('=', 1)
                        ek, ev = ek.strip(), ev.strip().strip('"').strip("'")
                        if ek and ek not in os.environ:
                            os.environ[ek] = ev
    SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "https://ebzzfbifmorqqtdfvenz.supabase.co")
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY topilmadi (.env / web/.env.local)")

    # Supabase dagi id va row xaritasini olamiz
    req_get = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/students?select=id,row",
        headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
    )
    with urllib.request.urlopen(req_get, timeout=15) as resp:
        supa_rows = json.loads(resp.read().decode())
    row_to_id = {item['row']: item['id'] for item in supa_rows}
    print(f"   Supabase da {len(row_to_id)} ta talaba topildi.")

    # Yangilash uchun paketlar (batch upsert)
    payload = []
    for s in students:
        r_num = s['row']
        if r_num not in row_to_id: continue
        payload.append({
            'id': row_to_id[r_num],
            'row': r_num,
            'shnum': s.get('shnum') or '',
            'fish': s.get('fish') or '',
            'group': s.get('group') or '',
            'tel': s.get('tel') or '',
            'verified': s.get('verified') or 'KUTILMOQDA',
            'baza': s.get('baza') or 'KIRITILDI',
            'updated_at': datetime.utcnow().isoformat()
        })

    for i in range(0, len(payload), 50):
        chunk = payload[i:i+50]
        req_post = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/students?on_conflict=id",
            data=json.dumps(chunk).encode('utf-8'),
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            method='POST'
        )
        with urllib.request.urlopen(req_post, timeout=20) as resp:
            pass
    print("   ✅ Supabase muvaffaqiyatli to'liq sinxronlandi.")
except Exception as e_sup:
    print(f"   ⚠️ Supabase xatosi: {e_sup}")

print("\n" + "=" * 60)
print("YAKUNIY HISOBOT:")
print(f"- Jami talabalar: {len(students)}")
print(f"- 1-kurs talabalari: {len(kurs1_students)}")
print(f"- So'rovnoma topshirganlar: {len(matched_kurs1)}")
print(f"- So'rovnoma topshirmagan 1-kurslar: {len(unsubmitted_kurs1)}")
print(f"- Shartnoma raqami qo'shilganlar: {shnum_added}")
print("=" * 60)
