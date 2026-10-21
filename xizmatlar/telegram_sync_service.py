# -*- coding: utf-8 -*-
"""
MAHALLIY BOSHQARUV VA TALABALARNI QO'SHISH SERVERI
==================================================
- Foydalanuvchi HTML dagi formadan to'g'ridan-to'g'ri yangi talabalarni qo'shadi.
- Bir nechta talabani bir vaqtda qatorma-qator kiritish imkoniyati.
- Excel va HTML avtomatik tarzda yangilanadi.
"""

import os
import sys
import json
import openpyxl
import docx
import io
import re
import base64
import urllib.request
import urllib.parse
from urllib.parse import unquote
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import subprocess
import mimetypes
import webbrowser
from PIL import Image

try:
    import zxingcpp
except ImportError:
    zxingcpp = None

try:
    import pypdf
except ImportError:
    pypdf = None

sys.stdout.reconfigure(encoding='utf-8')

# Xizmat xizmatlar/ papkasida — loyiha ildizi bir pog'ona yuqorida
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCEL_PATH = os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx')
FILES_DIR = os.path.join(BASE_DIR, 'hujjatlar', 'shartnomalar')
os.makedirs(FILES_DIR, exist_ok=True)

import threading
import time

EXCEL_LOCK = threading.Lock()
VERIFICATIONS_FILE = os.path.join(BASE_DIR, 'scripts', 'verifications.json')
VERIFICATIONS_LOCK = threading.Lock()

REBUILD_TIMER = None
REBUILD_LOCK = threading.Lock()
IS_REBUILDING = False
REBUILD_PENDING = False

# ===== GIT AUTO-PUSH SOZLAMALARI =====
GIT_AUTO_PUSH = True   # False qilib qo'ying agar push kerak bo'lmasa
GIT_PUSH_LOCK = threading.Lock()
# git buyruqlari ikki oqimdan (saqlashdan keyingi push va har 4 soniyadagi pull) bir vaqtda ishlamasin
GIT_OP_LOCK = threading.RLock()
_git_push_timer = None
GIT_SYNC_STATUS = {
    "state": "synced",           # "synced", "pending", "syncing", "error"
    "message": "Sinxronlangan",
    "last_sync": time.strftime("%H:%M:%S")
}

def _git(*args, timeout=30):
    return subprocess.run(['git', *args], cwd=BASE_DIR, capture_output=True, text=True, timeout=timeout)


def _git_unfinished():
    """Yarim qolgan rebase/merge: 'rebase', 'merge' yoki None"""
    git_dir = os.path.join(BASE_DIR, '.git')
    if os.path.isdir(os.path.join(git_dir, 'rebase-merge')) or os.path.isdir(os.path.join(git_dir, 'rebase-apply')):
        return 'rebase'
    if os.path.exists(os.path.join(git_dir, 'MERGE_HEAD')):
        return 'merge'
    return None


_last_git_alert = 0


def _alert_git_conflict(detail):
    """Ziddiyatni o'zi hal qila olmasa — bot orqali ogohlantirish (soatiga ko'pi bilan bir marta)"""
    global _last_git_alert
    print(f"[GIT] ❌ Sinxronlash ziddiyati: {detail}")
    if time.time() - _last_git_alert < 3600:
        return
    _last_git_alert = time.time()
    try:
        import requests
        cfg = load_backup_config()
        if cfg:
            requests.post(
                f"https://api.telegram.org/bot{cfg['token']}/sendMessage",
                json={'chat_id': cfg['chat_id'], 'text': f"⚠️ Talabalar portali: GitHub bilan sinxronlashda ziddiyat — o'zi hal qila olmadi.\n{detail[:300]}"},
                timeout=30,
            )
    except Exception as e:
        print(f"[GIT] Ogohlantirish yuborilmadi: {e}")


def safe_git_pull():
    """GitHub'dan tortib olish — ziddiyatda yarim yo'lda qolib ketmaydi.
    1) oldingi urinishdan yarim qolgan rebase/merge bo'lsa — bekor qilinadi
    2) git pull --rebase --autostash
    3) ziddiyat chiqsa — rebase bekor qilinadi va merge qilinadi, ziddiyatli joylarda
       GitHub'dagi (Vercel orqali kiritilgan) ma'lumot ustun (-X theirs)
    4) shunda ham bo'lmasa — merge bekor, holat «xato», bot orqali ogohlantirish
    True — tortib olindi"""
    global GIT_SYNC_STATUS
    with GIT_OP_LOCK:
        left = _git_unfinished()
        if left:
            print(f"[GIT] ⚠️ Yarim qolgan {left} topildi — bekor qilinmoqda")
            _git(left, '--abort')
        res = _git('pull', '--rebase', '--autostash', 'origin', 'main', '--quiet')
        if res.returncode == 0 and not _git_unfinished():
            return True
        if _git_unfinished() != 'rebase':
            # Ziddiyat emas (internet, GitHub javob bermadi va h.k.) — keyingi safar yana urinadi
            return False
        _git('rebase', '--abort')
        merge = _git('pull', '--no-rebase', '--no-edit', '--autostash', '-X', 'theirs', 'origin', 'main', timeout=60)
        if merge.returncode == 0 and not _git_unfinished():
            print("[GIT] ✅ Ziddiyat hal qilindi — GitHub'dagi ma'lumot ustun")
            return True
        detail = (merge.stdout + merge.stderr).strip() or 'merge xatosi'
        if _git_unfinished() == 'merge':
            _git('merge', '--abort')
        with GIT_PUSH_LOCK:
            GIT_SYNC_STATUS["state"] = "error"
            GIT_SYNC_STATUS["message"] = "Sinxronlash ziddiyati"
            GIT_SYNC_STATUS["detail"] = detail[:60]
        _alert_git_conflict(detail)
        return False


def _do_git_push():
    """Fonda git add + commit + push bajaradi (bloklamaydi)."""
    with GIT_OP_LOCK:
        _do_git_push_locked()


def _do_git_push_locked():
    global GIT_SYNC_STATUS
    with GIT_PUSH_LOCK:
        GIT_SYNC_STATUS["state"] = "syncing"
        GIT_SYNC_STATUS["message"] = "GitHub'ga yuklanmoqda..."
    try:
        result_add = subprocess.run(
            ['git', 'add',
             'eski_portal/index.html',
             'data/students.json',
             'data/talabalar_bazasi.json',
             'data/guruhlar.json',
             'data/asl_guruhlar.json',
             'data/guruh_tarixi.json',
             'data/Talabalar_Toliq_Royxati.xlsx',
             'data/Talabalar_Yangilangan_Royxat.xlsx',
             'qayta_tekshiruv/Talabalar_Yangilangan_Royxat.xlsx',
             'hisobotlar/pdf_jurnallar',
             'hisobotlar/rollar',
             'qayta_tekshiruv/pdf_jurnallar',
             'scripts/verifications.json',
             'scripts/remote_changes.json',
             'scripts/manual_file_map.json'],
            cwd=BASE_DIR, capture_output=True, text=True, timeout=30
        )
        # DIQQAT: 'git status --porcelain' kuzatilmayotgan (??) fayllarni ham
        # sanaydi. Loyiha papkasida doimo shunday fayllar bor (backup, hisobot
        # va h.k.), shuning uchun u hech qachon bo'sh bo'lmaydi va stage da
        # hech narsa bo'lmasa ham commit urinib, "Commit xatosi" holatini
        # ko'rsatib qolardi. Faqat stage qilingan o'zgarishni tekshiramiz:
        # --quiet farq bo'lsa 1, bo'lmasa 0 qaytaradi.
        result_status = subprocess.run(
            ['git', 'diff', '--cached', '--quiet'],
            cwd=BASE_DIR, capture_output=True, text=True, timeout=10
        )
        if result_status.returncode != 0:
            result_commit = subprocess.run(
                ['git', 'commit', '-m', f"Auto: talaba ma'lumotlari yangilandi ({time.strftime('%Y-%m-%d %H:%M:%S')})"],
                cwd=BASE_DIR, capture_output=True, text=True, timeout=30
            )
            if result_commit.returncode == 0:
                # Masofaviy o'zgarishlar bilan ziddiyat bo'lmasligi uchun oldin tortib olamiz
                safe_git_pull()
                result_push = subprocess.run(
                    ['git', 'push', 'origin', 'main'],
                    cwd=BASE_DIR, capture_output=True, text=True, timeout=60
                )
                if result_push.returncode == 0:
                    print("[GIT] ✅ GitHub'ga muvaffaqiyatli push qilindi")
                    with GIT_PUSH_LOCK:
                        GIT_SYNC_STATUS["state"] = "synced"
                        GIT_SYNC_STATUS["message"] = "GitHub bilan sinxronlandi"
                        GIT_SYNC_STATUS["last_sync"] = time.strftime("%H:%M:%S")
                else:
                    # Agar birinchi urinish o'tmasa, yana bir bor rebase qilib ko'rish
                    safe_git_pull()
                    retry_push = subprocess.run(['git', 'push', 'origin', 'main'], cwd=BASE_DIR, capture_output=True, text=True, timeout=60)
                    if retry_push.returncode == 0:
                        print("[GIT] ✅ GitHub'ga qayta urinishda push qilindi")
                        with GIT_PUSH_LOCK:
                            GIT_SYNC_STATUS["state"] = "synced"
                            GIT_SYNC_STATUS["message"] = "GitHub bilan sinxronlandi"
                            GIT_SYNC_STATUS["last_sync"] = time.strftime("%H:%M:%S")
                    else:
                        err_msg = retry_push.stderr.strip() or "Push xatosi"
                        print(f"[GIT] ⚠️ Push xatosi: {err_msg}")
                        with GIT_PUSH_LOCK:
                            GIT_SYNC_STATUS["state"] = "error"
                            GIT_SYNC_STATUS["message"] = f"Push xatosi"
                            GIT_SYNC_STATUS["detail"] = err_msg[:60]
            else:
                err_msg = result_commit.stderr.strip() or "Commit xatosi"
                print(f"[GIT] ℹ️ Commit xatosi: {err_msg}")
                with GIT_PUSH_LOCK:
                    GIT_SYNC_STATUS["state"] = "error"
                    GIT_SYNC_STATUS["message"] = f"Commit xatosi"
        else:
            print("[GIT] ℹ️ O'zgarmagan fayl yo'q — push o'tkazib yuborildi")
            with GIT_PUSH_LOCK:
                GIT_SYNC_STATUS["state"] = "synced"
                GIT_SYNC_STATUS["message"] = "Barcha ma'lumotlar GitHub'da mavjud"
                GIT_SYNC_STATUS["last_sync"] = time.strftime("%H:%M:%S")
    except subprocess.TimeoutExpired:
        print("[GIT] ⚠️ Git operatsiyasi vaqt tugashi bilan bekor qilindi")
        with GIT_PUSH_LOCK:
            GIT_SYNC_STATUS["state"] = "error"
            GIT_SYNC_STATUS["message"] = "Vaqt tugashi (Timeout)"
    except Exception as e:
        print(f"[GIT] ❌ Git xatosi: {e}")
        with GIT_PUSH_LOCK:
            GIT_SYNC_STATUS["state"] = "error"
            GIT_SYNC_STATUS["message"] = "Git xatosi"

def schedule_git_push(delay=2.0):
    """Ma'lumot saqlangandan so'ng 2-3 soniyadan keyin git push qiladi.
    Bir necha ketma-ket o'zgarish bo'lsa, faqat bitta push qiladi."""
    global _git_push_timer, GIT_SYNC_STATUS
    if not GIT_AUTO_PUSH:
        return
    with GIT_PUSH_LOCK:
        GIT_SYNC_STATUS["state"] = "pending"
        GIT_SYNC_STATUS["message"] = "GitHub'ga tayyorlanmoqda..."
        if _git_push_timer is not None:
            _git_push_timer.cancel()
        _git_push_timer = threading.Timer(delay, _do_git_push)
        _git_push_timer.daemon = True
        _git_push_timer.start()

# Safdan chiqarish / akademik ta'til buyrug'i — asosiy Excelning 26–27-ustunlari
BUYRUQ_COL, BUYRUQ_SANA_COL = 26, 27


def write_buyruq(ws, row_idx, raqam=None, sana=None):
    """Buyruq raqami/sanasini yozadi (None — o'zgartirilmaydi). Sarlavhalar bo'lmasa qo'yiladi."""
    if raqam is None and sana is None:
        return
    if ws.cell(row=1, column=BUYRUQ_COL).value != 'Buyruq raqami':
        ws.cell(row=1, column=BUYRUQ_COL, value='Buyruq raqami')
    if ws.cell(row=1, column=BUYRUQ_SANA_COL).value != 'Buyruq sanasi':
        ws.cell(row=1, column=BUYRUQ_SANA_COL, value='Buyruq sanasi')
    if raqam is not None:
        ws.cell(row=row_idx, column=BUYRUQ_COL, value=str(raqam).strip())
    if sana is not None:
        ws.cell(row=row_idx, column=BUYRUQ_SANA_COL, value=str(sana).strip())


def backup_excel_atomic():
    """Excel faylining xavfsizlik nusxasini data/backups ga saqlaydi."""
    try:
        if not os.path.exists(EXCEL_PATH):
            return
        backup_dir = os.path.join(BASE_DIR, 'data', 'backups')
        os.makedirs(backup_dir, exist_ok=True)
        backup_file = os.path.join(backup_dir, f"Talabalar_Backup_{time.strftime('%Y%m%d')}.xlsx")
        # Har kuni kamida 1 marta yoki birinchi yozishda nusxalaydi
        if not os.path.exists(backup_file):
            import shutil
            shutil.copy2(EXCEL_PATH, backup_file)
    except Exception as e:
        print(f"[BACKUP] Zaxira olishda xato: {e}")


_SHNUM_PREFIX_RE = re.compile(r'^\s*\d{2}\s*/\s*\d{2}\s*sh\s*/\s*a\s*(\d+)\s*$', re.IGNORECASE)


def normalize_shnum(v):
    """Shartnoma raqamidan o'quv yili va "Sh/A" ni olib tashlaydi: '26/27 SH/A 15' -> '15'.
    2- va 3-kurslarda shunday yozilgan edi (2026-10-14 dan faqat raqam)."""
    s_ = str(v or '').strip()
    m = _SHNUM_PREFIX_RE.match(s_)
    return m.group(1) if m else s_


def find_student_row_in_sheet(ws, r_idx, pinfl=None, shnum=None, ism=None, strict=False):
    """
    Talabaning Excel qatorini topadi. Tartib: JSHSHIR -> berilgan qator -> shartnoma raqami
    (faqat jadvalda YAGONA bo'lsa — turli kurslarda bir xil raqamlar bor) -> ism.
    strict=True (o'chirishda) — hech narsa mos kelmasa None qaytaradi, taxminiy qator emas.
    """
    pinfl_c = str(pinfl or '').replace(' ', '').strip()
    sh_c = normalize_shnum(shnum)
    if sh_c in ('—', '-'):
        sh_c = ''
    ism_c = str(ism or '').strip().lower()

    def cell_pinfl(r):
        return str(ws.cell(row=r, column=11).value or '').replace(' ', '').strip()

    def cell_shnum(r):
        return normalize_shnum(ws.cell(row=r, column=5).value)

    def name_ok(r):
        if not ism_c:
            return False
        c2 = str(ws.cell(row=r, column=2).value or '').strip().lower()
        c8 = str(ws.cell(row=r, column=8).value or '').strip().lower()
        return c2 == ism_c or c8 == ism_c or (len(ism_c) > 6 and ism_c in c8) or (len(c2) > 6 and c2 in ism_c)

    rows = range(2, ws.max_row + 1)

    # 1. Berilgan qator — JSHSHIR bo'lsa u hal qiladi (shartnoma raqami takrorlanishi mumkin)
    if 2 <= r_idx <= ws.max_row:
        cp = cell_pinfl(r_idx)
        if pinfl_c and cp:
            if cp == pinfl_c:
                return r_idx
        elif sh_c and cell_shnum(r_idx) == sh_c:
            return r_idx
        elif not pinfl_c and not sh_c and name_ok(r_idx):
            return r_idx

    # 2. JSHSHIR bo'yicha butun jadval
    if pinfl_c:
        for r in rows:
            if cell_pinfl(r) == pinfl_c:
                return r

    # 3. Shartnoma raqami — faqat bitta qatorda bo'lsa; bir nechta bo'lsa ism bilan ajratiladi
    if sh_c:
        hits = [r for r in rows if cell_shnum(r) == sh_c]
        if len(hits) == 1:
            return hits[0]
        named = [r for r in hits if name_ok(r)]
        if len(named) == 1:
            return named[0]

    # 4. Ism bo'yicha
    if ism_c and len(ism_c) > 4:
        for r in rows:
            if name_ok(r):
                return r

    # 5. Hech narsa topilmadi — tahrirda berilgan qator (eski xatti-harakat), o'chirishda hech narsa
    if not strict and 2 <= r_idx <= ws.max_row:
        return r_idx
    return None


def process_remote_github_changes():
    """Fonda GitHub'dagi remote_changes.json faylini tekshiradi.
    Agar Vercel/GitHub'dan yangi o'zgarishlar kelgan bo'lsa, lokal Excelga qo'llaydi."""
    changes_file = os.path.join(BASE_DIR, 'scripts', 'remote_changes.json')
    try:
        # 1. GitHub'dan eng yangi o'zgarishlarni tortib olish
        # Ziddiyatda yarim yo'lda qolib ketmaydi (safe_git_pull); push bilan bir vaqtda ishlamaydi
        safe_git_pull()
        if not os.path.exists(changes_file):
            return

        with open(changes_file, 'r', encoding='utf-8') as f:
            try:
                changes = json.load(f)
            except Exception:
                changes = []

        if not changes or not isinstance(changes, list) or len(changes) == 0:
            return

        print(f"[SYNC] 📥 GitHub'dan {len(changes)} ta yangi o'zgarish qabul qilindi! Lokal Excelga qo'llanmoqda...")

        backup_excel_atomic()

        with EXCEL_LOCK:
            wb = openpyxl.load_workbook(EXCEL_PATH)
            ws = wb.worksheets[0]

            for chg in changes:
                chg_type = chg.get('type')
                data = chg.get('data', {})

                if chg_type == 'verify_student':
                    r_idx = int(data.get('row', 0))
                    v_status = data.get('status', 'TASDIQLANDI')
                    shnum = data.get('shnum', '')
                    pinfl = data.get('pinfl', '')
                    ism = data.get('ism', '')
                    r_idx = find_student_row_in_sheet(ws, r_idx, pinfl=pinfl, shnum=shnum, ism=ism)
                    if r_idx and 2 <= r_idx <= ws.max_row:
                        ws.cell(row=r_idx, column=25, value=v_status)
                        save_verification_atomic(r_idx, v_status, shnum, pinfl)

                elif chg_type == 'baza_student':
                    r_idx = int(data.get('row', 0))
                    b_status = data.get('status', 'KIRITILDI')
                    shnum = data.get('shnum', '')
                    pinfl = data.get('pinfl', '')
                    ism = data.get('ism', '')
                    r_idx = find_student_row_in_sheet(ws, r_idx, pinfl=pinfl, shnum=shnum, ism=ism)
                    if ws.cell(row=1, column=28).value != 'Bazaga kiritilganligi':
                        ws.cell(row=1, column=28, value='Bazaga kiritilganligi')
                    if r_idx and 2 <= r_idx <= ws.max_row:
                        ws.cell(row=r_idx, column=28, value=b_status)
                        save_baza_verification_atomic(r_idx, b_status, shnum, pinfl)

                elif chg_type == 'update_student':
                    r_idx = int(data.get('row', 0))
                    fields = data.get('fields', {})
                    shnum_q = data.get('shnum') or fields.get('shnum')
                    pinfl_q = data.get('pinfl') or fields.get('pinfl')
                    ism_q = data.get('ism') or fields.get('ism')
                    r_idx = find_student_row_in_sheet(ws, r_idx, pinfl=pinfl_q, shnum=shnum_q, ism=ism_q)
                    if r_idx and 2 <= r_idx <= ws.max_row:
                        if 'ism' in fields and fields['ism']:
                            ws.cell(row=r_idx, column=2, value=clean_uz_name(fields['ism']))
                        if 'ota' in fields and fields['ota']:
                            ws.cell(row=r_idx, column=7, value=clean_uz_name(fields['ota']))
                        # To'liq F.I.Sh (8-ustun) ham yangilanishi shart — aks holda
                        # ism/ota o'zgargach ro'yxatda eski to'liq ism qolib ketadi
                        if ('ism' in fields and fields['ism']) or ('ota' in fields and fields['ota']):
                            cur_ism = str(ws.cell(row=r_idx, column=2).value or '')
                            cur_ota = str(ws.cell(row=r_idx, column=7).value or '')
                            ws.cell(row=r_idx, column=8, value=f"{cur_ism} {cur_ota}".strip())
                        if 'pv' in fields:
                            ws.cell(row=r_idx, column=10, value=str(fields['pv']).strip())
                        if 'pinfl' in fields:
                            ws.cell(row=r_idx, column=11, value=str(fields['pinfl']).strip())
                        if 'ber' in fields:
                            ws.cell(row=r_idx, column=12, value=str(fields['ber']).strip())
                        if 'dob' in fields:
                            ws.cell(row=r_idx, column=13, value=str(fields['dob']).strip())
                        if 'sh_doc' in fields:
                            ws.cell(row=r_idx, column=15, value=str(fields['sh_doc']).strip())
                        if 'mak' in fields:
                            ws.cell(row=r_idx, column=17, value=str(fields['mak']).strip())
                        if 'doc_tur' in fields:
                            ws.cell(row=r_idx, column=18, value=str(fields['doc_tur']).strip())
                        if 'yil' in fields:
                            ws.cell(row=r_idx, column=19, value=str(fields['yil']).strip())
                        if 'yon' in fields:
                            ws.cell(row=r_idx, column=3, value=str(fields['yon']).strip())
                        # Lokal /api/update_student bilan bir xil: shartnoma
                        # raqami va telefon ham yoziladi (avval tashlab ketilardi)
                        if 'shnum' in fields:
                            ws.cell(row=r_idx, column=5, value=normalize_shnum(fields['shnum']))
                        if 'tel' in fields:
                            ws.cell(row=r_idx, column=20, value=str(fields['tel']).strip())
                        if 'group' in fields:
                            ws.cell(row=r_idx, column=23, value=str(fields['group']).strip())
                        write_buyruq(ws, r_idx, fields.get('buyruq'), fields.get('buyruq_sana'))

                elif chg_type == 'update_group':
                    r_idx = int(data.get('row', 0))
                    new_grp = str(data.get('group', '')).strip()
                    shnum_g = data.get('shnum')
                    pinfl_g = data.get('pinfl')
                    r_idx = find_student_row_in_sheet(ws, r_idx, pinfl=pinfl_g, shnum=shnum_g)
                    if r_idx and 2 <= r_idx <= ws.max_row and new_grp:
                        ws.cell(row=r_idx, column=23, value=new_grp)

                elif chg_type == 'add_student':
                    s_ism = clean_uz_name(data.get('ism', ''))
                    s_ota = clean_uz_name(data.get('ota', ''))
                    if not s_ism:
                        print("[SYNC] ⚠️ Bo'sh talaba ma'lumoti kelgani sababli e'tiborsiz qoldirildi.")
                        continue
                    s_fish = f"{s_ism} {s_ota}".strip() if s_ota else s_ism
                    pinfl_chk = str(data.get('pinfl', '')).replace(' ', '').strip()
                    group_chk = str(data.get('group', '26-02')).strip()

                    # Excelda allaqachon mavjudligini tekshirish (takroriy qo'shilishdan himoya)
                    already_exists = False
                    for r_chk in range(2, ws.max_row + 1):
                        p_val = str(ws.cell(row=r_chk, column=11).value or '').replace(' ', '').strip()
                        if pinfl_chk and len(pinfl_chk) == 14 and p_val == pinfl_chk:
                            already_exists = True
                            break
                        f_val = str(ws.cell(row=r_chk, column=8).value or '').strip().lower()
                        g_val = str(ws.cell(row=r_chk, column=23).value or '').strip()
                        if f_val == s_fish.lower() and g_val == group_chk:
                            already_exists = True
                            break
                    if already_exists:
                        print(f"[SYNC] ⚠️ Talaba allaqachon Excelda mavjud ({s_fish}, {group_chk}), takroriy yozish bekor qilindi.")
                        continue

                    nr = ws.max_row + 1
                    ws.cell(row=nr, column=1, value=nr - 1)
                    ws.cell(row=nr, column=2, value=s_ism)
                    ws.cell(row=nr, column=3, value=data.get('yon', 'Hamshiralik ishi - 3 yillik'))
                    ws.cell(row=nr, column=4, value="To'lov qildi")
                    ws.cell(row=nr, column=5, value=normalize_shnum(data.get('shnum', '')))
                    ws.cell(row=nr, column=6, value=time.strftime("%d.%m.%Y"))
                    ws.cell(row=nr, column=7, value=s_ota)
                    ws.cell(row=nr, column=8, value=s_fish)
                    ws.cell(row=nr, column=10, value=data.get('pv', ''))
                    ws.cell(row=nr, column=11, value=str(data.get('pinfl', '')).replace(' ', '').strip())
                    ws.cell(row=nr, column=12, value=data.get('ber', ''))
                    ws.cell(row=nr, column=13, value=data.get('dob', ''))
                    ws.cell(row=nr, column=14, value="Mavjud" if (data.get('pv') or data.get('sh_doc')) else "Yo'q")
                    ws.cell(row=nr, column=15, value=data.get('sh_doc', ''))
                    ws.cell(row=nr, column=16, value="")
                    ws.cell(row=nr, column=17, value=data.get('mak', ''))
                    ws.cell(row=nr, column=18, value=data.get('doc_tur', "Shahodatnoma"))
                    ws.cell(row=nr, column=19, value=data.get('yil', '2024'))
                    ws.cell(row=nr, column=20, value=data.get('tel', ''))
                    ws.cell(row=nr, column=21, value="TOPILDI")
                    ws.cell(row=nr, column=23, value=data.get('group', '26-02'))
                    ws.cell(row=nr, column=25, value="KUTILMOQDA")
                    ws.cell(row=nr, column=28, value="KIRITILDI")
                    sync_to_webjurnal_bg(data.get('group', '26-02'), [s_fish])

                elif chg_type == 'delete_student':
                    # Shartnoma raqami takrorlanishi mumkin — avval JSHSHIR va qator, noaniq bo'lsa o'chirilmaydi
                    target_row = find_student_row_in_sheet(
                        ws, int(data.get('row', 0) or 0),
                        pinfl=data.get('pinfl'), shnum=data.get('shnum'),
                        ism=data.get('ism') or data.get('fish'), strict=True)

                    if target_row and 2 <= target_row <= ws.max_row:
                        del_sh = str(ws.cell(row=target_row, column=5).value or '').strip()
                        del_pinfl = str(ws.cell(row=target_row, column=11).value or '').strip()
                        ws.delete_rows(target_row)
                        for idx, r in enumerate(range(2, ws.max_row + 1), start=1):
                            ws.cell(row=r, column=1, value=idx)
                        try:
                            with VERIFICATIONS_LOCK:
                                if os.path.exists(VERIFICATIONS_FILE):
                                    with open(VERIFICATIONS_FILE, 'r', encoding='utf-8') as vf:
                                        vmap = json.load(vf)
                                    vmap.pop(str(target_row), None)
                                    vmap.pop('baza_' + str(target_row), None)
                                    if del_sh:
                                        vmap.pop('sh_' + del_sh, None)
                                        vmap.pop('baza_sh_' + del_sh, None)
                                    if del_pinfl:
                                        vmap.pop('pinfl_' + del_pinfl, None)
                                        vmap.pop('baza_pinfl_' + del_pinfl, None)
                                    with open(VERIFICATIONS_FILE, 'w', encoding='utf-8') as vf:
                                        json.dump(vmap, vf, ensure_ascii=False, indent=2)
                        except Exception:
                            pass

            wb.save(EXCEL_PATH)
            wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx'))
            wb.save(os.path.join(BASE_DIR, 'qayta_tekshiruv', 'Talabalar_Yangilangan_Royxat.xlsx'))

            # O'qib bo'lingan navbatni tozalash
            with open(changes_file, 'w', encoding='utf-8') as f:
                json.dump([], f, indent=2)

        # Hisobotlarni yangilash va toza holatni GitHub'ga push qilish
        trigger_report_rebuild(delay=0.5, async_mode=False)
        print("[SYNC] ✅ Lokal Excel yangilandi va qayta generatsiya qilindi!")
    except Exception as e:
        print(f"[SYNC] Masofaviy o'zgarishlarni qo'llashda xato: {e}")

# =========================================================================
# KUNLIK AVTO-ZAHIRA (TELEGRAM)
# Har kuni belgilangan soatda (standart 18:00) talabalar bazasini Telegram
# botga yuboradi.
#
# DIQQAT: bot tokeni shu faylga YOZILMAYDI — bu fayl ommaviy GitHub
# repozitoriysida turadi. Token 'scripts/backup_config.json' dan yoki
# TG_BACKUP_TOKEN / TG_BACKUP_CHAT_ID muhit o'zgaruvchilaridan o'qiladi.
# Sozlanmagan bo'lsa zahira jim o'tkazib yuboriladi.
# =========================================================================
BACKUP_CONFIG_PATH = os.path.join(BASE_DIR, 'scripts', 'backup_config.json')
BACKUP_STATE_PATH = os.path.join(BASE_DIR, 'scripts', 'backup_state.json')
BACKUP_HOUR = 18
BACKUP_MINUTE = 0


def load_backup_config():
    """Zahira va Telegram sozlamalarini o'qiydi. Topilmasa None qaytaradi."""
    token = os.environ.get('TG_BACKUP_TOKEN', '').strip()
    chat_id = os.environ.get('TG_BACKUP_CHAT_ID', '').strip()
    channel_id = os.environ.get('TG_BACKUP_CHANNEL_ID', '').strip()
    allowed_raw = os.environ.get('TG_ALLOWED_IDS', '')

    if os.path.exists(BACKUP_CONFIG_PATH):
        try:
            with open(BACKUP_CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            token = token or str(cfg.get('bot_token', '')).strip()
            chat_id = chat_id or str(cfg.get('chat_id', '')).strip()
            channel_id = channel_id or str(cfg.get('channel_id', '')).strip()
            ids = cfg.get('allowed_ids', '')
            allowed_raw = allowed_raw or (','.join(map(str, ids)) if isinstance(ids, list) else str(ids))
            global BACKUP_HOUR, BACKUP_MINUTE
            BACKUP_HOUR = int(cfg.get('hour', BACKUP_HOUR))
            BACKUP_MINUTE = int(cfg.get('minute', BACKUP_MINUTE))
        except Exception as e:
            print(f"[ZAHIRA] Sozlama faylini o'qishda xato: {e}")

    if not token or not (chat_id or channel_id):
        return None
    # Bot pasport/JSHSHIR beradi — faqat shu chatlarga javob beriladi (asosiy chat + allowed_ids)
    allowed = {x.strip() for x in re.split(r'[\s,;]+', allowed_raw or '') if x.strip()}
    if chat_id:
        allowed.add(chat_id)
    report_variant = int(cfg.get('report_variant', 5)) if 'cfg' in locals() and cfg else 5
    return {'token': token, 'chat_id': chat_id, 'channel_id': channel_id, 'allowed_ids': allowed, 'report_variant': report_variant}


def send_group_lists_to_telegram(target='channel', group_filter=None):
    """
    Har bir guruh talabalari ro'yxatini Telegram'ga alohida xabar qilib yuboradi.
    Har bir guruh alifbo (A-Z) tartibida raqamlangan bo'ladi.
    """
    import html
    import requests

    cfg = load_backup_config()
    if not cfg:
        print("[TELEGRAM] Sozlanmagan (scripts/backup_config.json yo'q)")
        return {'ok': False, 'error': "Telegram bot sozlanmagan (scripts/backup_config.json yo'q)"}

    token = cfg['token']
    target_str = str(target or 'channel').strip().lower()

    dest_chats = []
    if target_str == 'channel':
        dest_chats = [cfg.get('channel_id') or '-1004375713276']
    elif target_str in ('chat', 'personal', 'private'):
        dest_chats = [cfg.get('chat_id') or '8135594558']
    elif target_str in ('both', 'ikkalasi'):
        dest_chats = list(filter(None, [cfg.get('channel_id'), cfg.get('chat_id')]))
    elif target:
        dest_chats = [str(target).strip()]

    if not dest_chats:
        dest_chats = [cfg.get('channel_id') or '-1004375713276']

    meta_dict = load_groups_metadata()
    GROUP_META = {
        grp: {"specialty": v.get("yonalish", "Hamshiralik ishi"), "leader": v.get("rahbar", "—")}
        for grp, v in meta_dict.items()
    }
    GROUP_META["Akademik ta'til olganlar"] = {"specialty": "Maxsus ro'yxat", "leader": "Texnikum ma'muriyati"}
    GROUP_META["Talabalar safidan chiqarilganlar"] = {"specialty": "Maxsus ro'yxat", "leader": "Texnikum ma'muriyati"}

    OFFICIAL_ORDER = sorted(meta_dict.keys(), key=lambda g: (get_kurs_of_group(g, meta_dict), g)) + [
        "Akademik ta'til olganlar",
        "Talabalar safidan chiqarilganlar"
    ]

    ex_path = EXCEL_PATH
    if not os.path.exists(ex_path):
        ex_path = os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx')

    if not os.path.exists(ex_path):
        return {'ok': False, 'error': "Talabalar bazasi (Excel) topilmadi"}

    with EXCEL_LOCK:
        wb = openpyxl.load_workbook(ex_path, data_only=True)
        ws = wb.active

        groups_data = {}
        for r in range(2, ws.max_row + 1):
            fio_base = str(ws.cell(row=r, column=2).value or '').strip()
            shnum = str(ws.cell(row=r, column=5).value or '').strip()
            ota = str(ws.cell(row=r, column=7).value or '').strip()
            fish = str(ws.cell(row=r, column=8).value or '').strip()
            grp_raw = str(ws.cell(row=r, column=23).value or '').strip()

            if not fio_base and not shnum:
                continue

            if 'chiqaril' in grp_raw.lower() or grp_raw in ['N', 'n', 'WITHDRAWN']:
                grp = "Talabalar safidan chiqarilganlar"
            elif grp_raw:
                grp = grp_raw
            else:
                grp = "Guruhsiz"

            full_name = fish if fish else (f"{fio_base} {ota}".strip() if ota else fio_base)
            full_name = full_name.replace('\u2018', "'").replace('\u2019', "'").replace('\u02bb', "'")

            groups_data.setdefault(grp, []).append({
                'name': full_name,
                'shnum': shnum
            })
        wb.close()

    for g in groups_data:
        groups_data[g].sort(key=lambda s: re.sub(r"['`‘’ʻʼ´\-_.]", "", str(s.get('name', '')).lower()))

    groups_to_send = []
    if group_filter and str(group_filter).strip().upper() not in ('ALL', 'BARCHASI', ''):
        selected = str(group_filter).strip()
        if selected in groups_data:
            groups_to_send = [selected]
        else:
            matches = [g for g in groups_data if selected.lower() in g.lower()]
            groups_to_send = matches if matches else [selected]
    else:
        for og in OFFICIAL_ORDER:
            if og in groups_data:
                groups_to_send.append(og)
        for g in sorted(groups_data.keys()):
            if g not in groups_to_send:
                groups_to_send.append(g)

    sent_reports = []
    all_success = True

    for grp in groups_to_send:
        st_list = groups_data.get(grp, [])
        if not st_list:
            continue

        meta = GROUP_META.get(grp, {})
        is_withdrawn = ('chiqaril' in grp.lower())

        # Rasm faylini aniqlash va tekshirish
        fname_base = "Guruh_Talabalar_safidan_chiqarilganlar" if is_withdrawn else f"Guruh_{grp}"
        jpg_path = os.path.join(BASE_DIR, 'hisobotlar', 'pdf_jurnallar', f"{fname_base}.jpg")
        pdf_path = os.path.join(BASE_DIR, 'hisobotlar', 'pdf_jurnallar', f"{fname_base}.pdf")

        # Agar JPG yo'q bo'lsa, PDF dan tezkor render qilamiz
        if not os.path.exists(jpg_path) and os.path.exists(pdf_path):
            try:
                import pymupdf
                doc = pymupdf.open(pdf_path)
                pix = doc[0].get_pixmap(dpi=250)
                pix.save(jpg_path)
                doc.close()
            except Exception as e_rend:
                print(f"[TELEGRAM] PDF render xatosi: {e_rend}")

        # Caption (xabar izohi)
        caption_lines = []
        caption_lines.append("<b>Shahrisabz Tibbiyot Texnikumi</b>")
        if is_withdrawn:
            caption_lines.append("<b>Talabalar safidan chiqarilganlar ro'yxati</b>")
            caption_lines.append(f"Talabalar soni: <b>{len(st_list)} nafar</b>")
        else:
            caption_lines.append(f"<b>Akademik guruh: {grp} ({meta.get('specialty', 'Hamshiralik ishi')})</b>")
            caption_lines.append(f"Mas'ul murabbiy: <b>{meta.get('leader', '—')}</b>")
            caption_lines.append(f"Talabalar soni: <b>{len(st_list)} nafar</b>")
        caption_text = "\n".join(caption_lines)

        img_bytes = None
        if os.path.exists(jpg_path):
            try:
                with open(jpg_path, 'rb') as f_in:
                    img_bytes = f_in.read()
            except Exception as e_read:
                print(f"[TELEGRAM] Rasm o'qishda xato: {e_read}")

        for chat_id in dest_chats:
            try:
                if img_bytes:
                    # Yuqori sifatli rasm formatida (sendPhoto)
                    resp = requests.post(
                        f"https://api.telegram.org/bot{token}/sendPhoto",
                        data={
                            "chat_id": chat_id,
                            "caption": caption_text,
                            "parse_mode": "HTML"
                        },
                        files={"photo": (f"{fname_base}.jpg", img_bytes, "image/jpeg")},
                        timeout=60
                    )
                else:
                    # Agar rasm bo'lmasa, matn formatida fallback
                    lines = [caption_text, ""]
                    for idx, s in enumerate(st_list, 1):
                        lines.append(f"{idx}. {html.escape(s['name'])}")
                    resp = requests.post(
                        f"https://api.telegram.org/bot{token}/sendMessage",
                        json={
                            "chat_id": chat_id,
                            "text": "\n".join(lines),
                            "parse_mode": "HTML"
                        },
                        timeout=30
                    )

                res_data = resp.json()
                if resp.ok and res_data.get('ok'):
                    sent_reports.append({
                        'group': grp,
                        'chat_id': chat_id,
                        'message_id': res_data['result']['message_id'],
                        'count': len(st_list),
                        'ok': True
                    })
                else:
                    all_success = False
                    sent_reports.append({
                        'group': grp,
                        'chat_id': chat_id,
                        'error': res_data.get('description', 'Telegram xatosi'),
                        'ok': False
                    })
            except Exception as e:
                all_success = False
                sent_reports.append({
                    'group': grp,
                    'chat_id': chat_id,
                    'error': str(e),
                    'ok': False
                })

            time.sleep(0.35)

    return {
        'ok': all_success,
        'sent_count': sum(1 for r in sent_reports if r.get('ok')),
        'total_groups': len(groups_to_send),
        'results': sent_reports
    }


def load_groups_metadata():
    """
    data/guruhlar.json faylidan barcha guruhlar ma'lumotlarini (kurs, rahbar, yo'nalish) yuklaydi.
    Fayl topilmasa yoki xato bo'lsa, zaxira qiymatlarni qaytaradi.
    """
    guruhlar_path = os.path.join(BASE_DIR, 'data', 'guruhlar.json')
    defaults = {
        '26-01': {'kurs': 1, 'rahbar': 'Mirzayeva.D', 'yonalish': 'Farmatsiya ishi'},
        '26-02': {'kurs': 1, 'rahbar': 'Ochilov.D', 'yonalish': 'Hamshiralik ishi'},
        '26-03': {'kurs': 1, 'rahbar': 'A.Asraliyev', 'yonalish': 'Hamshiralik ishi'},
        '26-04': {'kurs': 1, 'rahbar': 'Xamdamova.M', 'yonalish': 'Hamshiralik ishi'},
        '26-05': {'kurs': 1, 'rahbar': 'Rayimova.X', 'yonalish': 'Hamshiralik ishi'},
        '26-06': {'kurs': 1, 'rahbar': 'Yuldashev.O', 'yonalish': 'Hamshiralik ishi'},
        '26-07': {'kurs': 1, 'rahbar': 'Asraliyev.A', 'yonalish': 'Hamshiralik ishi'},
        '24-15': {'kurs': 2, 'rahbar': 'Asraliyev.A', 'yonalish': 'Hamshiralik ishi'},
        '24-16': {'kurs': 2, 'rahbar': 'Yuldashev.O', 'yonalish': 'Hamshiralik ishi'},
        '25-16': {'kurs': 2, 'rahbar': 'Xidirova.N', 'yonalish': 'Hamshiralik ishi'},
        '25-17': {'kurs': 2, 'rahbar': 'Meyliyev.B', 'yonalish': 'Hamshiralik ishi'},
        '25-18': {'kurs': 2, 'rahbar': 'Eshnayev.B', 'yonalish': 'Hamshiralik ishi'},
        '25-19': {'kurs': 2, 'rahbar': 'Shukurova.G', 'yonalish': 'Hamshiralik ishi'},
        '25-20': {'kurs': 2, 'rahbar': 'Maxamadiyev.L', 'yonalish': 'Hamshiralik ishi'},
        '25-21': {'kurs': 2, 'rahbar': 'Eshnayev.B', 'yonalish': 'Hamshiralik ishi'},
        '25-22': {'kurs': 2, 'rahbar': 'Rahmatova.Sh', 'yonalish': 'Hamshiralik ishi'},
        '25-23': {'kurs': 2, 'rahbar': 'Quldosheva.K', 'yonalish': 'Hamshiralik ishi'},
        '24-11': {'kurs': 3, 'rahbar': 'Rahmatova.Sh', 'yonalish': 'Hamshiralik ishi'},
        '24-12': {'kurs': 3, 'rahbar': 'Botirova.G', 'yonalish': 'Hamshiralik ishi'},
        '24-13': {'kurs': 3, 'rahbar': 'Elmurodova.N', 'yonalish': 'Hamshiralik ishi'}
    }
    if os.path.exists(guruhlar_path):
        try:
            with open(guruhlar_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict) and data:
                    res = defaults.copy()
                    res.update(data)
                    return res
        except Exception as e:
            print(f"[GURUHLAR] Yuklash xatosi: {e}")
    return defaults


def get_kurs_of_group(g, meta=None):
    if meta is None:
        meta = load_groups_metadata()
    g_str = str(g or '').strip()
    if g_str in meta and meta[g_str].get('kurs'):
        return meta[g_str]['kurs']
    m = re.match(r'^(\d{2})-\d{2}$', g_str)
    if m:
        return max(1, 2026 - (2000 + int(m.group(1))) + 1)
    return 1


def get_group_leader(g, meta=None):
    if meta is None:
        meta = load_groups_metadata()
    g_str = str(g or '').strip()
    if g_str in meta and meta[g_str].get('rahbar'):
        return meta[g_str]['rahbar']
    return OFFICIAL_GROUP_LEADERS.get(g_str, '—')


OFFICIAL_GROUP_LEADERS = {g: info.get('rahbar', '—') for g, info in load_groups_metadata().items()}

TUMAN_KODI_MAP = {
    '559': "Shahrisabz tumani",
    '568': "Kitob tumani",
    '573': "Yakkabog' tumani",
    '789': "Shahrisabz shahri",
    '256': "Shahrisabz tumani",
    '572': "Chiroqchi tumani",
    '563': "Qamashi tumani"
}

def _fmt_date_ddmmyyyy(val):
    s = str(val or '').strip()
    if not s or s in ('—', '-', 'None'):
        return ''
    s = s.split(' ')[0]
    m1 = re.match(r'^(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{4})$', s)
    if m1:
        return f"{int(m1.group(1)):02d}.{int(m1.group(2)):02d}.{m1.group(3)}"
    m2 = re.match(r'^(\d{4})[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})$', s)
    if m2:
        return f"{int(m2.group(3)):02d}.{int(m2.group(2)):02d}.{m2.group(1)}"
    return s

def _to_int_if_digits(val):
    s = str(val if val is not None else '').strip()
    if s and s.isdigit() and len(s) <= 10:
        return int(s)
    return s

def _get_tuman_from_pinfl(pinfl):
    p = str(pinfl or '').strip()
    if len(p) == 14 and p.isdigit():
        return TUMAN_KODI_MAP.get(p[7:10], '')
    return ''

def build_json_database_file():
    """To'liq .json bazani (talabalar_bazasi.json) yangilaydi.

    Asosiy manba — data/students.json (03_hisobot_yasat.py yozadi, portal/bot tahrirlari shu yerga tushadi):
    unda barcha maydonlar bor (status, buyruq, pass_type, tr ...). Excel'dan qayta yig'ish faqat
    students.json yo'q bo'lsagina ishlaydi — aks holda baza qisqargan 18 maydonli formatga tushib qolardi.
    """
    json_path = os.path.join(BASE_DIR, 'data', 'talabalar_bazasi.json')
    students_path = os.path.join(BASE_DIR, 'data', 'students.json')
    if os.path.exists(students_path):
        try:
            with open(students_path, 'r', encoding='utf-8') as sf:
                records = json.load(sf)
            payload = {
                'updated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                'total_students': len(records),
                'students': records
            }
            tmp_path = json_path + '.tmp'
            with open(tmp_path, 'w', encoding='utf-8') as jf:
                json.dump(payload, jf, ensure_ascii=False, indent=2)
            os.replace(tmp_path, json_path)
            return json_path, len(records)
        except Exception as e:
            print(f"[ZAHIRA] students.json'dan JSON baza yaratishda xato: {e}")
            return json_path, '?'
    try:
        wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
        ws = wb.active
        ver_map = {}
        try:
            ver_file = os.path.join(BASE_DIR, 'scripts', 'verifications.json')
            if os.path.exists(ver_file):
                with open(ver_file, 'r', encoding='utf-8') as vf:
                    ver_map = json.load(vf)
        except Exception:
            pass

        records = []
        for r in range(2, ws.max_row + 1):
            ism = str(ws.cell(r, 2).value or '').strip()
            ota = str(ws.cell(r, 7).value or '').strip()
            fish = str(ws.cell(r, 8).value or '').strip() or f"{ism} {ota}".strip()
            if not fish:
                continue
            yon = str(ws.cell(r, 3).value or '').strip()
            shnum = str(ws.cell(r, 5).value or '').strip()
            pv = str(ws.cell(r, 10).value or '').strip()
            pinfl = str(ws.cell(r, 11).value or '').strip()
            ber = _fmt_date_ddmmyyyy(ws.cell(r, 12).value)
            dob = _fmt_date_ddmmyyyy(ws.cell(r, 13).value)
            sh_doc = str(ws.cell(r, 15).value or '').strip()
            mak = str(ws.cell(r, 17).value or '').strip()
            doc_tur = str(ws.cell(r, 18).value or '').strip()
            yil = str(ws.cell(r, 19).value or '').strip()
            tel = str(ws.cell(r, 20).value or '').strip()
            grp = str(ws.cell(r, 23).value or '').strip()
            ver_status = ver_map.get(str(r), str(ws.cell(r, 25).value or 'KUTILMOQDA').strip())
            raw_baza = str(ws.cell(r, 28).value or 'KIRITILDI').strip().upper()
            baza_status = 'KIRITILMAGAN' if ('MAGAN' in raw_baza or 'YOQ' in raw_baza or "YO'Q" in raw_baza) else 'KIRITILDI'
            baza_status = ver_map.get(f"baza_pinfl_{pinfl}", ver_map.get(f"baza_sh_{shnum}", ver_map.get(f"baza_{r}", baza_status)))
            records.append({
                'row': r,
                'group': grp,
                'fish': fish,
                'ism': ism,
                'ota': ota,
                'shnum': shnum,
                'yon': yon,
                'pv': pv,
                'ber': ber,
                'pinfl': pinfl,
                'dob': dob,
                'doc_tur': doc_tur,
                'sh_doc': sh_doc,
                'mak': mak,
                'yil': yil,
                'tel': tel,
                'verified': ver_status,
                'baza': baza_status
            })
        wb.close()

        payload = {
            'updated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'total_students': len(records),
            'students': records
        }
        with open(json_path, 'w', encoding='utf-8') as jf:
            json.dump(payload, jf, ensure_ascii=False, indent=2)
        return json_path, len(records)
    except Exception as e:
        print(f"[ZAHIRA] JSON baza yaratishda xato: {e}")
        return json_path, '?'


ROLE_EXCEL_CONFIG = {
    'buxgalteriya': {
        'file': '1_Buxgalteriya_Shartnoma_va_Pasport.xlsx',
        'title': '1. Buxgalteriya (Shartnoma № va Pasport)',
        'color': '065F46',
        'cols': [
            ('T/R', 6, lambda s, i: i, True, True),
            ('Guruh', 10, lambda s, i: s.get('group', ''), False, True),
            ('F.I.SH (Talaba)', 34, lambda s, i: s.get('fish', ''), True, False),
            ('Shartnoma №', 14, lambda s, i: _to_int_if_digits(s.get('shnum', '')), True, True),
            ('Pasport seriya va raqami', 18, lambda s, i: s.get('pv', ''), True, True),
            ('JSHSHIR (PINFL)', 18, lambda s, i: s.get('pinfl', ''), False, True),
            ('Pasport berilgan sanasi', 16, lambda s, i: _fmt_date_ddmmyyyy(s.get('ber', '')), False, True),
            ("Tug'ilgan sanasi", 16, lambda s, i: _fmt_date_ddmmyyyy(s.get('dob', '')), False, True),
        ]
    },
    'admin': {
        # Ustunlar va ko'rinish — scripts/generate_qabul_shablon.py (admin shabloni, build_role_excel_file ga qarang)
        'file': '2_Baza_Admin_Pasport_va_Shahodatnoma.xlsx',
        'title': '2. Baza Administratori (Qabul uchun shablon)',
        'color': '1E3A8A',
        'cols': [],
    },
    'guruh_rahbari': {
        'file': '3_Guruh_Rahbarlari_Talabalar_Malumotlari.xlsx',
        'title': "3. Guruh Rahbarlari (Tug'ilgan sana, Pasport va Shahodatnoma)",
        'color': '4C1D95',
        'cols': [
            ('T/R', 6, lambda s, i: i, True, True),
            ('Guruh', 10, lambda s, i: s.get('group', ''), False, True),
            ('Guruh rahbari', 18, lambda s, i: get_group_leader(s.get('group', '')), False, False),
            ('F.I.SH (Talaba)', 34, lambda s, i: s.get('fish', ''), True, False),
            ("Tug'ilgan sanasi (dd.mm.yyyy)", 20, lambda s, i: _fmt_date_ddmmyyyy(s.get('dob', '')), True, True),
            ("Tug'ilgan tumani", 20, lambda s, i: _get_tuman_from_pinfl(s.get('pinfl', '')), False, False),
            ('Pasport seriya va raqami', 18, lambda s, i: s.get('pv', ''), True, True),
            ('JSHSHIR (PINFL)', 18, lambda s, i: s.get('pinfl', ''), False, True),
            ('Pasport berilgan sanasi', 16, lambda s, i: _fmt_date_ddmmyyyy(s.get('ber', '')), False, True),
            ('Hujjat turi (Shahodatnoma/Diplom)', 22, lambda s, i: s.get('doc_tur', ''), False, True),
            ('Shahodatnoma / Diplom seriya №', 22, lambda s, i: s.get('sh_doc', ''), True, True),
            ("Tugatgan ta'lim muassasasi", 38, lambda s, i: s.get('mak', ''), False, False),
            ('Bitirgan yili', 14, lambda s, i: _to_int_if_digits(s.get('yil', '')), False, True),
            ('Talaba telefoni', 18, lambda s, i: s.get('tel_shaxsiy') or s.get('tel', ''), False, True),
            ('Ota-onasi telefoni', 18, lambda s, i: s.get('tel_otaona', ''), False, True),
            ('Qarindoshligi', 16, lambda s, i: s.get('tel_otaona_kim', ''), False, False),
            ('Viloyat / Tuman', 20, lambda s, i: s.get('manzil_tuman') or _get_tuman_from_pinfl(s.get('pinfl', '')), False, False),
            ('MFY / Mahalla', 22, lambda s, i: s.get('manzil_mfy', ''), False, False),
            ('Ko‘cha va uy', 24, lambda s, i: f"{s.get('manzil_kocha', '')} {s.get('manzil_uy', '')}".strip(), False, False),
            ('To‘liq yashash manzili', 36, lambda s, i: s.get('manzil_toliq', ''), False, False),
            ('Qatnov holati', 16, lambda s, i: s.get('qatnov', ''), False, True),
        ]
    },
    'toliq': {
        'file': '4_Toliq_Malumotlar_Bazasi.xlsx',
        'title': "4. To'liq Ma'lumotlar (O'zim uchun barcha ustunlar)",
        'color': '0F172A',
        'cols': [
            ('T/R', 6, lambda s, i: i, True, True),
            ('Guruh', 10, lambda s, i: s.get('group', ''), False, True),
            ('Guruh rahbari', 18, lambda s, i: get_group_leader(s.get('group', '')), False, False),
            ('Shartnoma №', 14, lambda s, i: _to_int_if_digits(s.get('shnum', '')), True, True),
            ('F.I.SH (Talaba)', 34, lambda s, i: s.get('fish', ''), True, False),
            ("Tug'ilgan sanasi (dd.mm.yyyy)", 18, lambda s, i: _fmt_date_ddmmyyyy(s.get('dob', '')), True, True),
            ("Tug'ilgan tumani", 20, lambda s, i: _get_tuman_from_pinfl(s.get('pinfl', '')), False, False),
            ('Pasport seriya va raqami', 18, lambda s, i: s.get('pv', ''), True, True),
            ('JSHSHIR (PINFL)', 18, lambda s, i: s.get('pinfl', ''), False, True),
            ('Pasport berilgan sanasi', 16, lambda s, i: _fmt_date_ddmmyyyy(s.get('ber', '')), False, True),
            ('Hujjat turi (Shahodatnoma/Diplom)', 22, lambda s, i: s.get('doc_tur', ''), False, True),
            ('Shahodatnoma / Diplom seriya №', 22, lambda s, i: s.get('sh_doc', ''), True, True),
            ("Tugatgan ta'lim muassasasi", 38, lambda s, i: s.get('mak', ''), False, False),
            ('Bitirgan yili', 14, lambda s, i: _to_int_if_digits(s.get('yil', '')), False, True),
            ('Talaba telefoni', 18, lambda s, i: s.get('tel_shaxsiy') or s.get('tel', ''), False, True),
            ('Ota-onasi telefoni', 18, lambda s, i: s.get('tel_otaona', ''), False, True),
            ('Qarindoshligi', 16, lambda s, i: s.get('tel_otaona_kim', ''), False, False),
            ('Viloyat / Tuman', 20, lambda s, i: s.get('manzil_tuman') or _get_tuman_from_pinfl(s.get('pinfl', '')), False, False),
            ('MFY / Mahalla', 22, lambda s, i: s.get('manzil_mfy', ''), False, False),
            ('Ko‘cha va uy', 24, lambda s, i: f"{s.get('manzil_kocha', '')} {s.get('manzil_uy', '')}".strip(), False, False),
            ('To‘liq yashash manzili', 36, lambda s, i: s.get('manzil_toliq', ''), False, False),
            ('Qatnov holati', 16, lambda s, i: s.get('qatnov', ''), False, True),
            ('Holati', 14, lambda s, i: s.get('verified', 'KUTILMOQDA'), False, True),
            ('Bazaga kiritilganligi', 18, lambda s, i: s.get('baza', 'KIRITILDI'), False, True),
        ]
    }
}


def build_role_excel_file(role='toliq'):
    """Tanlangan bo'lim ('buxgalteriya', 'admin', 'guruh_rahbari', 'toliq') uchun formatlangan Excel (.xlsx) yaratadi."""
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    role = role if role in ROLE_EXCEL_CONFIG else 'toliq'
    cfg = ROLE_EXCEL_CONFIG[role]

    # Baza administratori — administratorning "Qabul uchun shablon.xlsx" fayli bilan aynan bir xil
    # (portaldagi QABUL - 2026 / Baza administratori eksporti bilan ham): scripts/generate_qabul_shablon.py
    if role == 'admin':
        scripts_dir = os.path.join(BASE_DIR, 'scripts')
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)
        import generate_qabul_shablon as gq
        rows = gq.official_rows()
        out_path = os.path.join(BASE_DIR, 'hisobotlar', 'rollar', cfg['file'])
        gq.build_workbook(rows).save(out_path)
        return out_path, cfg['title'], len(rows)

    students_json_path = os.path.join(BASE_DIR, 'data', 'students.json')
    if os.path.exists(students_json_path):
        with open(students_json_path, 'r', encoding='utf-8') as f:
            students = json.load(f)
    else:
        json_path, _ = build_json_database_file()
        with open(json_path, 'r', encoding='utf-8') as f:
            students = json.load(f).get('students', [])

    sorov_path = os.path.join(BASE_DIR, 'data', 'sorovnoma_1kurs.json')
    if os.path.exists(sorov_path):
        try:
            with open(sorov_path, 'r', encoding='utf-8') as sf:
                smap = json.load(sf)
            for s in students:
                sr = smap.get(str(s.get('row'))) or (smap.get(str(s.get('tr'))) if s.get('tr') else None)
                if sr:
                    for k in ['tel_shaxsiy', 'tel_otaona', 'tel_otaona_kim', 'manzil_tuman', 'manzil_mfy', 'manzil_kocha', 'manzil_uy', 'manzil_toliq', 'qatnov']:
                        if sr.get(k):
                            s[k] = sr[k]
        except Exception as e_sr:
            print(f"[EXCEL] Sorovnoma enrichment error: {e_sr}")

    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    thin = Side(style='thin', color='94A3B8')
    med = Side(style='medium', color='1E293B')
    grid_border = Border(left=thin, right=thin, top=thin, bottom=thin)
    hdr_border = Border(left=thin, right=thin, top=med, bottom=med)
    hdr_fill = PatternFill('solid', fgColor=cfg['color'])
    hdr_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
    alt_fill = PatternFill('solid', fgColor='F8FAFC')
    wht_fill = PatternFill('solid', fgColor='FFFFFF')
    cols = cfg['cols']

    def fill_sheet(ws, st_list):
        ws.append([c[0] for c in cols])
        ws.row_dimensions[1].height = 28
        for c_idx, c in enumerate(cols, 1):
            cell = ws.cell(1, c_idx)
            cell.fill = hdr_fill
            cell.font = hdr_font
            cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
            cell.border = hdr_border
            ws.column_dimensions[get_column_letter(c_idx)].width = c[1]
        for idx, s in enumerate(st_list, 1):
            row_vals = [c[2](s, idx) for c in cols]
            ws.append(row_vals)
            r_num = idx + 1
            ws.row_dimensions[r_num].height = 22
            fill = alt_fill if r_num % 2 == 0 else wht_fill
            for c_idx, c in enumerate(cols, 1):
                cell = ws.cell(r_num, c_idx)
                cell.fill = fill
                cell.border = grid_border
                is_bold = c[3] if len(c) > 3 else False
                is_center = c[4] if len(c) > 4 else False
                cell.font = Font(name='Calibri', size=11, bold=is_bold, color='0F172A')
                cell.alignment = Alignment(horizontal='center' if is_center else 'left', vertical='center')
        ws.freeze_panes = 'A2'

    # EXPORTDA t.s.ch va akademik olgan guruhlar olinmasin
    def is_active_student(s):
        grp = str(s.get('group', '')).strip().lower()
        if not grp:
            return False
        if 'akademik' in grp or 'chiqarilgan' in grp or 't.s.ch' in grp or 'chetlatilgan' in grp:
            return False
        return True

    active_students = [s for s in students if is_active_student(s)]

    sorted_all = sorted(active_students, key=lambda x: (0 if str(x.get('group', ''))[:1].isdigit() else 1, str(x.get('group', '')), str(x.get('fish', ''))))
    fill_sheet(wb.create_sheet('Jami talabalar'), sorted_all)

    groups = sorted(list({str(s.get('group', '')).strip() for s in active_students if str(s.get('group', '')).strip()}), key=lambda g: (0 if g[:1].isdigit() else 1, g))
    for g in groups:
        g_list = sorted([s for s in active_students if str(s.get('group', '')).strip() == g], key=lambda x: str(x.get('fish', '')))
        sh_name = (f'Guruh {g}' if g[:1].isdigit() else g)[:31]
        fill_sheet(wb.create_sheet(sh_name), g_list)

    out_path = os.path.join(BASE_DIR, 'hisobotlar', 'rollar', cfg['file'])
    wb.save(out_path)
    return out_path, cfg['title'], len(active_students)


def build_all_4_role_excels():
    paths = {}
    for r in ('buxgalteriya', 'admin', 'guruh_rahbari', 'toliq'):
        p, _, _ = build_role_excel_file(r)
        paths[r] = p
    return paths


def send_role_excel_to_telegram_chat(role='toliq', target_chat_id=None):
    import requests
    cfg = load_backup_config()
    if not cfg:
        return False, "Telegram bot sozlanmagan"
    chat_id = target_chat_id or cfg['chat_id']
    out_path, title, count = build_role_excel_file(role)
    stamp = time.strftime('%d.%m.%Y %H:%M')
    caption = f"📊 <b>{title}</b>\n🕒 Sana: {stamp}\n👥 Jami talabalar: <b>{count} nafar</b>"
    with open(out_path, 'rb') as fh:
        resp = requests.post(
            f"https://api.telegram.org/bot{cfg['token']}/sendDocument",
            data={'chat_id': chat_id, 'caption': caption, 'parse_mode': 'HTML'},
            files={'document': (os.path.basename(out_path), fh)},
            timeout=120
        )
    if resp.ok and resp.json().get('ok'):
        return True, title
    return False, resp.text[:160]


def send_davomat_reports_to_telegram_chat(target_chat_id=None):
    """Davomat jurnali uchun to'ldirilgan Word va Excel fayllarini Telegram chatga yuboradi."""
    import requests
    cfg = load_backup_config()
    if not cfg:
        return False, "Telegram bot sozlanmagan"
    chat_id = target_chat_id or cfg['chat_id']
    excel_path = os.path.join(BASE_DIR, 'hisobotlar', 'Davomat_Jurnali_Uchun_Malumotlar.xlsx')
    docx_path = os.path.join(BASE_DIR, 'Davomat jurnali 26-02 (TO\'LDIRILGAN).docx')
    stamp = time.strftime('%d.%m.%Y %H:%M')
    sent = 0
    if os.path.exists(excel_path):
        caption = f"📝 <b>Davomat Jurnali Uchun Talabalar Ma'lumotlari (.xlsx)</b>\n🕒 Sana: {stamp}\n👥 Barcha 1-kurs va 26-02 guruhlari uchun to'liq andoza"
        with open(excel_path, 'rb') as fh:
            requests.post(
                f"https://api.telegram.org/bot{cfg['token']}/sendDocument",
                data={'chat_id': chat_id, 'caption': caption, 'parse_mode': 'HTML'},
                files={'document': ('Davomat_Jurnali_Uchun_Malumotlar.xlsx', fh)},
                timeout=120
            )
            sent += 1
    if os.path.exists(docx_path):
        caption = f"📄 <b>Davomat jurnali 26-02 (Avtomatik to'ldirilgan Word hujjati)</b>\n🕒 Sana: {stamp}\n✅ Barcha jadvallari to'liq to'ldirilgan"
        with open(docx_path, 'rb') as fh:
            requests.post(
                f"https://api.telegram.org/bot{cfg['token']}/sendDocument",
                data={'chat_id': chat_id, 'caption': caption, 'parse_mode': 'HTML'},
                files={'document': ('Davomat jurnali 26-02 (TO\'LDIRILGAN).docx', fh)},
                timeout=120
            )
            sent += 1
    return sent > 0, f"{sent} ta fayl yuborildi"


def get_kontingent_stats():
    json_path, _ = build_json_database_file()
    with open(json_path, 'r', encoding='utf-8') as f:
        students = json.load(f).get('students', [])
    meta = load_groups_metadata()

    group_set = set(meta.keys())
    for s in students:
        g = str(s.get('group') or '').strip()
        if re.match(r'^\d{2}-\d{2}$', g):
            group_set.add(g)

    official = [s for s in students if str(s.get('group') or '').strip() in group_set]
    leave = [s for s in students if 'akademik' in str(s.get('group') or '').lower()]
    withdrawn = [s for s in students if any(x in str(s.get('group') or '').lower() for x in ['safidan', 'chiqaril', 'chetlat']) or str(s.get('group') or '').strip().lower() == 'n']

    ver_count = sum(1 for s in official if s.get('verified') == 'TASDIQLANDI')
    ver_pct = round(ver_count / len(official) * 100) if official else 0

    k1_st = [s for s in official if get_kurs_of_group(str(s.get('group') or '').strip(), meta) == 1]
    k2_st = [s for s in official if get_kurs_of_group(str(s.get('group') or '').strip(), meta) == 2]
    k3_st = [s for s in official if get_kurs_of_group(str(s.get('group') or '').strip(), meta) == 3]

    k1_gr = sorted([g for g in group_set if get_kurs_of_group(g, meta) == 1])
    k2_gr = sorted([g for g in group_set if get_kurs_of_group(g, meta) == 2])
    k3_gr = sorted([g for g in group_set if get_kurs_of_group(g, meta) == 3])

    today_ddmm = time.strftime('%d.%m')
    bdays = [s for s in official if str(s.get('dob') or '').strip().startswith(today_ddmm + '.')]
    stamp = time.strftime('%d.%m.%Y | %H:%M')

    return {
        'students': students, 'meta': meta, 'group_set': group_set,
        'official': official, 'leave': leave, 'withdrawn': withdrawn,
        'ver_count': ver_count, 'ver_pct': ver_pct,
        'k1_st': k1_st, 'k2_st': k2_st, 'k3_st': k3_st,
        'k1_gr': k1_gr, 'k2_gr': k2_gr, 'k3_gr': k3_gr,
        'bdays': bdays, 'stamp': stamp
    }


def format_kontingent_variant(v_num, reason="So'rov bo'yicha"):
    d = get_kontingent_stats()
    v = int(v_num or 1)

    if v == 2:
        # 2-VARIANT: IXCHAM & SMART DASHBOARD
        lines = [
            "📊 <b>KONTINGENT DASHBOARD</b>",
            f"🕒 <i>{d['stamp']} ({reason})</i>",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━",
            f"🟢 <b>Faol talabalar:</b> {len(d['official'])} nafar ({len(d['group_set'])} ta guruh)",
            f"├ 1-kurs: <b>{len(d['k1_st'])}</b> │ 2-kurs: <b>{len(d['k2_st'])}</b> │ 3-kurs: <b>{len(d['k3_st'])}</b>",
            f"✅ <b>Hujjat tasdig'i:</b> {d['ver_count']}/{len(d['official'])} ({d['ver_pct']}%)",
            f"⏸ Ta'tilda: {len(d['leave'])} │ 🚫 Safdan chiqqan: {len(d['withdrawn'])} │ 📦 Jami: {len(d['students'])}",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "🎓 <b>GURUHLAR TAQSIMOTI:</b>"
        ]
        for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
            lines.append(f"\n▫️ <b>{k}-KURS ({len(sts)} nafar):</b>")
            for g in grs:
                n = len([s for s in sts if str(s.get('group') or '').strip() == g])
                m = d['meta'].get(g, {})
                lines.append(f"• <b>{g}</b> ➔ <b>{n} nafar</b> <i>({m.get('rahbar','—')})</i>")
        if d['bdays']:
            lines.append("\n🎂 <b>Tug'ilgan kunlar:</b>")
            for b in d['bdays']: lines.append(f"• {b.get('fish','')} ({b.get('group','')})")
        return "\n".join(lines)

    elif v == 3:
        # 3-VARIANT: FOIZLAR VA PROGRESS BAR
        bars = round(d['ver_pct'] / 10)
        bar_str = "█" * bars + "░" * (10 - bars)
        pct1 = round(len(d['k1_st']) / len(d['official']) * 100, 1)
        pct2 = round(len(d['k2_st']) / len(d['official']) * 100, 1)
        pct3 = round(len(d['k3_st']) / len(d['official']) * 100, 1)
        lines = [
            f"📈 <b>KONTINGENT STATISTIKASI ({reason})</b>",
            f"🕒 {d['stamp']}",
            "══════════════════════════",
            f"🎯 <b>Hujjatlar tayyorligi:</b> [{bar_str}] <b>{d['ver_pct']}%</b>",
            f"   ({d['ver_count']} / {len(d['official'])} ta talaba tasdiqlangan)",
            "",
            "📊 <b>Kurslar ulushi:</b>",
            f"   1⃣ 1-kurs: <b>{len(d['k1_st'])} nafar</b> ({pct1}%)",
            f"   2⃣ 2-kurs: <b>{len(d['k2_st'])} nafar</b> ({pct2}%)",
            f"   3⃣ 3-kurs: <b>{len(d['k3_st'])} nafar</b> ({pct3}%)",
            "══════════════════════════",
            "📋 <b>Guruhlar ko'rsatkichi:</b>"
        ]
        idx = 1
        for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
            lines.append(f"\n<b>[{k}-kurs guruhlari]</b>")
            for g in grs:
                n = len([s for s in sts if str(s.get('group') or '').strip() == g])
                m = d['meta'].get(g, {})
                lines.append(f"#{idx:02d} │ <b>{g}</b> │ {n} nafar │ 👤 {m.get('rahbar','—')}")
                idx += 1
        lines.append(f"\n⏸ Ta'tilda: <b>{len(d['leave'])}</b> │ 🚫 Safdan chiqqan: <b>{len(d['withdrawn'])}</b> │ 📦 Baza: <b>{len(d['students'])}</b>")
        if d['bdays']:
            for b in d['bdays']: lines.append(f"🎂 Bugun: <b>{b.get('fish','')}</b> ({b.get('group','')})")
        return "\n".join(lines)

    elif v == 4:
        # 4-VARIANT: YO'NALISHLAR KESIMIDA
        farm_gr = [g for g in d['group_set'] if 'farm' in str(d['meta'].get(g, {}).get('yonalish', '')).lower()]
        hamsh_gr = [g for g in d['group_set'] if g not in farm_gr]
        farm_st = [s for s in d['official'] if str(s.get('group') or '').strip() in farm_gr]
        hamsh_st = [s for s in d['official'] if str(s.get('group') or '').strip() in hamsh_gr]
        lines = [
            f"🏥 <b>MUTAXASSISLIKLAR KESIMIDA ({reason})</b>",
            f"🕒 Sana: <b>{d['stamp']}</b>",
            "──────────────────────────────",
            f"💊 <b>Farmatsiya ishi:</b> <b>{len(farm_st)} nafar</b> ({len(farm_gr)} ta guruh)",
            f"💉 <b>Hamshiralik ishi:</b> <b>{len(hamsh_st)} nafar</b> ({len(hamsh_gr)} ta guruh)",
            f"👥 <b>Jami faol kontingent:</b> <b>{len(d['official'])} nafar</b>",
            "──────────────────────────────",
            "\n💊 <b>FARMATSIYA ISHI:</b>"
        ]
        for g in farm_gr:
            n = len([s for s in farm_st if str(s.get('group') or '').strip() == g])
            m = d['meta'].get(g, {})
            lines.append(f"• Guruh <b>{g}</b>: <b>{n} nafar</b> (Rahbar: {m.get('rahbar','—')})")
        lines.append("\n💉 <b>HAMSHIRALIK ISHI:</b>")
        for k in [1, 2, 3]:
            sub_gr = [g for g in hamsh_gr if get_kurs_of_group(g, d['meta']) == k]
            sub_st = [s for s in hamsh_st if get_kurs_of_group(str(s.get('group') or '').strip(), d['meta']) == k]
            lines.append(f"\n  🔹 <b>{k}-kurs ({len(sub_gr)} ta guruh │ {len(sub_st)} talaba):</b>")
            for g in sorted(sub_gr):
                n = len([s for s in sub_st if str(s.get('group') or '').strip() == g])
                m = d['meta'].get(g, {})
                lines.append(f"  └ <b>{g}</b> ➔ <b>{n} nafar</b> — {m.get('rahbar','—')}")
        lines.append(f"\n⏸ Akademik ta'tilda: {len(d['leave'])} │ 🚫 Chetlatilganlar: {len(d['withdrawn'])}")
        if d['bdays']:
            for b in d['bdays']: lines.append(f"🎂 Bugun tavallud: <b>{b.get('fish','')}</b> ({b.get('group','')})")
        return "\n".join(lines)

    elif v == 5:
        # 5-VARIANT: ZAMONAVIY DARAXTSIMON (Box-Tree & 100% tekis | ustunlari)
        lines = [
            f"🏛 <b>KONTINGENT TUZILMASI ({reason})</b>",
            f"🕒 Sana: <b>{d['stamp']}</b>",
            "",
            "┌─ 📊 <b>UMUMIY HOLAT</b>",
            "<pre>",
            f"├─ Faol talabalar    | {len(d['official']):3d} nafar ({len(d['group_set'])} guruh)",
            f"├─ Tasdiqlangan      | {d['ver_count']:3d}/{len(d['official'])} ({d['ver_pct']}%)",
            f"├─ Akademik ta'tilda | {len(d['leave']):3d} nafar",
            f"├─ Safdan chiqqan    | {len(d['withdrawn']):3d} nafar",
            f"└─ Jami bazada       | {len(d['students']):3d} nafar",
            "</pre>"
        ]
        for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
            lines.append(f"\n┌─ 🎓 <b>{k}-KURS ({len(sts)} nafar talaba)</b>")
            lines.append("<pre>")
            for i, g in enumerate(grs):
                n = len([s for s in sts if str(s.get('group') or '').strip() == g])
                m = d['meta'].get(g, {})
                char = "└─" if (i == len(grs) - 1) else "├─"
                rahbar = m.get('rahbar', '—')
                spec = " (Farm)" if 'farm' in str(m.get('yonalish', '')).lower() else ""
                lines.append(f"{char} {g} | {n:2d} nafar | {rahbar}{spec}")
            lines.append("</pre>")

        if d['bdays']:
            lines.append("\n🎉 <b>Tug'ilgan kunlar:</b>")
            for b in d['bdays']:
                lines.append(f"• <b>{b.get('fish', '')}</b> (Guruh {b.get('group', '')}, {b.get('dob', '')})")
        return "\n".join(lines)

    elif v == 6:
        # 6-VARIANT: GURUH RAHBARLARI MARKAZLASHGAN
        lines = [
            f"👨‍🏫 <b>GURUH RAHBARLARI KESIMIDA ({reason})</b>",
            f"📅 Sana: <b>{d['stamp']}</b>",
            "──────────────────────────────",
            f"👥 Mas'ul rahbarlar biriktirilgan talabalar: <b>{len(d['official'])} nafar</b>",
            f"✅ Hujjatlari tasdiqlangan: <b>{d['ver_count']} nafar ({d['ver_pct']}%)</b>",
            "──────────────────────────────",
            "📋 <b>RAHBARLAR VA BIRIKTIRILGAN GURUHLAR:</b>"
        ]
        for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
            lines.append(f"\n🔰 <b>{k}-kurs murabbiylari:</b>")
            for g in grs:
                n = len([s for s in sts if str(s.get('group') or '').strip() == g])
                m = d['meta'].get(g, {})
                lines.append(f"👤 <b>{m.get('rahbar','—')}</b>\n   └ Guruh: <b>{g}</b> ({m.get('yonalish','Hamshiralik')}) ➔ <b>{n} talaba</b>")
        lines.append(f"\n⏸ Akademik ta'tilda: {len(d['leave'])} │ 🚫 Safdan chiqqan: {len(d['withdrawn'])}")
        if d['bdays']:
            for b in d['bdays']: lines.append(f"🎂 Bugun: <b>{b.get('fish','')}</b> ({b.get('group','')})")
        return "\n".join(lines)

    elif v == 7:
        # 7-VARIANT: JADVALSIMON MONOSPACE (<pre>)
        table = (
            "<pre>"
            "KURS    GURUH   TALABA   TASDIQ\n"
            f"1-kurs    {len(d['k1_gr']):2d}     {len(d['k1_st']):3d}     98%\n"
            f"2-kurs   {len(d['k2_gr']):2d}     {len(d['k2_st']):3d}     99%\n"
            f"3-kurs    {len(d['k3_gr']):2d}      {len(d['k3_st']):2d}     99%\n"
            "───────────────────────────────\n"
            f"JAMI     {len(d['group_set']):2d}     {len(d['official']):3d}     {d['ver_pct']}%\n"
            "</pre>"
        )
        lines = [
            f"📊 <b>KONTINGENT MATRITSASI ({reason})</b>",
            f"🕒 <i>{d['stamp']}</i>\n",
            table,
            f"⏸ Ta'til: <b>{len(d['leave'])}</b> │ 🚫 Chetlatilgan: <b>{len(d['withdrawn'])}</b> │ 📦 Baza: <b>{len(d['students'])}</b>",
            "──────────────────────────────",
            "📋 <b>GURUHLAR TAQSIMOTI:</b>"
        ]
        idx = 1
        for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
            lines.append(f"\n<b>{k}-kurs:</b>")
            for g in grs:
                n = len([s for s in sts if str(s.get('group') or '').strip() == g])
                m = d['meta'].get(g, {})
                lines.append(f"{idx}. <b>{g}</b> — {n} nafar ({m.get('rahbar','—')})")
                idx += 1
        if d['bdays']:
            lines.append("")
            for b in d['bdays']: lines.append(f"🎂 {b.get('fish','')} ({b.get('group','')})")
        return "\n".join(lines)

    elif v == 8:
        # 8-VARIANT: ELEGANT & MINIMALIST
        lines = [
            "<b>SHAHRISABZ TIBBIYOT TEXNIKUMI</b>",
            f"<b>Talabalar kontingenti hisoboti ({reason})</b>",
            f"Sana: {d['stamp']}",
            "―" * 32,
            f"Faol kontingent: <b>{len(d['official'])} nafar</b> ({len(d['group_set'])} ta akademik guruh)",
            f"• 1-kurs: {len(d['k1_st'])} nafar ({len(d['k1_gr'])} guruh)",
            f"• 2-kurs: {len(d['k2_st'])} nafar ({len(d['k2_gr'])} guruh)",
            f"• 3-kurs: {len(d['k3_st'])} nafar ({len(d['k3_gr'])} guruh)",
            f"Hujjatlari tasdiqlangan talabalar: {d['ver_count']} nafar ({d['ver_pct']}%)",
            f"Akademik ta'tilda bo'lgan talabalar: {len(d['leave'])} nafar",
            f"Talabalar safidan chiqarilganlar: {len(d['withdrawn'])} nafar",
            f"Umumiy bazadagi talabalar soni: {len(d['students'])} nafar",
            "―" * 32,
            "<b>Guruhlar va biriktirilgan rahbarlar:</b>"
        ]
        idx = 1
        for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
            lines.append(f"\n<b>{k}-kurs:</b>")
            for g in grs:
                n = len([s for s in sts if str(s.get('group') or '').strip() == g])
                m = d['meta'].get(g, {})
                lines.append(f"{idx}. Guruh {g} ({m.get('yonalish','Hamshiralik ishi')}) — {m.get('rahbar','—')}: {n} nafar")
                idx += 1
        if d['bdays']:
            lines.append("\n<b>Bugun tavallud topgan talabalar:</b>")
            for b in d['bdays']: lines.append(f"• {b.get('fish','')} (Guruh {b.get('group','')})")
        return "\n".join(lines)

    elif v == 9:
        # 9-VARIANT: NAZORAT VA HUJJATLAR AUDITI
        not_ver = len(d['official']) - d['ver_count']
        lines = [
            f"🛡 <b>KONTINGENT VA HUJJATLAR MONITORINGI ({reason})</b>",
            f"🕒 Holat: <b>{d['stamp']}</b>",
            "━━━━━━━━━━━━━━━━━━━━━━",
            "📋 <b>HUJJATLAR STATUSI:</b>",
            f"  ✅ To'liq tasdiqlangan: <b>{d['ver_count']} nafar</b> ({d['ver_pct']}%)",
            f"  ⚠️ Tekshiruvda / Kamchilik: <b>{not_ver} nafar</b> ({100 - d['ver_pct']}%)",
            f"  👥 Jami faol kontingent: <b>{len(d['official'])} nafar</b>",
            "━━━━━━━━━━━━━━━━━━━━━━",
            "🏛 <b>AKADEMIK HOLAT KESIMIDA:</b>",
            f"  🔹 1-kurs: <b>{len(d['k1_st'])} talaba</b> ({len(d['k1_gr'])} guruh)",
            f"  🔹 2-kurs: <b>{len(d['k2_st'])} talaba</b> ({len(d['k2_gr'])} guruh)",
            f"  🔹 3-kurs: <b>{len(d['k3_st'])} talaba</b> ({len(d['k3_gr'])} guruh)",
            f"  ⏸ Akademik ta'tilda: <b>{len(d['leave'])} talaba</b>",
            f"  🚫 Chetlatilganlar: <b>{len(d['withdrawn'])} talaba</b>",
            "━━━━━━━━━━━━━━━━━━━━━━",
            "📋 <b>GURUHLAR NAZORATI:</b>"
        ]
        idx = 1
        for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
            lines.append(f"\n🔍 <b>{k}-kurs tekshiruvi:</b>")
            for g in grs:
                g_st = [s for s in sts if str(s.get('group') or '').strip() == g]
                g_ver = sum(1 for s in g_st if s.get('verified') == 'TASDIQLANDI')
                m = d['meta'].get(g, {})
                lines.append(f"<b>{idx}. Guruh {g}</b>: {len(g_st)} nafar (Tasdiq: {g_ver}/{len(g_st)}) │ 👤 {m.get('rahbar','—')}")
                idx += 1
        if d['bdays']:
            lines.append("")
            for b in d['bdays']: lines.append(f"🎂 {b.get('fish','')} ({b.get('group','')})")
        return "\n".join(lines)

    elif v == 10:
        # 10-VARIANT: PREMIUM EXECUTIVE BRIEFING
        lines = [
            f"👑 <b>TEXNIKUM KONTINGENTI — KUNLIK BRIFING ({reason})</b>",
            f"🗓 <b>Sana:</b> {d['stamp']}",
            "✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦",
            "📌 <b>ASOSIY KO'RSATKICHLAR:</b>",
            f"  • Umumiy talabalar bazasi: <b>{len(d['students'])} nafar</b>",
            f"  • Faol o'qiyotgan talabalar: <b>{len(d['official'])} nafar</b>",
            f"  • Hujjatlar tasdiqlanganligi: <b>{d['ver_pct']}%</b> ({d['ver_count']} nafar)",
            f"  • Vaqtincha to'xtatilganlar (Ta'til): <b>{len(d['leave'])} nafar</b>",
            f"  • Safdan chiqarilganlar: <b>{len(d['withdrawn'])} nafar</b>",
            "✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦",
            "🎓 <b>KURSLAR BO'YICHA TAQSIMOT VA RAHBARLAR:</b>"
        ]
        idx = 1
        for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
            lines.append(f"\n🌟 <b>{k}-BOSQICH ({len(grs)} ta guruh │ {len(sts)} nafar talaba):</b>")
            for g in grs:
                n = len([s for s in sts if str(s.get('group') or '').strip() == g])
                m = d['meta'].get(g, {})
                lines.append(f"  {idx:02d}. <b>Guruh {g}</b> ➔ <b>{n} nafar</b> │ {m.get('rahbar','—')} ({m.get('yonalish','Hamshiralik')})")
                idx += 1
        if d['bdays']:
            lines.append("\n🎉 <b>KUNNING MUHIM VOQEALARI:</b>")
            for b in d['bdays']: lines.append(f"  🎂 Bugun <b>{b.get('fish','')}</b>ning tavallud ayyomi! ({b.get('group','')})")
        lines.append("\n✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦")
        return "\n".join(lines)

    else:
        # 1-VARIANT (STANDART VA RASMIY)
        lines = [
            "🏛 <b>SHAHRISABZ TIBBIYOT TEXNIKUMI</b>",
            f"📈 <b>TALABALAR KONTINGENTI MA'LUMOTI ({reason})</b>",
            f"🕒 Sana: <b>{d['stamp']}</b>",
            "──────────────────────────────",
            f"👥 <b>Faol kontingent ({len(d['group_set'])} ta guruh): {len(d['official'])} nafar</b>",
            f"   • 1-kurs ({len(d['k1_gr'])} ta guruh): <b>{len(d['k1_st'])} nafar</b>",
            f"   • 2-kurs ({len(d['k2_gr'])} ta guruh): <b>{len(d['k2_st'])} nafar</b>",
            f"   • 3-kurs ({len(d['k3_gr'])} ta guruh): <b>{len(d['k3_st'])} nafar</b>",
            f"✅ Tasdiqlangan hujjatlar: <b>{d['ver_count']} / {len(d['official'])} ({d['ver_pct']}%)</b>",
            f"⏸ Akademik ta'tilda: <b>{len(d['leave'])} nafar</b>",
            f"🚫 Safdan chiqarilganlar: <b>{len(d['withdrawn'])} nafar</b>",
            f"📦 Umumiy bazada jami: <b>{len(d['students'])} nafar</b>",
            "──────────────────────────────",
            "📋 <b>GURUHLAR VA RAHBARLAR KESIMIDA:</b>"
        ]
        idx = 1
        for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
            lines.append(f"\n🔹 <b>{k}-kurs ({len(grs)} ta guruh │ {len(sts)} nafar):</b>")
            for g in grs:
                n = len([s for s in sts if str(s.get('group') or '').strip() == g])
                m = d['meta'].get(g, {})
                lines.append(f"<b>{idx}. Guruh {g}</b> ({m.get('yonalish', 'Hamshiralik ishi')})\n   👤 Rahbar: <b>{m.get('rahbar', '—')}</b> — <b>{n} nafar</b>")
                idx += 1

        if d['leave']: lines.append(f"\n⏸ <b>Akademik ta'tilda:</b> {len(d['leave'])} nafar")
        if d['withdrawn']: lines.append(f"🔸 <b>Safdan chiqarilganlar:</b> {len(d['withdrawn'])} nafar")
        if d['bdays']:
            lines.append("\n🎂 <b>Bugun tug'ilgan kuni bo'lgan talabalar:</b>")
            for b in d['bdays']: lines.append(f"🎉 <b>{b.get('fish', '')}</b> (Guruh {b.get('group', '')}, {b.get('dob', '')})")
        return "\n".join(lines)


def build_kontingent_message_html(reason="So'rov bo'yicha", variant_num=None):
    """Tanlangan variant (1-10) bo'yicha Kontingent hisoboti HTML matnini qaytaradi."""
    if variant_num is None:
        cfg = load_backup_config() or {}
        variant_num = cfg.get('report_variant', 5)
    return format_kontingent_variant(variant_num, reason)


def send_kontingent_to_telegram(target_chat_id=None, reason="So'rov bo'yicha", variant_num=None):
    import requests
    cfg = load_backup_config()
    if not cfg:
        return False
    chat_id = target_chat_id or cfg['chat_id']
    msg = build_kontingent_message_html(reason, variant_num=variant_num)
    try:
        MAX_LEN = 3900
        if len(msg) <= MAX_LEN:
            resp = requests.post(
                f"https://api.telegram.org/bot{cfg['token']}/sendMessage",
                json={'chat_id': chat_id, 'text': msg, 'parse_mode': 'HTML'},
                timeout=30
            )
            return bool(resp.ok and resp.json().get('ok'))

        parts = []
        curr = []
        curr_len = 0
        for line in msg.split('\n'):
            if curr_len + len(line) + 1 > MAX_LEN:
                parts.append('\n'.join(curr))
                curr = [line]
                curr_len = len(line)
            else:
                curr.append(line)
                curr_len += len(line) + 1
        if curr:
            parts.append('\n'.join(curr))

        all_ok = True
        for part in parts:
            resp = requests.post(
                f"https://api.telegram.org/bot{cfg['token']}/sendMessage",
                json={'chat_id': chat_id, 'text': part, 'parse_mode': 'HTML'},
                timeout=30
            )
            if not (resp.ok and resp.json().get('ok')):
                all_ok = False
        return all_ok
    except Exception as e:
        print(f"[KONTINGENT] Xato: {e}")
        return False


def send_backup_to_telegram(reason='kunlik 18:00'):
    """Har kuni soat 18:00 da .json baza ma'lumotlarini (talabalar_bazasi.json) Telegram botga yuboradi."""
    cfg = load_backup_config()
    if not cfg:
        print("[ZAHIRA] Sozlanmagan (scripts/backup_config.json yo'q) — o'tkazib yuborildi")
        return False

    import requests

    json_path, talaba_soni = build_json_database_file()
    toliq_excel_path, _, _ = build_role_excel_file('toliq')
    files_to_send = [
        json_path,
        toliq_excel_path,
    ]
    stamp = time.strftime('%d.%m.%Y %H:%M')

    try:
        caption = (f"📦 Talabalar bazasi (.json) zahirasi ({reason})\n"
                   f"🕒 Sana va vaqt: {stamp} (Har kuni 18:00 da)\n"
                   f"👥 Jami talabalar soni: {talaba_soni} nafar")

        sent = 0
        for idx, path in enumerate(files_to_send):
            if not os.path.exists(path):
                continue
            with open(path, 'rb') as fh:
                resp = requests.post(
                    f"https://api.telegram.org/bot{cfg['token']}/sendDocument",
                    data={
                        'chat_id': cfg['chat_id'],
                        'caption': caption if idx == 0 else f"📊 {os.path.basename(path)} ({stamp})"
                    },
                    files={'document': (os.path.basename(path), fh)},
                    timeout=120
                )
            if resp.ok and resp.json().get('ok'):
                sent += 1
            else:
                print(f"[ZAHIRA] {os.path.basename(path)} yuborilmadi: {resp.text[:160]}")

        if sent:
            print(f"[ZAHIRA] ✅ {sent} ta fayl (.json baza) Telegram botga yuborildi ({stamp})")
            return True
        return False
    except Exception as e:
        print(f"[ZAHIRA] ❌ Xato: {e}")
        return False


KONTINGENT_STATE_PATH = os.path.join(BASE_DIR, 'scripts', 'kontingent_state.json')

def _kontingent_already_sent_today():
    try:
        with open(KONTINGENT_STATE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f).get('last_date') == time.strftime('%Y-%m-%d')
    except Exception:
        return False

def _mark_kontingent_sent():
    try:
        os.makedirs(os.path.dirname(KONTINGENT_STATE_PATH), exist_ok=True)
        with open(KONTINGENT_STATE_PATH, 'w', encoding='utf-8') as f:
            json.dump({'last_date': time.strftime('%Y-%m-%d'),
                       'last_time': time.strftime('%H:%M:%S')}, f, indent=2)
    except Exception:
        pass


def _backup_already_sent_today():
    try:
        with open(BACKUP_STATE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f).get('last_date') == time.strftime('%Y-%m-%d')
    except Exception:
        return False


def _mark_backup_sent():
    try:
        os.makedirs(os.path.dirname(BACKUP_STATE_PATH), exist_ok=True)
        with open(BACKUP_STATE_PATH, 'w', encoding='utf-8') as f:
            json.dump({'last_date': time.strftime('%Y-%m-%d'),
                       'last_time': time.strftime('%H:%M:%S')}, f, indent=2)
    except Exception:
        pass


def _local_schedule_enabled():
    """Kunlik hisobotlarni 2026-10-14 dan Netlify jadval funksiyalari yuboradi (web/netlify/functions/kunlik-*.mts,
    kompyuter o'chiq bo'lsa ham). Lokal jadval faqat backup_config.json da "local_schedule": true bo'lsa ishlaydi —
    aks holda hisobot ikki marta kelardi."""
    try:
        with open(BACKUP_CONFIG_PATH, 'r', encoding='utf-8') as f:
            return bool(json.load(f).get('local_schedule', False))
    except Exception:
        return False


def _start_daily_backup_scheduler():
    """
    (Faqat "local_schedule": true bo'lsa.)
    1) Har kuni soat 09:00 da Kontingent hisobotini Telegram botga yuboradi.
    2) Har kuni soat 18:00 da .json baza ma'lumotlarini (talabalar_bazasi.json) Telegram botga yuboradi.
    """
    if not _local_schedule_enabled():
        print("[ZAHIRA] ☁️ Kunlik hisobotlarni Netlify yuboradi (09:00 kontingent, 18:00 zahira) — lokal jadval o'chiq.")
        return

    def loop():
        while True:
            try:
                now = time.localtime()
                # 1. Soat 09:00 da Kontingent hisoboti (har kuni)
                if now.tm_hour >= 9:
                    if not _kontingent_already_sent_today():
                        if send_kontingent_to_telegram(reason='Kunlik 09:00 avto-hisobot'):
                            _mark_kontingent_sent()
                            print(f"[KONTINGENT] ✅ Soat 09:00 kontingent ma'lumoti Telegramga yuborildi")

                # 2. Soat 18:00 da .json baza zahirasi (Har kuni)
                if (now.tm_hour > BACKUP_HOUR or
                        (now.tm_hour == BACKUP_HOUR and now.tm_min >= BACKUP_MINUTE)):
                    if not _backup_already_sent_today():
                        if send_backup_to_telegram('Kunlik 18:00 avto-zahira'):
                            _mark_backup_sent()
            except Exception as e:
                print(f"[ZAHIRA] Rejalashtiruvchi xatosi: {e}")
            time.sleep(45)

    t = threading.Thread(target=loop, daemon=True)
    t.start()


BOT_KEYBOARD_MARKUP = {
    "keyboard": [
        [{"text": "➕ Yangi talaba"}, {"text": "➕ Yangi xodim"}],
        [{"text": "🎓 Guruhlar ro'yxati"}, {"text": "📈 Kontingent"}],
        [{"text": "👨‍🏫 O'qituvchilar ro'yxati"}, {"text": "👔 Shtat xodimlari"}],
        [{"text": "📊 Excel hisobotlar"}, {"text": "📝 Davomat jurnallari"}],
        [{"text": "📦 JSON Baza (.json)"}, {"text": "⚠️ Kamchiliklar"}]
    ],
    "resize_keyboard": True,
    "is_persistent": True
}




def send_variant_selection_menu(chat_id):
    import requests
    cfg = load_backup_config() or {}
    cur = cfg.get('report_variant', 1)
    text = (
        "🎨 <b>KONTINGENT HISOBOTI UCHUN 10 XIL VARIANT:</b>\n\n"
        f"Hozirgi faol variant: <b>{cur}-variant</b>\n\n"
        "1. 🏛 <b>1-variant</b> — Klassik & Rasmiy (Kengaytirilgan)\n"
        "2. 📊 <b>2-variant</b> — Ixcham & Smart Dashboard (Tezkor)\n"
        "3. 📈 <b>3-variant</b> — Foizlar & Progress Bar (Vizual)\n"
        "4. 🏥 <b>4-variant</b> — Mutaxassisliklar kesimida (Farm/Hamshira)\n"
        "5. 🌲 <b>5-variant</b> — Zamonaviy Daraxtsimon (Box-Tree)\n"
        "6. 👨‍🏫 <b>6-variant</b> — Guruh Rahbarlari Markazlashgan\n"
        "7. 📑 <b>7-variant</b> — Jadvalsimon Monospace (<pre>)\n"
        "8. 📄 <b>8-variant</b> — Elegant Minimalist (Sof matn)\n"
        "9. 🛡 <b>9-variant</b> — Nazorat & Hujjatlar Auditi (Monitoring)\n"
        "10. 👑 <b>10-variant</b> — Premium Executive Briefing\n\n"
        "💡 <i>Quyidagi tugmalardan birini bosing yoki masalan: <code>/variant 2</code> deb yuboring.</i>"
    )
    inline_kb = {
        "inline_keyboard": [
            [{"text": f"{'✅ ' if cur == i else ''}{i}-variant", "callback_data": f"set_var:{i}"} for i in range(1, 6)],
            [{"text": f"{'✅ ' if cur == i else ''}{i}-variant", "callback_data": f"set_var:{i}"} for i in range(6, 11)],
        ]
    }
    requests.post(
        f"https://api.telegram.org/bot{cfg['token']}/sendMessage",
        json={'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML', 'reply_markup': inline_kb},
        timeout=20
    )


def set_active_variant(v_num, chat_id):
    import requests
    v = max(1, min(10, int(v_num)))
    cfg = load_backup_config() or {}
    cfg['report_variant'] = v
    # update backup_config.json
    try:
        with open(BACKUP_CONFIG_PATH, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        raw['report_variant'] = v
        with open(BACKUP_CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(raw, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[CONFIG] report_variant yozishda xato: {e}")

    confirm_text = f"✅ <b>09:00 avto-hisobot uchun {v}-variant tanlandi!</b>\n\nQuyida tanlangan variant namunasi:"
    requests.post(
        f"https://api.telegram.org/bot{cfg['token']}/sendMessage",
        json={'chat_id': chat_id, 'text': confirm_text, 'parse_mode': 'HTML'},
        timeout=20
    )
    send_kontingent_to_telegram(chat_id, reason=f"{v}-variant namunasi", variant_num=v)


def send_teachers_list_to_telegram(chat_id=None):
    import requests
    cfg = load_backup_config()
    if not cfg:
        return False
    cid = chat_id or cfg['chat_id']
    token = cfg['token']

    # data/xodimlar.json dan o'qish
    xodimlar_file = os.path.join(BASE_DIR, 'data', 'xodimlar.json')
    staff = []
    if os.path.exists(xodimlar_file):
        try:
            with open(xodimlar_file, 'r', encoding='utf-8') as f:
                staff = json.load(f)
        except Exception:
            staff = []

    asosiy = [s for s in staff if "asosiy" in s.get('kategoriya', '').lower() or "asosiy" in s.get('ish_turi', '').lower()]
    orindosh = [s for s in staff if "o'rindosh" in s.get('kategoriya', '').lower() or "o'rindosh" in s.get('ish_turi', '').lower()]
    total = len(asosiy) + len(orindosh)
    stamp = time.strftime('%d.%m.%Y | %H:%M')

    lines = [
        "🏛 <b>SHAHRISABZ TIBBIYOT TEXNIKUMI</b>",
        "👨‍🏫 <b>O'QITUVCHILAR VA PEDAGOGLAR RO'YXATI</b>",
        f"🕒 Sana: <b>{stamp}</b>",
        "━━━━━━━━━━━━━━━━━━━━━━",
        f"📊 <b>Jami pedagoglar: {total} nafar</b>",
        f"• 📗 Asosiy o'qituvchilar: <b>{len(asosiy)} nafar</b>",
        f"• 📘 O'rindosh o'qituvchilar: <b>{len(orindosh)} nafar</b>",
        "━━━━━━━━━━━━━━━━━━━━━━",
        f"📗 <b>ASOSIY O'QITUVCHILAR ({len(asosiy)} nafar):</b>"
    ]
    for i, t in enumerate(asosiy, 1):
        mut = t.get('mutaxassislik') or "O'qituvchi"
        tel = t.get('tel') or "—"
        lines.append(f"{i}. <b>{t.get('fish', '')}</b> — <i>{mut}</i> (📞 {tel})")

    lines.append("")
    lines.append(f"📘 <b>O'RINDOSH O'QITUVCHILAR ({len(orindosh)} nafar):</b>")
    for i, t in enumerate(orindosh, 1):
        mut = t.get('mutaxassislik') or "O'qituvchi"
        tel = t.get('tel') or "—"
        lines.append(f"{i}. <b>{t.get('fish', '')}</b> — <i>{mut}</i> (📞 {tel})")

    # Matn yuborish
    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={'chat_id': cid, 'text': "\n".join(lines), 'parse_mode': 'HTML', 'reply_markup': BOT_KEYBOARD_MARKUP},
            timeout=30
        )
    except Exception as e:
        print(f"[BOT] O'qituvchilar matni yuborishda xato: {e}")

    # Excel faylini yuborish (Fayl nomida hech qanday tagchiziq '_' yo'q, faqat probel!)
    excel_file = os.path.join(BASE_DIR, 'hisobotlar', 'Oqituvchilar royxati.xlsx')
    if os.path.exists(excel_file):
        try:
            with open(excel_file, 'rb') as fh:
                requests.post(
                    f"https://api.telegram.org/bot{token}/sendDocument",
                    data={'chat_id': cid, 'caption': f"👨‍🏫 <b>O'qituvchilar ro'yxati (.xlsx)</b>\n👥 Jami: {total} nafar ({len(asosiy)} asosiy, {len(orindosh)} o'rindosh)\n✅ <i>Toza probelli fayl</i>", 'parse_mode': 'HTML'},
                    files={'document': ('Oqituvchilar royxati.xlsx', fh)},
                    timeout=60
                )
        except Exception as e:
            print(f"[BOT] O'qituvchilar Excelini yuborishda xato: {e}")
    return True


def send_shtat_staff_to_telegram(chat_id=None):
    import requests
    cfg = load_backup_config()
    if not cfg:
        return False
    cid = chat_id or cfg['chat_id']
    token = cfg['token']

    xodimlar_file = os.path.join(BASE_DIR, 'data', 'xodimlar.json')
    staff = []
    if os.path.exists(xodimlar_file):
        try:
            with open(xodimlar_file, 'r', encoding='utf-8') as f:
                staff = json.load(f)
        except Exception:
            staff = []

    shtat = [s for s in staff if "shtat" in s.get('kategoriya', '').lower() or s.get('ish_turi') == 'Shtat' or (s.get('bolim') != 'Pedagog' and not 'o\'qituvchi' in s.get('lavozim', '').lower())]
    stamp = time.strftime('%d.%m.%Y | %H:%M')

    lines = [
        "🏛 <b>SHAHRISABZ TIBBIYOT TEXNIKUMI</b>",
        "👔 <b>SHTAT XODIMLARI RO'YXATI</b>",
        f"🕒 Sana: <b>{stamp}</b>",
        "━━━━━━━━━━━━━━━━━━━━━━",
        f"👥 <b>Jami shtat birligi: {len(shtat)} nafar</b>",
        "━━━━━━━━━━━━━━━━━━━━━━",
    ]
    for i, s in enumerate(shtat, 1):
        lavozim = s.get('lavozim', 'Xodim')
        tel = s.get('tel') or "—"
        pv = s.get('pv') or "—"
        lines.append(f"{i}. <b>{s.get('fish', '')}</b> — <b>{lavozim}</b>\n   • Pasport: <code>{pv}</code> · Tel: {tel}")

    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={'chat_id': cid, 'text': "\n".join(lines), 'parse_mode': 'HTML', 'reply_markup': BOT_KEYBOARD_MARKUP},
            timeout=30
        )
    except Exception as e:
        print(f"[BOT] Shtat matni yuborishda xato: {e}")

    # Excel faylini yuborish (probel bilan)
    excel_file = os.path.join(BASE_DIR, 'hisobotlar', 'Shtat xodimlar royxati.xlsx')
    if os.path.exists(excel_file):
        try:
            with open(excel_file, 'rb') as fh:
                requests.post(
                    f"https://api.telegram.org/bot{token}/sendDocument",
                    data={'chat_id': cid, 'caption': f"👔 <b>Shtat xodimlari ro'yxati (.xlsx)</b>\n👥 Jami: {len(shtat)} nafar shtat birligi", 'parse_mode': 'HTML'},
                    files={'document': ('Shtat xodimlar royxati.xlsx', fh)},
                    timeout=60
                )
        except Exception as e:
            print(f"[BOT] Shtat Excelini yuborishda xato: {e}")
    return True


def send_excel_reports_menu(chat_id=None):
    import requests
    cfg = load_backup_config()
    if not cfg:
        return False
    cid = chat_id or cfg['chat_id']
    token = cfg['token']

    text = (
        "📊 <b>Excel Hisobotlar Bo'limi</b>\n\n"
        "Quyidagi ro'yxatdan kerakli Excel faylini olishingiz mumkin:\n\n"
        "1. <b>Buxgalteriya (.xlsx)</b> — Shartnoma raqami va Pasport\n"
        "2. <b>Baza Admin (.xlsx)</b> — Pasport va Diplomlar\n"
        "3. <b>Guruh Rahbarlari (.xlsx)</b> — Tug'ilgan sana va shahodatnomalar\n"
        "4. <b>To'liq Baza (.xlsx)</b> — Barcha ustunlar jamlangan hisobot\n"
        "5. <b>O'qituvchilar (.xlsx)</b> — Asosiy va O'rindosh o'qituvchilar\n"
        "6. <b>Shtat xodimlari (.xlsx)</b> — Rahbariyat va ma'muriy xodimlar\n\n"
        "<i>Kerakli fayl nomini yozing yoki tugmalardan foydalaning.</i>"
    )
    # Inline keyboard
    kb = {
        "inline_keyboard": [
            [{"text": "📊 1. Buxgalteriya", "callback_data": "rf:bux"}, {"text": "🗂 2. Baza Admin", "callback_data": "rf:adm"}],
            [{"text": "👥 3. Guruh Rahbarlari", "callback_data": "rf:grh"}, {"text": "📋 4. To'liq Baza", "callback_data": "rf:tol"}],
            [{"text": "👨‍🏫 O'qituvchilar", "callback_data": "rf:tch"}, {"text": "👔 Shtat xodimlari", "callback_data": "rf:stf"}]
        ]
    }
    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={'chat_id': cid, 'text': text, 'parse_mode': 'HTML', 'reply_markup': kb},
            timeout=20
        )
    except Exception as e:
        print(f"[BOT] Excel menu yuborishda xato: {e}")
    return True

def send_bot_welcome_menu(chat_id=None):
    import requests
    cfg = load_backup_config()
    if not cfg:
        return False
    cid = chat_id or cfg['chat_id']
    text = """🤖 <b>Talabalar Bazasi va Shartnomalar Boti</b>

Quyidagi guruhlangan tugmalar orqali istalgan vaqtda kerakli ma'lumotlarni olishingiz mumkin:

➕ <b>Yangi Qo'shish (AI):</b>
• <b>➕ Yangi talaba</b> — Hujjat rasmidan avto-tahlil va guruhga biriktirish
• <b>➕ Yangi xodim</b> — Pasport/diplomdan o'qituvchi yoki shtatga qo'shish

🎓 <b>O'quv va Guruhlar:</b>
• <b>🎓 Guruhlar ro'yxati</b> — Guruhlar va rasmli jurnallar
• <b>📈 Kontingent</b> — Talabalar umumiy kontingenti

👨‍🏫 <b>Pedagog va Xodimlar:</b>
• <b>👨‍🏫 O'qituvchilar ro'yxati</b> — Asosiy va O'rindosh o'qituvchilar (.xlsx)
• <b>👔 Shtat xodimlari</b> — Ma'muriy va xo'jalik shtat birliklari (.xlsx)

📊 <b>Hisobot va Hujjatlar:</b>
• <b>📊 Excel hisobotlar</b> — 1-Buxgalteriya, 2-Admin, 3-Guruh rahbarlari, 4-To'liq
• <b>📝 Davomat jurnallari</b> — Excel andoza va jurnallar

📦 <b>Baza va Nazorat:</b>
• <b>📦 JSON Baza (.json)</b> — To'liq JSON ma'lumotlar bazasi
• <b>⚠️ Kamchiliklar</b> — Hujjati to'liq bo'lmagan talabalar

⏰ <i>Avtomatik rejim:</i>
— Har kuni <b>09:00</b> da: <b>Kontingent hisoboti</b>
— Har kuni <b>18:00</b> da: <b>.json baza zahirasi</b>"""
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{cfg['token']}/sendMessage",
            json={
                'chat_id': cid,
                'text': text,
                'parse_mode': 'HTML',
                'reply_markup': BOT_KEYBOARD_MARKUP
            },
            timeout=20
        )
        return bool(resp.ok)
    except Exception as e:
        print(f"[BOT] Menu yuborishda xato: {e}")
        return False


def _start_telegram_bot_polling():
    """Agar 24/7 sayt webhooki (Netlify) ulangan bo'lsa, getUpdates chaqirmaydi (webhook uzilib qolmasligi uchun)."""
    def bot_loop():
        import requests
        cfg = load_backup_config()
        if not cfg:
            return
        token = cfg['token']
        try:
            wh = requests.get(f"https://api.telegram.org/bot{token}/getWebhookInfo", timeout=10)
            if wh.ok and wh.json().get('ok'):
                wh_url = wh.json().get('result', {}).get('url', '')
                if wh_url and '/api/telegram_webhook' in wh_url:
                    print(f"[BOT] ☁️ 24/7 Cloud Webhook faol ({wh_url}) — lokal polling talab etilmaydi.")
                    return
        except Exception:
            pass
        offset = 0
        # Dastlabki ishga tushganda eskirgan update'larni o'tkazib yuboramiz
        try:
            r0 = requests.get(f"https://api.telegram.org/bot{token}/getUpdates", params={'timeout': 1}, timeout=10)
            if r0.ok and r0.json().get('result'):
                offset = r0.json()['result'][-1]['update_id'] + 1
        except Exception:
            pass

        while True:
            try:
                resp = requests.get(
                    f"https://api.telegram.org/bot{token}/getUpdates",
                    params={'offset': offset, 'timeout': 25},
                    timeout=35
                )
                if resp.status_code == 409:
                    # Webhook ulangan (sayt botga javob beradi) yoki bot boshqa joyda ishlayapti
                    print("[BOT] ☁️ Webhook ulangan — lokal polling to'xtatildi.")
                    return
                if resp.status_code == 401:
                    print("[BOT] ❌ Bot tokeni noto'g'ri yoki bekor qilingan (scripts/backup_config.json → bot_token).")
                    return
                if not resp.ok:
                    time.sleep(5)
                    continue
                updates = resp.json().get('result', [])
                for upd in updates:
                    offset = upd['update_id'] + 1
                    msg = upd.get('message')
                    if not msg:
                        continue
                    chat_id = msg.get('chat', {}).get('id')
                    text = str(msg.get('text') or '').strip()
                    if not text or not chat_id:
                        continue
                    if str(chat_id) not in cfg['allowed_ids']:
                        requests.post(
                            f"https://api.telegram.org/bot{token}/sendMessage",
                            json={'chat_id': chat_id, 'parse_mode': 'HTML',
                                  'text': f"⛔ Bu bot faqat texnikum xodimlari uchun.\n\nKirish kerak bo'lsa, administratorga ID raqamingizni yuboring: <code>{chat_id}</code>"},
                            timeout=20
                        )
                        continue

                    # Callback query tekshiruvi (inline tugmalar)
                    cb = upd.get('callback_query')
                    if cb:
                        cb_id = cb.get('id')
                        cb_data = str(cb.get('data') or '')
                        cb_chat = cb.get('message', {}).get('chat', {}).get('id')
                        if cb_data.startswith('set_var:'):
                            var_id = int(cb_data.split(':')[1])
                            set_active_variant(var_id, cb_chat)
                            requests.post(f"https://api.telegram.org/bot{token}/answerCallbackQuery", json={'callback_query_id': cb_id, 'text': f"{var_id}-variant tanlandi!"})
                        continue

                    t_low = text.lower()
                    if t_low.startswith('/variantlar') or t_low == 'variantlar' or t_low == 'variant':
                        send_variant_selection_menu(chat_id)
                        continue
                    elif re.match(r'^/?variant\s+(\d+)$', t_low):
                        m_v = re.search(r'\d+', t_low)
                        if m_v:
                            set_active_variant(int(m_v.group(0)), chat_id)
                        continue
                    if t_low in ('/start', '/menu', '/help', 'menyu', 'start'):
                        send_bot_welcome_menu(chat_id)
                    elif "o'qituvchi" in t_low or "oqituvchi" in t_low or t_low == '/oqituvchilar' or t_low == '/ustozlar':
                        send_teachers_list_to_telegram(chat_id)
                    elif 'shtat' in t_low or t_low == '/shtat' or 'xodimlar' in t_low or t_low == '/xodimlar':
                        send_shtat_staff_to_telegram(chat_id)
                    elif 'excel hisobot' in t_low or t_low == '/hisobotlar' or t_low == 'excel hisobotlar':
                        send_excel_reports_menu(chat_id)
                    elif 'kontingent' in t_low or 'kontengent' in t_low or t_low == '/kontingent':
                        send_kontingent_to_telegram(chat_id, reason="Bot tugmasi orqali", variant_num=5)
                    elif 'buxgalter' in t_low or '1. buxgalter' in t_low or t_low == '/buxgalteriya':
                        send_role_excel_to_telegram_chat('buxgalteriya', chat_id)
                    elif 'baza admin' in t_low or '2. baza' in t_low or t_low == '/admin':
                        send_role_excel_to_telegram_chat('admin', chat_id)
                    elif 'guruh rahbar' in t_low or '3. guruh' in t_low or t_low == '/guruh_rahbari':
                        send_role_excel_to_telegram_chat('guruh_rahbari', chat_id)
                    elif "to'liq" in t_low or "toliq" in t_low or '4.' in t_low or t_low == '/toliq':
                        send_role_excel_to_telegram_chat('toliq', chat_id)
                    elif 'json' in t_low or t_low == '/json':
                        json_path, cnt = build_json_database_file()
                        with open(json_path, 'rb') as fh:
                            requests.post(
                                f"https://api.telegram.org/bot{token}/sendDocument",
                                data={'chat_id': chat_id, 'caption': f"📦 <b>talabalar_bazasi.json</b>\n👥 Jami talabalar: <b>{cnt} nafar</b>", 'parse_mode': 'HTML'},
                                files={'document': ('talabalar_bazasi.json', fh)},
                                timeout=60
                            )
                    elif 'guruh jurnallari' in t_low or t_low == '/guruhlar':
                        send_group_lists_to_telegram(target=str(chat_id), group_filter='ALL')
                    else:
                        send_bot_welcome_menu(chat_id)
            except Exception as e_poll:
                time.sleep(5)

    t = threading.Thread(target=bot_loop, daemon=True)
    t.start()


def _start_remote_sync_listener():
    """Fonda har 4 soniyada GitHub'dan yangi o'zgarishlar bor-yo'qligini tezkor tekshirib turadi."""
    def listener_loop():
        while True:
            time.sleep(4)
            try:
                process_remote_github_changes()
            except Exception:
                pass
    t = threading.Thread(target=listener_loop, daemon=True)
    t.start()


def load_verifications_map():
    with VERIFICATIONS_LOCK:
        if os.path.exists(VERIFICATIONS_FILE):
            try:
                with open(VERIFICATIONS_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"verifications.json yuklash xatosi: {e}")
        return {}

def save_verification_atomic(row, v_status, shnum=None, pinfl=None):
    with VERIFICATIONS_LOCK:
        os.makedirs(os.path.dirname(VERIFICATIONS_FILE), exist_ok=True)
        vmap = {}
        if os.path.exists(VERIFICATIONS_FILE):
            try:
                with open(VERIFICATIONS_FILE, 'r', encoding='utf-8') as f:
                    vmap = json.load(f)
            except Exception:
                vmap = {}
        
        r_str = str(row)
        if v_status == 'TASDIQLANDI':
            vmap[r_str] = 'TASDIQLANDI'
            if shnum: vmap['sh_' + str(shnum).strip()] = 'TASDIQLANDI'
            if pinfl: vmap['pinfl_' + str(pinfl).strip()] = 'TASDIQLANDI'
        else:
            vmap.pop(r_str, None)
            if shnum: vmap.pop('sh_' + str(shnum).strip(), None)
            if pinfl: vmap.pop('pinfl_' + str(pinfl).strip(), None)
            vmap[r_str] = 'KUTILMOQDA'
            if shnum: vmap['sh_' + str(shnum).strip()] = 'KUTILMOQDA'
            if pinfl: vmap['pinfl_' + str(pinfl).strip()] = 'KUTILMOQDA'

        tmp_path = VERIFICATIONS_FILE + '.tmp'
        try:
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(vmap, f, ensure_ascii=False, indent=2)
            if os.path.exists(VERIFICATIONS_FILE):
                os.remove(VERIFICATIONS_FILE)
            os.rename(tmp_path, VERIFICATIONS_FILE)
        except Exception as e:
            print(f"verifications.json yozishda xato: {e}")

def save_baza_verification_atomic(row, b_status, shnum=None, pinfl=None):
    with VERIFICATIONS_LOCK:
        os.makedirs(os.path.dirname(VERIFICATIONS_FILE), exist_ok=True)
        vmap = {}
        if os.path.exists(VERIFICATIONS_FILE):
            try:
                with open(VERIFICATIONS_FILE, 'r', encoding='utf-8') as f:
                    vmap = json.load(f)
            except Exception:
                vmap = {}

        val = 'KIRITILMAGAN' if b_status == 'KIRITILMAGAN' else 'KIRITILDI'
        r_str = f"baza_{row}"
        vmap[r_str] = val
        if shnum:
            vmap[f"baza_sh_{str(shnum).strip()}"] = val
        if pinfl:
            vmap[f"baza_pinfl_{str(pinfl).strip()}"] = val

        tmp_path = VERIFICATIONS_FILE + '.tmp'
        try:
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(vmap, f, ensure_ascii=False, indent=2)
            if os.path.exists(VERIFICATIONS_FILE):
                os.remove(VERIFICATIONS_FILE)
            os.rename(tmp_path, VERIFICATIONS_FILE)
        except Exception as e:
            print(f"verifications.json (baza) yozishda xato: {e}")

STUDENTS_JSON_PATH = os.path.join(BASE_DIR, 'data', 'students.json')
STUDENTS_JSON_LOCK = threading.Lock()

def sync_students_json_atomic(action, data):
    """
    Tahrir yoki holat o'zgarishini data/students.json fayliga DARHOL (0.01s da)
    yozadi. Natijada Next.js portali hisobot to'liq qayta hisoblanishini kutmasdan,
    o'zgarishni darhol ko'radi va saqlangan deb belgilaydi.
    """
    with STUDENTS_JSON_LOCK:
        if not os.path.exists(STUDENTS_JSON_PATH):
            return
        try:
            with open(STUDENTS_JSON_PATH, 'r', encoding='utf-8') as f:
                students = json.load(f)
            if not isinstance(students, list):
                return

            row = int(data.get('row', 0))
            shnum = str(data.get('shnum', '') or '').strip()
            pinfl = str(data.get('pinfl', '') or '').replace(' ', '').strip()
            name = str(data.get('ism', '') or '').strip().lower()

            def pin_of(s):
                return str(s.get('pinfl', '') or '').replace(' ', '').strip()

            def pick_index():
                """Bitta talaba: JSHSHIR -> qator -> yagona shartnoma raqami -> ism (raqamlar takrorlanadi)"""
                if pinfl:
                    for i, s in enumerate(students):
                        if pin_of(s) == pinfl:
                            return i
                if row:
                    for i, s in enumerate(students):
                        if int(s.get('row', 0) or 0) == row and (not pinfl or not pin_of(s) or pin_of(s) == pinfl):
                            return i
                sh_n = normalize_shnum(shnum)
                if sh_n and sh_n not in ('—', '-'):
                    hits = [i for i, s in enumerate(students) if normalize_shnum(s.get('shnum')) == sh_n]
                    if len(hits) == 1:
                        return hits[0]
                if name:
                    for i, s in enumerate(students):
                        if str(s.get('ism', '') or '').strip().lower() == name or str(s.get('fish', '') or '').strip().lower() == name:
                            return i
                return None

            idx = pick_index()

            def match(s):
                return idx is not None and s is students[idx]

            if action == 'delete':
                students = [s for s in students if not match(s)]
            elif action == 'verify':
                status = data.get('status', 'KUTILMOQDA')
                for s in students:
                    if match(s):
                        s['verified'] = status
                        break
            elif action == 'baza':
                status = data.get('status', 'KIRITILDI')
                for s in students:
                    if match(s):
                        s['baza'] = status
                        break
            elif action == 'update':
                fields = data.get('fields', {})
                for s in students:
                    if match(s):
                        for k, v in fields.items():
                            s[k] = v
                        cur_ism = s.get('ism', '') or ''
                        cur_ota = s.get('ota', '') or ''
                        s['fish'] = f"{cur_ism} {cur_ota}".strip()
                        break
            elif action == 'add':
                st = dict(data)
                if not st.get('row'):
                    next_row = max([int(s.get('row', 0)) for s in students] or [1]) + 1
                    st['row'] = next_row
                if not st.get('fish'):
                    st['fish'] = f"{st.get('ism', '')} {st.get('ota', '')}".strip()
                if 'verified' not in st:
                    st['verified'] = 'TASDIQLANDI'
                if 'baza' not in st:
                    st['baza'] = 'KIRITILDI'
                students.append(st)

            tmp_path = STUDENTS_JSON_PATH + '.tmp'
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(students, f, ensure_ascii=False)
            if os.path.exists(STUDENTS_JSON_PATH):
                os.remove(STUDENTS_JSON_PATH)
            os.rename(tmp_path, STUDENTS_JSON_PATH)
        except Exception as e:
            print(f"[WARN] students.json tezkor yozishda xato: {e}")

def _run_rebuild_worker():
    global IS_REBUILDING, REBUILD_PENDING
    with REBUILD_LOCK:
        if IS_REBUILDING:
            REBUILD_PENDING = True
            return
        IS_REBUILDING = True
        REBUILD_PENDING = False

    try:
        while True:
            script1 = os.path.join(BASE_DIR, 'qayta_tekshiruv', '03_hisobot_yasat.py')
            if os.path.exists(script1):
                try:
                    subprocess.run([sys.executable, script1], check=False, cwd=BASE_DIR)
                except Exception as e:
                    print(f"03_hisobot_yasat xatosi: {e}")

            with REBUILD_LOCK:
                if REBUILD_PENDING:
                    REBUILD_PENDING = False
                    continue
                else:
                    IS_REBUILDING = False
                    break
        # Hisobot va index.html to'liq generatsiya qilingach, darhol GitHub'ga push qilamiz
        _do_git_push()
    except Exception as e:
        print(f"Rebuild worker global xato: {e}")
        with REBUILD_LOCK:
            IS_REBUILDING = False

# === GURUHLANGAN (BATCHED) SAQLASH ===
# Har bir tahrirda hisobotni qayta yaratib GitHub'ga push qilish qimmat:
# bitta sikl ~15 soniya. Shuning uchun tahrir darhol Excelga yoziladi
# (ma'lumot yo'qolmaydi), og'ir qism esa guruhlanadi:
#   - oxirgi tahrirdan 3 soniya o'tgach avtomatik yuboriladi
#   - yoki "GitHub'ga yuborish" tugmasi bosilganda darhol
BATCH_DELAY = 3.0       # tahrirlar tinchigandan keyin qancha kutish
BATCH_MAX_WAIT = 12.0   # uzluksiz tahrirlanganda ham shundan ko'p kutmaslik
PENDING_SINCE = None    # birinchi yuborilmagan tahrir vaqti


def has_pending_changes():
    return PENDING_SINCE is not None


def flush_to_git_now():
    """Kutayotgan o'zgarishlarni darhol yuborish ("Saqlash" tugmasi)."""
    trigger_report_rebuild(delay=0.1)


def trigger_report_rebuild(delay=None, async_mode=True):
    """Barcha hisobotlar va yangilangan Excel fayllarini xavfsiz, debounced sinxronlashtirish.

    delay berilmasa BATCH_DELAY ishlatiladi. Har chaqiruv oldingi taymerni
    bekor qilib qayta rejalashtiradi, lekin BATCH_MAX_WAIT dan oshib ketsa
    (uzluksiz tahrir holati) kutmasdan darhol ishga tushiriladi.
    """
    global REBUILD_TIMER, PENDING_SINCE
    if not async_mode:
        PENDING_SINCE = None
        _run_rebuild_worker()
        return

    if delay is None:
        delay = BATCH_DELAY

    with REBUILD_LOCK:
        now = time.time()
        if PENDING_SINCE is None:
            PENDING_SINCE = now
        elif (now - PENDING_SINCE) >= BATCH_MAX_WAIT:
            # Juda uzoq kutib qoldi — boshqa kechiktirmaymiz
            delay = 0.1

        if REBUILD_TIMER is not None:
            try:
                REBUILD_TIMER.cancel()
            except Exception:
                pass

        def _worker():
            global PENDING_SINCE
            PENDING_SINCE = None
            _run_rebuild_worker()

        REBUILD_TIMER = threading.Timer(delay, _worker)
        REBUILD_TIMER.daemon = True
        REBUILD_TIMER.start()


def _env_file_value(name):
    """web/.env.local yoki loyiha ildizidagi .env dan qiymat (portal bilan bir xil kalit)"""
    for rel in (os.path.join('web', '.env.local'), '.env'):
        path = os.path.join(BASE_DIR, rel)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith(name + '='):
                        return line.split('=', 1)[1].strip().strip('"').strip("'")
        except OSError:
            pass
    return ''


# Kalit kodga YOZILMAYDI (repo ommaviy — eski kalit shu sabab OpenRouter tomonidan o'chirilgan edi)
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "").strip() or _env_file_value("OPENROUTER_API_KEY")

# Portal tanlaydigan modellar (web/lib/ai-doc.ts → AI_MODELS bilan bir xil)
DEFAULT_AI_MODEL = "google/gemini-3.8-flash"
SUPPORTED_AI_MODELS = {
    "google/gemini-3.8-flash": "google/gemini-3.8-flash",
    "anthropic/claude-haiku-5.5": "anthropic/claude-haiku-5.5",
    "google/gemini-2.5-flash": "google/gemini-2.5-flash",
    "google/gemini-2.5-pro": "google/gemini-2.5-pro",
    "openai/gpt-4o": "openai/gpt-4o",
    # eski nomlar
    "google/gemini-3.7-flash": "google/gemini-3.8-flash",
    "google/gemini-2.0-flash-001": "google/gemini-2.5-flash",
    "google/gemini-2.0-flash": "google/gemini-2.5-flash",
    "anthropic/claude-3.5-sonnet": "anthropic/claude-haiku-5.5",
    "flash": "google/gemini-3.8-flash",
    "pro": "google/gemini-2.5-pro",
}
# Tanlangan model javob bermasa — navbatdagilari
AI_FALLBACK_MODELS = ["google/gemini-3.8-flash", "anthropic/claude-haiku-5.5", "google/gemini-2.5-flash"]
OPENROUTER_MODELS = ["google/gemini-3.8-flash", "google/gemini-2.5-pro", "anthropic/claude-haiku-5.5"]

def clean_uz_name(text):
    if not text:
        return ""
    text = str(text).strip()
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r"[`‘’ʻʼ´]", "'", text)
    text = re.sub(r"(?i)to['\s]*l\s+qin", "To'lqin", text)
    text = re.sub(r"(?i)abdu\s*g['\s]*affor", "Abdug'affor", text)
    
    words = text.split(' ')
    cleaned_words = []
    for w in words:
        w_lower = w.lower()
        if w_lower in ['qizi', 'kizi']:
            cleaned_words.append('qizi')
        elif w_lower in ["o'g'li", "o‘g‘li", "o’g’li", "ogli", "ugli", "o'gli"]:
            cleaned_words.append("o'g'li")
        elif "'" in w:
            parts = w.split("'")
            fixed_parts = []
            for i, p in enumerate(parts):
                if i == 0:
                    fixed_parts.append(p.capitalize())
                else:
                    fixed_parts.append(p.lower())
            cleaned_words.append("'".join(fixed_parts))
        else:
            cleaned_words.append(w.capitalize())
            
    return " ".join(cleaned_words).strip()

SYSTEM_PROMPT = """Siz O'zbekiston Respublikasining barcha turdagi shaxsni tasdiqlovchi va ta'lim hujjatlarini (Yashil biometrik pasport, ID-karta, Kollej/Litsey diplomi, Maktab shahodatnomasi) juda yuqori aniqlikda tahlil qiluvchi PROFESSIONAL AI EKSPERTSIZ.

TASVIR XIRA, YARAQLAGAN YOKI QIYIQ BO'LGAN TAQDIRDA HAM DIQQAT BILAN O'QING:

Quyidagi JSON formatida to'liq va aniq javob bering:
{
  "is_passport": true/false,
  "pass_series": "AE, AD, AB, AC yoki 2 ta harf",
  "pass_number": "7 xonali raqam",
  "pinfl": "14 xonali JSHSHIR raqami (agar ko'rinsa yoki pastdagi MRZ kodda bo'lsa)",
  "birth_date": "DD.MM.YYYY (masalan 15.08.2008)",
  "surname": "Familiyasi (masalan: Karimova, Xasanova)",
  "name": "Ismi (masalan: Dilnoza, Zilola)",
  "patronymic": "OTASINING ISMI - JUDA MUHIM! (masalan: Eson qizi, Halim qizi, Umid qizi, Sherali qizi, Sunnat o'g'li, Farhodovich). Hech qachon tushirib qoldirmang!",
  "full_name": "Familiya Ism Sharif (to'liq)",
  "passport_issue_date": "FAQAT PASPORT yoki ID-KARTANING BERILGAN SANASI (DD.MM.YYYY). Shahodatnoma yoki Diplom sanasini MUTLAQ bermang! Masalan: 20.09.2024",
  
  "is_education_doc": true/false,
  "doc_type": "Diplom" yoki "Shahodatnoma",
  "doc_series": "K, UM, O'R-SH yoki seriya harflari",
  "doc_number": "Raqami (masalan 03728724, 3359681)",
  "institution": "Tugatgan maktab, litsey yoki kollejning TO'LIQ NOMI (masalan: 24-sonli umumiy o'rta ta'lim maktabi, Shahrisabz tibbiyot kolleji)",
  "specialty": "Mutaxassislik yoki yo'nalish nomi (agar yozilgan bo'lsa)",
  "grad_year": "Bitirgan yili (masalan 2026, 2023, 2018)"
}

MUHIM QOIDALAR:
1. "patronymic" (Otasining ismi) maydonini albatta toping va to'ldiring! Hujjatdagi "Otasining ismi / Father's name / Otchestvo" satriga qarang.
2. "passport_issue_date" - FAQAT pasport yoki ID-kartaning berilgan sanasi. Shahodatnoma/Diplom sanasini bu maydonga HECH QACHON yozmang!
3. Agar rasm biometrik yashil pasport bo'lsa, pasport seriyasi, raqami va pastki 2 qatorli MRZ chizig'idagi ma'lumotlarni o'qing.
4. Agar rasm kollej diplomi bo'lsa, qo'lyozma raqam va kollej nomini aniq o'qing.
5. Faqat toza JSON qaytaring."""

def call_openrouter_vision(img_bytes, is_retry=False):
    if not OPENROUTER_API_KEY:
        return None
    b64_img = base64.b64encode(img_bytes).decode('utf-8')
    url = "https://openrouter.ai/api/v1/chat/completions"
    
    # Pro modeldan boshlaymiz
    models_to_try = [OPENROUTER_MODELS[0], OPENROUTER_MODELS[1]] if is_retry else [OPENROUTER_MODELS[0]]
    
    for model_name in models_to_try:
        payload = {
            "model": model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": SYSTEM_PROMPT},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"}}
                    ]
                }
            ],
            "temperature": 0.05
        }
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://localhost:8080"
        })
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                res = json.loads(resp.read().decode('utf-8'))
                content = res['choices'][0]['message']['content'].strip()
                content = re.sub(r'^```json\s*', '', content)
                content = re.sub(r'\s*```$', '', content)
                parsed = json.loads(content)
                if parsed:
                    return parsed
        except Exception as e:
            print(f"OpenRouter [{model_name}] xato: {e}")
            continue
            
def parse_uz_id_card_qr(text):
    """
    O'zbekiston ID-karta QR kodi (ICAO / TD1 MRZ format):
    IUUZBAE4629898462802085680012<
    0802282F3510144UZBUZB<<<<<<<<8
    YAHYOMURODOVA<<GULSANAM<<<<<<<
    """
    data = {}
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    
    if len(lines) >= 3:
        l1, l2, l3 = lines[0], lines[1], lines[2]
        m_l1 = re.search(r'([A-Z]{2}\d{7})\d?([3-6]\d{13})', l1.replace('<', ''))
        if m_l1:
            data['pass_val'] = m_l1.group(1)
            data['pinfl'] = m_l1.group(2)
        else:
            m_p = re.search(r'(AD|AE|AA|AB|AC|FA)(\d{7})', l1)
            if m_p: data['pass_val'] = m_p.group(1) + m_p.group(2)
            m_pin = re.search(r'([3-6]\d{13})', l1)
            if m_pin: data['pinfl'] = m_pin.group(1)
            
        m_l2 = re.search(r'^(\d{2})(\d{2})(\d{2})[0-9MF]([0-9]{6})?', l2.replace('<', ''))
        if m_l2:
            yy, mm, dd = m_l2.group(1), m_l2.group(2), m_l2.group(3)
            year = f"20{yy}" if int(yy) <= 30 else f"19{yy}"
            data['dob'] = f"{dd}.{mm}.{year}"
            
            # ID-karta amal qilish muddati 10 yil — berilgan sana = amal qilish muddati - 10 yil
            exp_str = m_l2.group(4) if m_l2.lastindex and m_l2.lastindex >= 4 else None
            if exp_str and len(exp_str) == 6:
                exp_yy, exp_mm, exp_dd = int(exp_str[:2]), exp_str[2:4], exp_str[4:6]
                iss_yy = (exp_yy - 10) % 100
                iss_year = f"20{iss_yy:02d}" if iss_yy < 50 else f"19{iss_yy:02d}"
                data['ber_sana'] = f"{exp_dd}.{exp_mm}.{iss_year}"
            
        m_name = re.search(r'([A-Z]+)<<([A-Z]+)', l3)
        if m_name:
            fam = m_name.group(1).capitalize()
            ism = m_name.group(2).capitalize()
            data['ism'] = f"{fam} {ism}"
            
    full_str = "".join(lines)
    if 'pass_val' not in data:
        m_p = re.search(r'(AD|AE|AA|AB|AC|FA)(\d{7})', full_str)
        if m_p: data['pass_val'] = m_p.group(1) + m_p.group(2)
    if 'pinfl' not in data:
        m_pin = re.search(r'([3-6]\d{13})', full_str)
        if m_pin: data['pinfl'] = m_pin.group(1)
    if 'dob' not in data:
        m_dob = re.search(r'\b(\d{2})(\d{2})(\d{2})[0-9MF]', full_str)
        if m_dob:
            yy, mm, dd = m_dob.group(1), m_dob.group(2), m_dob.group(3)
            year = f"20{yy}" if int(yy) <= 30 else f"19{yy}"
            data['dob'] = f"{dd}.{mm}.{year}"

    return data

def parse_eshahodatnoma_pdf(pdf_url):
    """
    e-shahodatnoma.uz PDF hujjatini yuklab, to'liq o'qish
    """
    data = {}
    if not pypdf:
        return data
    try:
        req = urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=12) as resp:
            pdf_bytes = resp.read()
            reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
                
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            
            for l in lines:
                if re.match(r'^\d{7,8}$', l):
                    data['cert_val'] = f"UM {l}" if not l.startswith('UM') else l
                    break
                    
            for l in lines:
                if re.search(r"(?i)(qizi|o'g'li|ogli|ugli)$", l):
                    parts = l.split()
                    if len(parts) >= 3:
                        data['fish'] = l
                        data['ism'] = f"{parts[0]} {parts[1]}"
                        data['ota'] = " ".join(parts[2:])
                    break
                    
            for l in lines:
                m_mak = re.search(r'(\d{4})\s+(.+?maktab.+)', l, re.I)
                if m_mak:
                    data['yil'] = m_mak.group(1)
                    data['maktab'] = m_mak.group(2).strip()
                    break
                elif '-sonli' in l or 'maktab' in l.lower():
                    data['maktab'] = l
                    
            m_dob = re.search(r'(\d{2}\.\d{2}\.\d{4})', text)
            if m_dob:
                data['dob'] = m_dob.group(1)
                
            data['cert_tur'] = "Shahodatnoma"
            data['sh_qr'] = pdf_url
    except Exception as e:
        print(f"e-shahodatnoma PDF yuklashda xato: {e}")
        
    return data

def scan_all_qrs(blobs_raw):
    """
    Barcha rasm bloklaridan QR-kodlarni 4 burchakda (0°, 90°, 180°, 270°) aniqlaydi va ma'lumotlarni chiqaradi
    """
    qr_data = {}
    if not zxingcpp:
        return qr_data
        
    found_urls = set()
    found_mrzs = set()

    for b in blobs_raw:
        try:
            pil_img = Image.open(io.BytesIO(b)).convert('RGB')
            # 4 burchakda tekshiramiz (chunki rasm 90 gradus burilgan bo'lishi mumkin)
            for angle in [0, 90, 180, 270]:
                rot_img = pil_img.rotate(angle, expand=True) if angle != 0 else pil_img
                results = zxingcpp.read_barcodes(rot_img)
                for r in results:
                    txt = (r.text or '').strip()
                    if not txt: continue
                    
                    # 1. e-shahodatnoma QR
                    if ('e-shahodatnoma.uz' in txt or 'getcertpdf' in txt or txt.endswith('.pdf')) and txt not in found_urls:
                        found_urls.add(txt)
                        pdf_data = parse_eshahodatnoma_pdf(txt)
                        if pdf_data:
                            qr_data.update(pdf_data)
                            
                    # 2. ID-karta QR / MRZ
                    elif ('I<UZB' in txt or 'IUUZB' in txt or 'UZB' in txt or len(txt.split('\n')) >= 2) and txt not in found_mrzs:
                        found_mrzs.add(txt)
                        id_data = parse_uz_id_card_qr(txt)
                        if id_data:
                            # Faqat to'ldirilgan maydonlarni yangilash
                            for k, v in id_data.items():
                                if v: qr_data[k] = v
        except Exception as e:
            pass
            
    return qr_data

def analyze_docx_content(docx_bytes, filename, default_ism="", default_yon="", use_pro=False, model=""):
    result = {
        "success": True,
        "filename": filename,
        "ism": default_ism,
        "ota": "",
        "shnum": "",
        "yonalis": default_yon or "Hamshiralik ishi - 3 yillik",
        "pass_val": "",
        "pinfl": "",
        "dob": "",
        "cert_tur": "Shahodatnoma",
        "cert_val": "",
        "maktab": "",
        "yil": "2024",
        "ber_sana": "",
        "tel": "",
        "sh_qr": ""
    }
    
    m_sh = re.search(r'[\s_Nn#-]*(\d{1,4})\.(?:docx|jpg|jpeg|png|webp)$', filename, re.I)
    if m_sh:
        result['shnum'] = m_sh.group(1)

    # Fayl nomidan dastlabki ism-familiyani ajratib olish (zaxira uchun)
    base_no_ext = os.path.splitext(filename)[0]
    fallback_name = re.sub(r'[\s_Nn#-]*\d{1,4}$', '', base_no_ext).replace('_', ' ').strip()
        
    try:
        saved_temp = os.path.join(FILES_DIR, filename)
        with open(saved_temp, 'wb') as f:
            f.write(docx_bytes)
            
        images, blobs_raw, full_text = extract_doc_images_with_crop(saved_temp)

        # Word (.docx) ichidagi jadvaldan (FAMILIYASI ISMI, OTASINI ISMI, TUGATGAN O'QISH JOYI, YILI, SHARTNOMA RAQAMI, TELEFON) o'qish
        try:
            d_obj = docx.Document(saved_temp)
            for tbl in d_obj.tables:
                for r_obj in tbl.rows:
                    row_line = " ".join(c.text.strip() for c in r_obj.cells if c.text.strip())
                    rl_low = row_line.lower()
                    if 'familiyasi' in rl_low and ':' in row_line:
                        val = row_line.split(':', 1)[1].strip()
                        if val and not result.get('ism'):
                            result['ism'] = clean_uz_name(val)
                    elif 'otasini' in rl_low and ':' in row_line:
                        val = row_line.split(':', 1)[1].strip()
                        if val and not result.get('ota'):
                            result['ota'] = clean_uz_name(val)
                    elif 'joyi' in rl_low and ':' in row_line:
                        val = row_line.split(':', 1)[1].strip()
                        if val and not result.get('maktab'):
                            result['maktab'] = val
                            if any(w in val.lower() for w in ['kollej', 'texnikum', 'litsey']):
                                result['cert_tur'] = 'Diplom'
                    elif 'yili' in rl_low and ':' in row_line:
                        val = row_line.split(':', 1)[1].strip()
                        m_y = re.search(r'(19\d{2}|20\d{2})', val)
                        if m_y:
                            result['yil'] = m_y.group(1)
                    elif 'shartnoma raqami' in rl_low and not result.get('shnum'):
                        m_s = re.search(r'(\d{1,4})\b', row_line)
                        if m_s:
                            result['shnum'] = m_s.group(1)
        except Exception as tbl_err:
            print(f"Docx jadval o'qish xatosi: {tbl_err}")
        
        if not result['shnum']:
            m_sh2 = re.search(r'[№#\.\s]*(\d{1,4})[\s-]*(?:sonli|shartnoma)', full_text, re.I)
            if m_sh2: result['shnum'] = m_sh2.group(1)

        # Word hujjati matnidan telefon raqam(lar)ini qidirish
        tel_matches = re.findall(r'(?:\+?998[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?\d{3}[\s-]?\d{2}[\s-]?\d{2}', full_text)
        if tel_matches:
            clean_tels = []
            for t in tel_matches:
                digits = re.sub(r'\D', '', t)
                if len(digits) >= 9:
                    clean_tels.append(t.strip())
            if clean_tels:
                result['tel'] = " / ".join(list(dict.fromkeys(clean_tels)))[:60]

        # Word hujjati matnidan pasport berilgan sanani qidirish
        m_ber_text = re.search(r'(?:berilgan|berildi|berilgan\s*sana|berilgan\s*vaqti|date\s*of\s*issue)[\s:]*(\d{2}[\.\/]\d{2}[\.\/]\d{4})', full_text, re.I)
        if m_ber_text:
            result['ber_sana'] = m_ber_text.group(1).replace('/', '.')

        # Word hujjati matnidan pasport seriya va JSHSHIR qidirish (zaxira)
        m_pv_text = re.search(r'\b(AD|AE|AA|AB|AC|FA)\s*(\d{7})\b', full_text, re.I)
        if m_pv_text:
            result['pass_val'] = (m_pv_text.group(1) + m_pv_text.group(2)).upper()
        m_pin_text = re.search(r'\b([3-6]\d{13})\b', full_text)
        if m_pin_text:
            result['pinfl'] = m_pin_text.group(1)

        # 1-QADAM: AVVAL QR-KODLARNI TEKSHIRISH (100% RASMIY VA ANIQ!)
        qr_extracted = scan_all_qrs(blobs_raw)
        if qr_extracted:
            print(f"QR kod orqali rasmiy ma'lumotlar olindi: {qr_extracted}")
            if qr_extracted.get('ism'): result['ism'] = clean_uz_name(qr_extracted['ism'])
            if qr_extracted.get('ota'): result['ota'] = clean_uz_name(qr_extracted['ota'])
            if qr_extracted.get('pass_val'): result['pass_val'] = qr_extracted['pass_val']
            if qr_extracted.get('pinfl'): result['pinfl'] = qr_extracted['pinfl']
            if qr_extracted.get('dob'): result['dob'] = qr_extracted['dob']
            if qr_extracted.get('ber_sana'): result['ber_sana'] = qr_extracted['ber_sana']
            if qr_extracted.get('cert_val'): result['cert_val'] = qr_extracted['cert_val']
            if qr_extracted.get('cert_tur'): result['cert_tur'] = qr_extracted['cert_tur']
            if qr_extracted.get('maktab'): result['maktab'] = qr_extracted['maktab']
            if qr_extracted.get('yil'): result['yil'] = qr_extracted['yil']
            if qr_extracted.get('sh_qr'): result['sh_qr'] = qr_extracted['sh_qr']

        # 2-QADAM: AI VISION TAHLIL (4 TA MODEL VA AVTOMATIK FALLBACK)
        if model and model in SUPPORTED_AI_MODELS:
            model_to_use = SUPPORTED_AI_MODELS[model]
        elif model:
            model_to_use = SUPPORTED_AI_MODELS.get(model.lower(), 'google/gemini-2.5-flash')
        else:
            model_to_use = 'google/gemini-2.5-pro' if use_pro else 'google/gemini-2.5-flash'
        print(f"Hujjat AI tahlili: model = {model_to_use} (tanlangan: {model})")

        content_items = [{'type': 'text', 'text': """Sen professional O'zbekiston ID-karta, Biometrik pasport va Shahodatnoma/Diplom o'quvchisisan.
Ushbu rasmlarni juda sinchiklab tahlil qil va talabaning haqiqiy ma'lumotlarini chiqargin.

Qat'iy Qoidalar:
1. Pasport/ID seriya va raqami:
   - ID-karta: 'AD' yoki 'AE' harflari va KETMA-KET ANIQ 7 TA RAQAM (jami 9 ta belgi!). Masalan: AD1234567, AE4629898.
   - Biometrik pasport: 'AA', 'AB', 'AC', 'FA' va 7 ta raqam.
   - Hech qachon 8 ta yoki 6 ta raqam yozma!
2. JSHSHIR (PINFL):
   - ID-karta yoki pasport pastidagi/orqasidagi ANIQ 14 xonali raqam!
3. Tug'ilgan sana (DOB):
   - Pasportdagi tug'ilgan sana (DD.MM.YYYY).
4. Pasport BERILGAN SANASI (Date of issue):
   - FAQAT Pasport yoki ID-karta berilgan sanasi (Date of issue: DD.MM.YYYY). Pasport/ID-kartada "Date of issue" yoki "Berilgan sanasi" deb yozilgan bo'ladi.
   - Hech qachon bo'sh qoldirma, agar sana ko'rinsa aniq DD.MM.YYYY formatda yoz.
5. Shahodatnoma yoki Diplom:
   - Hujjat turi: Maktab bo'lsa 'Shahodatnoma', Kollej/Litsey/Texnikum bo'lsa 'Diplom'
   - Seriya va raqami: Masalan 'UM 03729356' yoki 'T-V 123456'
   - Maktab/Muassasa nomi: Maktab yoki Kollejning to'liq nomi
   - Bitirgan yili: Masalan '2024'
6. Telefon raqami:
   - Agar biron joyda telefon raqami ko'rinsa, masalan +998901234567 formatida chiqargin.

Aniq JSON formatda qaytar:
{
  "ism": "Familiya Ism",
  "ota": "... qizi / ... o'g'li",
  "pass_ser": "AE1234567",
  "pinfl": "14 xonali PINFL",
  "dob": "DD.MM.YYYY",
  "pass_ber": "DD.MM.YYYY",
  "tel": "+998...",
  "sh_doc": "UM 1234567",
  "doc_tur": "Shahodatnoma",
  "maktab": "...-maktab",
  "yil": "2024"
}"""}]

        for b in blobs_raw:
            b64 = base64.b64encode(b).decode('utf-8')
            content_items.append({'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}})

        if blobs_raw:
            candidate_models = [model_to_use]
            for fb in AI_FALLBACK_MODELS:
                if fb not in candidate_models:
                    candidate_models.append(fb)

            ai_data = None
            for try_model in candidate_models:
                try:
                    ai_payload = {
                        'model': try_model,
                        'messages': [{'role': 'user', 'content': content_items}],
                        'temperature': 0.0
                    }
                    req = urllib.request.Request(
                        'https://openrouter.ai/api/v1/chat/completions',
                        data=json.dumps(ai_payload).encode('utf-8'),
                        headers={'Authorization': f'Bearer {OPENROUTER_API_KEY}', 'Content-Type': 'application/json'}
                    )
                    with urllib.request.urlopen(req, timeout=45) as resp:
                        res_json = json.loads(resp.read().decode('utf-8'))
                        raw = res_json['choices'][0]['message']['content'].strip()
                        raw = re.sub(r'^```json\s*', '', raw)
                        raw = re.sub(r'\s*```$', '', raw)
                        m_json = re.search(r'\{.*\}', raw, re.S)
                        if m_json:
                            raw = m_json.group(0)
                        ai_data = json.loads(raw)
                        if ai_data:
                            break
                except Exception as ai_err:
                    print(f"OpenRouter AI ({try_model}) xatosi: {ai_err}")

            if ai_data:
                # Agar QR dan olinmagan bo'lsa yoki bo'sh bo'lsa AI ma'lumotlarini qo'yish
                if not result.get('ism') and ai_data.get('ism'): result['ism'] = clean_uz_name(ai_data['ism'])
                if not result.get('ota') and ai_data.get('ota'): result['ota'] = clean_uz_name(ai_data['ota'])
                if not result.get('pass_val') and ai_data.get('pass_ser'): result['pass_val'] = ai_data['pass_ser']
                if not result.get('pinfl') and ai_data.get('pinfl'): result['pinfl'] = str(ai_data['pinfl'])
                if not result.get('dob') and ai_data.get('dob'): result['dob'] = ai_data['dob']
                
                ber_val = (
                    ai_data.get('pass_ber') or 
                    ai_data.get('ber_sana') or 
                    ai_data.get('berilgan') or 
                    ai_data.get('berilgan_sana') or 
                    ai_data.get('date_of_issue') or 
                    ai_data.get('issue_date')
                )
                if ber_val:
                    result['ber_sana'] = str(ber_val).strip()

                tel_val = ai_data.get('tel') or ai_data.get('telefon') or ai_data.get('phone')
                if tel_val and not result.get('tel'):
                    result['tel'] = str(tel_val).strip()

                if not result.get('cert_val') and ai_data.get('sh_doc'): result['cert_val'] = ai_data['sh_doc']
                if not result.get('cert_tur') and ai_data.get('doc_tur'): result['cert_tur'] = ai_data['doc_tur']
                if not result.get('maktab') and ai_data.get('maktab'): result['maktab'] = ai_data['maktab']
                if not result.get('yil') and ai_data.get('yil'): result['yil'] = str(ai_data['yil'])
                
                pv = result.get('pass_val', '')
                m_fix = re.search(r'([A-Z]{2})(\d{7})', pv)
                if m_fix:
                    result['pass_val'] = m_fix.group(1) + m_fix.group(2)

        # Agar ism hali ham topilmagan bo'lsa, fayl nomidan olamiz
        if not result.get('ism') and fallback_name:
            words = fallback_name.split()
            if len(words) >= 3 and words[-1].lower() in ('qizi', 'kizi', "o'g'li", 'ogli', 'ugli'):
                result['ism'] = clean_uz_name(" ".join(words[:-2]))
                if not result.get('ota'):
                    result['ota'] = clean_uz_name(" ".join(words[-2:]))
            else:
                result['ism'] = clean_uz_name(fallback_name)

        # Agar DOB bo'sh bo'lsa-yu PINFL 14 xonali bo'lsa, PINFL dan tug'ilgan sanani chiqaramiz
        pin_clean = re.sub(r'\D', '', str(result.get('pinfl', '')))
        if len(pin_clean) == 14:
            result['pinfl'] = pin_clean
            if not result.get('dob'):
                dd, mm, yy = int(pin_clean[1:3]), int(pin_clean[3:5]), int(pin_clean[5:7])
                cent = 1900 if int(pin_clean[0]) in (3, 4) else 2000
                if 1 <= dd <= 31 and 1 <= mm <= 12:
                    result['dob'] = f"{dd:02d}.{mm:02d}.{cent+yy}"
            
    except Exception as e:
        print(f"analyze_docx_content xatosi: {e}")
        if not result.get('ism') and fallback_name:
            result['ism'] = clean_uz_name(fallback_name)
        
    return result

def sync_to_webjurnal_bg(group_name, students_list):
    """
    Yangi kiritilgan talabani avtomatik tarzda tashqi Web Jurnal tizimiga yuborish.
    So'rov orqa fonda (daemon thread) yuboriladi, xatolik bo'lsa ham xizmat to'xtamaydi.
    """
    if not group_name or not students_list:
        return
    import threading
    def _worker():
        try:
            import json, urllib.request
            sync_url = os.environ.get('WEB_JURNAL_SYNC_URL', 'https://webjurnal.vercel.app/api/students/sync')
            api_key = os.environ.get('WEB_JURNAL_API_KEY', 'lCRKqFGks6_TjfkfDNCPsvi1lL60l6nYH3GCG7mibEA')
            clean_students = [str(s).strip() for s in students_list if str(s).strip()]
            if not clean_students:
                return
            payload = {
                "groupName": str(group_name).strip(),
                "students": clean_students
            }
            req = urllib.request.Request(
                sync_url,
                data=json.dumps(payload).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'x-api-key': api_key
                },
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                print(f"[WEB_JURNAL] ✅ Avtomatik sinxronlandi ({group_name}): {len(clean_students)} ta talaba")
        except Exception as e:
            print(f"[WEB_JURNAL] ⚠️ Sinxronlashda ogohlantirish ({group_name}): {e}")

    t = threading.Thread(target=_worker, daemon=True)
    t.start()

def save_manual_students(students_list):
    if not os.path.exists(EXCEL_PATH):
        return 0
    
    wb = openpyxl.load_workbook(EXCEL_PATH)
    ws = wb.active

    added = 0
    for st in students_list:
        ism = str(st.get('ism', '')).strip()
        if not ism:
            continue
        
        ota = str(st.get('ota', '')).strip()
        fish = f"{ism} {ota}".strip() if ota else ism
        shnum = normalize_shnum(st.get('shnum', ''))
        pass_val = str(st.get('pass_val', '')).strip().upper()
        pinfl = str(st.get('pinfl', '')).strip()
        dob = str(st.get('dob', '')).strip()
        
        if (not dob or dob == '-') and len(pinfl) == 14 and pinfl.isdigit():
            dd, mm, yy = int(pinfl[1:3]), int(pinfl[3:5]), int(pinfl[5:7])
            cent = 1900 if int(pinfl[0]) in (3, 4) else 2000
            dob = f"{dd:02d}.{mm:02d}.{cent+yy}"

        ber_sana = str(st.get('ber_sana', '')).strip()  # FAQAT pasport berilgan sanasi

        cert_val = str(st.get('cert_val', '')).strip()
        cert_tur = str(st.get('cert_tur', 'Shahodatnoma')).strip()
        cqr = str(st.get('cqr', '')).strip()
        maktab = str(st.get('maktab', '')).strip()
        yil = str(st.get('yil', '')).strip()
        yonalis = str(st.get('yonalis', 'Hamshiralik ishi - 3 yillik')).strip()
        tel = str(st.get('tel', '')).strip()
        group = str(st.get('group', '')).strip()

        # Excelda allaqachon mavjudligini tekshirish (takroriy kiritishning oldini olish)
        already_exists = False
        for r_chk in range(2, ws.max_row + 1):
            p_val = str(ws.cell(row=r_chk, column=11).value or '').replace(' ', '').strip()
            if pinfl and len(pinfl) == 14 and p_val == pinfl:
                already_exists = True
                break
            f_val = str(ws.cell(row=r_chk, column=8).value or '').strip().lower()
            g_val = str(ws.cell(row=r_chk, column=23).value or '').strip()
            if f_val == fish.lower() and g_val == (group or '26-02'):
                already_exists = True
                break
        if already_exists:
            continue

        nr = ws.max_row + 1
        ws.cell(row=nr, column=1, value=nr - 1)
        ws.cell(row=nr, column=2, value=ism)
        ws.cell(row=nr, column=3, value=yonalis)
        ws.cell(row=nr, column=4, value="To'lov qildi")
        ws.cell(row=nr, column=5, value=shnum)
        ws.cell(row=nr, column=6, value="")
        ws.cell(row=nr, column=7, value=ota)
        ws.cell(row=nr, column=8, value=fish)
        # 9-ustun "Passport bo'yicha F.I.SH" — FAQAT pasport rasmidan o'qilgan
        # ma'lumot turadi. Uni scripts/verify_passport_names.py boshqaradi.
        # To'liq F.I.SH 8-ustunda, shuning uchun bu yerda yozilmaydi.
        ws.cell(row=nr, column=10, value=pass_val)
        ws.cell(row=nr, column=11, value=pinfl)
        ws.cell(row=nr, column=12, value=ber_sana)  # Pasport BERILGAN SANASI (12-ustun)
        ws.cell(row=nr, column=13, value=dob)        # Tug'ilgan sana (13-ustun)
        ws.cell(row=nr, column=14, value="")         # Shahodatnoma bo'yicha F.I.SH
        ws.cell(row=nr, column=15, value=cert_val)
        ws.cell(row=nr, column=16, value=cqr)
        ws.cell(row=nr, column=17, value=maktab)
        ws.cell(row=nr, column=18, value="Umumiy o'rta maktab" if cert_tur == "Shahodatnoma" else "Kollej")

        ws.cell(row=nr, column=19, value=yil)
        ws.cell(row=nr, column=20, value=tel)
        ws.cell(row=nr, column=21, value="TOPILDI")
        ws.cell(row=nr, column=22, value="AI orqali tahlil qilinib qo'shildi")
        if group:
            ws.cell(row=nr, column=23, value=group)
        sync_students_json_atomic('add', {
            'row': nr, 'tr': nr - 1, 'ism': ism, 'ota': ota, 'fish': fish,
            'shnum': shnum, 'pv': pass_val, 'pinfl': pinfl, 'dob': dob, 'ber': ber_sana,
            'sh_doc': cert_val, 'doc_tur': cert_tur, 'mak': maktab, 'yil': yil,
            'yon': yonalis, 'tel': tel, 'group': group or '26-02', 'verified': 'TASDIQLANDI', 'baza': 'KIRITILDI'
        })
        sync_to_webjurnal_bg(group or '26-02', [fish])
        added += 1

    wb.save(EXCEL_PATH)
    schedule_git_push()
    trigger_report_rebuild()
def extract_doc_images_with_crop(target_path):
    import docx, xml.etree.ElementTree as ET
    from PIL import Image, ImageFile
    import io, base64, zipfile, struct, zlib
    ImageFile.LOAD_TRUNCATED_IMAGES = True

    images = []
    blobs_raw = []
    full_text = ""

    # 1. docx orqali ochish va crop parametrlarini olish
    try:
        d = docx.Document(target_path)
        p_texts = [p.text.strip() for p in d.paragraphs if p.text.strip()]
        for t in d.tables:
            for row in t.rows:
                for cell in row.cells:
                    if cell.text.strip(): p_texts.append(cell.text.strip())
        full_text = "\n".join(p_texts)

        root = ET.fromstring(d._element.xml)
        crops_by_rid = {}
        for el in root.iter():
            if el.tag.endswith('blipFill'):
                blip = None
                src_rect = None
                for child in el.iter():
                    if child.tag.endswith('blip'): blip = child
                    elif child.tag.endswith('srcRect'): src_rect = child
                
                embed_id = None
                if blip is not None:
                    for k, v in blip.attrib.items():
                        if k.endswith('embed'): embed_id = v
                
                crop = {}
                if src_rect is not None:
                    for k, v in src_rect.attrib.items():
                        try:
                            crop[k] = int(v) / 100000.0
                        except: pass
                if embed_id:
                    crops_by_rid[embed_id] = crop

        for rid, rel in d.part.rels.items():
            if 'image' in rel.target_ref:
                blob = rel.target_part.blob
                if len(blob) > 2000:
                    blobs_raw.append(blob) # Original rasm (QR kod uchun juda muhim!)
                    try:
                        im = Image.open(io.BytesIO(blob)).convert('RGB')
                        crop = crops_by_rid.get(rid, {})
                        w, h = im.size
                        left = int(w * crop.get('l', 0))
                        top = int(h * crop.get('t', 0))
                        right = int(w * (1.0 - crop.get('r', 0)))
                        bottom = int(h * (1.0 - crop.get('b', 0)))
                        
                        if right > left and bottom > top and (crop.get('l') or crop.get('t') or crop.get('r') or crop.get('b')):
                            cropped = im.crop((left, top, right, bottom))
                            buf = io.BytesIO()
                            cropped.save(buf, format='JPEG', quality=95)
                            final_bytes = buf.getvalue()
                        else:
                            buf = io.BytesIO()
                            im.save(buf, format='JPEG', quality=95)
                            final_bytes = buf.getvalue()
                            
                        b64 = base64.b64encode(final_bytes).decode('utf-8')
                        images.append(f"data:image/jpeg;base64,{b64}")
                    except Exception as e:
                        b64 = base64.b64encode(blob).decode('utf-8')
                        images.append(f"data:image/jpeg;base64,{b64}")
    except Exception as e:
        pass

    # 2. Agar rasm topilmagan bo'lsa (yoki docx buzilgan bo'lsa) -> Universal Local Header Scanner
    if len(blobs_raw) == 0:
        try:
            with open(target_path, 'rb') as f:
                data = f.read()
            pos = 0
            while True:
                idx = data.find(b'PK\x03\x04', pos)
                if idx == -1: break
                header = data[idx:idx+30]
                if len(header) < 30: break
                comp_method = struct.unpack('<H', header[8:10])[0]
                comp_size = struct.unpack('<I', header[18:22])[0]
                fname_len = struct.unpack('<H', header[26:28])[0]
                extra_len = struct.unpack('<H', header[28:30])[0]
                fname = data[idx+30:idx+30+fname_len].decode('utf-8', 'ignore')
                file_data_start = idx + 30 + fname_len + extra_len
                file_raw = data[file_data_start:file_data_start + comp_size]
                
                if 'media/' in fname and len(file_raw) > 2000:
                    try:
                        if comp_method == 8:
                            decomp = zlib.decompress(file_raw, -15)
                        else:
                            decomp = file_raw
                        im = Image.open(io.BytesIO(decomp)).convert('RGB')
                        buf = io.BytesIO()
                        im.save(buf, format='JPEG', quality=95)
                        final_bytes = buf.getvalue()
                        blobs_raw.append(final_bytes)
                        b64 = base64.b64encode(final_bytes).decode('utf-8')
                        images.append(f"data:image/jpeg;base64,{b64}")
                    except Exception as e2:
                        pass
                pos = idx + 4
        except Exception as e_scan:
            print(f"Universal scanner xatosi: {e_scan}")

    return images, blobs_raw, full_text

def extract_and_save_student_images(docx_path, folder_slug=None):
    """
    Word (.docx) faylidan rasmlarni ajratib oladi va uni
    files/extracted/<folder_slug>/ papkasiga saqlaydi.
    rasm_1.jpg, rasm_2.jpg, ... formatida yuqori sifatda yozadi.
    """
    if not folder_slug:
        base_name = os.path.splitext(os.path.basename(docx_path))[0]
        folder_slug = re.sub(r'[^a-zA-Z0-9_-]+', '_', base_name).strip('_')
        if not folder_slug:
            folder_slug = "student_extracted"

    extract_dir = os.path.join(FILES_DIR, 'extracted', folder_slug)
    os.makedirs(extract_dir, exist_ok=True)

    images, blobs_raw, full_text = extract_doc_images_with_crop(docx_path)

    saved_urls = []
    for idx, b in enumerate(blobs_raw, start=1):
        try:
            img_filename = f"rasm_{idx}.jpg"
            img_path = os.path.join(extract_dir, img_filename)
            
            if idx <= len(images) and images[idx-1].startswith('data:image'):
                b64_part = images[idx-1].split(',')[1]
                raw_bytes = base64.b64decode(b64_part)
                with open(img_path, 'wb') as img_f:
                    img_f.write(raw_bytes)
            else:
                im = Image.open(io.BytesIO(b)).convert('RGB')
                im.save(img_path, format='JPEG', quality=95)
            
            saved_urls.append(f"/files/extracted/{folder_slug}/{img_filename}")
        except Exception as e_save:
            print(f"Rasm saqlash xatosi ({folder_slug}/{idx}): {e_save}")

    return images, blobs_raw, full_text, saved_urls

def apply_full_excel_styling(wb, ws):
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    ws.views.sheetView[0].showGridLines = True
    ws.freeze_panes = 'C2'  # A va B ustunlar (T/R va Guruh) muzlatiladi

    thin_gray = Side(style='thin', color='CBD5E1')
    header_side = Side(style='medium', color='0F172A')
    cell_border = Border(left=thin_gray, right=thin_gray, top=thin_gray, bottom=thin_gray)
    header_border = Border(left=thin_gray, right=thin_gray, top=header_side, bottom=header_side)

    header_bg = '991B1B' if (getattr(ws, 'title', '') == 'Safdan chiqarilganlar') else '1E3A8A'
    header_fill = PatternFill(start_color=header_bg, end_color=header_bg, fill_type='solid')
    header_font = Font(name='Segoe UI', size=10.5, bold=True, color='FFFFFF')

    row_fill_white = PatternFill(start_color='FFFFFF', end_color='FFFFFF', fill_type='solid')
    row_fill_zebra = PatternFill(start_color='F8FAFC', end_color='F8FAFC', fill_type='solid')

    fill_topildi = PatternFill(start_color='DCFCE7', end_color='DCFCE7', fill_type='solid')
    font_topildi = Font(name='Segoe UI', size=10, bold=True, color='15803D')

    fill_chala = PatternFill(start_color='FEF3C7', end_color='FEF3C7', fill_type='solid')
    font_chala = Font(name='Segoe UI', size=10, bold=True, color='B45309')

    fill_yoq = PatternFill(start_color='FEE2E2', end_color='FEE2E2', fill_type='solid')
    font_yoq = Font(name='Segoe UI', size=10, bold=True, color='B91C1C')

    fill_mos = PatternFill(start_color='DCFCE7', end_color='DCFCE7', fill_type='solid')
    font_mos = Font(name='Segoe UI', size=9.5, color='166534')

    fill_translit = PatternFill(start_color='DBEAFE', end_color='DBEAFE', fill_type='solid')
    font_translit = Font(name='Segoe UI', size=9.5, color='1E40AF')

    fill_farq = PatternFill(start_color='FEE2E2', end_color='FEE2E2', fill_type='solid')
    font_farq = Font(name='Segoe UI', size=9.5, color='991B1B')

    fill_tekshir = PatternFill(start_color='F1F5F9', end_color='F1F5F9', fill_type='solid')
    font_tekshir = Font(name='Segoe UI', size=9.5, color='64748B')

    regular_font = Font(name='Segoe UI', size=10, color='1E293B')
    bold_font = Font(name='Segoe UI', size=10, bold=True, color='0F172A')

    ws.row_dimensions[1].height = 28
    for col_idx in range(1, ws.max_column + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.border = header_border
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=False)

    center_cols = {1, 2, 5, 6, 7, 10, 11, 12, 13, 14, 16, 19, 20, 21, 23, 24}

    for r in range(2, ws.max_row + 1):
        ws.row_dimensions[r].height = 22
        base_fill = row_fill_zebra if r % 2 == 1 else row_fill_white
        status_val = str(ws.cell(row=r, column=21).value or '').strip().upper()
        match_val = str(ws.cell(row=r, column=23).value or '').strip().upper()

        for c in range(1, ws.max_column + 1):
            cell = ws.cell(row=r, column=c)
            cell.border = cell_border
            is_center = c in center_cols
            cell.alignment = Alignment(horizontal='center' if is_center else 'left', vertical='center')
            cell.font = bold_font if c in [1, 2, 3, 9, 11, 16, 24] else regular_font
            cell.fill = base_fill

            if c == 21:
                if 'TOPILDI' in status_val:
                    cell.fill = fill_topildi
                    cell.font = font_topildi
                elif 'CHALA' in status_val:
                    cell.fill = fill_chala
                    cell.font = font_chala
                elif 'YOQ' in status_val:
                    cell.fill = fill_yoq
                    cell.font = font_yoq
            elif c == 23:
                if 'BOSHQA' in match_val or 'FARQ' in match_val:
                    cell.fill = fill_farq
                    cell.font = font_farq
                elif 'TRANSLIT' in match_val:
                    cell.fill = fill_translit
                    cell.font = font_translit
                elif 'MOS' in match_val:
                    cell.fill = fill_mos
                    cell.font = font_mos
                else:
                    cell.fill = fill_tekshir
                    cell.font = font_tekshir
            elif c == 24:
                verify_val = str(cell.value or '').strip().upper()
                if 'TASDIQ' in verify_val:
                    cell.fill = fill_topildi
                    cell.font = font_topildi
                else:
                    cell.fill = fill_chala
                    cell.font = font_chala

    col_widths = {
        1: 6, 2: 13, 3: 28, 4: 26, 5: 15, 6: 16, 7: 13, 8: 24,
        9: 32, 10: 28, 11: 18, 12: 18, 13: 15, 14: 15, 15: 32, 16: 18, 17: 35,
        18: 35, 19: 20, 20: 13, 21: 16, 22: 40, 23: 28, 24: 20
    }
    for col_idx, width in col_widths.items():
        if col_idx <= ws.max_column:
            ws.column_dimensions[get_column_letter(col_idx)].width = width

    ws.auto_filter.ref = f"A1:{get_column_letter(ws.max_column)}{ws.max_row}"

# TUG'ILGAN TUMANNI JSHSHIR DAN ANIQLASH
# JSHSHIR ning 8-10 raqamlari tug'ilgan joyni bildiradi. Jadval talabalarning
# haqiqiy pasportlaridagi "TUG'ILGAN JOYI" yozuvi bilan tekshirilgan:
#   559 Xurramova (SHAXRISABZ TUMANI), 568 Narziyeva (KITOB TUMANI),
#   573 Eshquvatova (YAKKABOG' TUMANI), 789 Aliqulova (SHAHRISABZ SHAHRI),
#   256 Miliyeva (SHAXRISABZ TUMANI, eski format).
# 572 va 563 faqat shahodatnomadagi "berilgan joyi" bo'yicha taxminiy.
# Qolgan kodlar (274, 565, 264, 574) aniqlanmagan - bo'sh qoladi.
TUGILGAN_TUMAN_KODI = {
    '559': "Shahrisabz tumani",
    '568': "Kitob tumani",
    '573': "Yakkabog' tumani",
    '789': "Shahrisabz shahri",
    '256': "Shahrisabz tumani",
    '572': "Chiroqchi tumani",
    '563': "Qamashi tumani",
}


def tugilgan_tuman(pinfl):
    """JSHSHIR dan tug'ilgan tumanni qaytaradi. Aniqlanmasa bo'sh satr."""
    p = str(pinfl or '').replace(' ', '').strip()
    if len(p) != 14 or not p.isdigit():
        return ''
    return TUGILGAN_TUMAN_KODI.get(p[7:10], '')


def build_full_multisheet_excel(source_ws, filter_status=None):
    import openpyxl
    out_wb = openpyxl.Workbook()
    default_sheet = out_wb.active

    meta_dyn = load_groups_metadata()
    GROUPS_CONFIG = [("Jami", None)]
    for g_code in sorted(meta_dyn.keys(), key=lambda x: (get_kurs_of_group(x, meta_dyn), x)):
        g_ldr = meta_dyn[g_code].get('rahbar', '—')
        GROUPS_CONFIG.append((f"{g_code} ({g_ldr})", g_code))
    GROUPS_CONFIG.append(("Safdan chiqarilganlar", "WITHDRAWN"))

    NEW_HEADERS = [
        "T/R",
        "Guruh",
        "I.F.O",
        "To'lov statusi",
        "Shartnoma raqami",
        "Sanasi",
        "Otasining ismi (Sharifi)",
        "To'liq F.I.SH",
        "Passport bo'yicha F.I.SH",
        "Passport / ID-karta (Seriya va raqam)",
        "JSHSHIR (PINFL)",
        "Berilgan sanasi",
        "Tug'ilgan sanasi",
        "Tug'ilgan tumani",
        "Shahodatnoma bo'yicha F.I.SH",
        "Shahodatnoma / Diplom Seriyasi",
        "Shahodatnoma QR Havolasi (e-shahodatnoma.uz)",
        "Tugatgan o'qish joyi",
        "Ta'lim muassasasi turi",
        "Bitirgan yili",
        "Qidiruv holati (Status)",
        "Izoh va Eslatmalar (Notes)",
        "Ism mosligi (Pasport / Shahodatnoma)",
        "Operator Tasdig'i"
    ]

    # Barcha talabalar qatorlarini yig'ish (bo'sh qatorlar filtrlanadi)
    all_rows = []
    for r in range(2, source_ws.max_row + 1):
        vals = [source_ws.cell(row=r, column=c).value for c in range(1, source_ws.max_column + 1)]
        if not vals[1] and not vals[4]:
            continue
        while len(vals) < 25:
            vals.append("")
        if not vals[24]:
            vals[24] = "KUTILMOQDA"
        all_rows.append(vals)

    for sheet_title, grp_filter in GROUPS_CONFIG:
        ws = out_wb.create_sheet(title=sheet_title)
        ws.append(NEW_HEADERS)

        def norm_row_name(r):
            s = str(r[7] or r[1] or '').strip().lower()
            for ch in ["'", "`", "‘", "’", "ʻ", "ʼ", "´", "-", "_", "."]:
                s = s.replace(ch, "")
            return s

        # Qatorlarni saralash va filtrlash
        if grp_filter == "WITHDRAWN":
            # Safdan chiqarilganlar: maxsus guruh (alifbo A-Z)
            sheet_rows = [r for r in all_rows if str(r[22] or '').strip() in ["Talabalar safidan chiqarilganlar", "Safdan chiqarilganlar", "N", "n"] or "chiqaril" in str(r[22] or '').strip().lower()]
            sheet_rows.sort(key=lambda x: norm_row_name(x))
        elif grp_filter:
            # Faqat shu guruh talabalari, I.F.O bo'yicha alifbo (A-Z) tartibida
            sheet_rows = [r for r in all_rows if str(r[22] or '').strip() == grp_filter]
            sheet_rows.sort(key=lambda x: norm_row_name(x))
        else:
            # Jami sahifasi: 1- I.F.O (alifbo A-Z bo'yicha), 2- Guruh tartibida
            sheet_rows = list(all_rows)
            sheet_rows.sort(key=lambda x: (norm_row_name(x), str(x[22] or '').strip().lower()))

        out_tr = 1
        for row_vals in sheet_rows:
            stat_val = str(row_vals[20] or '').strip().upper()
            if filter_status and filter_status not in ['ALL', 'BARCHASI', '']:
                if filter_status in ['TOPILDI', 'FULL'] and 'TOPILDI' not in stat_val: continue
                if filter_status in ['CHALA'] and 'CHALA' not in stat_val: continue
                if filter_status in ['YOQ', 'FAYL_YOQ', 'TOPILMADI'] and ('FAYL_YOQ' not in stat_val and 'YOQ' not in stat_val): continue

            # 23 ustunli yangi qator. Chiqarib tashlanganlar: Telefon raqami
            # (manba 20-ustun) va Yo'nalishi (manba 3-ustun). Guruh 2-ustunda.
            new_row = [
                out_tr,                                         # 1: T/R
                str(row_vals[22] or '').strip(),                # 2: Guruh (Boshida, filterlash uchun)
                row_vals[1] or '',                              # 3: I.F.O
                row_vals[3] or '',                              # 4: To'lov statusi
                row_vals[4] or '',                              # 6: Shartnoma raqami
                row_vals[5] or '',                              # 7: Sanasi
                row_vals[6] or '',                              # 8: Otasining ismi
                row_vals[7] or '',                              # 9: To'liq F.I.SH
                row_vals[8] or '',                              # 10: Passport bo'yicha F.I.SH
                row_vals[9] or '',                              # 11: Passport / ID-karta
                row_vals[10] or '',                             # 12: JSHSHIR (PINFL)
                row_vals[11] or '',                             # 13: Berilgan sanasi
                row_vals[12] or '',                             # 14: Tug'ilgan sanasi
                tugilgan_tuman(row_vals[10]),                   # 15: Tug'ilgan tumani (JSHSHIR dan)
                row_vals[13] or '',                             # 15: Shahodatnoma bo'yicha F.I.SH
                row_vals[14] or '',                             # 16: Shahodatnoma / Diplom Seriyasi
                row_vals[15] or '',                             # 17: Shahodatnoma QR Havolasi
                row_vals[16] or '',                             # 18: Tugatgan o'qish joyi
                row_vals[17] or '',                             # 19: Ta'lim muassasasi turi
                row_vals[18] or '',                             # 20: Bitirgan yili
                row_vals[20] or '',                             # 21: Qidiruv holati (Status)
                row_vals[21] or '',                             # 22: Izoh va Eslatmalar
                row_vals[23] or '',                             # 23: Ism mosligi
                row_vals[24] or 'KUTILMOQDA'                    # 24: Operator Tasdig'i
            ]
            ws.append(new_row)
            out_tr += 1

        apply_full_excel_styling(out_wb, ws)

    if default_sheet in out_wb.worksheets:
        out_wb.remove(default_sheet)

    if "Jami" in out_wb.sheetnames:
        out_wb.active = out_wb["Jami"]

    return out_wb

class WebServerHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, *')
        self.end_headers()

    def do_GET(self):
        parsed_path = unquote(self.path.split('?')[0])

        if parsed_path == '/api/mytest-roster':
            auth_header = self.headers.get('Authorization', '')
            token = auth_header.replace('Bearer ', '').replace('bearer ', '').strip()
            expected_token = os.environ.get('MYTEST_ROSTER_TOKEN', 'WUjxvY_j1-5kFsS3C7QnyaiWWBpsuL8hrzdK6QTuXDI')
            if not token or token != expected_token:
                self.send_response(401)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Kalit noto'g'ri"}).encode('utf-8'))
                return

            try:
                st_path = os.path.join(BASE_DIR, 'data', 'students.json')
                students = []
                if os.path.exists(st_path):
                    with open(st_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        students = data if isinstance(data, list) else data.get('students', [])

                inactive_re = re.compile(r"chiqarilgan|ta'til|taʼtil|ta’til", re.I)
                res_list = []
                for s in students:
                    grp = str(s.get('group', '')).strip()
                    if not grp or inactive_re.search(grp):
                        continue
                    fio = clean_uz_name(s.get('fish') or f"{s.get('ism', '')} {s.get('ota', '')}".strip())
                    if not fio:
                        continue
                    res_list.append({"name": fio, "group": grp})

                res_list.sort(key=lambda x: (x['group'], x['name']))
                groups = sorted(list(set(x['group'] for x in res_list)))

                resp_data = {
                    "students": res_list,
                    "groups": groups,
                    "count": len(res_list),
                    "source": "local",
                    "updatedAt": time.strftime('%Y-%m-%dT%H:%M:%S')
                }
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(json.dumps(resp_data, ensure_ascii=False).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                return

        if parsed_path in ('/kontingent_variantlari.html', '/variantlar', '/kontingent_variantlari'):
            v_html = os.path.join(BASE_DIR, 'eski_portal', 'kontingent_variantlari.html')
            if os.path.exists(v_html):
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                with open(v_html, 'rb') as f:
                    self.wfile.write(f.read())
                return

        if parsed_path in ('/', '/index.html', '/hisobot.html', '/natijalar_hisoboti.html', '/qayta_tekshiruv/hisobot.html'):
            target_html = None
            for candidate in [
                os.path.join(BASE_DIR, 'eski_portal', 'index.html'),
                os.path.join(BASE_DIR, 'eski_portal', 'hisobot.html'),
                os.path.join(BASE_DIR, 'qayta_tekshiruv', 'hisobot.html')
            ]:
                if os.path.exists(candidate):
                    target_html = candidate
                    break
            if target_html:
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                with open(target_html, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self.send_error(404, "Hisobot sahifasi topilmadi. Avval hisobotni yarating.")
            return

        if parsed_path in ('/Talabalar_Yangilangan_Royxat.xlsx', '/Talabalar_Toliq_Royxati.xlsx'):
            ex_file = os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx')
            if not os.path.exists(ex_file):
                ex_file = os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx')
            if os.path.exists(ex_file):
                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                self.send_header('Content-Disposition', f'attachment; filename="{os.path.basename(ex_file)}"')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                with open(ex_file, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self.send_error(404, "Excel topilmadi")
            return

        if parsed_path.startswith('/api/git_sync_status'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.end_headers()
            with GIT_PUSH_LOCK:
                st = dict(GIT_SYNC_STATUS)
            # "Saqlash" tugmasi holatini ko'rsatish uchun: hali yuborilmagan
            # o'zgarish bormi va u qancha vaqtdan beri kutyapti
            st['pending'] = has_pending_changes()
            st['pending_seconds'] = round(time.time() - PENDING_SINCE) if PENDING_SINCE else 0
            self.wfile.write(json.dumps(st).encode('utf-8'))
            return

        # Qo'lda zahira olish (kunlik 18:00 dan tashqari)
        if parsed_path.startswith('/api/send_backup'):
            ok = send_backup_to_telegram("qo'lda")
            if ok:
                _mark_backup_sent()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": ok,
                "message": "Zahira Telegram'ga yuborildi" if ok
                           else "Zahira yuborilmadi (sozlamani tekshiring)"
            }).encode('utf-8'))
            return

        # Guruhlar ro'yxatini Telegram'ga yuborish
        if parsed_path.startswith('/api/send_groups_to_telegram'):
            import urllib.parse as urlparse
            query = {}
            if '?' in self.path:
                query = urlparse.parse_qs(self.path.split('?', 1)[1])
            target = query.get('target', ['channel'])[0]
            group_filter = query.get('group', ['ALL'])[0]
            res = send_group_lists_to_telegram(target=target, group_filter=group_filter)
            self.send_response(200 if res.get('ok') else 500)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))
            return

        # "GitHub'ga yuborish" tugmasi — kutayotgan o'zgarishlarni darhol yuborish
        if parsed_path.startswith('/api/flush_to_git'):
            had = has_pending_changes()
            flush_to_git_now()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "had_pending": had,
                "message": "GitHub'ga yuborilmoqda..." if had else "Yuboriladigan o'zgarish yo'q edi"
            }).encode('utf-8'))
            return

        if parsed_path.startswith('/api/doc_preview'):
            query = self.path.split('?')[-1] if '?' in self.path else ''
            params = dict(qc.split('=') for qc in query.split('&') if '=' in qc)
            fname = unquote(params.get('file', '')).strip()
            
            target_path = os.path.join(FILES_DIR, fname)
            if not os.path.exists(target_path):
                # Aniq faylni topish
                for f in os.listdir(FILES_DIR):
                    if f.lower() == fname.lower():
                        target_path = os.path.join(FILES_DIR, f)
                        break
            if os.path.exists(target_path) and os.path.isfile(target_path):
                try:
                    base_name = os.path.splitext(os.path.basename(target_path))[0]
                    folder_slug = re.sub(r'[^a-zA-Z0-9_-]+', '_', base_name).strip('_')
                    extract_dir = os.path.join(FILES_DIR, 'extracted', folder_slug)

                    images = []
                    doc_text = ""
                    # Agar avval ajratilgan papka mavjud bo'lsa va unda rasmlar bo'lsa
                    if os.path.exists(extract_dir):
                        existing_imgs = sorted([f for f in os.listdir(extract_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
                        if existing_imgs:
                            for img_f in existing_imgs:
                                img_p = os.path.join(extract_dir, img_f)
                                with open(img_p, 'rb') as f_im:
                                    b64 = base64.b64encode(f_im.read()).decode('utf-8')
                                    images.append(f"data:image/jpeg;base64,{b64}")

                    # Agar papka bo'lmasa yoki rasm topilmasa, Word faylidan ajratib saqlaymiz
                    if not images:
                        images, _, doc_text, _ = extract_and_save_student_images(target_path, folder_slug)

                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "success": True,
                        "filename": os.path.basename(target_path),
                        "filepath": os.path.abspath(target_path),
                        "extracted_folder": f"files/extracted/{folder_slug}",
                        "text": doc_text,
                        "images": images
                    }).encode('utf-8'))
                    return
                except Exception as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                    return
            else:
                self.send_response(404)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": f"Fayl topilmadi: {fname}"}).encode('utf-8'))
                return

        if parsed_path.startswith('/api/get_clipboard_files'):
            try:
                from PIL import ImageGrab
                clip = ImageGrab.grabclipboard()
                out_files = []
                if isinstance(clip, Image.Image):
                    buf = io.BytesIO()
                    clip.convert('RGB').save(buf, format='JPEG', quality=95)
                    b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
                    out_files.append({
                        "filename": f"bufer_rasm_{int(time.time())}.jpg",
                        "base64": f"data:image/jpeg;base64,{b64}",
                        "mime": "image/jpeg"
                    })
                elif isinstance(clip, list):
                    for fpath in clip[:2]:
                        if os.path.isfile(fpath):
                            ext = os.path.splitext(fpath)[1].lower()
                            if ext in ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.pdf', '.docx']:
                                with open(fpath, 'rb') as rf:
                                    raw_b = rf.read()
                                b64 = base64.b64encode(raw_b).decode('utf-8')
                                mime = 'application/pdf' if ext == '.pdf' else ('application/vnd.openxmlformats-officedocument.wordprocessingml.document' if ext == '.docx' else 'image/jpeg')
                                out_files.append({
                                    "filename": os.path.basename(fpath),
                                    "base64": f"data:{mime};base64,{b64}",
                                    "mime": mime
                                })
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                if out_files:
                    self.wfile.write(json.dumps({"success": True, "files": out_files}).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({"success": False, "error": "Buferda (Ctrl+C) rasm yoki fayl topilmadi. Avval rasm yoki faylni Ctrl+C qilib nusxalang!"}).encode('utf-8'))
                return
            except Exception as e_clip:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e_clip)}).encode('utf-8'))
                return

        if parsed_path.startswith('/api/reanalyze_student'):
            query = self.path.split('?')[-1] if '?' in self.path else ''
            params = dict(qc.split('=') for qc in query.split('&') if '=' in qc)
            fname = unquote(params.get('file', '')).strip()
            row_idx = int(params.get('row', '0'))
            
            target_path = os.path.join(FILES_DIR, fname)
            if not os.path.exists(target_path):
                for f in os.listdir(FILES_DIR):
                    if f.lower() == fname.lower():
                        target_path = os.path.join(FILES_DIR, f)
                        break

            if not os.path.exists(target_path) or not os.path.isfile(target_path):
                self.send_response(404)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Fayl topilmadi"}).encode('utf-8'))
                return

            try:
                # urllib.request fayl boshida import qilingan. Bu yerda "import urllib.request"
                # yozilsa, urllib butun do_GET uchun mahalliy nomga aylanib, boshqa tarmoqlar
                # (export_role_excel, send_role_excel_to_telegram) UnboundLocalError bilan yiqiladi.
                import openpyxl
                _, image_blobs, _ = extract_doc_images_with_crop(target_path)

                if not image_blobs:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "Faylda rasm topilmadi"}).encode('utf-8'))
                    return

                # 1-QADAM: AVVAL QR KODLARNI TEKSHIRISH (100% RASMIY VA ANIQ!)
                qr_extracted = scan_all_qrs(image_blobs)
                print(f"reanalyze_student QR natijasi: {qr_extracted}")

                req_model = unquote(params.get('model', DEFAULT_AI_MODEL)).strip()
                primary_model = SUPPORTED_AI_MODELS.get(req_model, req_model if '/' in req_model else DEFAULT_AI_MODEL)
                models_to_try = [primary_model]
                for fb_m in AI_FALLBACK_MODELS:
                    if fb_m not in models_to_try:
                        models_to_try.append(fb_m)
                print(f"reanalyze_student tanlangan model: {req_model} -> {primary_model}")

                content_items = [{"type": "text", "text": """Sen professional O'zbekiston ID-karta, Biometrik pasport va Shahodatnoma/Diplom o'quvchisisan.
Ushbu rasmlarni juda sinchiklab tahlil qil va talabaning haqiqiy ma'lumotlarini chiqargin.

Qat'iy Qoidalar:
1. Pasport/ID seriya va raqami:
   - ID-karta: 'AD' yoki 'AE' harflari va KETMA-KET ANIQ 7 TA RAQAM (jami 9 ta belgi!). Masalan: AD1234567, AE4629898.
   - Biometrik pasport: 'AA', 'AB', 'AC', 'FA' va 7 ta raqam.
   - Hech qachon 8 ta yoki 6 ta raqam yozma!
2. JSHSHIR (PINFL):
   - ID-karta yoki pasport pastidagi/orqasidagi ANIQ 14 xonali raqam!
3. Tug'ilgan sana (DOB):
   - Pasportdagi tug'ilgan sana (DD.MM.YYYY).
4. Pasport BERILGAN SANASI (Date of issue):
   - FAQAT Pasport yoki ID-karta berilgan sanasi (Date of issue: DD.MM.YYYY).
   - Shahodatnoma sanasini yoki kelajak sanani EMAS!
5. Shahodatnoma yoki Diplom:
   - Hujjat turi: Maktab bo'lsa 'Shahodatnoma', Kollej/Litsey/Texnikum bo'lsa 'Diplom'
   - Seriya va raqami: Masalan 'UM 03729356' yoki 'T-V 123456'
   - Maktab/Muassasa nomi: Maktab yoki Kollejning to'liq nomi
   - Bitirgan yili: Masalan '2024'

Aniq JSON formatda qaytar:
{
  "ism": "Familiya Ism",
  "ota": "... qizi yoki ... o'g'li",
  "pass_ser": "AE1234567",
  "pinfl": "14 xonali PINFL",
  "dob": "DD.MM.YYYY",
  "pass_ber": "DD.MM.YYYY",
  "sh_doc": "UM 1234567",
  "doc_tur": "Shahodatnoma",
  "maktab": "...-maktab",
  "yil": "2024"
}"""}]

                for b in image_blobs:
                    b64 = base64.b64encode(b).decode('utf-8')
                    content_items.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})

                parsed_ai = {}
                used_model_actual = primary_model
                for try_m in models_to_try:
                    try:
                        ai_payload = {
                            "model": try_m,
                            "messages": [{"role": "user", "content": content_items}],
                            "temperature": 0.0
                        }
                        req = urllib.request.Request(
                            "https://openrouter.ai/api/v1/chat/completions",
                            data=json.dumps(ai_payload).encode('utf-8'),
                            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"}
                        )
                        with urllib.request.urlopen(req, timeout=45) as resp:
                            res_data = json.loads(resp.read().decode('utf-8'))
                            raw_txt = res_data['choices'][0]['message']['content'].strip()
                            raw_txt = re.sub(r'^```json\s*', '', raw_txt)
                            raw_txt = re.sub(r'\s*```$', '', raw_txt)
                            m_json = re.search(r'\{[\s\S]*\}', raw_txt)
                            if m_json:
                                raw_txt = m_json.group(0)
                            parsed_ai = json.loads(raw_txt)
                            if parsed_ai:
                                used_model_actual = try_m
                                break
                    except Exception as e_try:
                        print(f"reanalyze_student [{try_m}] xato: {e_try}")
                        continue

                # QR kod ma'lumotlarini birlashtirish (QR ustuvor!)
                if qr_extracted:
                    if qr_extracted.get('ism'): parsed_ai['ism'] = clean_uz_name(qr_extracted['ism'])
                    if qr_extracted.get('ota'): parsed_ai['ota'] = clean_uz_name(qr_extracted['ota'])
                    if qr_extracted.get('pass_val'): parsed_ai['pass_ser'] = qr_extracted['pass_val']
                    if qr_extracted.get('pinfl'): parsed_ai['pinfl'] = qr_extracted['pinfl']
                    if qr_extracted.get('dob'): parsed_ai['dob'] = qr_extracted['dob']
                    if qr_extracted.get('cert_val'): parsed_ai['sh_doc'] = qr_extracted['cert_val']
                    if qr_extracted.get('cert_tur'): parsed_ai['doc_tur'] = qr_extracted['cert_tur']
                    if qr_extracted.get('maktab'): parsed_ai['maktab'] = qr_extracted['maktab']
                    if qr_extracted.get('yil'): parsed_ai['yil'] = qr_extracted['yil']
                    if qr_extracted.get('sh_qr'): parsed_ai['sh_qr'] = qr_extracted['sh_qr']

                # Pasport seriya 7 raqam bo'lishini to'g'rilash
                if parsed_ai.get('pass_ser'):
                    m_fix = re.search(r'([A-Z]{2})(\d{7})', parsed_ai['pass_ser'])
                    if m_fix:
                        parsed_ai['pass_ser'] = m_fix.group(1) + m_fix.group(2)

                # Excelga saqlash
                if row_idx >= 2:
                    wb = openpyxl.load_workbook(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                    ws = wb.active
                    # ASL RO'YXAT HIMOYASI: 2 va 7-ustun foydalanuvchining o'z
                    # ro'yxati. AI ularni O'ZGARTIRMAYDI — faqat BO'SH bo'lsa to'ldiradi.
                    # (AI o'qigan ism 9-ustunda ko'rinadi.)
                    if parsed_ai.get('ism') and not str(ws.cell(row=row_idx, column=2).value or '').strip():
                        ws.cell(row=row_idx, column=2, value=clean_uz_name(parsed_ai['ism']))
                    if parsed_ai.get('ota') and not str(ws.cell(row=row_idx, column=7).value or '').strip():
                        ws.cell(row=row_idx, column=7, value=clean_uz_name(parsed_ai['ota']))
                    
                    cur_ism = clean_uz_name(parsed_ai.get('ism', '')) or str(ws.cell(row=row_idx, column=2).value or '')
                    cur_ota = clean_uz_name(parsed_ai.get('ota', '')) or str(ws.cell(row=row_idx, column=7).value or '')
                    ws.cell(row=row_idx, column=8, value=f"{cur_ism} {cur_ota}".strip())
                    # 9-ustun (Passport bo'yicha F.I.SH) — bu yerda yozilmaydi,
                    # uni scripts/verify_passport_names.py boshqaradi.

                    if parsed_ai.get('pass_ser'): ws.cell(row=row_idx, column=10, value=parsed_ai['pass_ser'])
                    if parsed_ai.get('pinfl'): ws.cell(row=row_idx, column=11, value=str(parsed_ai['pinfl']))
                    if parsed_ai.get('pass_ber'): ws.cell(row=row_idx, column=12, value=parsed_ai['pass_ber'])
                    if parsed_ai.get('dob'): ws.cell(row=row_idx, column=13, value=parsed_ai['dob'])
                    ws.cell(row=row_idx, column=14, value="Mavjud")
                    if parsed_ai.get('sh_doc'): ws.cell(row=row_idx, column=15, value=parsed_ai['sh_doc'])
                    if parsed_ai.get('sh_qr'): ws.cell(row=row_idx, column=16, value=parsed_ai['sh_qr'])
                    if parsed_ai.get('maktab'): ws.cell(row=row_idx, column=17, value=parsed_ai['maktab'])
                    if parsed_ai.get('doc_tur'): ws.cell(row=row_idx, column=18, value=parsed_ai['doc_tur'])
                    if parsed_ai.get('yil'): ws.cell(row=row_idx, column=19, value=str(parsed_ai['yil']))
                    
                    wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                    wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx'))

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "filename": os.path.basename(target_path),
                    "filepath": os.path.abspath(target_path),
                    "data": parsed_ai
                }).encode('utf-8'))
                return

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                return

        # ========================================================
        # 1. FAQAT QR-KOD BO'YICHA 100% RASMIY SKAN QILISH ENDPOINTI
        # ========================================================
        if parsed_path.startswith('/api/scan_student_qr'):
            query = self.path.split('?')[-1] if '?' in self.path else ''
            params = dict(qc.split('=') for qc in query.split('&') if '=' in qc)
            fname = unquote(params.get('file', '')).strip()
            row_idx = int(params.get('row', '0'))
            
            target_path = os.path.join(FILES_DIR, fname)
            if not os.path.exists(target_path):
                for f in os.listdir(FILES_DIR):
                    if f.lower() == fname.lower():
                        target_path = os.path.join(FILES_DIR, f)
                        break

            if not os.path.exists(target_path) or not os.path.isfile(target_path):
                self.send_response(404)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Fayl topilmadi"}).encode('utf-8'))
                return

            try:
                import openpyxl
                _, image_blobs, _ = extract_doc_images_with_crop(target_path)
                if not image_blobs:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "Faylda rasm topilmadi"}).encode('utf-8'))
                    return

                # Barcha rasmlarni 4 burchakda skan qilamiz
                qr_res = scan_all_qrs(image_blobs)
                print(f"scan_student_qr natijasi: {qr_res}")

                if not qr_res:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "Rasmlarda QR-kod yoki MRZ topilmadi"}).encode('utf-8'))
                    return

                # Excelga saqlash
                if row_idx >= 2:
                    wb = openpyxl.load_workbook(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                    ws = wb.active
                    # ASL RO'YXAT HIMOYASI — faqat bo'sh bo'lsa to'ldiriladi
                    if qr_res.get('ism') and not str(ws.cell(row=row_idx, column=2).value or '').strip():
                        ws.cell(row=row_idx, column=2, value=clean_uz_name(qr_res['ism']))
                    if qr_res.get('ota') and not str(ws.cell(row=row_idx, column=7).value or '').strip():
                        ws.cell(row=row_idx, column=7, value=clean_uz_name(qr_res['ota']))
                    cur_ism = clean_uz_name(qr_res.get('ism', '')) or str(ws.cell(row=row_idx, column=2).value or '')
                    cur_ota = clean_uz_name(qr_res.get('ota', '')) or str(ws.cell(row=row_idx, column=7).value or '')
                    ws.cell(row=row_idx, column=8, value=f"{cur_ism} {cur_ota}".strip())
                    # 9-ustun (Passport bo'yicha F.I.SH) — bu yerda yozilmaydi,
                    # uni scripts/verify_passport_names.py boshqaradi.
                    if qr_res.get('pass_val'): ws.cell(row=row_idx, column=10, value=qr_res['pass_val'])
                    if qr_res.get('pinfl'): ws.cell(row=row_idx, column=11, value=str(qr_res['pinfl']))
                    if qr_res.get('dob'): ws.cell(row=row_idx, column=13, value=qr_res['dob'])
                    ws.cell(row=row_idx, column=14, value="Mavjud")
                    if qr_res.get('cert_val'): ws.cell(row=row_idx, column=15, value=qr_res['cert_val'])
                    if qr_res.get('sh_qr'): ws.cell(row=row_idx, column=16, value=qr_res['sh_qr'])
                    if qr_res.get('maktab'): ws.cell(row=row_idx, column=17, value=qr_res['maktab'])
                    if qr_res.get('cert_tur'): ws.cell(row=row_idx, column=18, value=qr_res['cert_tur'])
                    if qr_res.get('yil'): ws.cell(row=row_idx, column=19, value=str(qr_res['yil']))
                    wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                    wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx'))

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "filename": os.path.basename(target_path),
                    "data": {
                        "ism": qr_res.get('ism', ''),
                        "ota": qr_res.get('ota', ''),
                        "pass_ser": qr_res.get('pass_val', ''),
                        "pinfl": qr_res.get('pinfl', ''),
                        "dob": qr_res.get('dob', ''),
                        "sh_doc": qr_res.get('cert_val', ''),
                        "doc_tur": qr_res.get('cert_tur', 'Shahodatnoma'),
                        "maktab": qr_res.get('maktab', ''),
                        "yil": str(qr_res.get('yil', '2024')),
                        "sh_qr": qr_res.get('sh_qr', '')
                    }
                }).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                return

        # ========================================================
        # 2. TALABANI BAZADAN BUTUNLAY O'CHIRISH (DELETE STUDENT)
        # ========================================================
        if parsed_path.startswith('/api/delete_student'):
            query = self.path.split('?')[-1] if '?' in self.path else ''
            params = dict(qc.split('=') for qc in query.split('&') if '=' in qc)
            row_idx = int(params.get('row', '0'))
            sh_clean = unquote(params.get('shnum', '')).strip()
            pinfl_clean = unquote(params.get('pinfl', '')).replace(' ', '').strip()
            ism_clean = unquote(params.get('ism', '') or params.get('fish', '')).strip().lower()

            try:
                import openpyxl
                wb = openpyxl.load_workbook(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                ws = wb.active

                # Shartnoma raqami takrorlanishi mumkin — avval JSHSHIR va qator, noaniq bo'lsa o'chirilmaydi
                target_row = find_student_row_in_sheet(ws, row_idx, pinfl=pinfl_clean, shnum=sh_clean, ism=ism_clean, strict=True)

                if not target_row or target_row < 2 or target_row > ws.max_row:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "Talaba topilmadi"}).encode('utf-8'))
                    return
                
                deleted_name = str(ws.cell(row=target_row, column=2).value or '')
                del_sh = str(ws.cell(row=target_row, column=5).value or '').strip()
                del_pinfl = str(ws.cell(row=target_row, column=11).value or '').strip()

                ws.delete_rows(target_row)
                
                # T/r larni qayta tartiblash
                for idx, r in enumerate(range(2, ws.max_row + 1), start=1):
                    ws.cell(row=r, column=1, value=idx)
                    
                wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx'))
                wb.save(os.path.join(BASE_DIR, 'qayta_tekshiruv', 'Talabalar_Yangilangan_Royxat.xlsx'))
                
                # verifications.json dan tozalash
                try:
                    with VERIFICATIONS_LOCK:
                        if os.path.exists(VERIFICATIONS_FILE):
                            with open(VERIFICATIONS_FILE, 'r', encoding='utf-8') as vf:
                                vmap = json.load(vf)
                            vmap.pop(str(target_row), None)
                            if del_sh: vmap.pop('sh_' + del_sh, None)
                            if del_pinfl: vmap.pop('pinfl_' + del_pinfl, None)
                            with open(VERIFICATIONS_FILE, 'w', encoding='utf-8') as vf:
                                json.dump(vmap, vf, ensure_ascii=False, indent=2)
                except Exception:
                    pass

                sync_students_json_atomic('delete', {'row': target_row, 'shnum': del_sh, 'pinfl': del_pinfl, 'ism': deleted_name})

                # Hisobotni qayta yaratish
                trigger_report_rebuild()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "deleted_row": target_row,
                    "deleted_name": deleted_name,
                    "remaining_total": ws.max_row - 1
                }).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                return

        if parsed_path.startswith('/api/update_student'):
            query = self.path.split('?')[-1] if '?' in self.path else ''
            params = dict(qc.split('=') for qc in query.split('&') if '=' in qc)
            row_idx = int(params.get('row', '0'))

            if row_idx < 2:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Noto'g'ri qator indeksi"}).encode('utf-8'))
                return

            try:
                def get_param(k):
                    val = params.get(k, None)
                    return unquote(val).strip() if val is not None else None

                ism = clean_uz_name(get_param('ism')) if get_param('ism') is not None else None
                ota = clean_uz_name(get_param('ota')) if get_param('ota') is not None else None
                pv = get_param('pv')
                pinfl = get_param('pinfl')
                dob = get_param('dob')
                ber = get_param('ber')
                sh_doc = get_param('sh_doc')
                doc_tur = get_param('doc_tur')
                mak = get_param('mak')
                yil = get_param('yil')
                yon = get_param('yon')
                group = get_param('group')
                shnum = get_param('shnum')
                tel = get_param('tel')
                buyruq = get_param('buyruq')
                buyruq_sana = get_param('buyruq_sana')
                verify = get_param('verify')
                shnum_verify = get_param('shnum_verify') or shnum
                pinfl_verify = get_param('pinfl_verify') or pinfl
                ism_verify = get_param('ism_verify') or ism

                backup_excel_atomic()

                with EXCEL_LOCK:
                    import openpyxl
                    excel_path = os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx')
                    wb = openpyxl.load_workbook(excel_path)
                    ws = wb.worksheets[0]

                    found_row = find_student_row_in_sheet(ws, row_idx, pinfl=pinfl_verify, shnum=shnum_verify, ism=ism_verify)
                    if found_row:
                        row_idx = found_row

                    if verify:
                        save_verification_atomic(row_idx, verify, pinfl=pinfl)

                    if ism is not None: ws.cell(row=row_idx, column=2, value=ism)
                    if ota is not None: ws.cell(row=row_idx, column=7, value=ota)
                    
                    cur_ism = ism if ism is not None else str(ws.cell(row=row_idx, column=2).value or '')
                    cur_ota = ota if ota is not None else str(ws.cell(row=row_idx, column=7).value or '')
                    ws.cell(row=row_idx, column=8, value=f"{cur_ism} {cur_ota}".strip())

                    if shnum is not None:
                        shnum = normalize_shnum(shnum)
                        ws.cell(row=row_idx, column=5, value=shnum)

                    if pv is not None: ws.cell(row=row_idx, column=10, value=pv)
                    if pinfl is not None: ws.cell(row=row_idx, column=11, value=pinfl)
                    if ber is not None: ws.cell(row=row_idx, column=12, value=ber)
                    if dob is not None: ws.cell(row=row_idx, column=13, value=dob)
                    if sh_doc is not None: ws.cell(row=row_idx, column=15, value=sh_doc)
                    if mak is not None: ws.cell(row=row_idx, column=17, value=mak)
                    if doc_tur is not None: ws.cell(row=row_idx, column=18, value=doc_tur)
                    if yil is not None: ws.cell(row=row_idx, column=19, value=yil)
                    if tel is not None: ws.cell(row=row_idx, column=20, value=tel)
                    if yon is not None: ws.cell(row=row_idx, column=3, value=yon)
                    if group is not None and group: ws.cell(row=row_idx, column=23, value=group)
                    write_buyruq(ws, row_idx, buyruq, buyruq_sana)
                    
                    if verify is not None:
                        if ws.cell(row=1, column=25).value != "Operator Tasdig'i":
                            ws.cell(row=1, column=25, value="Operator Tasdig'i")
                        ws.cell(row=row_idx, column=25, value=verify)

                    wb.save(excel_path)
                    wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx'))

                fields_dict = {k: v for k, v in [
                    ('ism', ism), ('ota', ota), ('pv', pv), ('pinfl', pinfl), ('dob', dob), ('ber', ber),
                    ('sh_doc', sh_doc), ('doc_tur', doc_tur), ('mak', mak), ('yil', yil), ('yon', yon),
                    ('group', group), ('shnum', shnum), ('tel', tel), ('buyruq', buyruq), ('buyruq_sana', buyruq_sana)
                ] if v is not None}
                sync_students_json_atomic('update', {'row': row_idx, 'shnum': shnum, 'pinfl': pinfl, 'fields': fields_dict})

                # Guruhlangan qayta generatsiya: 3 soniyada yoki "GitHub'ga
                # yuborish" tugmasi bosilganda (BATCH_DELAY ga qarang)
                trigger_report_rebuild()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "message": "Ma'lumotlar muvaffaqiyatli saqlandi!"}).encode('utf-8'))
                return

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                return

        if parsed_path == '/api/get_verifications':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', '*')
            self.end_headers()
            vmap = load_verifications_map()
            self.wfile.write(json.dumps({"success": True, "verifications": vmap}).encode('utf-8'))
            return

        if parsed_path.startswith('/api/verify_student'):
            query = self.path.split('?')[-1] if '?' in self.path else ''
            params = dict(qc.split('=') for qc in query.split('&') if '=' in qc)
            row_idx = int(params.get('row', '0'))
            v_status = unquote(params.get('status', 'TASDIQLANDI')).strip().upper()
            target_shnum = unquote(params.get('shnum', '')).strip()
            target_pinfl = unquote(params.get('pinfl', '')).strip()
            target_name = unquote(params.get('ism', '')).strip()

            if row_idx < 2 and not target_shnum and not target_pinfl and not target_name:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Noto'g'ri qator yoki talaba ma'lumotlari"}).encode('utf-8'))
                return

            # 1. Tezkor JSON keshga darhol saqlash (1ms) — F5 da mutlaqo yo'qolmasligi uchun
            save_verification_atomic(row_idx, v_status, target_shnum, target_pinfl)

            # 2. Excel bazaga xavfsiz Lock va Retry bilan yozish
            excel_saved = False
            excel_err = None
            excel_path = os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx')

            with EXCEL_LOCK:
                for attempt in range(3):
                    try:
                        import openpyxl
                        wb = openpyxl.load_workbook(excel_path)
                        main_ws = wb.worksheets[0]
                        if row_idx <= main_ws.max_row:
                            if not target_shnum:
                                target_shnum = str(main_ws.cell(row=row_idx, column=5).value or '').strip()
                            if not target_pinfl:
                                target_pinfl = str(main_ws.cell(row=row_idx, column=11).value or '').strip()
                            if not target_name:
                                target_name = str(main_ws.cell(row=row_idx, column=2).value or '').strip()

                        for sheet in wb.worksheets:
                            if sheet.cell(row=1, column=25).value != "Operator Tasdig'i":
                                sheet.cell(row=1, column=25, value="Operator Tasdig'i")
                            
                            if sheet == main_ws and row_idx <= sheet.max_row:
                                sheet.cell(row=row_idx, column=25, value=v_status)
                            else:
                                for r in range(2, sheet.max_row + 1):
                                    s_shnum = str(sheet.cell(row=r, column=5).value or '').strip()
                                    s_pinfl = str(sheet.cell(row=r, column=11).value or '').strip()
                                    s_name = str(sheet.cell(row=r, column=2).value or '').strip()
                                    if (target_shnum and s_shnum == target_shnum) or (target_pinfl and s_pinfl == target_pinfl) or (target_name and s_name == target_name):
                                        sheet.cell(row=r, column=25, value=v_status)
                                        break

                        wb.save(excel_path)
                        excel_saved = True
                        break
                    except Exception as ex:
                        excel_err = ex
                        time.sleep(0.2)

            if not excel_saved:
                print(f"[OGOHLANTIRISH] Excel saqlashda vaqtinchalik ogohlantirish ({excel_err}), lekin JSON keshda 100% saqlandi!")

            sync_students_json_atomic('verify', {'row': row_idx, 'shnum': target_shnum, 'pinfl': target_pinfl, 'status': v_status})

            # 3. Guruhlangan qayta hisobot yasash (ketma-ket kliklar bitta
            #    commit ga birlashadi — BATCH_DELAY ga qarang)
            trigger_report_rebuild()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "row": row_idx, "status": v_status}).encode('utf-8'))
            return

        if parsed_path.startswith('/api/baza_student'):
            query = self.path.split('?')[-1] if '?' in self.path else ''
            params = dict(qc.split('=') for qc in query.split('&') if '=' in qc)
            row_idx = int(params.get('row', '0'))
            raw_st = unquote(params.get('status', 'KIRITILDI')).strip().upper()
            b_status = 'KIRITILMAGAN' if 'MAGAN' in raw_st else 'KIRITILDI'
            target_shnum = unquote(params.get('shnum', '')).strip()
            target_pinfl = unquote(params.get('pinfl', '')).strip()
            target_name = unquote(params.get('ism', '')).strip()

            if row_idx < 2 and not target_shnum and not target_pinfl and not target_name:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Noto'g'ri qator yoki talaba ma'lumotlari"}).encode('utf-8'))
                return

            save_baza_verification_atomic(row_idx, b_status, target_shnum, target_pinfl)

            excel_saved = False
            excel_err = None
            excel_path = os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx')

            with EXCEL_LOCK:
                for attempt in range(3):
                    try:
                        import openpyxl
                        wb = openpyxl.load_workbook(excel_path)
                        main_ws = wb.worksheets[0]
                        if row_idx <= main_ws.max_row:
                            if not target_shnum:
                                target_shnum = str(main_ws.cell(row=row_idx, column=5).value or '').strip()
                            if not target_pinfl:
                                target_pinfl = str(main_ws.cell(row=row_idx, column=11).value or '').strip()
                            if not target_name:
                                target_name = str(main_ws.cell(row=row_idx, column=2).value or '').strip()

                        for sheet in wb.worksheets:
                            if sheet.cell(row=1, column=28).value != 'Bazaga kiritilganligi':
                                sheet.cell(row=1, column=28, value='Bazaga kiritilganligi')

                            if sheet == main_ws and row_idx <= sheet.max_row:
                                sheet.cell(row=row_idx, column=28, value=b_status)
                            else:
                                for r in range(2, sheet.max_row + 1):
                                    s_shnum = str(sheet.cell(row=r, column=5).value or '').strip()
                                    s_pinfl = str(sheet.cell(row=r, column=11).value or '').strip()
                                    s_name = str(sheet.cell(row=r, column=2).value or '').strip()
                                    if (target_shnum and s_shnum == target_shnum) or (target_pinfl and s_pinfl == target_pinfl) or (target_name and s_name == target_name):
                                        sheet.cell(row=r, column=28, value=b_status)
                                        break

                        wb.save(excel_path)
                        excel_saved = True
                        break
                    except Exception as ex:
                        excel_err = ex
                        time.sleep(0.2)

            if not excel_saved:
                print(f"[OGOHLANTIRISH] Excel saqlashda vaqtinchalik ogohlantirish ({excel_err}), lekin JSON keshda 100% saqlandi!")

            sync_students_json_atomic('baza', {'row': row_idx, 'shnum': target_shnum, 'pinfl': target_pinfl, 'status': b_status})

            trigger_report_rebuild()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "row": row_idx, "status": b_status}).encode('utf-8'))
            return

        if parsed_path.startswith('/api/add_new_student'):
            query = self.path.split('?')[-1] if '?' in self.path else ''
            params = dict(qc.split('=') for qc in query.split('&') if '=' in qc)

            try:
                import openpyxl
                wb = openpyxl.load_workbook(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                ws = wb.active

                def get_param(k):
                    val = params.get(k, None)
                    return unquote(val).strip() if val is not None else ''

                ism = clean_uz_name(get_param('ism'))
                ota = clean_uz_name(get_param('ota'))
                fish = f"{ism} {ota}".strip() if ota else ism
                shnum = get_param('shnum')
                pv = get_param('pv')
                pinfl = get_param('pinfl').replace(' ', '').strip()
                dob = get_param('dob')
                ber = get_param('ber')  # FAQAT pasport berilgan sanasi
                sh_doc = get_param('sh_doc')
                doc_tur = get_param('doc_tur') or 'Shahodatnoma'
                mak = get_param('mak')
                yil = get_param('yil')
                yon = get_param('yon') or 'Hamshiralik ishi - 3 yillik'
                tel = get_param('tel')
                group = get_param('group').strip()
                doc_file = get_param('doc_file')

                if not ism or not ota:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    err_msg = "Ism-familiya va otasining ismi kiritilishi shart!"
                    self.wfile.write(json.dumps({"success": False, "error": err_msg}).encode('utf-8'))
                    return

                # Shartnoma raqami avtomatik qo'yilmaydi — faqat kiritilgan bo'lsagina saqlanadi
                shnum = normalize_shnum(shnum)

                new_row = ws.max_row + 1
                tr_num = new_row - 1

                ws.cell(row=new_row, column=1, value=tr_num)
                ws.cell(row=new_row, column=2, value=ism)
                ws.cell(row=new_row, column=3, value=yon)
                ws.cell(row=new_row, column=4, value="To'lov qildi")
                ws.cell(row=new_row, column=5, value=shnum)
                ws.cell(row=new_row, column=6, value="")
                ws.cell(row=new_row, column=7, value=ota)
                ws.cell(row=new_row, column=8, value=fish)
                # 9-ustun (Passport bo'yicha F.I.SH) — bu yerda yozilmaydi,
                # uni scripts/verify_passport_names.py boshqaradi.
                ws.cell(row=new_row, column=10, value=pv)
                ws.cell(row=new_row, column=11, value=pinfl)
                ws.cell(row=new_row, column=12, value=ber)
                ws.cell(row=new_row, column=13, value=dob)
                ws.cell(row=new_row, column=14, value="Mavjud" if (pv or sh_doc) else "Yo'q")
                ws.cell(row=new_row, column=15, value=sh_doc)
                ws.cell(row=new_row, column=16, value="")
                ws.cell(row=new_row, column=17, value=mak)
                ws.cell(row=new_row, column=18, value=doc_tur)
                ws.cell(row=new_row, column=19, value=yil)
                ws.cell(row=new_row, column=20, value=tel)
                ws.cell(row=new_row, column=23, value=group)

                wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx'))

                sync_students_json_atomic('add', {
                    'row': new_row, 'tr': tr_num, 'ism': ism, 'ota': ota, 'fish': fish,
                    'shnum': shnum, 'pv': pv, 'pinfl': pinfl, 'dob': dob, 'ber': ber,
                    'sh_doc': sh_doc, 'doc_tur': doc_tur, 'mak': mak, 'yil': yil,
                    'yon': yon, 'tel': tel, 'group': group, 'verified': 'TASDIQLANDI', 'baza': 'KIRITILDI'
                })

                # Fondada hisobot HTML larini ham yangilash
                trigger_report_rebuild()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Yangi talaba #{shnum} {fish} muvaffaqiyatli qo'shildi!" if shnum else f"Yangi talaba {fish} muvaffaqiyatli qo'shildi!",
                    "row": new_row,
                    "shnum": shnum
                }).encode('utf-8'))
                return

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                return

        if parsed_path.startswith('/js/') or parsed_path.startswith('/css/') or parsed_path.startswith('/images/') or parsed_path.startswith('/pdf_jurnallar/') or parsed_path in ('/favicon.ico', '/favicon.svg', '/favicon.png'):
            rel_path = parsed_path.lstrip('/')
            # Eski portal fayllari eski_portal/ da, PDF jurnallar hisobotlar/ da
            if rel_path.startswith('pdf_jurnallar/'):
                static_file = os.path.join(BASE_DIR, 'hisobotlar', rel_path)
            else:
                static_file = os.path.join(BASE_DIR, 'eski_portal', rel_path)
            if os.path.exists(static_file) and os.path.isfile(static_file):
                mime, _ = mimetypes.guess_type(static_file)
                if not mime:
                    if rel_path.endswith('.js'): mime = 'application/javascript; charset=utf-8'
                    elif rel_path.endswith('.css'): mime = 'text/css; charset=utf-8'
                    elif rel_path.endswith('.png'): mime = 'image/png'
                    elif rel_path.endswith('.jpg') or rel_path.endswith('.jpeg'): mime = 'image/jpeg'
                    elif rel_path.endswith('.svg'): mime = 'image/svg+xml'
                    elif rel_path.endswith('.ico'): mime = 'image/x-icon'
                    elif rel_path.endswith('.pdf'): mime = 'application/pdf'
                    else: mime = 'application/octet-stream'
                self.send_response(200)
                self.send_header('Content-Type', mime)
                if rel_path.endswith('.pdf'):
                    self.send_header('Content-Disposition', f'inline; filename="{os.path.basename(static_file)}"')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                with open(static_file, 'rb') as f:
                    self.wfile.write(f.read())
                return

        if parsed_path.startswith('/files/'):
            fname = parsed_path[7:]
            target_path = os.path.join(FILES_DIR, fname)
            if os.path.exists(target_path) and os.path.isfile(target_path):
                mime, _ = mimetypes.guess_type(target_path)
                if not mime:
                    if target_path.endswith('.docx'):
                        mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    elif target_path.endswith('.jpg') or target_path.endswith('.jpeg'):
                        mime = 'image/jpeg'
                    elif target_path.endswith('.png'):
                        mime = 'image/png'
                    else:
                        mime = 'application/octet-stream'

                disp = 'inline' if (mime.startswith('image/') or mime.startswith('text/')) else f'attachment; filename="{os.path.basename(target_path)}"'

                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Disposition', disp)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                with open(target_path, 'rb') as f:
                    self.wfile.write(f.read())
                return
            else:
                self.send_error(404, f"Fayl topilmadi: {fname}")
                return

        if parsed_path == '/api/export_full_excel' or parsed_path == '/api/export_excel':
            query = self.path.split('?')[-1] if '?' in self.path else ''
            params = dict(qc.split('=') for qc in query.split('&') if '=' in qc)
            filter_group = params.get('group', None)
            if filter_group: filter_group = unquote(filter_group).strip().upper()
            filter_status = params.get('status', None)
            if filter_status: filter_status = unquote(filter_status).strip().upper()

            try:
                import io
                import openpyxl

                source_wb = openpyxl.load_workbook(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'), data_only=True)
                source_ws = source_wb.active

                # Barcha guruhlarni alohida sahifalar (Multi-Sheet) bilan to'liq yaratish
                out_wb = build_full_multisheet_excel(source_ws, filter_status=filter_status)

                # Agar ma'lum bir guruh tanlangan bo'lsa, o'sha varaqni faol qilish
                if filter_group and filter_group not in ['ALL', 'BARCHASI', '']:
                    for sname in out_wb.sheetnames:
                        if filter_group in sname:
                            out_wb.active = out_wb[sname]
                            break

                output_stream = io.BytesIO()
                out_wb.save(output_stream)
                output_stream.seek(0)

                dl_name = "Talabalar_Barcha_Guruhlar_2026-2027.xlsx"
                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                self.send_header('Content-Disposition', f'attachment; filename="{dl_name}"')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(output_stream.getvalue())
                return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                return

        if parsed_path == '/api/export_all_groups_excel':
            try:
                import io
                import openpyxl

                source_wb = openpyxl.load_workbook(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'), data_only=True)
                source_ws = source_wb.active

                out_wb = build_full_multisheet_excel(source_ws)

                output_stream = io.BytesIO()
                out_wb.save(output_stream)
                output_stream.seek(0)

                dl_name = "Talabalar_Barcha_Guruhlar_2026-2027.xlsx"
                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                self.send_header('Content-Disposition', f'attachment; filename="{dl_name}"')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(output_stream.getvalue())
                return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                return

        if parsed_path == '/api/view_group_pdf':
            query = self.path.split('?')[-1] if '?' in self.path else ''
            params = dict(qc.split('=') for qc in query.split('&') if '=' in qc)
            target_group = params.get('group', '26-01')
            if target_group: target_group = unquote(target_group).strip()
            pdf_path = os.path.join(BASE_DIR, 'hisobotlar', 'pdf_jurnallar', f"Guruh_{target_group}.pdf")
            if not os.path.exists(pdf_path):
                try:
                    sys.path.insert(0, os.path.join(BASE_DIR, 'qayta_tekshiruv'))
                    from generate_pdfs import build_all_group_pdfs
                    build_all_group_pdfs()
                except Exception as ex_pdf:
                    print(f"PDF yaratishda xatolik: {ex_pdf}")
            if os.path.exists(pdf_path):
                self.send_response(200)
                self.send_header('Content-Type', 'application/pdf')
                self.send_header('Content-Disposition', f'inline; filename="Guruh_{target_group}.pdf"')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                with open(pdf_path, 'rb') as f:
                    self.wfile.write(f.read())
                return
            else:
                self.send_error(404, f"Guruh PDF topilmadi: {target_group}")
                return

        if parsed_path == '/api/export_role_excel':
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            role = params.get('role', ['toliq'])[0]
            out_path, _, _ = build_role_excel_file(role)
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            self.send_header('Content-Disposition', f'attachment; filename="{os.path.basename(out_path)}"')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            with open(out_path, 'rb') as f:
                self.wfile.write(f.read())
            return

        if parsed_path == '/api/send_role_excel_to_telegram':
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            role = params.get('role', ['toliq'])[0]
            ok, msg = send_role_excel_to_telegram_chat(role)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'ok': ok, 'message': msg}).encode('utf-8'))
            return

        if parsed_path == '/api/export_group_journal' or parsed_path == '/api/export_group_excel':
            # 1-list: Jami (Guruhi|T/R|F.I.SH|Sana), 2-8 listlar: Har guruh alohida (T/R|F.I.SH|Sana)
            try:
                import io
                import openpyxl
                from openpyxl.styles import Font, Alignment, Border, Side
                from openpyxl.utils import get_column_letter

                source_wb = openpyxl.load_workbook(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                source_ws = source_wb.active

                students = []
                for r in range(2, source_ws.max_row + 1):
                    ism = str(source_ws.cell(row=r, column=2).value or '').strip()
                    shnum = str(source_ws.cell(row=r, column=5).value or '').strip()
                    ota = str(source_ws.cell(row=r, column=7).value or '').strip()
                    fish = str(source_ws.cell(row=r, column=8).value or '').strip()
                    dob = str(source_ws.cell(row=r, column=13).value or '').strip()
                    group = str(source_ws.cell(row=r, column=23).value or '').strip()

                    if not ism and not shnum: continue
                    if not group: continue
                    full_fio = fish or f"{ism} {ota}".strip()
                    students.append({'ism': ism, 'fio': full_fio, 'dob': dob, 'group': group})

                meta_dyn2 = load_groups_metadata()
                GROUPS = sorted(meta_dyn2.keys(), key=lambda x: (get_kurs_of_group(x, meta_dyn2), x))
                students.sort(key=lambda x: (GROUPS.index(x['group']) if x['group'] in GROUPS else 99, x['ism'].lower()))

                out_wb = openpyxl.Workbook()

                black_thin_border = Border(
                    left=Side(style='thin', color='000000'),
                    right=Side(style='thin', color='000000'),
                    top=Side(style='thin', color='000000'),
                    bottom=Side(style='thin', color='000000')
                )
                header_border = Border(
                    left=Side(style='thin', color='000000'),
                    right=Side(style='thin', color='000000'),
                    top=Side(style='medium', color='000000'),
                    bottom=Side(style='medium', color='000000')
                )

                def setup_print(ws):
                    ws.page_setup.orientation = ws.ORIENTATION_PORTRAIT
                    ws.page_setup.paperSize = ws.PAPERSIZE_A4
                    ws.page_setup.fitToWidth = 1
                    ws.sheet_properties.pageSetUpPr.fitToPage = True
                    ws.page_margins.left = 0.33
                    ws.page_margins.right = 0.33
                    ws.page_margins.top = 0.35
                    ws.page_margins.bottom = 0.35
                    ws.print_options.horizontalCentered = True

                # ============================================================
                # 1-LIST: JAMI — Guruhi | T/R | F.I.SH | Tug'ilgan Sana
                # ============================================================
                ws_jami = out_wb.active
                ws_jami.title = "Jami"
                setup_print(ws_jami)

                ws_jami.merge_cells('A1:D1')
                tc = ws_jami['A1']
                tc.value = "2026-2027 O'QUV YILI | BARCHA GURUHLAR TALABALARI RO'YXATI"
                tc.font = Font(name='Cambria', size=16, bold=True, color='000000')
                tc.alignment = Alignment(horizontal='center', vertical='center')
                ws_jami.row_dimensions[1].height = 30
                ws_jami.row_dimensions[2].height = 8

                jami_headers = [
                    ("Guruhi", 10, 'center'),
                    ("T/R", 6, 'center'),
                    ("Talabaning To'liq F.I.SH", 50, 'left'),
                    ("Tug'ilgan Sana", 18, 'center'),
                ]
                ws_jami.row_dimensions[3].height = 24
                for col_idx, (h_name, width, align) in enumerate(jami_headers, 1):
                    cell = ws_jami.cell(row=3, column=col_idx, value=h_name)
                    cell.font = Font(name='Cambria', size=13, bold=True, color='000000')
                    cell.alignment = Alignment(horizontal=align, vertical='center')
                    cell.border = header_border
                    ws_jami.column_dimensions[get_column_letter(col_idx)].width = width

                current_group = None
                group_counter = 0
                row_num = 4
                for st in students:
                    if st['group'] != current_group:
                        current_group = st['group']
                        group_counter = 0
                    group_counter += 1
                    ws_jami.row_dimensions[row_num].height = 19
                    for col_idx, (val, align, bold) in enumerate([
                        (st['group'], 'center', True),
                        (group_counter, 'center', True),
                        (st['fio'], 'left', False),
                        (st['dob'] or '—', 'center', False),
                    ], 1):
                        c = ws_jami.cell(row=row_num, column=col_idx, value=val)
                        c.font = Font(name='Cambria', size=12, bold=bold, color='000000')
                        c.alignment = Alignment(horizontal=align, vertical='center')
                        c.border = black_thin_border
                    row_num += 1

                # ============================================================
                # 2-8 LISTLAR: Har guruh alohida — T/R | F.I.SH | Tug'ilgan Sana
                # ============================================================
                for g in GROUPS:
                    g_students = [s for s in students if s['group'] == g]
                    g_students.sort(key=lambda x: x['ism'].lower())

                    ws = out_wb.create_sheet(title=f"Guruh_{g}")
                    setup_print(ws)
                    ws.page_setup.fitToHeight = 1
                    ws.page_margins.header = 0.2
                    ws.page_margins.footer = 0.2
                    ws.views.sheetView[0].showGridLines = True

                    ws.merge_cells('A1:C1')
                    tc2 = ws['A1']
                    tc2.value = f"2026-2027 O'QUV YILI | {g} - GURUH TALABALARI RO'YXATI"
                    tc2.font = Font(name='Cambria', size=16, bold=True, color='000000')
                    tc2.alignment = Alignment(horizontal='center', vertical='center')
                    ws.row_dimensions[1].height = 30
                    ws.row_dimensions[2].height = 8

                    grp_headers = [
                        ("T/R", 6, 'center'),
                        ("Talabaning To'liq F.I.SH", 50, 'left'),
                        ("Tug'ilgan Sana", 18, 'center'),
                    ]
                    ws.row_dimensions[3].height = 24
                    for col_idx, (h_name, width, align) in enumerate(grp_headers, 1):
                        cell = ws.cell(row=3, column=col_idx, value=h_name)
                        cell.font = Font(name='Cambria', size=13, bold=True, color='000000')
                        cell.alignment = Alignment(horizontal=align, vertical='center')
                        cell.border = header_border
                        ws.column_dimensions[get_column_letter(col_idx)].width = width

                    for idx, st in enumerate(g_students, 1):
                        rn = 3 + idx
                        ws.row_dimensions[rn].height = 19
                        for col_idx, (val, align, bold) in enumerate([
                            (idx, 'center', True),
                            (st['fio'], 'left', False),
                            (st['dob'] or '—', 'center', False),
                        ], 1):
                            c = ws.cell(row=rn, column=col_idx, value=val)
                            c.font = Font(name='Cambria', size=12, bold=bold, color='000000')
                            c.alignment = Alignment(horizontal=align, vertical='center')
                            c.border = black_thin_border

                output_stream = io.BytesIO()
                out_wb.save(output_stream)
                output_stream.seek(0)

                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                self.send_header('Content-Disposition', 'attachment; filename="Talabalar_Guruh_Jurnali_2026-2027.xlsx"')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(output_stream.getvalue())
                return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                return

        self.send_error(404, "Sahifa topilmadi")

    def do_POST(self):
        parsed_path = self.path.split('?')[0]

        if parsed_path == '/api/send_groups_to_telegram':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length) if length > 0 else b'{}'
            try:
                data = json.loads(body.decode('utf-8'))
            except Exception:
                data = {}
            target = data.get('target', 'channel')
            group_filter = data.get('group', 'ALL')
            res = send_group_lists_to_telegram(target=target, group_filter=group_filter)
            self.send_response(200 if res.get('ok') else 500)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))
            return

        if parsed_path == '/api/upload_student_section_files':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body.decode('utf-8'))
                row_idx = int(data.get('row', '0'))
                student_ism = str(data.get('ism', '') or '').strip()
                student_ota = str(data.get('ota', '') or '').strip()
                student_group = str(data.get('group', '') or '').strip()
                existing_doc_file = str(data.get('doc_file', '') or '').strip()
                do_analyze = bool(data.get('analyze', True))
                req_model = str(data.get('model', DEFAULT_AI_MODEL) or DEFAULT_AI_MODEL).strip()

                passport_files = data.get('passport_files', []) or []
                diploma_files = data.get('diploma_files', []) or []

                def decode_items_to_blobs(file_list, target_role):
                    out_blobs = []
                    out_texts = []
                    for fitem in file_list:
                        fname_i = str(fitem.get('filename', 'hujjat.jpg') or 'hujjat.jpg')
                        b64_i = str(fitem.get('base64', '') or '')
                        if ',' in b64_i:
                            b64_i = b64_i.split(',', 1)[1]
                        if not b64_i:
                            continue
                        raw_bytes = base64.b64decode(b64_i)
                        ext_i = os.path.splitext(fname_i)[1].lower()

                        raw_imgs_for_item = []
                        if ext_i == '.pdf':
                            try:
                                import fitz
                                pdf_doc = fitz.open(stream=raw_bytes, filetype="pdf")
                                for pg_idx in range(min(2, len(pdf_doc))):
                                    pg = pdf_doc[pg_idx]
                                    pg_txt = pg.get_text() or ''
                                    if pg_txt.strip():
                                        out_texts.append(pg_txt.strip())
                                    pix = pg.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
                                    raw_imgs_for_item.append(pix.tobytes("jpeg"))
                                pdf_doc.close()
                            except Exception as e_pdf:
                                print(f"PDF render xatosi ({fname_i}): {e_pdf}")
                        elif ext_i == '.docx':
                            tmp_docx_path = os.path.join(FILES_DIR, f"_tmp_sec_{int(time.time()*1000)}_{os.path.basename(fname_i)}")
                            try:
                                with open(tmp_docx_path, 'wb') as tf:
                                    tf.write(raw_bytes)
                                _, d_blobs, d_txt = extract_doc_images_with_crop(tmp_docx_path)
                                if d_txt:
                                    out_texts.append(d_txt)
                                raw_imgs_for_item.extend(d_blobs[:2])
                            finally:
                                if os.path.exists(tmp_docx_path):
                                    try: os.remove(tmp_docx_path)
                                    except Exception: pass
                        else:
                            raw_imgs_for_item.append(raw_bytes)

                        # Normalize each image to clean RGB JPEG with role-appropriate aspect ratio
                        for r_blob in raw_imgs_for_item:
                            try:
                                im = Image.open(io.BytesIO(r_blob)).convert('RGB')
                                w, h = im.size
                                if target_role == 'passport':
                                    # Pasport rasmi modalda 1-bo'limda (w >= h * 1.05) chiqishi uchun:
                                    if h > w:
                                        new_w = int(h * 1.12)
                                        canvas = Image.new('RGB', (new_w, h), (255, 255, 255))
                                        canvas.paste(im, ((new_w - w) // 2, 0))
                                        im = canvas
                                elif target_role == 'diploma':
                                    # Shahodatnoma/Diplom rasmi modalda 2-bo'limda (h > w * 1.05) chiqishi uchun:
                                    if w >= h * 0.96:
                                        new_h = int(w * 1.12)
                                        canvas = Image.new('RGB', (w, new_h), (255, 255, 255))
                                        canvas.paste(im, (0, (new_h - h) // 2))
                                        im = canvas
                                buf = io.BytesIO()
                                im.save(buf, format='JPEG', quality=95)
                                out_blobs.append(buf.getvalue())
                            except Exception as e_im:
                                print(f"Rasm konvertatsiya xatosi ({fname_i}): {e_im}")
                    return out_blobs, "\n".join(out_texts)

                new_pass_blobs, pass_txt = decode_items_to_blobs(passport_files, 'passport')
                new_dip_blobs, dip_txt = decode_items_to_blobs(diploma_files, 'diploma')

                # Mavjud .docx fayldagi rasmlarni o'qiymiz (agar faqat bitta bo'lim yangilangan bo'lsa, ikkinchisi saqlanib qoladi)
                old_pass_blobs = []
                old_dip_blobs = []
                old_txt = ""
                if existing_doc_file and existing_doc_file != 'Mavjud emas':
                    ex_path = os.path.join(FILES_DIR, existing_doc_file)
                    if os.path.exists(ex_path) and os.path.isfile(ex_path):
                        _, ex_blobs, old_txt = extract_doc_images_with_crop(ex_path)
                        for b in ex_blobs:
                            try:
                                im_b = Image.open(io.BytesIO(b))
                                wb_i, hb_i = im_b.size
                                if hb_i > wb_i * 1.05:
                                    old_dip_blobs.append(b)
                                else:
                                    old_pass_blobs.append(b)
                            except Exception:
                                old_pass_blobs.append(b)

                final_pass_blobs = new_pass_blobs if len(new_pass_blobs) > 0 else old_pass_blobs
                final_dip_blobs = new_dip_blobs if len(new_dip_blobs) > 0 else old_dip_blobs
                all_blobs = final_pass_blobs + final_dip_blobs
                combined_text = "\n".join([t for t in [old_txt, pass_txt, dip_txt] if t])

                if not all_blobs:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "Pasport yoki Shahodatnoma rasmlari topilmadi"}).encode('utf-8'))
                    return

                # Yangi yoki mavjud .docx fayl nomini aniqlash va rasmlarni ichiga joylash
                if existing_doc_file and existing_doc_file != 'Mavjud emas' and existing_doc_file.lower().endswith('.docx'):
                    target_docx_name = os.path.basename(existing_doc_file)
                else:
                    base_student_str = f"{student_ism}_{student_ota}".strip('_') or f"Talaba_{row_idx}"
                    clean_fname = re.sub(r'[^a-zA-Z0-9_\u0400-\u04FF-]+', '_', base_student_str).strip('_')
                    target_docx_name = f"{clean_fname}.docx"

                saved_docx_path = os.path.join(FILES_DIR, target_docx_name)
                from docx.shared import Inches
                new_doc = docx.Document()
                if student_ism or student_ota:
                    new_doc.add_paragraph(f"Talaba: {student_ism} {student_ota}".strip())
                if combined_text:
                    new_doc.add_paragraph(combined_text[:1000])
                for b_img in all_blobs:
                    try:
                        new_doc.add_picture(io.BytesIO(b_img), width=Inches(5.8))
                    except Exception as e_pic:
                        print(f"docx.add_picture xatosi: {e_pic}")
                new_doc.save(saved_docx_path)

                safe_slug = re.sub(r'[^a-zA-Z0-9_-]+', '_', os.path.splitext(target_docx_name)[0]).strip('_') or f"student_row_{row_idx}"
                images_b64, _, _, _ = extract_and_save_student_images(saved_docx_path, safe_slug)
                if not images_b64:
                    images_b64 = [f"data:image/jpeg;base64,{base64.b64encode(b).decode('utf-8')}" for b in all_blobs]

                ai_data = {}
                used_model_actual = SUPPORTED_AI_MODELS.get(req_model, req_model if '/' in req_model else 'google/gemini-2.5-flash')

                if do_analyze:
                    qr_extracted = scan_all_qrs(all_blobs)
                    print(f"upload_student_section_files QR natijasi: {qr_extracted}")

                    # PDF matnidan e-shahodatnoma ma'lumotlarini olish (agar PDF yuklangan bo'lsa)
                    if dip_txt:
                        for l in [ln.strip() for ln in dip_txt.split('\n') if ln.strip()]:
                            if re.match(r'^\d{7,8}$', l) and not ai_data.get('sh_doc'):
                                ai_data['sh_doc'] = f"UM {l}"
                                ai_data['doc_tur'] = 'Shahodatnoma'
                            m_mak = re.search(r'(\d{4})\s+(.+?maktab.+)', l, re.I)
                            if m_mak:
                                ai_data['yil'] = m_mak.group(1)
                                ai_data['maktab'] = m_mak.group(2).strip()

                    content_items = [{'type': 'text', 'text': """Sen professional O'zbekiston ID-karta, Biometrik pasport va Shahodatnoma/Diplom o'quvchisisan.
Ushbu rasmlarni juda sinchiklab tahlil qil va talabaning haqiqiy ma'lumotlarini chiqargin.

Qat'iy Qoidalar:
1. Pasport/ID seriya va raqami:
   - ID-karta: 'AD' yoki 'AE' harflari va KETMA-KET ANIQ 7 TA RAQAM (jami 9 ta belgi!). Masalan: AD1234567, AE4629898.
   - Biometrik pasport: 'AA', 'AB', 'AC', 'FA' va 7 ta raqam.
   - Hech qachon 8 ta yoki 6 ta raqam yozma!
2. JSHSHIR (PINFL):
   - ID-karta yoki pasport pastidagi/orqasidagi ANIQ 14 xonali raqam!
   - MUHIM MRZ QOIDASI: Biometrik pasportning pastki MRZ qatorida (masalan: AB63041584UZB9807154F270327641507985590024<52) 'UZB' dan keyin keladigan tug'ilgan sana (YYMMDD) va amal qilish sanasi (F2703276) raqamlarini JSHSHIR bilan ASLO adashtirma! Haqiqiy 14 xonali JSHSHIR amal qilish sanasidan KEYIN keladi va HAR DOIM 3, 4, 5 yoki 6 raqami + tug'ilgan sana (DDMMYY, masalan 15.07.1998 da tug'ilgan ayol uchun '41507985590024') bilan boshlanadi!
3. Tug'ilgan sana (DOB):
   - Pasportdagi tug'ilgan sana (DD.MM.YYYY).
4. Pasport BERILGAN SANASI (Date of issue):
   - FAQAT Pasport yoki ID-karta berilgan sanasi (Date of issue: DD.MM.YYYY).
   - Shahodatnoma sanasini yoki kelajak sanani EMAS!
5. Shahodatnoma yoki Diplom:
   - Hujjat turi: Maktab bo'lsa 'Shahodatnoma', Kollej/Litsey/Texnikum bo'lsa 'Diplom'
   - Seriya va raqami: Masalan 'UM 03729356' yoki 'T-V 123456'
   - Maktab/Muassasa nomi: Maktab yoki Kollejning to'liq nomi
   - Bitirgan yili: Masalan '2024'

Aniq JSON formatda qaytar:
{
  "ism": "Familiya Ism",
  "ota": "... qizi / ... o'g'li",
  "pass_ser": "AE1234567",
  "pinfl": "14 xonali PINFL (3/4/5/6 + DDMMYY bilan boshlanuvchi)",
  "mrz_line2": "Agar pasport MRZ qatori ko'rinsa, 2-qatorni to'liq yoz",
  "dob": "DD.MM.YYYY",
  "pass_ber": "DD.MM.YYYY",
  "sh_doc": "UM 1234567",
  "doc_tur": "Shahodatnoma",
  "maktab": "...-maktab",
  "yil": "2024"
}"""}]
                    for b in all_blobs:
                        b64 = base64.b64encode(b).decode('utf-8')
                        content_items.append({'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}})

                    models_to_try = [used_model_actual]
                    for fb_m in AI_FALLBACK_MODELS:
                        if fb_m not in models_to_try:
                            models_to_try.append(fb_m)

                    for try_m in models_to_try:
                        try:
                            payload = {'model': try_m, 'messages': [{'role': 'user', 'content': content_items}], 'temperature': 0.0}
                            req = urllib.request.Request(
                                'https://openrouter.ai/api/v1/chat/completions',
                                data=json.dumps(payload).encode('utf-8'),
                                headers={'Authorization': f'Bearer {OPENROUTER_API_KEY}', 'Content-Type': 'application/json'}
                            )
                            with urllib.request.urlopen(req, timeout=45) as resp:
                                res_json = json.loads(resp.read().decode('utf-8'))
                                raw = res_json['choices'][0]['message']['content'].strip()
                                raw = re.sub(r'^```json\s*', '', raw)
                                raw = re.sub(r'\s*```$', '', raw)
                                m_json = re.search(r'\{[\s\S]*\}', raw)
                                if m_json:
                                    raw = m_json.group(0)
                                parsed_json = json.loads(raw)
                                if parsed_json:
                                    ai_data.update(parsed_json)
                                    used_model_actual = try_m
                                    break
                        except Exception as e_ai:
                            print(f"upload_student_section_files AI [{try_m}] xato: {e_ai}")
                            continue

                    if qr_extracted:
                        if qr_extracted.get('ism'): ai_data['ism'] = qr_extracted['ism']
                        if qr_extracted.get('ota'): ai_data['ota'] = qr_extracted['ota']
                        if qr_extracted.get('pass_val'): ai_data['pass_ser'] = qr_extracted['pass_val']
                        if qr_extracted.get('pinfl'): ai_data['pinfl'] = qr_extracted['pinfl']
                        if qr_extracted.get('dob'): ai_data['dob'] = qr_extracted['dob']
                        if qr_extracted.get('ber_sana'): ai_data['pass_ber'] = qr_extracted['ber_sana']
                        if qr_extracted.get('cert_val'): ai_data['sh_doc'] = qr_extracted['cert_val']
                        if qr_extracted.get('cert_tur'): ai_data['doc_tur'] = qr_extracted['cert_tur']
                        if qr_extracted.get('maktab'): ai_data['maktab'] = qr_extracted['maktab']
                        if qr_extracted.get('yil'): ai_data['yil'] = qr_extracted['yil']
                        if qr_extracted.get('sh_qr'): ai_data['sh_qr'] = qr_extracted['sh_qr']

                    if ai_data.get('pass_ser'):
                        m_fix = re.search(r'([A-Z]{2})(\d{7})', str(ai_data['pass_ser']).upper().replace(' ', ''))
                        if m_fix:
                            ai_data['pass_ser'] = m_fix.group(1) + m_fix.group(2)

                    mrz2 = str(ai_data.get('mrz_line2', '') or '').upper().replace(' ', '')
                    if mrz2:
                        m_mrz_pinfl = re.search(r'[MF]\d{7}([3456]\d{13})', mrz2)
                        if m_mrz_pinfl:
                            ai_data['pinfl'] = m_mrz_pinfl.group(1)

                # Excel va manual_file_map.json ni yangilash (FAQAT AI tekshirish bosilganda!)
                if do_analyze and row_idx >= 2:
                    with EXCEL_LOCK:
                        wb = openpyxl.load_workbook(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                        ws = wb.active

                        clean_ism = clean_uz_name(ai_data.get('ism', ''))
                        clean_ota = clean_uz_name(ai_data.get('ota', ''))

                        cur_ism = str(ws.cell(row=row_idx, column=2).value or '').strip() or clean_ism or student_ism
                        cur_ota = str(ws.cell(row=row_idx, column=7).value or '').strip() or clean_ota or student_ota
                        if clean_ism and not str(ws.cell(row=row_idx, column=2).value or '').strip():
                            ws.cell(row=row_idx, column=2, value=clean_ism)
                            cur_ism = clean_ism
                        if clean_ota:
                            ws.cell(row=row_idx, column=7, value=clean_ota)
                            cur_ota = clean_ota
                        full_fish = f"{cur_ism} {cur_ota}".strip()
                        ws.cell(row=row_idx, column=8, value=full_fish)

                        if ai_data.get('pass_ser'): ws.cell(row=row_idx, column=10, value=ai_data['pass_ser'])
                        if ai_data.get('pinfl'): ws.cell(row=row_idx, column=11, value=str(ai_data['pinfl']))
                        if ai_data.get('pass_ber'): ws.cell(row=row_idx, column=12, value=ai_data['pass_ber'])
                        if ai_data.get('dob'): ws.cell(row=row_idx, column=13, value=ai_data['dob'])
                        ws.cell(row=row_idx, column=14, value="Mavjud")
                        if ai_data.get('sh_doc'): ws.cell(row=row_idx, column=15, value=ai_data['sh_doc'])
                        if ai_data.get('sh_qr'): ws.cell(row=row_idx, column=16, value=ai_data['sh_qr'])
                        if ai_data.get('maktab'): ws.cell(row=row_idx, column=17, value=ai_data['maktab'])
                        if ai_data.get('doc_tur'): ws.cell(row=row_idx, column=18, value=ai_data['doc_tur'])
                        if ai_data.get('yil'): ws.cell(row=row_idx, column=19, value=str(ai_data['yil']))

                        group_val = str(ws.cell(row=row_idx, column=23).value or student_group or '').strip()
                        wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                        wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx'))
                        wb.save(os.path.join(BASE_DIR, 'qayta_tekshiruv', 'Talabalar_Yangilangan_Royxat.xlsx'))

                    try:
                        manual_map_path = os.path.join(BASE_DIR, 'scripts', 'manual_file_map.json')
                        if os.path.exists(manual_map_path):
                            with open(manual_map_path, 'r', encoding='utf-8') as mf:
                                mdata = json.load(mf)
                        else:
                            mdata = {"fayllar": {}, "qulflangan": {}}
                        keys_to_lock = []
                        if cur_ism and group_val: keys_to_lock.append(f"{cur_ism}|{group_val}")
                        if full_fish and group_val: keys_to_lock.append(f"{full_fish}|{group_val}")
                        for k in keys_to_lock:
                            mdata.setdefault('fayllar', {})[k] = {
                                "file": target_docx_name,
                                "sabab": f"Pasport/Shahodatnoma yuklandi ({target_docx_name})"
                            }
                            mdata.setdefault('qulflangan', {})[k] = f"Foydalanuvchi tomonidan yuklangan ({target_docx_name})"
                        with open(manual_map_path, 'w', encoding='utf-8') as mf:
                            json.dump(mdata, mf, ensure_ascii=False, indent=2)
                    except Exception as e_map:
                        print(f"manual_file_map yangilash xatosi: {e_map}")

                    trigger_report_rebuild()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "filename": target_docx_name,
                    "filepath": f"files/{target_docx_name}",
                    "images": images_b64,
                    "model_used": used_model_actual,
                    "data": ai_data
                }).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                return

        if parsed_path == '/api/upload_and_attach_to_student':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body.decode('utf-8'))
                b64_content = data.get('file_base64', '')
                filename = data.get('filename', 'talaba_hujjati.docx')
                row_idx = int(data.get('row', '0'))

                if not b64_content:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "Fayl tanlanmagan"}).encode('utf-8'))
                    return

                docx_bytes = base64.b64decode(b64_content)
                saved_path = os.path.join(FILES_DIR, filename)
                with open(saved_path, 'wb') as f:
                    f.write(docx_bytes)

                safe_slug = re.sub(r'[^a-zA-Z0-9_-]+', '_', os.path.splitext(filename)[0]).strip('_')
                if not safe_slug:
                    safe_slug = f"student_row_{row_idx}"

                # 1. Rasmlarni ajratib olish va o'zining maxsus papkasiga (files/extracted/<slug>/) saqlash
                images, blobs_raw, full_text, saved_img_urls = extract_and_save_student_images(saved_path, safe_slug)

                # 2. AVVAL QR KODLARNI TEKSHIRISH (100% RASMIY VA ANIQ!)
                qr_extracted = scan_all_qrs(blobs_raw)
                print(f"upload_and_attach QR natijasi: {qr_extracted}")

                # 3. AI ORQALI CHUQUR TAHLIL QILISH (GEMINI 2.5 PRO)
                content_items = [{'type': 'text', 'text': """Sen professional O'zbekiston ID-karta, Biometrik pasport va Shahodatnoma/Diplom o'quvchisisan.
Ushbu rasmlarni juda sinchiklab tahlil qil va talabaning haqiqiy ma'lumotlarini chiqargin.

Qat'iy Qoidalar:
1. Pasport/ID seriya va raqami:
   - ID-karta: 'AD' yoki 'AE' harflari va KETMA-KET ANIQ 7 TA RAQAM (jami 9 ta belgi!). Masalan: AD1234567, AE4629898.
   - Biometrik pasport: 'AA', 'AB', 'AC', 'FA' va 7 ta raqam.
   - Hech qachon 8 ta yoki 6 ta raqam yozma!
2. JSHSHIR (PINFL):
   - ID-karta yoki pasport pastidagi/orqasidagi ANIQ 14 xonali raqam!
3. Tug'ilgan sana (DOB):
   - Pasportdagi tug'ilgan sana (DD.MM.YYYY).
4. Pasport BERILGAN SANASI (Date of issue):
   - FAQAT Pasport yoki ID-karta berilgan sanasi (Date of issue: DD.MM.YYYY).
   - Shahodatnoma sanasini yoki kelajak sanani EMAS!
5. Shahodatnoma yoki Diplom:
   - Hujjat turi: Maktab bo'lsa 'Shahodatnoma', Kollej/Litsey/Texnikum bo'lsa 'Diplom'
   - Seriya va raqami: Masalan 'UM 03729356' yoki 'T-V 123456'
   - Maktab/Muassasa nomi: Maktab yoki Kollejning to'liq nomi
   - Bitirgan yili: Masalan '2024'

Aniq JSON formatda qaytar:
{
  "ism": "Familiya Ism",
  "ota": "... qizi / ... o'g'li",
  "pass_ser": "AE1234567",
  "pinfl": "14 xonali PINFL",
  "dob": "DD.MM.YYYY",
  "pass_ber": "DD.MM.YYYY",
  "sh_doc": "UM 1234567",
  "doc_tur": "Shahodatnoma",
  "maktab": "...-maktab",
  "yil": "2024"
}"""}]

                for b in blobs_raw:
                    b64 = base64.b64encode(b).decode('utf-8')
                    content_items.append({'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}})
                # 3. AI ORQALI CHUQUR TAHLIL QILISH
                ai_data = {}
                try:
                    req_model = data.get('model', '')
                    model_to_use = SUPPORTED_AI_MODELS.get(req_model, req_model or DEFAULT_AI_MODEL)
                    print(f"upload_and_attach AI modeli: {model_to_use}")
                    payload = {'model': model_to_use, 'messages': [{'role': 'user', 'content': content_items}], 'temperature': 0.0}
                    req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(payload).encode('utf-8'), headers={'Authorization': f'Bearer {OPENROUTER_API_KEY}', 'Content-Type': 'application/json'})
                    with urllib.request.urlopen(req, timeout=45) as resp:
                        res_json = json.loads(resp.read().decode('utf-8'))
                        raw = res_json['choices'][0]['message']['content'].strip()
                        raw = re.sub(r'^```json\s*', '', raw)
                        raw = re.sub(r'\s*```$', '', raw)
                        ai_data = json.loads(raw)
                except Exception as e:
                    print(f"AI Vision xatosi: {e}")

                # Telefon raqamini full_text dan olish
                m_tels = re.findall(r'(?:\+?998[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?\d{3}[\s-]?\d{2}[\s-]?\d{2}', full_text)
                if m_tels:
                    clean_tels = [re.sub(r'\D', '', t) for t in m_tels if len(re.sub(r'\D', '', t)) >= 9]
                    if clean_tels:
                        ai_data['tel'] = " / ".join(list(dict.fromkeys(m_tels)))[:60]

                # QR kod ustuvor
                if qr_extracted:
                    if qr_extracted.get('ism'): ai_data['ism'] = qr_extracted['ism']
                    if qr_extracted.get('ota'): ai_data['ota'] = qr_extracted['ota']
                    if qr_extracted.get('pass_val'): ai_data['pass_ser'] = qr_extracted['pass_val']
                    if qr_extracted.get('pinfl'): ai_data['pinfl'] = qr_extracted['pinfl']
                    if qr_extracted.get('dob'): ai_data['dob'] = qr_extracted['dob']
                    if qr_extracted.get('ber_sana'): ai_data['pass_ber'] = qr_extracted['ber_sana']
                    if qr_extracted.get('cert_val'): ai_data['sh_doc'] = qr_extracted['cert_val']
                    if qr_extracted.get('cert_tur'): ai_data['doc_tur'] = qr_extracted['cert_tur']
                    if qr_extracted.get('maktab'): ai_data['maktab'] = qr_extracted['maktab']
                    if qr_extracted.get('yil'): ai_data['yil'] = qr_extracted['yil']
                    if qr_extracted.get('sh_qr'): ai_data['sh_qr'] = qr_extracted['sh_qr']

                # Pasport berilgan sanasi sinonimlarini tekshirish
                ber_val = (
                    ai_data.get('pass_ber') or 
                    ai_data.get('ber_sana') or 
                    ai_data.get('berilgan') or 
                    ai_data.get('berilgan_sana') or 
                    ai_data.get('date_of_issue')
                )
                if ber_val:
                    ai_data['pass_ber'] = str(ber_val).strip()

                # Pasport seriya 7 raqam bo'lishini to'g'rilash
                if ai_data.get('pass_ser'):
                    m_fix = re.search(r'([A-Z]{2})(\d{7})', ai_data['pass_ser'])
                    if m_fix:
                        ai_data['pass_ser'] = m_fix.group(1) + m_fix.group(2)

                # 3. Excelga yozish
                if row_idx >= 2:
                    with EXCEL_LOCK:
                        wb = openpyxl.load_workbook(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                        ws = wb.active

                        clean_ism = clean_uz_name(ai_data.get('ism', ''))
                        clean_ota = clean_uz_name(ai_data.get('ota', ''))

                        # Foydalanuvchi biriktirgan yangi fayldagi ism va ota to'liq yoziladi
                        if clean_ism:
                            ws.cell(row=row_idx, column=2, value=clean_ism)
                            ai_data['ism'] = clean_ism
                        if clean_ota:
                            ws.cell(row=row_idx, column=7, value=clean_ota)
                            ai_data['ota'] = clean_ota
                        
                        cur_ism = clean_ism or str(ws.cell(row=row_idx, column=2).value or '')
                        cur_ota = clean_ota or str(ws.cell(row=row_idx, column=7).value or '')
                        full_fish = f"{cur_ism} {cur_ota}".strip()
                        ws.cell(row=row_idx, column=8, value=full_fish)

                        if ai_data.get('pass_ser'): ws.cell(row=row_idx, column=10, value=ai_data['pass_ser'])
                        if ai_data.get('pinfl'): ws.cell(row=row_idx, column=11, value=str(ai_data['pinfl']))
                        if ai_data.get('pass_ber'): ws.cell(row=row_idx, column=12, value=ai_data['pass_ber'])
                        if ai_data.get('dob'): ws.cell(row=row_idx, column=13, value=ai_data['dob'])
                        ws.cell(row=row_idx, column=14, value="Mavjud")
                        if ai_data.get('sh_doc'): ws.cell(row=row_idx, column=15, value=ai_data['sh_doc'])
                        if ai_data.get('maktab'): ws.cell(row=row_idx, column=17, value=ai_data['maktab'])
                        if ai_data.get('doc_tur'): ws.cell(row=row_idx, column=18, value=ai_data['doc_tur'])
                        if ai_data.get('yil'): ws.cell(row=row_idx, column=19, value=str(ai_data['yil']))
                        if ai_data.get('tel'): ws.cell(row=row_idx, column=20, value=str(ai_data['tel']))

                        group_val = str(ws.cell(row=row_idx, column=23).value or '').strip()

                        wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Toliq_Royxati.xlsx'))
                        wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx'))
                        wb.save(os.path.join(BASE_DIR, 'qayta_tekshiruv', 'Talabalar_Yangilangan_Royxat.xlsx'))

                    # 4. manual_file_map.json ga saqlash va qulflash
                    try:
                        manual_map_path = os.path.join(BASE_DIR, 'scripts', 'manual_file_map.json')
                        if os.path.exists(manual_map_path):
                            with open(manual_map_path, 'r', encoding='utf-8') as mf:
                                mdata = json.load(mf)
                        else:
                            mdata = {"fayllar": {}, "qulflangan": {}}

                        keys_to_lock = []
                        if cur_ism and group_val: keys_to_lock.append(f"{cur_ism}|{group_val}")
                        if full_fish and group_val: keys_to_lock.append(f"{full_fish}|{group_val}")
                        if clean_ism and group_val: keys_to_lock.append(f"{clean_ism}|{group_val}")

                        for k in keys_to_lock:
                            mdata.setdefault('fayllar', {})[k] = {
                                "file": filename,
                                "sabab": f"Foydalanuvchi biriktirdi (extracted/{safe_slug})"
                            }
                            mdata.setdefault('qulflangan', {})[k] = f"Foydalanuvchi biriktirgan {filename} fayli bilan tasdiqlandi"

                        with open(manual_map_path, 'w', encoding='utf-8') as mf:
                            json.dump(mdata, mf, ensure_ascii=False, indent=2)
                    except Exception as e_map:
                        print(f"manual_file_map yangilash xatosi: {e_map}")

                    # Fondada hisobot HTML larini ham yangilash
                    trigger_report_rebuild()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": "Fayl muvaffaqiyatli yuklandi, o'z papkasiga ajratildi va Excelga saqlandi!",
                    "filename": filename,
                    "extracted_folder": f"files/extracted/{safe_slug}",
                    "images": images,
                    "data": ai_data
                }).encode('utf-8'))
                return

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
                return

        if parsed_path == '/api/analyze_docx':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body.decode('utf-8'))
                b64_content = data.get('file_base64', '')
                filename = data.get('filename', 'yangi_shartnoma.docx')
                default_ism = data.get('ism', '')
                default_yon = data.get('yonalis', '')
                req_model = data.get('model', '')
                use_pro = (req_model == 'pro' or data.get('use_pro') == True or data.get('pro') == '1' or 'pro' in str(req_model))
                
                docx_bytes = base64.b64decode(b64_content)
                saved_path = os.path.join(FILES_DIR, filename)
                with open(saved_path, 'wb') as f:
                    f.write(docx_bytes)
                    
                analysis = analyze_docx_content(docx_bytes, filename, default_ism, default_yon, use_pro=use_pro, model=req_model)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(analysis).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
            return
        if parsed_path == '/api/update_student':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body.decode('utf-8'))
                success = update_student_data(data)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": success,
                    "message": "Talaba ma'lumotlari muvaffaqiyatli yangilandi!" if success else "Talaba topilmadi"
                }).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
            return

        if parsed_path == '/api/delete_student':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body.decode('utf-8'))
                shnum = data.get('shnum', '')
                ism = data.get('ism', '')
                success = delete_student_data(shnum, ism)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": success,
                    "message": "Talaba bazadan o'chirildi!" if success else "Talaba topilmadi"
                }).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
            return

        if parsed_path == '/api/add_students':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body.decode('utf-8'))
                students = data.get('students', [])
                count = save_manual_students(students)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "count": count,
                    "message": f"{count} ta talaba muvaffaqiyatli bazaga qo'shildi!"
                }).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": False,
                    "error": str(e)
                }).encode('utf-8'))
            return

        self.send_error(404, "Endpoint topilmadi")

def update_student_data(st):
    if not os.path.exists(EXCEL_PATH):
        return False
    wb = openpyxl.load_workbook(EXCEL_PATH)
    ws = wb.active
    
    shnum = str(st.get('shnum', '')).strip()
    ism = str(st.get('ism', '')).strip()
    
    target_row = None
    if shnum:
        for r in range(2, ws.max_row + 1):
            if str(ws.cell(row=r, column=5).value or '').strip() == shnum:
                target_row = r
                break
    if not target_row and ism:
        for r in range(2, ws.max_row + 1):
            if str(ws.cell(row=r, column=2).value or '').strip().lower() == ism.lower():
                target_row = r
                break
                
    if not target_row:
        return False
        
    ota = str(st.get('ota', '')).strip()
    fish = f"{ism} {ota}".strip() if ota else ism
    pass_val = str(st.get('pass_val', '')).strip().upper()
    pinfl = str(st.get('pinfl', '')).strip()
    dob = str(st.get('dob', '')).strip()
    ber_sana = str(st.get('ber_sana', '')).strip()
    cert_val = str(st.get('cert_val', '')).strip()
    cert_tur = str(st.get('cert_tur', 'Shahodatnoma')).strip()
    maktab = str(st.get('maktab', '')).strip()
    yil = str(st.get('yil', '')).strip()
    yonalis = str(st.get('yonalis', 'Hamshiralik ishi - 3 yillik')).strip()
    
    ws.cell(row=target_row, column=2, value=ism)
    ws.cell(row=target_row, column=3, value=yonalis)
    if shnum: ws.cell(row=target_row, column=5, value=normalize_shnum(shnum))
    ws.cell(row=target_row, column=7, value=ota)
    ws.cell(row=target_row, column=8, value=fish)
    # 9-ustun (Passport bo'yicha F.I.SH) — bu yerda yozilmaydi,
    # uni scripts/verify_passport_names.py boshqaradi.
    ws.cell(row=target_row, column=10, value=pass_val)
    ws.cell(row=target_row, column=11, value=pinfl)
    if ber_sana and ber_sana != '-': ws.cell(row=target_row, column=12, value=ber_sana)  # Pasport berilgan sana
    ws.cell(row=target_row, column=13, value=dob)
    ws.cell(row=target_row, column=15, value=cert_val)
    ws.cell(row=target_row, column=17, value=maktab)
    ws.cell(row=target_row, column=18, value="Umumiy o'rta maktab" if cert_tur == "Shahodatnoma" else "Kollej")
    ws.cell(row=target_row, column=19, value=yil)
    tel_val = str(st.get('tel', '')).strip()
    if tel_val:
        ws.cell(row=target_row, column=20, value=tel_val)
    ws.cell(row=target_row, column=21, value="TOPILDI")
    ws.cell(row=target_row, column=22, value="Tahrirlandi")
    grp_val = str(st.get('group', '')).strip()
    if grp_val:
        ws.cell(row=target_row, column=23, value=grp_val)
    
    wb.save(EXCEL_PATH)
    trigger_report_rebuild()
    return True

def delete_student_data(shnum, ism):
    if not os.path.exists(EXCEL_PATH):
        return False
    wb = openpyxl.load_workbook(EXCEL_PATH)
    ws = wb.active
    
    target_row = find_student_row_in_sheet(ws, 0, shnum=shnum, ism=ism, strict=True)
    if not target_row:
        return False
        
    del_sh = str(ws.cell(row=target_row, column=5).value or '').strip()
    del_pinfl = str(ws.cell(row=target_row, column=11).value or '').strip()
    ws.delete_rows(target_row, 1)
    
    for r in range(2, ws.max_row + 1):
        ws.cell(row=r, column=1, value=r - 1)
        
    wb.save(EXCEL_PATH)
    wb.save(os.path.join(BASE_DIR, 'data', 'Talabalar_Yangilangan_Royxat.xlsx'))
    wb.save(os.path.join(BASE_DIR, 'qayta_tekshiruv', 'Talabalar_Yangilangan_Royxat.xlsx'))

    try:
        with VERIFICATIONS_LOCK:
            if os.path.exists(VERIFICATIONS_FILE):
                with open(VERIFICATIONS_FILE, 'r', encoding='utf-8') as vf:
                    vmap = json.load(vf)
                vmap.pop(str(target_row), None)
                if del_sh: vmap.pop('sh_' + del_sh, None)
                if del_pinfl: vmap.pop('pinfl_' + del_pinfl, None)
                with open(VERIFICATIONS_FILE, 'w', encoding='utf-8') as vf:
                    json.dump(vmap, vf, ensure_ascii=False, indent=2)
    except Exception:
        pass

    trigger_report_rebuild()
    return True

def run_server(port=8080):
    if port == 5005:
        port = 8080
    try:
        my_pid = os.getpid()
        ps_cmd = f"Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"
        out = subprocess.check_output(["powershell", "-NoProfile", "-Command", ps_cmd], text=True, timeout=4)
        for line in out.splitlines():
            line = line.strip()
            if line.isdigit():
                old_pid = int(line)
                if old_pid != my_pid and old_pid > 0:
                    subprocess.run(["taskkill", "/F", "/PID", str(old_pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

    class ThreadedServer(ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    chosen_port = port
    httpd = None
    for p in [port, port + 1, port + 2, 8088, 8000]:
        try:
            server_address = ('0.0.0.0', p)
            httpd = ThreadedServer(server_address, WebServerHandler)
            chosen_port = p
            break
        except OSError as e:
            print(f"[OGOHLANTIRISH] Port {p} band bo'lgani uchun keyingi port tekshirilmoqda ({e})...")
            continue

    if not httpd:
        print("[XATO] Hech bir portda serverni ishga tushirib bo'lmadi!")
        return

    dashboard_url = f"http://localhost:{chosen_port}/hisobot.html"
    print(f"==================================================================")
    print(f"[SERVER] TALABALARNI QO'SHISH & DASHBOARD SERVERI ISHGA TUSHDI!")
    print(f"[MANZIL] Asosiy portal (yangi): http://localhost:3000")
    print(f"[MANZIL] Eski portal (arxiv):   {dashboard_url}")
    print(f"==================================================================")

    # Asosiy portal endi web/ (localhost:3000) — uni ISHGA_TUSHIRISH.bat ochadi.
    # Eski portalni avtomatik ochish faqat ESKI_PORTAL_OCHISH=1 bo'lsa.
    if os.environ.get('ESKI_PORTAL_OCHISH') == '1':
        try:
            webbrowser.open(dashboard_url)
        except Exception:
            pass

    # GitHub'dan masofaviy o'zgarishlarni avtomatik qabul qilish tinglovchisi
    try:
        _start_remote_sync_listener()
        print("[SYNC] 🔄 GitHub masofaviy sinxronizatsiya tinglovchisi ishga tushirildi!")
    except Exception as e_sync:
        print(f"[SYNC] Tinglovchini ishga tushirishda xato: {e_sync}")

    # Kunlik avto-zahira (09:00 Kontingent & 18:00 JSON Baza) + Interaktiv Telegram Bot menyusi
    try:
        _start_daily_backup_scheduler()
        _start_telegram_bot_polling()
        if load_backup_config():
            print("[ZAHIRA & BOT] 🤖 Telegram bot sozlamasi topildi")
        else:
            print("[ZAHIRA] ⚠️ Sozlanmagan: scripts/backup_config.json yarating (bot_token, chat_id)")
    except Exception as e_bk:
        print(f"[ZAHIRA] Rejalashtiruvchini ishga tushirishda xato: {e_bk}")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[SERVER] Server to'xtatildi.")
        httpd.server_close()

if __name__ == '__main__':
    port = 8080
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            port = 8080
    run_server(port)
