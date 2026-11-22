# -*- coding: utf-8 -*-
"""
APPLY LATEST SURVEY DATA TO STUDENTS & GENERATE REPORTS
======================================================
1. Reads all survey entries from data/google_sheet_survey.xlsx (chronological order).
2. Maps every survey entry to 1-kurs students in data/students.json.
3. Later survey responses overwrite earlier ones (latest submission wins).
4. Cleans & formats phones (+998 XX XXX-XX-XX), relations, and full addresses.
5. Updates data/students.json, talabalar_bazasi.json, sorovnoma_1kurs.json.
6. Generates hisobotlar/1-kurs_Sorovnoma_Malumotlari.xlsx.
7. Re-generates all 4 role reports (including Guruh Rahbarlari Excel).
8. Syncs tel and other fields to Supabase students table.
"""

import os, sys, re, json, openpyxl, unicodedata
from datetime import datetime
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
SURVEY_FILE = os.path.join(BASE_DIR, 'data', 'google_sheet_survey.xlsx')
STUDENTS_FILE = os.path.join(BASE_DIR, 'data', 'students.json')
BAZA_FILE = os.path.join(BASE_DIR, 'data', 'talabalar_bazasi.json')
SOROVNOMA_FILE = os.path.join(BASE_DIR, 'data', 'sorovnoma_1kurs.json')

UZB_PREFIXES = ('90', '91', '92', '93', '94', '95', '97', '98', '99', '88', '77', '33', '50', '55', '70', '71', '75', '76', '78')

def clean_name(s):
    if not s: return ''
    return ' '.join(str(s).strip().split())

def clean_phone_val(val):
    if val is None: return []
    if isinstance(val, (int, float)):
        val_str = str(int(val))
    else:
        val_str = str(val).strip()
        val_str = re.sub(r'\.0$', '', val_str)
        val_str = re.sub(r'(\d+)\.0\b', r'\1', val_str)

    if val_str.lower() in ('000', '00', '0', '-', '—', "yo'q", "yoq", "null", "none", "uzim", "o'zim", "onam", "otam", "yo`q", "yuq"):
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
    if any(w in t for w in ["onam", "oanm", "ayam", "oyim", "oyijon", "мама", "онам", "oman", "onasi", "onamga", "onamniki"]):
        return "Onasi"
    if any(w in t for w in ["dadam", "dada", "otam", "adam", "папа", "отам", "otasi", "otamga", "dadamniki"]):
        return "Otasi"
    if any(w in t for w in ["turmush", "erim", "xujaynim", "ortog", "o'rtoq", "turmush oʻrtogʻ", "turmush o'rtog'i"]):
        return "Turmush o'rtog'i"
    if any(w in t for w in ["akam", "aka", "брат", "akamga"]):
        return "Akasi"
    if any(w in t for w in ["opam", "apam", "singlim", "сестра", "opamga"]):
        return "Opasi / Singlisi"
    if any(w in t for w in ["ukam"]):
        return "Ukasi"
    if any(w in t for w in ["qaynonam", "qaynoman", "qaynona"]):
        return "Qaynonasi"
    if any(w in t for w in ["buvim", "buvi", "momo", "buvam"]):
        return "Buvasi"
    if any(w in t for w in ["yangam"]):
        return "Yangasi"
    if any(w in t for w in ["ozim", "uzim", "manga", "o'zim", "oʻzim", "uzimniki", "uzimga"]):
        return "O'zi"
    return "Otasi / Onasi"

def norm(s):
    s = str(s or '').lower().strip()
    s = unicodedata.normalize('NFC', s)
    CYR_TO_LAT = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
        'ж': 'j', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
        'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
        'ф': 'f', 'х': 'x', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sh', 'ъ': '',
        'ы': 'i', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya', 'ў': 'o', 'қ': 'q',
        'ғ': 'g', 'ҳ': 'h'
    }
    s = "".join(CYR_TO_LAT.get(ch, ch) for ch in s)
    s = re.sub(r"[ʻʼʽ'`’‘]", "'", s)
    s = s.replace("h", "x").replace("'", "")
    s = re.sub(r'[^a-z\s]', '', s)
    words = [w for w in s.split() if w not in ('qizi', 'ogli', 'ugli', 'kizi', 'ogʻli', 'o‘g‘li')]
    return " ".join(words)

# Explicit row mapping for tricky names / typos (survey row in excel -> student row in students.json)
ROW_MAPPING = {
    14: 53,   # Jovliyeva Nargiza Ortiq qizi [26-02]
    15: 139,  # Turğunova Jasmina Turğun qizi [26-01]
    22: 53,   # Jovliyeva Nargiza Ortiq qizi [26-02]
    31: 20,   # BerdiquloaGulshan Rustam qizi [26-02]
    32: 120,  # Sayfillayeve Shodiyona Sayfilla qizi [26-06]
    53: 139,  # Turğunova Jasmina Turğun qizi [26-01]
    54: 142,  # Tursunova (+998 77 809-81-30) -> Tursunova Fotima [26-05]
    55: 20,   # BerdiqulovaGulshanRustamqizi [26-02]
    61: 118,  # Sanaqulova NozliyaGʻofur qizi [26-06]
    64: 173,  # Ziyodullayev JASMINA Alisher qizi [26-01]
    66: 48,   # Jabborova bahoraoy Shukurullo qizi [26-05]
    68: 134,  # Toshmurodona Sarvara ilhom qizi [26-05]
    70: 136,  # Tòxtayeva Durdona Nazim qizi [26-02]
    78: 17,   # Azamov Shohjahon Sherali 9 [26-04]
    83: 26,   # Eshmurodova charos beqqul qizi [26-02]
    95: 4,    # Abdixalilova shahzoda [26-04]
    98: 155,  # Xaydarov Iroda Zarif qizi [26-03]
    102: 100, # Farangiz Pardayeva Norali qizi [26-03]
    106: 561, # Турсунмуродова Диера Жасур Кизи [26-03]
    107: 89,  # NiyozovaSevara Turaqulovna [26-06]
    116: 152, # усмонова юлдуз нумон кизи [26-03]
    120: 178, # Sayfiyeva Sarvinoz Zafar qizi [26-06]
    121: 111, # Ruzmurodava Larisa [26-02]
    123: 561, # Турсунмуродова Диера Жасур кизи [26-03]
    133: 56,  # Juraeva Dilnoz Goibnazarovna [26-03]
    138: 171, # Zaripova Marjona Samijon qizi [26-06]
    147: 174, # Ixtiyorova Nigina Xol qizi [26-05]
    151: 132, # Temirboyeca Iroda Baxtiyor qizi [26-04]
    156: 153, # Hamdamova Madina [26-04]
    159: 153, # Hamdamova Madina [26-04]
    162: 109, # Ravshanova Dudağına Radju qizi [26-01]
    168: 175, # Abdunazarova Dilafruz [26-06]
    171: 176, # Azimova zaxro [26-06]
    179: 83,  # Muzropova Ruxshona [26-05]
    188: 127, # Soyipova Dinora [26-04]
    193: 68,  # Maxmarajabova zerda xasan qizi [26-06]
    194: 89,  # Niyozova Sevara Turaqulovna [26-06]
    198: 89,  # NiyozovaSevara Turaqulovna [26-06]
    199: 162, # Xujamurodova durdona Bahrom qizi [26-04]
    200: 17,  # Azamov Shohjahon Sherali oʻgʻli [26-04]
    201: 60,  # Luxmonova Nozima [26-05]
    202: 181, # Irgasheva Dinora Shodmon qizi [26-06]
    203: 171, # Zarifova Marjona [26-06]
    204: 49,  # Jalilova Jasmina Jamshid qizi [26-05]
    205: 4,   # Abdixalilova shahzoda [26-04]
    206: 182, # Shonazarova Vazira Botir qizi [26-02]
    207: 52,  # Jalolova Rayxona Akmal qizi [26-02]
    208: 52,  # Jalolova Rayxona Akmal qizi [26-02]
    209: 52,  # Jalolova Rayxona Akmal qizi [26-02]
    210: 182, # Shonazarova Vazira Botir qizi [26-02]
    211: 64,  # Mahmudova Maftuna To'ra qizi [26-06]
    212: 25,  # Eshimova Zilola Bekzod qizi [26-06]
    213: 94,  # Nurillayeva sevinch Mashrab qizi [26-06]
    214: 94,  # Nurillayeva sevinch Mashrab qizi [26-06]
    215: 61,  # Mahmadmurodova Sevara safarali qizi [26-06]
    216: 37,  # Hamroqulova Marjona Òktam qizi [26-04]
    217: 117, # Sanaqulova Muxtarama Xudoyqulovna [26-06]
    218: 106, # Quchqarova Zebiniso Farhod qizi [26-06]
    219: 104, # Qarshiyeva shahlo [26-06]
    220: 134, # Toshmurodova Sarvara ilhom qizi [26-05]
    221: 134, # Toshmurodova Sarvara ilhom qizi [26-05]
    222: 171, # Zarifova Marjona samijin qizi [26-06]
    223: 174, # Ixtiyorova Niginabonu Xolovna [26-05]
    224: 161, # Xolmurodova Sabina A'zam qizi [26-06]
    225: 176, # Nosirib Rovub -> Azimova Zahroxon [26-06]
    226: 176, # Nosirb rovub -> Azimova Zahroxon [26-06]
    227: 98,  # Ortiqova Dilnoza Zokir qizi [26-06]
    228: 121, # Sayfiyeva Zarina Ahmad qizi [26-03]
    229: 33,  # Gʻayratova Jasmina [26-05]
    230: 168, # Yahyomurodova Gulsanam Akmal qizi [26-06]
    231: 88,  # Niyozova Komila Toshpo'latovna [26-03]
}

def main():
    print("=" * 60)
    print("1. Talabalar va So'rovnomani yuklash...")
    print("=" * 60)
    
    with open(STUDENTS_FILE, encoding='utf-8') as f:
        students = json.load(f)
        
    kurs1 = [s for s in students if str(s.get('group', '')).startswith('26-')]
    row_to_st = {s['row']: s for s in students}
    print(f"Jami talabalar: {len(students)}, 1-kurs talabalari: {len(kurs1)}")
    
    wb = openpyxl.load_workbook(SURVEY_FILE, data_only=True)
    ws = wb.active
    print(f"So'rovnoma qatorlari: {ws.max_row}")

    # Process all survey rows chronologically
    matched_survey = {} # st_row -> entry
    
    for r in range(2, ws.max_row + 1):
        vals = [ws.cell(r, c).value for c in range(1, 13)]
        if not any(vals): continue
        ts, grp, fio, dob, tuman, mfy, kocha, uy, qatnov, t1_raw, t2_raw, kim_raw = vals[:12]
        if not fio: continue

        st_row = ROW_MAPPING.get(r)
        if not st_row:
            nf = norm(fio)
            f_words = nf.split()[:2]
            for s in kurs1:
                ns = norm(s.get('fish', ''))
                s_words = ns.split()[:2]
                if len(f_words) >= 2 and len(s_words) >= 2 and f_words == s_words:
                    st_row = s['row']
                    break
                    
        if not st_row:
            print(f"⚠️ Topilmadi: Row {r}: [{grp}] '{fio}'")
            continue

        # Phone extraction
        t1_nums = clean_phone_val(t1_raw)
        t2_nums = clean_phone_val(t2_raw)
        t3_nums = clean_phone_val(kim_raw)
        
        tel1 = fmt_phone(t1_nums[0]) if t1_nums else ""
        tel2 = ""
        if t2_nums:
            tel2 = fmt_phone(t2_nums[0])
        elif len(t1_nums) > 1:
            tel2 = fmt_phone(t1_nums[1])
        elif t3_nums:
            tel2 = fmt_phone(t3_nums[0])
            
        rel = parse_relationship(f"{t2_raw or ''} {kim_raw or ''}")
        if not tel2: rel = ""
        
        clean_tuman = clean_name(tuman)
        clean_mfy = clean_name(mfy)
        clean_kocha = clean_name(kocha)
        clean_uy = clean_name(uy)
        if clean_uy and re.match(r'^\d+(\.0)?$', clean_uy):
            clean_uy = f"{int(float(clean_uy))}-uy"
        elif clean_uy and not clean_uy.endswith('-uy') and clean_uy.isdigit():
            clean_uy = f"{clean_uy}-uy"
            
        m_parts = [p for p in [clean_tuman, clean_mfy, clean_kocha, clean_uy] if p]
        manzil_toliq = ", ".join(m_parts)
        
        # Save / overwrite (later survey row takes precedence)
        matched_survey[st_row] = {
            'r': r,
            'timestamp': str(ts or ''),
            'group': clean_name(grp),
            'fio': clean_name(fio),
            'dob': clean_name(dob),
            'tuman': clean_tuman,
            'mfy': clean_mfy,
            'kocha': clean_kocha,
            'uy': clean_uy,
            'manzil_toliq': manzil_toliq,
            'qatnov': clean_name(qatnov),
            'tel_shaxsiy': tel1,
            'tel_otaona': tel2,
            'tel_otaona_kim': rel
        }

    print(f"\n✅ So'rovnoma topshirgan unikal 1-kurs talabalar soni: {len(matched_survey)} / {len(kurs1)}")

    # Update 1-kurs students
    sorovnoma_json = {}
    updated_count = 0

    for st in kurs1:
        rid = st['row']
        if rid in matched_survey:
            surv = matched_survey[rid]
            if surv['tel_shaxsiy']:
                st['tel_shaxsiy'] = surv['tel_shaxsiy']
            if surv['tel_otaona']:
                st['tel_otaona'] = surv['tel_otaona']
                st['tel_otaona_kim'] = surv['tel_otaona_kim']
                
            if st.get('tel_shaxsiy') and st.get('tel_otaona'):
                rel_txt = f" ({st['tel_otaona_kim']})" if st.get('tel_otaona_kim') else ""
                st['tel'] = f"{st['tel_shaxsiy']} / {st['tel_otaona']}{rel_txt}"
            elif st.get('tel_shaxsiy'):
                st['tel'] = st['tel_shaxsiy']
                
            if surv['tuman']: st['manzil_tuman'] = surv['tuman']
            if surv['mfy']: st['manzil_mfy'] = surv['mfy']
            if surv['kocha']: st['manzil_kocha'] = surv['kocha']
            if surv['uy']: st['manzil_uy'] = surv['uy']
            if surv['qatnov']: st['qatnov'] = surv['qatnov']
            if surv['manzil_toliq']: st['manzil_toliq'] = surv['manzil_toliq']
            
            # Formatted DOB if missing in base
            if surv['dob'] and not st.get('dob'):
                st['dob'] = surv['dob']
                
            sorovnoma_json[str(rid)] = {
                'row': rid,
                'tr': st.get('tr'),
                'fish': st.get('fish'),
                'group': st.get('group'),
                'topshirgan': True,
                'timestamp': surv['timestamp'],
                'dob': surv['dob'] or st.get('dob', ''),
                'manzil_tuman': st.get('manzil_tuman', ''),
                'manzil_mfy': st.get('manzil_mfy', ''),
                'manzil_kocha': st.get('manzil_kocha', ''),
                'manzil_uy': st.get('manzil_uy', ''),
                'manzil_toliq': st.get('manzil_toliq', ''),
                'qatnov': st.get('qatnov', ''),
                'tel_shaxsiy': st.get('tel_shaxsiy', ''),
                'tel_otaona': st.get('tel_otaona', ''),
                'tel_otaona_kim': st.get('tel_otaona_kim', ''),
                'tel': st.get('tel', '')
            }
            updated_count += 1
        else:
            # Did not fill survey
            sorovnoma_json[str(rid)] = {
                'row': rid,
                'tr': st.get('tr'),
                'fish': st.get('fish'),
                'group': st.get('group'),
                'topshirgan': False,
                'tel_shaxsiy': st.get('tel_shaxsiy', ''),
                'tel_otaona': st.get('tel_otaona', ''),
                'tel_otaona_kim': st.get('tel_otaona_kim', ''),
                'tel': st.get('tel', '')
            }

    print(f"Bazada yangilangan 1-kurs talabalari: {updated_count}")
    
    # Check for any remaining students without phone
    no_phone = [s for s in kurs1 if not s.get('tel_shaxsiy')]
    print(f"\nTelefon raqami UMUMAN YO'Q 1-kurs talabalari ({len(no_phone)}):")
    for np in no_phone:
        print(f"  [{np.get('group')}] row:{np.get('row')} {np.get('fish')}")

    # Save data/students.json
    with open(STUDENTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(students, f, ensure_ascii=False, indent=2)
    print("✅ data/students.json saqlandi.")

    # Save data/talabalar_bazasi.json
    with open(BAZA_FILE, 'w', encoding='utf-8') as f:
        json.dump({'students': students}, f, ensure_ascii=False, indent=2)
    print("✅ data/talabalar_bazasi.json saqlandi.")

    # Save data/sorovnoma_1kurs.json
    with open(SOROVNOMA_FILE, 'w', encoding='utf-8') as f:
        json.dump(sorovnoma_json, f, ensure_ascii=False, indent=2)
    print("✅ data/sorovnoma_1kurs.json saqlandi.")

    # Generate hisobotlar/1-kurs_Sorovnoma_Malumotlari.xlsx
    print("\n" + "=" * 60)
    print("2. hisobotlar/1-kurs_Sorovnoma_Malumotlari.xlsx yaratish...")
    print("=" * 60)
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
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        c.border = border_thin

    ws_rep.row_dimensions[1].height = 28

    kurs1_sorted = sorted(kurs1, key=lambda x: (x.get('group', ''), x.get('fish', '')))
    for tr, st in enumerate(kurs1_sorted, 1):
        r_idx = tr + 1
        topshirgan = st['row'] in matched_survey
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
            row_fill = PatternFill('solid', fgColor='FEE2E2') # Qizil ogohlantirish
        
        for c_idx, val in enumerate(vals, 1):
            cell = ws_rep.cell(r_idx, c_idx, value=val)
            cell.fill = row_fill
            cell.border = border_thin
            cell.font = Font(name='Calibri', size=10, bold=(c_idx in (2, 3, 4)))
            cell.alignment = Alignment(horizontal='center' if c_idx in (1, 2, 4, 5, 11, 12, 13) else 'left', vertical='center')
        ws_rep.row_dimensions[r_idx].height = 22

    for col in ws_rep.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws_rep.column_dimensions[col_letter].width = max(max_len + 3, 10)

    sorov_out = os.path.join(BASE_DIR, 'hisobotlar', '1-kurs_Sorovnoma_Malumotlari.xlsx')
    wb_rep.save(sorov_out)
    print(f"✅ {sorov_out} saqlandi.")

    # Re-generate all 4 role excels
    print("\n" + "=" * 60)
    print("3. Guruh rahbarlari va barcha rol hisobotlarini qayta generatsiya qilish...")
    print("=" * 60)
    import xizmatlar.telegram_sync_service as tss
    role_paths = tss.build_all_4_role_excels()
    for rname, rpath in role_paths.items():
        print(f"✅ {rname}: {rpath}")

    # Sync tel fields to Supabase
    print("\n" + "=" * 60)
    print("4. Supabase bilan telefon raqamlarini sinxronlash...")
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

        req_get = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/students?select=id,row",
            headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
        )
        with urllib.request.urlopen(req_get, timeout=15) as resp:
            supa_rows = json.loads(resp.read().decode())
        row_to_id = {item['row']: item['id'] for item in supa_rows}
        print(f"Supabase da {len(row_to_id)} ta talaba mavjud.")

        payload = []
        for s in students:
            r_num = s['row']
            if r_num not in row_to_id: continue
            payload.append({
                'id': row_to_id[r_num],
                'row': r_num,
                'tel': s.get('tel') or '',
                'updated_at': datetime.utcnow().isoformat()
            })

        for i in range(0, len(payload), 100):
            chunk = payload[i:i+100]
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
        print("✅ Supabase students jadvalidagi barcha telefon raqamlar sinxronlandi.")
    except Exception as e:
        print(f"⚠️ Supabase sinxronlashda xatolik: {e}")

    print("\n" + "=" * 60)
    print("Bajarildi! Barcha ma'lumotlar muvaffaqiyatli yangilandi.")
    print("=" * 60)

if __name__ == '__main__':
    main()
