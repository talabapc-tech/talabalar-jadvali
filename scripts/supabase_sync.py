# -*- coding: utf-8 -*-
"""
Supabase ma'lumotlar bazasiga 562 ta talabani to'liq yuklash skripti.
"""
import os
import json
import urllib.request
import urllib.error

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDENTS_FILE = os.path.join(BASE_DIR, 'data', 'students.json')

def _load_env_file(filepath):
    if not os.path.exists(filepath):
        return
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            k, v = k.strip(), v.strip()
            if k and k not in os.environ:
                os.environ[k] = v

_load_env_file(os.path.join(BASE_DIR, '.env'))
_load_env_file(os.path.join(BASE_DIR, 'web', '.env.local'))

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "https://ebzzfbifmorqqtdfvenz.supabase.co")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def upload_students():
    if not SERVICE_KEY:
        print("XATO: SUPABASE_SERVICE_ROLE_KEY muhit o'zgaruvchisi topilmadi (.env yoki web/.env.local tekshiring)!")
        return False
    if not os.path.exists(STUDENTS_FILE):
        print("XATO: data/students.json topilmadi!")
        return False

    with open(STUDENTS_FILE, 'r', encoding='utf-8') as f:
        students = json.load(f)

    print(f"Jami talabalar soni: {len(students)} ta.")

    # Mavjud row -> id xaritasini olish (tr o'zgarganda ham id surilib ketmasin)
    req_get = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/students?select=id,row",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req_get, timeout=20) as resp:
        supa_rows = json.loads(resp.read().decode('utf-8'))
    row_to_id = {int(item['row']): item['id'] for item in supa_rows if item.get('row') is not None}

    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    existing_payload = []
    new_payload = []
    for s in students:
        r_num = int(s.get("row") or 0)
        row_data = {
            "row": r_num,
            "tr": int(s.get("tr") or 0),
            "ism": str(s.get("ism") or "").strip(),
            "ota": str(s.get("ota") or "").strip(),
            "fish": str(s.get("fish") or "").strip(),
            "group": str(s.get("group") or "").strip(),
            "shnum": str(s.get("shnum") or "").strip(),
            "sana": str(s.get("sana") or "").strip(),
            "pv": str(s.get("pv") or "").strip(),
            "pass_type": str(s.get("pass_type") or "").strip(),
            "pinfl": str(s.get("pinfl") or "").strip().replace(" ", ""),
            "dob": str(s.get("dob") or "").strip(),
            "ber": str(s.get("ber") or "").strip(),
            "sh_doc": str(s.get("sh_doc") or "").strip(),
            "sh_qr": str(s.get("sh_qr") or "").strip(),
            "mak": str(s.get("mak") or "").strip(),
            "doc_tur": str(s.get("doc_tur") or "").strip(),
            "yil": str(s.get("yil") or "").strip(),
            "yon": str(s.get("yon") or "").strip(),
            "tel": str(s.get("tel") or "").strip(),
            "doc_file": str(s.get("doc_file") or "").strip(),
            "status": str(s.get("status") or "full"),
            "pass_fish": str(s.get("pass_fish") or "").strip(),
            "cert_fish": str(s.get("cert_fish") or "").strip(),
            "name_match": str(s.get("name_match") or "").strip(),
            "name_flag": str(s.get("name_flag") or "").strip(),
            "verified": str(s.get("verified") or "KUTILMOQDA"),
            "baza": str(s.get("baza") or "KIRITILDI"),
            "buyruq": str(s.get("buyruq") or "").strip(),
            "buyruq_sana": str(s.get("buyruq_sana") or "").strip(),
        }
        if r_num in row_to_id:
            row_data["id"] = row_to_id[r_num]
            existing_payload.append(row_data)
        else:
            new_payload.append(row_data)

    batch_size = 50
    uploaded = 0
    for target_url, items in (
        (f"{SUPABASE_URL}/rest/v1/students?on_conflict=id", existing_payload),
        (f"{SUPABASE_URL}/rest/v1/students", new_payload),
    ):
        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]
            req = urllib.request.Request(target_url, data=json.dumps(batch).encode('utf-8'), headers=headers, method='POST')
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    uploaded += len(batch)
                    print(f"Yuklandi: {uploaded}/{len(students)}...")
            except urllib.error.HTTPError as e:
                err = e.read().decode('utf-8')
                print(f"Xatolik yuz berdi ({e.code}): {err}")
                return False

    print(f"[OK] MUVAFFAQIYATLI: Barcha {uploaded} ta talaba Supabase'ga to'liq yuklandi!")
    return True

if __name__ == '__main__':
    upload_students()
