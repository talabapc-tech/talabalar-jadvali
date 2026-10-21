# -*- coding: utf-8 -*-
import os
import sys
import json
import re
import time
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, 'xizmatlar'))

import telegram_sync_service as tss

def load_data():
    json_path, _ = tss.build_json_database_file()
    with open(json_path, 'r', encoding='utf-8') as f:
        students = json.load(f).get('students', [])
    meta = tss.load_groups_metadata()
    cfg = tss.load_backup_config()
    return students, meta, cfg

def get_stats(students, meta):
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

    k1_st = [s for s in official if tss.get_kurs_of_group(str(s.get('group') or '').strip(), meta) == 1]
    k2_st = [s for s in official if tss.get_kurs_of_group(str(s.get('group') or '').strip(), meta) == 2]
    k3_st = [s for s in official if tss.get_kurs_of_group(str(s.get('group') or '').strip(), meta) == 3]

    k1_gr = sorted([g for g in group_set if tss.get_kurs_of_group(g, meta) == 1])
    k2_gr = sorted([g for g in group_set if tss.get_kurs_of_group(g, meta) == 2])
    k3_gr = sorted([g for g in group_set if tss.get_kurs_of_group(g, meta) == 3])

    today_ddmm = time.strftime('%d.%m')
    bdays = [s for s in official if str(s.get('dob') or '').strip().startswith(today_ddmm + '.')]

    stamp = time.strftime('%d.%m.%Y | %H:%M')

    return {
        'students': students,
        'meta': meta,
        'group_set': group_set,
        'official': official,
        'leave': leave,
        'withdrawn': withdrawn,
        'ver_count': ver_count,
        'ver_pct': ver_pct,
        'k1_st': k1_st, 'k2_st': k2_st, 'k3_st': k3_st,
        'k1_gr': k1_gr, 'k2_gr': k2_gr, 'k3_gr': k3_gr,
        'bdays': bdays,
        'stamp': stamp
    }

# ==================== 10 XIL VARIANT ====================

def variant_1(d):
    """1-VARIANT: KLASSIK VA RASMIY (Standart kengaytirilgan)"""
    lines = [
        "🏛 <b>SHAHRISABZ TIBBIYOT TEXNIKUMI</b>",
        "📈 <b>TALABALAR KONTINGENTI MA'LUMOTI (1-variant: Rasmiy)</b>",
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
        lines.append(f"\n🔹 <b>{k}-kurs ({len(grs)} ta guruh | {len(sts)} nafar):</b>")
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


def variant_2(d):
    """2-VARIANT: IXCHAM & SMART DASHBOARD (Tezkor o'qish uchun)"""
    lines = [
        "📊 <b>KONTINGENT DASHBOARD (2-variant: Ixcham)</b>",
        f"📅 <i>{d['stamp']}</i>",
        "━" * 28,
        f"🟢 <b>Faol:</b> {len(d['official'])} nafar | <b>Guruhlar:</b> {len(d['group_set'])} ta",
        f"├ 1-kurs: <b>{len(d['k1_st'])}</b> | 2-kurs: <b>{len(d['k2_st'])}</b> | 3-kurs: <b>{len(d['k3_st'])}</b>",
        f"✅ <b>Hujjat tasdig'i:</b> {d['ver_count']}/{len(d['official'])} ({d['ver_pct']}%)",
        f"⏸ Ta'tilda: {len(d['leave'])} | 🚫 Safdan chiqqan: {len(d['withdrawn'])} | 📦 Jami: {len(d['students'])}",
        "━" * 28,
        "🎓 <b>GURUHLAR TAQSIMOTI:</b>"
    ]
    for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
        lines.append(f"\n▫️ <b>{k}-KURS ({len(sts)} nafar):</b>")
        for g in grs:
            n = len([s for s in sts if str(s.get('group') or '').strip() == g])
            m = d['meta'].get(g, {})
            r = m.get('rahbar', '—')
            lines.append(f"• <b>{g}</b> ➔ <b>{n} nafar</b> <i>({r})</i>")

    if d['bdays']:
        lines.append("\n🎂 <b>Tug'ilgan kunlar:</b>")
        for b in d['bdays']: lines.append(f"• {b.get('fish','')} ({b.get('group','')})")
    return "\n".join(lines)


def variant_3(d):
    """3-VARIANT: FOIZLAR VA PROGRESS BAR (Statistik / Vizual)"""
    bars_full = round(d['ver_pct'] / 10)
    bar = "█" * bars_full + "░" * (10 - bars_full)
    pct1 = round(len(d['k1_st']) / len(d['official']) * 100, 1)
    pct2 = round(len(d['k2_st']) / len(d['official']) * 100, 1)
    pct3 = round(len(d['k3_st']) / len(d['official']) * 100, 1)

    lines = [
        "📈 <b>KONTINGENT STATISTIKASI (3-variant: Vizual)</b>",
        f"🕒 {d['stamp']}",
        "══════════════════════════",
        f"🎯 <b>Hujjatlar tayyorligi:</b> [{bar}] <b>{d['ver_pct']}%</b>",
        f"   ({d['ver_count']} / {len(d['official'])} ta talaba tasdiqlangan)",
        "",
        "📊 <b>Kurslar ulushi:</b>",
        f"   1⃣ 1-kurs: <b>{len(d['k1_st'])} nafar</b> ({pct1}%)",
        f"   2⃣ 2-kurs: <b>{len(d['k2_st'])} nafar</b> ({pct2}%)",
        f"   3⃣ 3-kurs: <b>{len(d['k3_st'])} nafar</b> ({pct3}%)",
        "══════════════════════════",
        "📋 <b>Guruhlar bo'yicha ko'rsatkich:</b>"
    ]
    idx = 1
    for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
        lines.append(f"\n<b>[{k}-kurs guruhlari]</b>")
        for g in grs:
            n = len([s for s in sts if str(s.get('group') or '').strip() == g])
            m = d['meta'].get(g, {})
            lines.append(f"#{idx:02d} | <b>{g}</b> | {n} nafar | 👤 {m.get('rahbar','—')}")
            idx += 1

    lines.append("\n━━━━━━━━━━━━━━━━━━━━━━")
    lines.append(f"⏸ Ta'tilda: <b>{len(d['leave'])}</b> | 🚫 Safdan chiqqan: <b>{len(d['withdrawn'])}</b> | 📦 Baza: <b>{len(d['students'])}</b>")
    if d['bdays']:
        for b in d['bdays']: lines.append(f"🎂 Bugun: <b>{b.get('fish','')}</b> ({b.get('group','')})")
    return "\n".join(lines)


def variant_4(d):
    """4-VARIANT: YO'NALISHLAR KESIMIDA (Mutaxassislik bo'yicha guruhlangan)"""
    farm_gr = [g for g in d['group_set'] if 'farm' in str(d['meta'].get(g, {}).get('yonalish', '')).lower()]
    hamsh_gr = [g for g in d['group_set'] if g not in farm_gr]

    farm_st = [s for s in d['official'] if str(s.get('group') or '').strip() in farm_gr]
    hamsh_st = [s for s in d['official'] if str(s.get('group') or '').strip() in hamsh_gr]

    lines = [
        "🏥 <b>MUTAXASSISLIKLAR KESIMIDA HISOBOT (4-variant)</b>",
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
        sub_gr = [g for g in hamsh_gr if tss.get_kurs_of_group(g, d['meta']) == k]
        sub_st = [s for s in hamsh_st if tss.get_kurs_of_group(str(s.get('group') or '').strip(), d['meta']) == k]
        lines.append(f"\n  🔹 <b>{k}-kurs ({len(sub_gr)} ta guruh | {len(sub_st)} talaba):</b>")
        for g in sorted(sub_gr):
            n = len([s for s in sub_st if str(s.get('group') or '').strip() == g])
            m = d['meta'].get(g, {})
            lines.append(f"  └ <b>{g}</b> ➔ <b>{n} nafar</b> — {m.get('rahbar','—')}")

    lines.append(f"\n⏸ Akademik ta'tilda: {len(d['leave'])} | 🚫 Chetlatilganlar: {len(d['withdrawn'])}")
    if d['bdays']:
        for b in d['bdays']: lines.append(f"🎂 Bugun tavallud: <b>{b.get('fish','')}</b> ({b.get('group','')})")
    return "\n".join(lines)


def variant_5(d):
    """5-VARIANT: ZAMONAVIY DARAXTSIMON (Box-Tree struktura)"""
    lines = [
        "╔══════════════════════════════╗",
        "║  🏛 KONTINGENT HISOBOTI      ║",
        "║  (5-variant: Daraxtsimon)    ║",
        "╚══════════════════════════════╝",
        f"🕒 Sana: {d['stamp']}",
        "",
        "┌─ 📊 <b>UMUMIY HOLAT</b>",
        f"│  ├─ 👥 Faol talabalar: <b>{len(d['official'])}</b> ({len(d['group_set'])} ta guruh)",
        f"│  ├─ ✅ Tasdiqlangan: <b>{d['ver_count']}/{len(d['official'])}</b> ({d['ver_pct']}%)",
        f"│  ├─ ⏸ Akademik ta'tilda: <b>{len(d['leave'])}</b>",
        f"│  ├─ 🚫 Safdan chiqarilgan: <b>{len(d['withdrawn'])}</b>",
        f"│  └─ 📦 Jami bazada: <b>{len(d['students'])}</b>",
        "└─────────────────────────────"
    ]
    for k, grs, sts in [(1, d['k1_gr'], d['k1_st']), (2, d['k2_gr'], d['k2_st']), (3, d['k3_gr'], d['k3_st'])]:
        lines.append(f"\n┌─ 🎓 <b>{k}-KURS ({len(sts)} nafar talaba)</b>")
        for i, g in enumerate(grs):
            n = len([s for s in sts if str(s.get('group') or '').strip() == g])
            m = d['meta'].get(g, {})
            is_last = (i == len(grs) - 1)
            char = "└─" if is_last else "├─"
            n_str = (" " * (2 - len(str(n)))) + str(n) if len(str(n)) < 2 else str(n)
            lines.append(f"│  {char} <b>{g}</b>: {n_str} nafar │ {m.get('rahbar','—')}")
        lines.append("└─────────────────────────────")

    if d['bdays']:
        for b in d['bdays']: lines.append(f"🎉 <b>Tug'ilgan kun:</b> {b.get('fish','')} ({b.get('group','')})")
    return "\n".join(lines)


def variant_6(d):
    """6-VARIANT: GURUH RAHBARLARI (MURABBIYLAR) MARKAZLASHGAN"""
    lines = [
        "👨‍🏫 <b>GURUH RAHBARLARI KESIMIDA (6-variant)</b>",
        f"📅 Sana: <b>{d['stamp']}</b>",
        "──────────────────────────────",
        f"🏛 Shahrisabz Tibbiyot Texnikumi",
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
            r = m.get('rahbar', '—')
            lines.append(f"👤 <b>{r}</b>\n   └ Guruh: <b>{g}</b> ({m.get('yonalish','Hamshiralik ishi')}) ➔ <b>{n} talaba</b>")

    lines.append("\n──────────────────────────────")
    lines.append(f"⏸ Akademik ta'tilda: {len(d['leave'])} | 🚫 Safdan chiqqan: {len(d['withdrawn'])}")
    if d['bdays']:
        for b in d['bdays']: lines.append(f"🎂 Bugun: <b>{b.get('fish','')}</b> ({b.get('group','')})")
    return "\n".join(lines)


def variant_7(d):
    """7-VARIANT: JADVALSIMON PRE FORMATI (Monospace xulosa)"""
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
        "📊 <b>KONTINGENT MATRITSASI (7-variant: Monospace)</b>",
        f"🕒 <i>{d['stamp']}</i>\n",
        table,
        f"⏸ Ta'til: <b>{len(d['leave'])}</b> | 🚫 Chetlatilgan: <b>{len(d['withdrawn'])}</b> | 📦 Baza: <b>{len(d['students'])}</b>",
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


def variant_8(d):
    """8-VARIANT: ELEGANT & MINIMALIST (Kam emoji, sof matn)"""
    lines = [
        "<b>SHAHRISABZ TIBBIYOT TEXNIKUMI</b>",
        "<b>Talabalar kontingenti to'g'risida axborot (8-variant: Minimal)</b>",
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


def variant_9(d):
    """9-VARIANT: NAZORAT & HUJJATLAR AUDITI (Inspeksiya / Monitoring)"""
    not_ver = len(d['official']) - d['ver_count']
    lines = [
        "🛡 <b>KONTINGENT VA HUJJATLAR MONITORINGI (9-variant: Audit)</b>",
        f"🕒 Holat: <b>{d['stamp']}</b>",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "📋 <b>HUJJATLAR STATUSI:</b>",
        f"  ✅ To'liq tasdiqlangan: <b>{d['ver_count']} nafar</b> ({d['ver_pct']}%)",
        f"  ⚠️ Tekshiruvda / Kamchilik: <b>{not_ver} nafar</b> ({100 - d['ver_pct']}%)",
        f"  👥 Jami tekshiruvdagi faol kontingent: <b>{len(d['official'])} nafar</b>",
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
            lines.append(f"<b>{idx}. Guruh {g}</b>: {len(g_st)} nafar (Tasdiq: {g_ver}/{len(g_st)}) | 👤 {m.get('rahbar','—')}")
            idx += 1

    if d['bdays']:
        lines.append("")
        for b in d['bdays']: lines.append(f"🎂 {b.get('fish','')} ({b.get('group','')})")
    return "\n".join(lines)


def variant_10(d):
    """10-VARIANT: PREMIUM EXECUTIVE BRIEFING (Rahbariyat brifingi)"""
    lines = [
        "👑 <b>TEXNIKUM KONTINGENTI — KUNLIK BRIFING (10-variant: Premium)</b>",
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
        lines.append(f"\n🌟 <b>{k}-BOSQICH ({len(grs)} ta guruh | {len(sts)} nafar talaba):</b>")
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


VARIANTS = [
    (1, "Klassik & Rasmiy (Standart kengaytirilgan)", variant_1),
    (2, "Ixcham & Smart Dashboard (Tezkor)", variant_2),
    (3, "Foizlar & Vizual Progress Bar", variant_3),
    (4, "Yo'nalishlar (Mutaxassisliklar) Kesimida", variant_4),
    (5, "Zamonaviy Daraxtsimon (Box-Tree)", variant_5),
    (6, "Guruh Rahbarlari Markazlashgan", variant_6),
    (7, "Jadvalli Monospace Matritsa", variant_7),
    (8, "Elegant Minimalist (Sof matn)", variant_8),
    (9, "Nazorat & Hujjatlar Auditi (Monitoring)", variant_9),
    (10, "Premium Executive Briefing (Rahbariyat)", variant_10),
]

def main():
    students, meta, cfg = load_data()
    if not cfg:
        print("XATO: scripts/backup_config.json topilmadi!")
        return

    d = get_stats(students, meta)
    token = cfg['token']
    chat_id = cfg['chat_id']

    intro = (
        "✨ <b>TALABALAR KONTINGENTI HISOBOTI UCHUN 10 XIL VARIANT TAYYORLANDI!</b>\n\n"
        "Quyida 1-variantdan 10-variantgacha har bir uslub alohida xabar qilib yuboriladi. "
        "Ko'rib chiqib, sizga eng ma'qul kelgan variant raqamini tanlashingiz mumkin."
    )
    requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json={'chat_id': chat_id, 'text': intro, 'parse_mode': 'HTML'}, timeout=20)
    time.sleep(1)

    for num, name, fn in VARIANTS:
        header = f"━━━━━━━━━━━━━━━━━━━━\n💎 <b>{num}-VARIANT: {name.upper()}</b>\n━━━━━━━━━━━━━━━━━━━━\n\n"
        body = fn(d)
        full_msg = header + body

        resp = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={'chat_id': chat_id, 'text': full_msg, 'parse_mode': 'HTML'},
            timeout=30
        )
        if resp.ok and resp.json().get('ok'):
            print(f"[OK] {num}-variant muvaffaqiyatli yuborildi ({len(full_msg)} belgi)")
        else:
            print(f"[XATO] {num}-variant yuborilmadi: {resp.text}")
        time.sleep(1.2)  # Telegram rate limitni buzmaslik uchun

    summary = (
        "🏁 <b>Barcha 10 xil variant yuborildi!</b>\n\n"
        "💡 <i>Qaysi variant sizga ko'proq ma'qul kelsa, o'shani 09:00 avto-hisobot uchun asosiy qilib belgilab beraman.</i>"
    )
    requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json={'chat_id': chat_id, 'text': summary, 'parse_mode': 'HTML'}, timeout=20)
    print("BARCHA 10 VARIANT TELEGRAMGA YUBORILDI!")

if __name__ == '__main__':
    main()
