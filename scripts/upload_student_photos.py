# -*- coding: utf-8 -*-
"""
Talabalarning rasmlarini papkadan avtomatik moslashtirib Supabase Storage'ga yuklash skripti.

Ishlatish:
  1) Avval tekshiruv (hech narsa yuklamaydi, kim kimga mos tushganini ko'rsatadi):
     python scripts/upload_student_photos.py "C:\\yo'l\\talabalar_rasmlari"

  2) Hammasini Supabase Storage'ga yuklash:
     python scripts/upload_student_photos.py "C:\\yo'l\\talabalar_rasmlari" --apply

  3) Mavjud rasmlarni ham ustidan yangilash:
     python scripts/upload_student_photos.py "C:\\yo'l\\talabalar_rasmlari" --apply --overwrite
"""
import argparse
import difflib
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

BASE_DIR = Path(__file__).resolve().parent.parent
STUDENTS_FILE = BASE_DIR / "data" / "students.json"

PHOTO_BUCKET = "student-photos"
META_BUCKET = "student-photos-meta"
META_PATH = "index.json"
MAX_DIM = 640
WEBP_QUALITY = 86
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".jfif"}


def _load_env_file(filepath: Path) -> None:
    if not filepath.exists():
        return
    for raw in filepath.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


_load_env_file(BASE_DIR / ".env")
_load_env_file(BASE_DIR / "web" / ".env.local")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "https://ebzzfbifmorqqtdfvenz.supabase.co").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

CYR_TO_LAT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "j", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "x", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "",
    "ы": "i", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "ў": "o", "қ": "q", "ғ": "g", "ҳ": "h",
}


def to_latin(s: str) -> str:
    out = []
    for ch in s.lower():
        out.append(CYR_TO_LAT.get(ch, ch))
    return "".join(out)


def clean_pin(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


def clean_pv(v) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(v or "").upper())


def norm_tokens(text: str, soft: bool = False) -> list[str]:
    s = to_latin(str(text or ""))
    # Fayl nomi boshidagi raqamlarni ("01.", "12_", "5 - ") olib tashlash
    s = re.sub(r"^\s*\d{1,3}\s*[._\-)\s]+", " ", s)
    # Guruh kodlarini (26-01, 25_21) ism ichidan olib tashlash
    s = re.sub(r"\b2\d[-_\s]?\d{2}\b", " ", s)
    s = re.sub(r"['`ʻʼ‘’\"«»()\[\]{}]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    if soft:
        s = s.replace("kh", "h").replace("x", "h").replace("q", "k").replace("dj", "j")
        s = re.sub(r"(.)\1+", r"\1", s)
    return [t for t in s.split() if t and not t.isdigit()]


def norm_str(text: str, soft: bool = False) -> str:
    return " ".join(norm_tokens(text, soft=soft))


def extract_group_hint(path: Path, root: Path) -> str:
    rel_parts = list(path.relative_to(root).parts)
    for part in reversed(rel_parts):
        m = re.search(r"\b(2\d)\s*[-_.\s]\s*(\d{2})\b", part)
        if m:
            return f"{m.group(1)}-{m.group(2)}"
    return ""


def base36(n: int) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        return "0"
    out = []
    while n:
        n, r = divmod(n, 36)
        out.append(chars[r])
    return "".join(reversed(out))


def photo_key_of(student: dict) -> str:
    p = clean_pin(student.get("pinfl"))
    if len(p) == 14:
        return f"p:{p}"
    return f"r:{int(student['row'])}"


def sb_request(method: str, path: str, data: bytes | None = None, content_type: str | None = None, extra_headers: dict | None = None):
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    return urllib.request.urlopen(req, timeout=30)


def fetch_students() -> list[dict]:
    if SERVICE_KEY:
        try:
            with sb_request(
                "GET",
                "/rest/v1/students?select=row,ism,ota,fish,group,pinfl,shnum,pv&order=row.asc&limit=2000",
            ) as resp:
                rows = json.loads(resp.read().decode("utf-8"))
                if rows:
                    return rows
        except Exception as e:
            print(f"[OGOHLANTIRISH] Supabase students o'qilmadi ({e}), data/students.json dan o'qilmoqda...")
    if STUDENTS_FILE.exists():
        return json.loads(STUDENTS_FILE.read_text(encoding="utf-8"))
    raise SystemExit("XATO: Talabalar ro'yxati topilmadi!")


def fetch_photo_index() -> dict:
    try:
        with sb_request("GET", f"/storage/v1/object/{META_BUCKET}/{META_PATH}") as resp:
            parsed = json.loads(resp.read().decode("utf-8"))
            if isinstance(parsed, dict) and isinstance(parsed.get("items"), dict):
                return parsed
    except urllib.error.HTTPError as e:
        if e.code not in (400, 404):
            print(f"[OGOHLANTIRISH] index.json o'qishda xato ({e.code})")
    except Exception:
        pass
    return {"version": 1, "items": {}}


def save_photo_index(idx: dict) -> None:
    payload = json.dumps(idx, ensure_ascii=False, indent=2).encode("utf-8")
    sb_request(
        "POST",
        f"/storage/v1/object/{META_BUCKET}/{META_PATH}",
        data=payload,
        content_type="application/json",
        extra_headers={"x-upsert": "true", "cache-control": "0"},
    ).read()


def upload_webp(storage_path: str, webp_bytes: bytes) -> str:
    sb_request(
        "POST",
        f"/storage/v1/object/{PHOTO_BUCKET}/{urllib.parse.quote(storage_path)}",
        data=webp_bytes,
        content_type="image/webp",
        extra_headers={"x-upsert": "false", "cache-control": "31536000"},
    ).read()
    return f"{SUPABASE_URL}/storage/v1/object/public/{PHOTO_BUCKET}/{storage_path}"


def remove_old_objects(paths: list[str]) -> None:
    if not paths:
        return
    try:
        payload = json.dumps({"prefixes": paths}).encode("utf-8")
        sb_request(
            "DELETE",
            f"/storage/v1/object/{PHOTO_BUCKET}",
            data=payload,
            content_type="application/json",
        ).read()
    except Exception:
        pass


def optimize_photo(filepath: Path) -> bytes:
    with Image.open(filepath) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            rgba = im.convert("RGBA")
            bg.paste(rgba, mask=rgba.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        w, h = im.size
        longest = max(w, h)
        if longest > MAX_DIM:
            scale = MAX_DIM / float(longest)
            im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="WEBP", quality=WEBP_QUALITY, method=6)
        return buf.getvalue()


def score_student(stem: str, group_hint: str, student: dict) -> tuple[float, str]:
    pin_in_name = re.search(r"\b([3456]\d{13})\b", stem)
    s_pin = clean_pin(student.get("pinfl"))
    if pin_in_name and s_pin and pin_in_name.group(1) == s_pin:
        return 1.0, "pinfl"

    pv_in_name = re.search(r"\b([A-Z]{2}\s*\d{7})\b", stem.upper())
    s_pv = clean_pv(student.get("pv"))
    if pv_in_name and s_pv and clean_pv(pv_in_name.group(1)) == s_pv:
        return 0.99, "pasport"

    q_toks = norm_tokens(stem, soft=False)
    q_soft_toks = norm_tokens(stem, soft=True)
    if not q_toks:
        return 0.0, ""

    fish = str(student.get("fish") or f"{student.get('ism') or ''} {student.get('ota') or ''}").strip()
    ism = str(student.get("ism") or "").strip()

    s_full_toks = norm_tokens(fish, soft=False)
    s_ism_toks = norm_tokens(ism, soft=False) or s_full_toks[:2]
    s_full_soft = norm_tokens(fish, soft=True)
    s_ism_soft = norm_tokens(ism, soft=True) or s_full_soft[:2]

    same_group = bool(group_hint and str(student.get("group") or "").strip() == group_hint)
    g_bonus = 0.04 if same_group else 0.0

    # To'liq aniq moslik (tartibdan qat'i nazar)
    if q_toks == s_full_toks or sorted(q_toks) == sorted(s_full_toks):
        return min(1.0, 0.98 + g_bonus), "exact_fish"
    if q_toks == s_ism_toks or (len(q_toks) >= 2 and sorted(q_toks) == sorted(s_ism_toks)):
        return min(1.0, 0.96 + g_bonus), "exact_ism"
    if q_soft_toks == s_full_soft or sorted(q_soft_toks) == sorted(s_full_soft):
        return min(1.0, 0.94 + g_bonus), "soft_fish"
    if q_soft_toks == s_ism_soft or (len(q_soft_toks) >= 2 and sorted(q_soft_toks) == sorted(s_ism_soft)):
        return min(1.0, 0.92 + g_bonus), "soft_ism"

    # Fuzzy solishtirish: to'liq F.I.Sh. va Familiya+Ism (oddiy va teskari tartibda)
    q_s = " ".join(q_soft_toks)
    q_rev = " ".join(reversed(q_soft_toks))
    candidates = [
        " ".join(s_full_soft),
        " ".join(s_ism_soft),
        " ".join(s_full_soft[:2]),
    ]
    best = 0.0
    for cand in candidates:
        if not cand:
            continue
        r1 = difflib.SequenceMatcher(None, q_s, cand).ratio()
        r2 = difflib.SequenceMatcher(None, q_rev, cand).ratio()
        best = max(best, r1, r2)

    # Familiya birinchi so'z mosligi uchun kichik qo'shimcha
    if q_soft_toks and s_ism_soft and q_soft_toks[0] == s_ism_soft[0]:
        best = min(0.95, best + 0.03)

    return min(0.99, best + g_bonus), "fuzzy"


def match_file(path: Path, root: Path, students: list[dict], min_score: float):
    group_hint = extract_group_hint(path, root)
    stem = path.stem

    scored = []
    for s in students:
        sc, kind = score_student(stem, group_hint, s)
        if sc >= 0.60:
            scored.append((sc, kind, s))
    scored.sort(key=lambda x: x[0], reverse=True)

    if not scored:
        return "unmatched", None, 0.0, "", []

    top_sc, top_kind, top_s = scored[0]
    if top_sc < min_score:
        return "unmatched", None, top_sc, top_kind, scored[:3]

    # Agar 2-o'rin ham deyarli teng bo'lsa — shubhali/ikki ma'noli deb belgilaymiz
    if len(scored) > 1 and top_sc < 0.99:
        second_sc = scored[1][0]
        if top_sc - second_sc < 0.035:
            return "ambiguous", None, top_sc, top_kind, scored[:3]

    return "matched", top_s, top_sc, top_kind, scored[:2]


def main():
    parser = argparse.ArgumentParser(description="Talaba rasmlarini Supabase Storage ga ommaviy yuklash")
    parser.add_argument("folder", help="Talabalar rasmlari joylashgan papka yo'li")
    parser.add_argument("--apply", action="store_true", help="Haqiqatan Supabase'ga yuklash (busiz faqat tekshiruv)")
    parser.add_argument("--overwrite", action="store_true", help="Allaqachon rasmi bor talabalarnikini ham almashtirish")
    parser.add_argument("--min-score", type=float, default=0.84, help="Fuzzy moslik chegarasi (standart: 0.84)")
    parser.add_argument("--report", help="Natijani JSON faylga saqlash yo'li")
    args = parser.parse_args()

    root = Path(args.folder).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise SystemExit(f"XATO: Papka topilmadi: {root}")
    if args.apply and not SERVICE_KEY:
        raise SystemExit("XATO: SUPABASE_SERVICE_ROLE_KEY topilmadi!")

    students = fetch_students()
    print(f"Bazada jami {len(students)} nafar talaba o'qildi.")

    files = sorted(
        p for p in root.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS and not p.name.startswith(".")
    )
    print(f"Papkada {len(files)} ta rasm topildi: {root}\n")

    matched = []
    ambiguous = []
    unmatched = []
    used_keys: dict[str, Path] = {}

    for fp in files:
        status, st, sc, kind, top_cands = match_file(fp, root, students, args.min_score)
        rel = str(fp.relative_to(root))
        if status == "matched" and st is not None:
            key = photo_key_of(st)
            if key in used_keys:
                ambiguous.append({
                    "file": rel,
                    "reason": f"Takroriy rasm ({used_keys[key].name} ham shu talabaga mos tushgan)",
                    "student": f"{st.get('fish')} ({st.get('group')})",
                })
            else:
                used_keys[key] = fp
                matched.append((fp, rel, st, sc, kind))
        elif status == "ambiguous":
            ambiguous.append({
                "file": rel,
                "reason": "Bir nechta talaba o'xshash",
                "candidates": [f"{c[2].get('fish')} ({c[2].get('group')}) [{c[0]:.2f}]" for c in top_cands],
            })
        else:
            unmatched.append({
                "file": rel,
                "best_guess": [f"{c[2].get('fish')} ({c[2].get('group')}) [{c[0]:.2f}]" for c in top_cands],
            })

    exact_cnt = sum(1 for m in matched if m[4] != "fuzzy")
    fuzzy_cnt = sum(1 for m in matched if m[4] == "fuzzy")
    print(f"Mos tushganlar : {len(matched)} ta (aniq: {exact_cnt}, o'xshash/fuzzy: {fuzzy_cnt})")
    print(f"Ikki ma'noli   : {len(ambiguous)} ta")
    print(f"Topilmaganlar  : {len(unmatched)} ta")

    if fuzzy_cnt:
        print("\n--- O'xshash (fuzzy) mosliklar (tekshirib oling) ---")
        for _, rel, st, sc, kind in matched:
            if kind == "fuzzy":
                print(f"  [{sc:.2f}] {rel}  -->  {st.get('fish')} ({st.get('group')})")

    if ambiguous:
        print("\n--- Ikki ma'noli / Takroriy fayllar ---")
        for item in ambiguous:
            print(f"  ! {item['file']}: {item['reason']} {item.get('candidates') or item.get('student')}")

    if unmatched:
        print("\n--- Topilmagan rasmlar ---")
        for item in unmatched[:40]:
            guess = f" | taxmin: {', '.join(item['best_guess'])}" if item["best_guess"] else ""
            print(f"  ? {item['file']}{guess}")
        if len(unmatched) > 40:
            print(f"  ... va yana {len(unmatched) - 40} ta")

    if args.report:
        report_data = {
            "matched": [
                {"file": rel, "row": st["row"], "pinfl": clean_pin(st.get("pinfl")), "fish": st.get("fish"), "group": st.get("group"), "score": round(sc, 3), "kind": kind}
                for _, rel, st, sc, kind in matched
            ],
            "ambiguous": ambiguous,
            "unmatched": unmatched,
        }
        Path(args.report).write_text(json.dumps(report_data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nHisobot saqlandi: {args.report}")

    if not args.apply:
        print("\n[TEKSHIRUV REJIMI] Hech narsa yuklanmadi. Yuklash uchun --apply bayrog'ini qo'shing.")
        return

    print("\nSupabase Storage'ga yuklash boshlandi...")
    idx = fetch_photo_index()
    items = idx.setdefault("items", {})
    uploaded = 0
    skipped = 0
    old_paths_to_delete: list[str] = []

    for i, (fp, rel, st, sc, kind) in enumerate(matched, start=1):
        key = photo_key_of(st)
        pinfl = clean_pin(st.get("pinfl"))
        row_num = int(st["row"])
        fish = str(st.get("fish") or f"{st.get('ism') or ''} {st.get('ota') or ''}").strip()

        if key in items and not args.overwrite:
            skipped += 1
            continue

        try:
            webp_bytes = optimize_photo(fp)
            h12 = hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]
            ts = base36(int(time.time() * 1000) + i)
            storage_path = f"p_{h12}_{ts}.webp"
            public_url = upload_webp(storage_path, webp_bytes)

            # Eski yozuvlarni tozalash
            for k in list(items.keys()):
                rec = items[k]
                same_pin = len(pinfl) == 14 and clean_pin(rec.get("pinfl")) == pinfl
                same_row = rec.get("row") == row_num and (not pinfl or not clean_pin(rec.get("pinfl")) or clean_pin(rec.get("pinfl")) == pinfl)
                if k == key or same_pin or same_row:
                    if rec.get("path") and rec["path"] != storage_path:
                        old_paths_to_delete.append(rec["path"])
                    if k != key:
                        del items[k]

            items[key] = {
                "key": key,
                "path": storage_path,
                "url": public_url,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "row": row_num,
                **({"pinfl": pinfl} if len(pinfl) == 14 else {}),
                **({"fish": fish} if fish else {}),
            }
            uploaded += 1
            if uploaded % 20 == 0 or i == len(matched):
                print(f"  Yuklandi: {uploaded} / {len(matched)} (o'tkazib yuborilgan: {skipped})...")
        except Exception as e:
            print(f"  [XATO] {rel} ({fish}): {e}")

    if uploaded > 0:
        save_photo_index(idx)
        if old_paths_to_delete:
            remove_old_objects(old_paths_to_delete)
        print(f"\n[OK] Tayyor! {uploaded} ta rasm Supabase Storage'ga yuklandi va indeks yangilandi (jami indeksda: {len(items)} ta).")
    else:
        print(f"\nYangi yuklanadigan rasm bo'lmadi (o'tkazib yuborilgan: {skipped}).")


if __name__ == "__main__":
    main()
