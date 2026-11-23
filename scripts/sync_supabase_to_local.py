# -*- coding: utf-8 -*-
"""
Supabase ma'lumotlar bazasidagi barcha talabalarni (shu jumladan yangi qo'shilganlarni)
data/students.json va data/talabalar_bazasi.json fayllariga to'liq sinxronlash skripti.
"""
import os, sys, json
from datetime import datetime
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, '.env'))
load_dotenv(os.path.join(BASE_DIR, 'web', '.env.local'))

from supabase import create_client

url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
if not url or not key:
    print("XATO: Supabase URL yoki KEY topilmadi!")
    sys.exit(1)

sb = create_client(url, key)
res = sb.table('students').select('*').order('row').execute()
sb_students = res.data

print(f"Supabase dan {len(sb_students)} ta talaba yuklab olindi.")

STUDENTS_FILE = os.path.join(BASE_DIR, 'data', 'students.json')
BAZA_FILE = os.path.join(BASE_DIR, 'data', 'talabalar_bazasi.json')

with open(STUDENTS_FILE, 'r', encoding='utf-8') as f:
    local_students = json.load(f)

updated_students = []
for s in sb_students:
    r = s.get('row')
    entry = {
        "id": s.get("id"),
        "row": int(s.get("row") or len(updated_students) + 1),
        "tr": int(s.get("tr") or len(updated_students) + 1),
        "shnum": str(s.get("shnum") or ''),
        "sana": str(s.get("sana") or ''),
        "ism": str(s.get("ism") or ''),
        "ota": str(s.get("ota") or ''),
        "fish": str(s.get("fish") or f"{s.get('ism', '')} {s.get('ota', '')}".strip()),
        "yon": str(s.get("yon") or ''),
        "group": str(s.get("group") or ''),
        "pv": str(s.get("pv") or ''),
        "pass_type": str(s.get("pass_type") or ''),
        "pinfl": str(s.get("pinfl") or ''),
        "dob": str(s.get("dob") or ''),
        "ber": str(s.get("ber") or ''),
        "sh_doc": str(s.get("sh_doc") or ''),
        "sh_qr": str(s.get("sh_qr") or ''),
        "mak": str(s.get("mak") or ''),
        "doc_tur": str(s.get("doc_tur") or ''),
        "yil": str(s.get("yil") or ''),
        "tel": str(s.get("tel") or ''),
        "doc_file": str(s.get("doc_file") or ''),
        "status": str(s.get("status") or 'full'),
        "pass_fish": str(s.get("pass_fish") or ''),
        "cert_fish": str(s.get("cert_fish") or ''),
        "name_match": str(s.get("name_match") or ''),
        "name_flag": str(s.get("name_flag") or ''),
        "verified": str(s.get("verified") or 'KUTILMOQDA'),
        "baza": str(s.get("baza") or 'KIRITILDI'),
        "buyruq": str(s.get("buyruq") or ''),
        "buyruq_sana": str(s.get("buyruq_sana") or '')
    }
    updated_students.append(entry)

local_students = updated_students


# Sort by row
local_students.sort(key=lambda x: int(x.get('row', 0)))

# Save data/students.json
with open(STUDENTS_FILE, 'w', encoding='utf-8') as f:
    json.dump(local_students, f, ensure_ascii=False, indent=2)
print(f"✅ data/students.json saqlandi ({len(local_students)} ta talaba).")

# Save data/talabalar_bazasi.json
talabalar_bazasi_payload = {
    "students": local_students,
    "last_updated": datetime.now().isoformat()
}
with open(BAZA_FILE, 'w', encoding='utf-8') as f:
    json.dump(talabalar_bazasi_payload, f, ensure_ascii=False, indent=2)
print(f"✅ data/talabalar_bazasi.json saqlandi ({len(local_students)} ta talaba).")

print(f"Sinxronizatsiya yakunlandi! ({len(local_students)} ta talaba to'liq sinxronlandi).")
