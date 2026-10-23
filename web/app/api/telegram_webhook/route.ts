import type { NextRequest } from 'next/server'
import { COURSES, GROUP_LEADERS } from '@/lib/config'
import { malumotnomaBlocker, malumotnomaData, malumotnomaFileName } from '@/lib/malumotnoma'
import { renderMalumotnomaJpg } from '@/lib/server/malumotnoma-rasm'
import { academicGroups, byName, fullName, groupTitle, isAcademicLeave, isOfficialGroup, isOutside, kursOf } from '@/lib/student'
import { loadGroupSettings, loadStaff, loadStudents, REPO_PATHS, readRepoFile, readRepoFileIn, saveStaff, sendChange } from '@/lib/server/source'
import { analyzeDocumentImage, parseTextData } from '@/lib/server/telegram-ai'
import { deletePendingDraft, getPendingDraft, getUserMode, type PendingDraft, savePendingDraft, setUserMode } from '@/lib/server/telegram-session'
import { cleanStaffPhone, type StaffMember } from '@/lib/staff'
import { renderGroupListPng } from '@/lib/server/guruh-rasm'
import { siteOrigin, TG_ALLOWED_IDS, TG_BOT_TOKEN, TG_CHAT_ID, TG_REPORT_KEY, TG_WEBHOOK_SECRET, tgCall, tgEsc as esc, tgSendPhoto } from '@/lib/server/telegram'
import type { Student } from '@/lib/types'
import { majlisMatni } from '@/lib/majlis'
import { loadMajlisDb } from '@/lib/server/majlis-store'

/*
  24/7 Telegram bot webhook va kunlik hisobotlar (eski api/telegram_webhook.js dan ko'chirilgan).

  GET  ?action=kontingent   — 09:00 kontingent hisoboti (Netlify jadval funksiyasi, &key= bilan)
  GET  ?action=backup_json  — 18:00 JSON baza + 4-Excel zahirasi (&key= bilan)
  GET  ?action=setup        — webhookni shu sayt manziliga ulash (maxfiy kalit bilan)
  GET  ?action=status       — bot va webhook holati (oxirgi xato, navbatdagi xabarlar)
  POST callback_query       — ichma-ich menyular: m:st (Talabalar), m:xd (Xodimlar), m:rep (Hisobotlar);
                              gl → kurslar, k:<kurs> → guruhlar, g:<guruh> → matn + rasm
  POST "🗓 Majlis" / /majlis — o'qituvchilar majlisi davomati Mini App'ini (/majlis) ochish tugmasi

  Asosiy klaviatura atigi 4 bo'lim; har biri o'z menyusini ochadi va tugma bosilganda xabarning
  o'zi almashadi (chat to'lib ketmaydi). Ro'yxatlar Telegram iqtibosi (<blockquote>) ichida —
  uzunlari yig'iq (expandable) holda keladi.
  POST               — Telegram'dan kelgan xabar (bot tugmalari, talaba/guruh qidiruvi,
                              /malumotnoma <shartnoma № yoki F.I.SH>)

  Bot faqat TELEGRAM_CHAT_ID va TELEGRAM_ALLOWED_IDS dagi chatlarga javob beradi; begona
  so'rovlar X-Telegram-Bot-Api-Secret-Token sarlavhasi bo'yicha rad etiladi.
  Ma'lumot: data/talabalar_bazasi.json, hisobotlar/rollar/*.xlsx, hisobotlar/pdf_jurnallar/
  (Netlify'da GitHub'dan, kompyuterda diskdan).
*/

const BOT_TOKEN = TG_BOT_TOKEN
/** Bot o'qiydigan baza va hisobot fayllari 1 daqiqa keshlanadi (har bosishda GitHub'ga bormaslik uchun) */
const BOT_CACHE = { maxAgeMs: 60_000 }
const DEFAULT_CHAT_ID = TG_CHAT_ID

/** Asosiy menyu — 4 ta bo'lim. Qolgan hamma narsa shu bo'limlar ichida (inline tugmalar). */
const MENU = {
  talabalar: '🎓 Talabalar',
  xodimlar: '👨‍🏫 Xodimlar',
  hisobotlar: '📊 Hisobotlar',
  majlis: '🗓 Majlis',
} as const

const BOT_KEYBOARD = {
  keyboard: [
    [{ text: MENU.talabalar }, { text: MENU.xodimlar }],
    [{ text: MENU.hisobotlar }, { text: MENU.majlis }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: 'Talaba ismi, shartnoma № yoki JSHSHIR…',
}

/** Ro'yxat — Telegram iqtibosi ichida; uzun bo'lsa yig'iq (bosilganda ochiladi) */
function quote(lines: string[], expandable = lines.length > 12) {
  return lines.length ? `<blockquote${expandable ? ' expandable' : ''}>${lines.join('\n')}</blockquote>` : ''
}

/** Menyu tugmasi matnidan emoji va bo'shliqlarni olib tashlash: "🎓 Talabalar" → "talabalar" */
const plainText = (t: string) => t.replace(/^[^\p{L}\d/]+/u, '').trim()

const ROLE_FILES = [
  { match: ['buxgalter', '1. buxgalter', '/buxgalteriya'], file: '1_Buxgalteriya_Shartnoma_va_Pasport.xlsx', title: '1. Buxgalteriya (Shartnoma № va Pasport)' },
  { match: ['baza admin', '2. baza', '/admin'], file: '2_Baza_Admin_Pasport_va_Shahodatnoma.xlsx', title: '2. Baza Administratori (Pasport va Shahodatnoma/Diplom)' },
  { match: ['guruh rahbar', '3. guruh', '/guruh_rahbari'], file: '3_Guruh_Rahbarlari_Talabalar_Malumotlari.xlsx', title: "3. Guruh Rahbarlari (Tug'ilgan sana, Pasport va Shahodatnoma)" },
  { match: ["to'liq", 'toliq', '4. to', '/toliq'], file: '4_Toliq_Malumotlar_Bazasi.xlsx', title: "4. To'liq Ma'lumotlar (O'zim uchun barcha ustunlar)" },
]

/** PDF jurnallar (Python generate_pdfs.py) faqat 1-kurs guruhlari uchun yasaladi */
const pdfGroups = () => COURSES.find((c) => c.kurs === 1)?.groups ?? []

async function loadStudentsDb(): Promise<Student[]> {
  const buf = await readRepoFile(REPO_PATHS.baza, BOT_CACHE)
  if (!buf) return []
  try {
    const data = JSON.parse(buf.toString('utf-8'))
    return Array.isArray(data.students) ? data.students : []
  } catch {
    return []
  }
}

async function tg(method: string, body: BodyInit, json = false) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    ...(json ? { headers: { 'Content-Type': 'application/json' } } : {}),
    body,
  })
  return res.json().catch(() => ({ ok: false }))
}

/** Telegram bitta xabarga 4096 belgidan ko'p qabul qilmaydi — uzun hisobot qatorlar bo'yicha bo'linadi */
const MAX_MESSAGE = 3900

function splitMessage(text: string): string[] {
  const parts: string[] = []
  let cur = ''
  // Ochiq turgan <blockquote …> yoki <pre> — bo'linish shu teg ichiga to'g'ri kelsa, yopib, keyingi bo'lakda qayta ochamiz
  let open: string | null = null
  for (const block of text.split('\n')) {
    const line = block.length > MAX_MESSAGE ? block.slice(0, MAX_MESSAGE) : block
    if (cur && cur.length + line.length + 20 > MAX_MESSAGE) {
      parts.push(open ? `${cur}${closeTag(open)}` : cur)
      cur = open ? `${open}${line}` : line
    } else {
      cur = cur ? `${cur}\n${line}` : line
    }
    for (const m of line.matchAll(/<(\/?)(blockquote|pre)\b[^>]*>/g)) open = m[1] ? null : m[0]
  }
  if (cur) parts.push(cur)
  return parts
}

const closeTag = (open: string) => (open.startsWith('<pre') ? '</pre>' : '</blockquote>')

async function sendMessage(chatId: string | number, text: string, markup: unknown = BOT_KEYBOARD) {
  let last: { ok?: boolean; description?: string } = { ok: false }
  const parts = splitMessage(text)
  for (const [i, part] of parts.entries()) {
    // Tugmalar faqat oxirgi bo'lak ostida
    const extra = i === parts.length - 1 ? { reply_markup: markup } : {}
    last = await tg('sendMessage', JSON.stringify({ chat_id: chatId, text: part, parse_mode: 'HTML', ...extra }), true)
    if (!last.ok) console.error('sendMessage xatosi:', last.description)
  }
  return last
}

function sendDocument(chatId: string | number, buf: Buffer, fileName: string, caption: string) {
  const fd = new FormData()
  fd.append('chat_id', String(chatId))
  fd.append('caption', caption)
  fd.append('parse_mode', 'HTML')
  fd.append('document', new Blob([new Uint8Array(buf)]), fileName)
  return tg('sendDocument', fd)
}

/** O‘zbekcha apostroflarning barcha ko‘rinishlarini bittaga keltirish (o‘g‘li = o'g'li = o`g`li) */
const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[‘’ʻʼ`´]/g, "'").replace(/\s+/g, ' ').trim()

function tashkentStamp() {
  const now = new Date(Date.now() + 5 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const dd = p(now.getUTCDate()), mm = p(now.getUTCMonth() + 1)
  return { stamp: `${dd}.${mm}.${now.getUTCFullYear()} | ${p(now.getUTCHours())}:${p(now.getUTCMinutes())}`, ddmm: `${dd}.${mm}` }
}

async function kontingentText(reason: string) {
  const students = await loadStudentsDb()
  const groups = academicGroups(students)
  const official = students.filter((s) => isOfficialGroup(s.group))
  const leave = students.filter((s) => isAcademicLeave(s.group))
  const withdrawn = students.filter((s) => isOutside(s.group))
  const ver = official.filter((s) => s.verified === 'TASDIQLANDI').length
  const { stamp, ddmm } = tashkentStamp()
  const p = (n: number, w: number) => String(n).padStart(w, ' ')

  const lines = [
    `🏛 <b>KONTINGENT TUZILMASI (${reason})</b>`,
    `🕒 Sana: <b>${stamp}</b>`,
    '',
    '┌─ 📊 <b>UMUMIY HOLAT</b>',
    '<pre>',
    `├─ Faol kontingent   | ${p(official.length, 3)} nafar`,
    `├─ Guruhlar soni     | ${p(groups.length, 3)} ta guruh`,
    `├─ Hujjat tasdig'i   | ${p(ver, 3)}/${official.length} (${official.length ? Math.round((ver / official.length) * 100) : 0}%)`,
    `├─ Akademik ta'tilda | ${p(leave.length, 3)} nafar`,
    `├─ Safdan chiqqan    | ${p(withdrawn.length, 3)} nafar`,
    `└─ Jami bazada       | ${p(students.length, 3)} nafar`,
    '</pre>',
  ]

  COURSES.forEach((c) => {
    const kGr = groups.filter((g) => kursOf(g) === c.kurs)
    if (!kGr.length) return
    const kSt = official.filter((s) => kursOf(s.group) === c.kurs)
    lines.push(`\n┌─ 🎓 <b>${c.kurs}-KURS (${kSt.length} nafar talaba)</b>`)
    lines.push('<pre>')
    kGr.forEach((g, i) => {
      const n = students.filter((s) => String(s.group || '').trim() === g).length
      const char = i === kGr.length - 1 ? '└─' : '├─'
      const r = GROUP_LEADERS[g] || '—'
      const title = groupTitle(g)
      const spec = title.toLowerCase().includes('farm') ? ' (Farm)' : ''
      lines.push(`${char} ${g.padEnd(5, ' ')} | ${p(n, 2)} nafar | ${r}${spec}`)
    })
    lines.push('</pre>')
  })

  const bdays = official.filter((s) => String(s.dob || '').startsWith(`${ddmm}.`))
  if (bdays.length) {
    lines.push("\n🎉 <b>Bugun tug'ilgan kunlar:</b>")
    lines.push(quote(bdays.map((b) => `• <b>${esc(b.fish)}</b> — ${esc(b.group)}, ${esc(b.dob)}`)))
  }
  return lines.join('\n')
}

async function kamchiliklarText() {
  const students = (await loadStudentsDb()).filter((s) => isOfficialGroup(s.group))
  const lines = [
    "⚠️ <b>Hujjatida kamchiligi bor talabalar</b>",
    quote([
      `Pasport seriyasi yo'q: <b>${students.filter((s) => !s.pv).length}</b>`,
      `JSHSHIR yo'q: <b>${students.filter((s) => !s.pinfl).length}</b>`,
      `Shahodatnoma / diplom № yo'q: <b>${students.filter((s) => !s.sh_doc).length}</b>`,
      `Shartnoma № yo'q: <b>${students.filter((s) => !s.shnum).length}</b>`,
    ], false),
  ]
  // Hujjat kamchiligi (pasport, JSHSHIR, shahodatnoma) — ismma-ism
  const docGaps = students.filter((s) => !s.pv || !s.pinfl || !s.sh_doc)
  if (docGaps.length) {
    lines.push(`📋 <b>Hujjati to'liq emas — ${docGaps.length} nafar</b>`)
    lines.push(quote(docGaps.map((s, i) => {
      const miss = [!s.pv && 'pasport', !s.pinfl && 'JSHSHIR', !s.sh_doc && 'shahodatnoma', !s.shnum && 'shartnoma №'].filter(Boolean)
      return `${i + 1}. <b>${esc(s.fish)}</b> — ${esc(s.group)}\n      ❌ <i>${miss.join(', ')}</i>`
    })))
  }
  // Shartnoma raqami yo'qlar ko'p bo'ladi (2–3-kurs) — guruhlar kesimida soni bilan
  const noShnum = students.filter((s) => !s.shnum)
  if (noShnum.length) {
    const byGroup = new Map<string, number>()
    for (const s of noShnum) byGroup.set(s.group, (byGroup.get(s.group) ?? 0) + 1)
    lines.push(`📄 <b>Shartnoma № yo'q — guruhlar kesimida</b>`)
    lines.push(quote([...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([g, n]) => `${esc(g)} — <b>${n}</b> nafar${GROUP_LEADERS[g] ? ` · ${esc(GROUP_LEADERS[g])}` : ''}`)))
    lines.push("<i>Ismma-ism ro'yxat: 📊 Hisobotlar → Excel → 4. To'liq baza</i>")
  }
  if (!docGaps.length && !noShnum.length) lines.push("✅ Barcha talabalarning hujjatlari to'liq.")
  return lines.join('\n')
}

function studentCard(s: Student, i: number) {
  return `<b>${i + 1}. ${esc(s.fish)}</b>\n` + quote([
    `👥 Guruh: <b>${esc(s.group || '—')}</b>${GROUP_LEADERS[s.group] ? ` · ${esc(GROUP_LEADERS[s.group])}` : ''}`,
    `📄 Shartnoma №: <b>${esc(s.shnum || '—')}</b>`,
    `📅 Tug'ilgan: <b>${esc(s.dob || '—')}</b>`,
    `🪪 Pasport: <code>${esc(s.pv || '—')}</code>${s.ber ? ` (${esc(s.ber)})` : ''}`,
    `🔢 JSHSHIR: <code>${esc(s.pinfl || '—')}</code>`,
    `📜 ${esc(s.doc_tur || 'Shahodatnoma')}: <code>${esc(s.sh_doc || '—')}</code>`,
    `🏫 ${esc(s.mak || '—')}${s.yil ? ` (${esc(s.yil)})` : ''}`,
    `📞 ${esc(s.tel || '—')}`,
  ], false)
}


async function loadStaffDb(): Promise<StaffMember[]> {
  try {
    const list = await loadStaff()
    if (Array.isArray(list) && list.length) return list
    const buf = await readRepoFile(['data/xodimlar.json', 'xodimlar.json'], BOT_CACHE)
    if (buf) {
      const parsed = JSON.parse(buf.toString('utf-8'))
      if (Array.isArray(parsed)) return parsed as StaffMember[]
    }
  } catch { /* bo'sh */ }
  return []
}

/** Xodimlarni toifalarga ajratish: asosiy va o'rindosh o'qituvchilar, shtat */
function staffGroups(staff: StaffMember[]) {
  const asosiy = staff.filter((s) => s.kategoriya?.includes('Asosiy') || s.ish_turi?.includes('Asosiy'))
  const orindosh = staff.filter((s) => s.kategoriya?.includes("O'rindosh") || s.ish_turi?.includes("O'rindosh"))
  const shtat = staff.filter((s) => s.kategoriya?.includes('Shtat') || s.ish_turi === 'Shtat' ||
    (!s.kategoriya?.includes("o'qituvchi") && !s.ish_turi?.includes("o'qituvchi") && s.bolim !== 'Pedagog'))
  return { asosiy, orindosh, shtat }
}

const teacherLine = (t: StaffMember, i: number) =>
  `${i + 1}. <b>${esc(t.fish)}</b>\n      <i>${esc(t.mutaxassislik || "O'qituvchi")}</i> · 📞 ${esc(cleanStaffPhone(t.tel))}`

function teachersSummaryText(staff: StaffMember[], filter: 'all' | 'asosiy' | 'orindosh' = 'all') {
  const { asosiy, orindosh } = staffGroups(staff)
  const { stamp } = tashkentStamp()
  if (filter !== 'all') {
    const list = filter === 'asosiy' ? asosiy : orindosh
    return [
      `${filter === 'asosiy' ? '📗' : '📘'} <b>${filter === 'asosiy' ? 'Asosiy' : "O'rindosh"} o'qituvchilar</b> — ${list.length} nafar`,
      `🕒 ${stamp}`,
      list.length ? quote(list.map(teacherLine)) : "<i>Ro'yxat bo'sh</i>",
    ].join('\n')
  }
  return [
    `👨‍🏫 <b>O'qituvchilar</b> — ${asosiy.length + orindosh.length} nafar`,
    `🕒 ${stamp}`,
    '',
    `📗 <b>Asosiy</b> — ${asosiy.length} nafar`,
    quote(asosiy.map(teacherLine)),
    '',
    `📘 <b>O'rindosh</b> — ${orindosh.length} nafar`,
    quote(orindosh.map(teacherLine)),
  ].join('\n')
}

function shtatStaffSummaryText(staff: StaffMember[]) {
  const { shtat } = staffGroups(staff)
  const { stamp } = tashkentStamp()
  return [
    `👔 <b>Shtat xodimlari</b> — ${shtat.length} nafar`,
    `🕒 ${stamp}`,
    shtat.length ? quote(shtat.map((s, i) =>
      `${i + 1}. <b>${esc(s.fish)}</b> — ${esc(s.lavozim || 'Xodim')}\n      ${esc(s.bolim || "Ma'muriy")} · 📞 ${esc(cleanStaffPhone(s.tel))}${s.pv ? ` · <code>${esc(s.pv)}</code>` : ''}`))
      : "<i>Ro'yxat bo'sh</i>",
  ].join('\n')
}

function teachersListView(staff: StaffMember[], filter: 'all' | 'asosiy' | 'orindosh' = 'all'): View {
  const { asosiy, orindosh } = staffGroups(staff)
  // Tanlangan tugmada belgi o'rniga ✅
  const mark = (f: typeof filter, icon: string, label: string) => `${filter === f ? '✅' : icon} ${label}`
  return {
    text: teachersSummaryText(staff, filter),
    markup: {
      inline_keyboard: [
        [
          { text: mark('asosiy', '📗', `Asosiy · ${asosiy.length}`), callback_data: 'tch:asosiy' },
          { text: mark('orindosh', '📘', `O'rindosh · ${orindosh.length}`), callback_data: 'tch:orindosh' },
          { text: mark('all', '🌐', 'Hammasi'), callback_data: 'tch:all' },
        ],
        [{ text: "📥 Excel (o'qituvchilar)", callback_data: 'doc:tch' }],
        [{ text: '⬅️ Xodimlar menyusi', callback_data: 'm:xd' }],
      ],
    },
  }
}

function shtatStaffView(staff: StaffMember[]): View {
  return {
    text: shtatStaffSummaryText(staff),
    markup: {
      inline_keyboard: [
        [{ text: '📥 Excel (shtat)', callback_data: 'doc:stf' }],
        [{ text: '⬅️ Xodimlar menyusi', callback_data: 'm:xd' }],
      ],
    },
  }
}

/* ------------------------------ BO'LIM MENYULARI ------------------------------ */

const backTo = (to: 'm:st' | 'm:xd' | 'm:rep', label: string): Btn[] => [{ text: `⬅️ ${label}`, callback_data: to }]

/** 🎓 Talabalar — guruhlar, kontingent, kamchiliklar, ma'lumotnoma, yangi talaba */
async function studentsMenuView(): Promise<View> {
  const students = await loadStudentsDb()
  const official = students.filter((s) => isOfficialGroup(s.group))
  const ver = official.filter((s) => s.verified === 'TASDIQLANDI').length
  return {
    text: [
      '🎓 <b>Talabalar</b>',
      quote([
        `Faol kontingent: <b>${official.length}</b> nafar · ${academicGroups(students).length} guruh`,
        `Tasdiqlangan: <b>${ver}</b> · kutilmoqda: <b>${official.length - ver}</b>`,
        `Akademik ta'til: <b>${students.filter((s) => isAcademicLeave(s.group)).length}</b> · safdan chiqqan: <b>${students.filter((s) => isOutside(s.group)).length}</b>`,
      ], false),
      "<i>Bo'limni tanlang yoki talaba ismi, shartnoma № yoki JSHSHIR ni yozib yuboring.</i>",
    ].join('\n'),
    markup: {
      inline_keyboard: [
        [{ text: "👥 Guruhlar ro'yxati", callback_data: 'gl' }, { text: '📈 Kontingent', callback_data: 'st:kont' }],
        [{ text: '⚠️ Kamchiliklar', callback_data: 'st:kam' }, { text: "📄 Ma'lumotnoma", callback_data: 'st:mal' }],
        [{ text: '➕ Yangi talaba qo\'shish', callback_data: 'add:st' }],
      ],
    },
  }
}

/** 👨‍🏫 Xodimlar — o'qituvchilar (asosiy / o'rindosh), shtat, Excel, yangi xodim */
async function staffMenuView(): Promise<View> {
  const { asosiy, orindosh, shtat } = staffGroups(await loadStaffDb())
  return {
    text: [
      '👨‍🏫 <b>Xodimlar</b>',
      quote([
        `📗 Asosiy o'qituvchilar: <b>${asosiy.length}</b>`,
        `📘 O'rindosh o'qituvchilar: <b>${orindosh.length}</b>`,
        `👔 Shtat xodimlari: <b>${shtat.length}</b>`,
      ], false),
      "<i>Ro'yxatni tanlang:</i>",
    ].join('\n'),
    markup: {
      inline_keyboard: [
        [{ text: `📗 Asosiy · ${asosiy.length}`, callback_data: 'tch:asosiy' }, { text: `📘 O'rindosh · ${orindosh.length}`, callback_data: 'tch:orindosh' }],
        [{ text: `👔 Shtat · ${shtat.length}`, callback_data: 'stf:shtat' }, { text: '🌐 Hamma o\'qituvchilar', callback_data: 'tch:all' }],
        [{ text: "📥 Excel: o'qituvchilar", callback_data: 'doc:tch' }, { text: '📥 Excel: shtat', callback_data: 'doc:stf' }],
        [{ text: '📥 Excel: barcha xodimlar', callback_data: 'doc:all_stf' }],
        [{ text: '➕ Yangi xodim qo\'shish', callback_data: 'add:xd' }],
      ],
    },
  }
}

/** 📊 Hisobotlar — Excel, guruh ro'yxatlari (PDF), JSON baza */
function reportsMenuView(): View {
  return {
    text: [
      '📊 <b>Hisobotlar</b>',
      quote([
        "📑 <b>Excel hisobotlar</b> — buxgalteriya, baza admin, guruh rahbarlari, to'liq baza",
        "🗂 <b>Guruh ro'yxatlari (PDF)</b> — A4, imzo uchun, chop etishga tayyor",
        "📦 <b>JSON baza</b> — to'liq zaxira nusxa",
      ], false),
    ].join('\n'),
    markup: {
      inline_keyboard: [
        [{ text: '📑 Excel hisobotlar', callback_data: 'rep:excel' }, { text: "🗂 Guruh ro'yxatlari (PDF)", callback_data: 'rep:pdf' }],
        [{ text: '📦 JSON baza', callback_data: 'rep:json' }, { text: '📈 Kontingent', callback_data: 'st:kont' }],
      ],
    },
  }
}

function excelReportsView(): View {
  return {
    text: [
      '📑 <b>Excel hisobotlar</b>',
      quote([
        '1️⃣ <b>Buxgalteriya</b> — shartnoma № va pasport',
        '2️⃣ <b>Baza administratori</b> — pasport va shahodatnoma / diplom',
        "3️⃣ <b>Guruh rahbarlari</b> — tug'ilgan sana, pasport, shahodatnoma",
        "4️⃣ <b>To'liq baza</b> — barcha ustunlar (manzil, ota-ona, telefonlar ham)",
      ], false),
      '<i>Fayl darhol shu chatga yuboriladi.</i>',
    ].join('\n'),
    markup: {
      inline_keyboard: [
        [{ text: '1️⃣ Buxgalteriya', callback_data: 'doc:bux' }, { text: '2️⃣ Baza admin', callback_data: 'doc:adm' }],
        [{ text: '3️⃣ Guruh rahbarlari', callback_data: 'doc:grh' }, { text: "4️⃣ To'liq baza", callback_data: 'doc:tol' }],
        backTo('m:rep', 'Hisobotlar'),
      ],
    },
  }
}

async function sendStaffExcelDocument(chatId: string | number, type: 'teachers' | 'shtat' | 'all') {
  const { stamp } = tashkentStamp()
  let file = 'Oqituvchilar royxati.xlsx'
  let title = "O'qituvchilar ro'yxati (.xlsx)"
  if (type === 'shtat') {
    file = 'Shtat xodimlar royxati.xlsx'
    title = "ShTAT xodimlar ro'yxati (.xlsx)"
  } else if (type === 'all') {
    file = 'Barcha xodimlar royxati.xlsx'
    title = "Barcha xodimlar ro'yxati (.xlsx)"
  }
  const buf = await readRepoFileIn(['hisobotlar', ''], file, BOT_CACHE)
  if (buf) {
    await sendDocument(chatId, buf, file, `📊 <b>${esc(title)}</b>\n🕒 Sana: ${stamp}\n✅ <i>Bo'sh joyli toza format</i>`)
  } else {
    await sendMessage(chatId, `⚠️ Fayl topilmadi: ${esc(file)}`)
  }
}

async function sendRoleExcelDirect(chatId: string | number, file: string, title: string) {
  const { stamp } = tashkentStamp()
  const buf = await readRepoFileIn(REPO_PATHS.rollar, file, BOT_CACHE)
  if (buf) {
    await sendDocument(chatId, buf, file, `📊 <b>${esc(title)}</b>\n🕒 Sana: ${stamp}`)
  } else {
    await sendMessage(chatId, `❌ Fayl yuklashda xatolik: ${esc(file)}`)
  }
}

/** Barcha guruhlar ro'yxati (imzo varaqasi) — A4 PDF (hisobotlar/pdf_jurnallar) */
async function sendGuruhlarPdf(chatId: string | number) {
  const { stamp } = tashkentStamp()
  const buf = await readRepoFileIn(REPO_PATHS.pdfJurnallar, 'Barcha_Guruhlar_Jurnali.pdf', BOT_CACHE)
  if (buf) await sendDocument(chatId, buf, 'Barcha_Guruhlar_Jurnali.pdf', `📑 <b>Barcha ${pdfGroups().length} ta guruh ro'yxati (A4 PDF)</b>\n🕒 Sana: ${stamp}`)
  else await sendMessage(chatId, '❌ PDF ro\'yxat topilmadi.')
}

/* ------------------------------ AI DRAFT VA TASDIQLASH KO'RINISHI ------------------------------ */

function pendingDraftView(draft: PendingDraft): View {
  const d = draft.data
  const ismOta = `${d.ism || ''} ${d.ota || ''}`.trim()
  const displayFish = d.fish || ismOta || '—'
  const info = [
    `👤 <b>${esc(displayFish)}</b>`,
    `🪪 Pasport: <code>${esc(d.pv || '—')}</code>`,
    `🔢 JSHSHIR: <code>${esc(d.pinfl || '—')}</code>`,
    `📅 Tug'ilgan: <b>${esc(d.dob || '—')}</b>`,
    `📞 ${esc(d.tel || '—')}`,
  ]
  if (d.sh_doc || d.maktab) {
    info.push(`📜 ${esc(d.doc_tur || 'Hujjat')} ${esc(d.sh_doc || '')}${d.maktab ? ` · ${esc(d.maktab)}` : ''}`)
  }
  if (d.mutaxassislik || d.lavozim) info.push(`💼 <i>${esc(d.mutaxassislik || d.lavozim || '')}</i>`)
  const lines = ["🤖 <b>AI hujjatdan o'qidi:</b>", quote(info, false), "Qaysi toifaga qo'shilsin?"]

  const defaultGroup = d.group || '26-02'
  const rows: Btn[][] = []

  if (draft.mode === 'add_student') {
    rows.push([
      { text: `🎓 Talaba (Guruh ${defaultGroup})`, callback_data: `sav_st:${draft.id}:${defaultGroup}` },
      { text: '🔀 Boshqa guruh', callback_data: `grp_pick:${draft.id}` },
    ])
    rows.push([
      { text: '👔 Xodim sifatida saqlash', callback_data: `stf_pick:${draft.id}` },
      { text: '❌ Bekor qilish', callback_data: `cancel:${draft.id}` },
    ])
  } else if (draft.mode === 'add_staff') {
    rows.push([
      { text: "📗 Asosiy o'qituvchi", callback_data: `sav_stf:${draft.id}:asosiy` },
      { text: "📘 O'rindosh", callback_data: `sav_stf:${draft.id}:orindosh` },
    ])
    rows.push([
      { text: '👔 ShTAT - xodimlar', callback_data: `sav_stf:${draft.id}:shtat` },
      { text: `🎓 Talaba (${defaultGroup})`, callback_data: `sav_st:${draft.id}:${defaultGroup}` },
    ])
    rows.push([
      { text: '❌ Bekor qilish', callback_data: `cancel:${draft.id}` },
    ])
  } else {
    rows.push([
      { text: "🎓 Talaba sifatida qo'shish", callback_data: `grp_pick:${draft.id}` },
      { text: "👔 Xodim sifatida qo'shish", callback_data: `stf_pick:${draft.id}` },
    ])
    rows.push([
      { text: '❌ Bekor qilish', callback_data: `cancel:${draft.id}` },
    ])
  }

  return {
    text: lines.join('\n'),
    markup: { inline_keyboard: rows },
  }
}

function groupPickerForDraft(draftId: string): View {
  const c1 = pdfGroups()
  const rows: Btn[][] = []
  for (let i = 0; i < c1.length; i += 3) {
    rows.push(c1.slice(i, i + 3).map((g) => ({ text: `Guruh ${g}`, callback_data: `sav_st:${draftId}:${g}` })))
  }
  rows.push([
    { text: '25-16 (2-kurs)', callback_data: `sav_st:${draftId}:25-16` },
    { text: '24-11 (3-kurs)', callback_data: `sav_st:${draftId}:24-11` },
  ])
  rows.push([
    { text: '⬅️ Ortga', callback_data: `dft_back:${draftId}` },
    { text: '❌ Bekor qilish', callback_data: `cancel:${draftId}` },
  ])

  return {
    text: "🎓 <b>Talaba qaysi guruhga qo'shilsin?</b>\n\nKerakli guruhni tanlang:",
    markup: { inline_keyboard: rows },
  }
}

function staffPickerForDraft(draftId: string): View {
  return {
    text: "👔 <b>Xodim qaysi toifaga qo'shilsin?</b>\n\nKerakli toifani tanlang:",
    markup: {
      inline_keyboard: [
        [
          { text: "📗 Asosiy o'qituvchilar", callback_data: `sav_stf:${draftId}:asosiy` },
          { text: "📘 O'rindosh o'qituvchilar", callback_data: `sav_stf:${draftId}:orindosh` },
        ],
        [
          { text: '👔 ShTAT - xodimlar', callback_data: `sav_stf:${draftId}:shtat` },
        ],
        [
          { text: '⬅️ Ortga', callback_data: `dft_back:${draftId}` },
          { text: '❌ Bekor qilish', callback_data: `cancel:${draftId}` },
        ],
      ],
    },
  }
}

/* ------------------------------ GURUHLAR RO'YXATI ------------------------------ */

const SPECIAL_LISTS = {
  akademik: { title: "Akademik ta'til olganlar", pick: (s: Student) => isAcademicLeave(s.group) },
  safdan: { title: 'Talabalar safidan chiqarilganlar', pick: (s: Student) => isOutside(s.group) },
} as const
type SpecialList = keyof typeof SPECIAL_LISTS

type Btn = { text: string; callback_data: string }
type View = { text: string; markup: { inline_keyboard: Btn[][] } }

const inGroup = (g: string) => (s: Student) => String(s.group || '').trim() === g
const chunk = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n))

/** 1-qadam: kurslar (va akademik / safdan chiqarilganlar) */
async function coursePickerView(): Promise<View> {
  const students = await loadStudents()
  const count = (pick: (s: Student) => boolean) => students.filter(pick).length
  const rows: Btn[][] = []
  const lines: string[] = []
  for (const c of COURSES) {
    const groups = academicGroups(students, c.kurs)
    if (!groups.length) continue
    const n = count((s) => isOfficialGroup(s.group) && kursOf(s.group) === c.kurs)
    rows.push([{ text: `🎓 ${c.kurs}-kurs  ·  ${groups.length} guruh  ·  ${n} nafar`, callback_data: `k:${c.kurs}` }])
    lines.push(`🎓 <b>${c.kurs}-kurs</b> — ${groups.length} ta guruh, ${n} nafar`)
  }
  rows.push((Object.keys(SPECIAL_LISTS) as SpecialList[]).map((k) => ({
    text: `${k === 'akademik' ? "⏸ Akademik ta'til" : '🚫 Safdan chiqarilgan'} · ${count(SPECIAL_LISTS[k].pick)}`,
    callback_data: `g:${k}`,
  })))
  rows.push(backTo('m:st', 'Talabalar menyusi'))
  return {
    text: `👥 <b>Guruhlar ro'yxati</b>\n${quote(lines, false)}\n<b>Kursni tanlang</b>, keyin guruhni — ro'yxat matn va rasm bo'lib keladi.`,
    markup: { inline_keyboard: rows },
  }
}

/** 2-qadam: tanlangan kursning guruhlari (har qatorda 3 ta) */
async function courseGroupsView(kurs: number): Promise<View> {
  const students = await loadStudents()
  const groups = academicGroups(students, kurs)
  const lines = groups.map((g) => {
    const leader = GROUP_LEADERS[g]
    return `<b>${esc(g)}</b> — ${students.filter(inGroup(g)).length} nafar${leader ? ` · ${esc(leader)}` : ''}`
  })
  return {
    text: `🎓 <b>${kurs}-kurs guruhlari</b>\n${quote(lines, false)}\n<b>Guruhni tanlang:</b>`,
    markup: {
      inline_keyboard: [
        ...chunk(groups.map((g) => ({ text: `${g} · ${students.filter(inGroup(g)).length}`, callback_data: `g:${g}` })), 3),
        [{ text: '⬅️ Kurslarga qaytish', callback_data: 'gl' }],
      ],
    },
  }
}

/** Tugma bosilgan xabarning o'zini almashtiradi (chat to'lib ketmasin); bo'lmasa (rasm ostidagi tugma) — yangi xabar */
async function showView(chatId: string | number, view: View, editMessageId?: number) {
  if (editMessageId) {
    const r = await tgCall('editMessageText', {
      chat_id: chatId, message_id: editMessageId, text: view.text, parse_mode: 'HTML', reply_markup: view.markup,
    })
    // "message is not modified" — shu ko'rinish allaqachon turibdi
    if (r.ok || String(r.description || '').includes('not modified')) return
  }
  await sendMessage(chatId, view.text, view.markup)
}

/** Ro'yxat ostidagi tugmalar: shu kursning guruhlariga yoki kurslarga qaytish */
const pickAgain = (key: string) => {
  const kurs = key in SPECIAL_LISTS ? null : kursOf(key)
  return {
    inline_keyboard: [[
      ...(kurs ? [{ text: `⬅️ ${kurs}-kurs guruhlari`, callback_data: `k:${kurs}` }] : []),
      { text: '🎓 Kurslar', callback_data: 'gl' },
    ]],
  }
}

/** Bitta guruh (yoki akademik / safdan chiqarilganlar) ro'yxati: avval matn, keyin rasm */
async function sendGroupList(chatId: string | number, key: string) {
  const special = key in SPECIAL_LISTS ? SPECIAL_LISTS[key as SpecialList] : null
  const list = (await loadStudents())
    .filter(special ? special.pick : (s) => String(s.group || '').trim() === key)
    .sort(byName)
  const title = special ? special.title : `Guruh ${key}`
  if (!list.length) {
    await sendMessage(chatId, `❓ ${esc(title)}: talaba topilmadi.`, pickAgain(key))
    return
  }
  const leader = special ? '' : GROUP_LEADERS[key] || ''
  const subtitle = special ? 'Rasmiy kontingentga kirmaydi' : `${kursOf(key)}-kurs · ${groupTitle(key)}`
  const { stamp } = tashkentStamp()

  const head = [
    `👥 <b>${esc(title)}</b> — ${list.length} nafar`,
    special ? `<i>${esc(subtitle)}</i>` : `📚 ${esc(subtitle)}${leader ? ` · 👤 <b>${esc(leader)}</b>` : ''}`,
    `🕒 ${stamp}`,
  ]
  const rows = list.map((s, i) => special
    ? `${i + 1}. ${esc(fullName(s))} — ${s.chiqqan_guruh ? `<b>${esc(s.chiqqan_guruh)}</b> dan` : 'guruhi ?'}${s.buyruq_sana ? `, ${esc(s.buyruq_sana)}` : ''}`
    : `${i + 1}. ${esc(fullName(s))} — №${esc(s.shnum || '—')}${s.verified === 'TASDIQLANDI' ? ' ✅' : ''}`)
  // Guruh ro'yxati o'qish uchun so'raladi — yig'iq emas, ochiq iqtibos
  await sendMessage(chatId, [...head, quote(rows, false)].join('\n'))

  try {
    const png = await renderGroupListPng({ title, subtitle, leader, stamp, students: list, special: !!special })
    const file = special ? `${key === 'akademik' ? 'Akademik_tatil' : 'Safdan_chiqarilganlar'}_royxati.png` : `Guruh_${key}_royxati.png`
    await tgSendPhoto(chatId, png, file, `🖼 <b>${esc(title)}</b> — ${list.length} nafar\n🕒 ${stamp}`, pickAgain(key))
  } catch (err) {
    console.error('Guruh rasmi chizilmadi:', err)
    await sendMessage(chatId, `⚠️ Rasm yaratilmadi: ${esc((err as Error).message)}`, pickAgain(key))
  }
}

async function searchText(query: string) {
  const q = norm(query)
  const digits = q.replace(/\s/g, '')
  const matches = (await loadStudentsDb()).filter((s) =>
    norm(s.fish).includes(q) ||
    norm(s.shnum) === q ||
    (q.length >= 4 && norm(s.pv).replace(/\s/g, '').includes(digits)) ||
    (/^\d{4,}$/.test(digits) && String(s.pinfl || '').includes(digits)))
  if (!matches.length) return null
  const shown = matches.slice(0, 8)
  const lines = [`🔍 <b>Topildi: ${matches.length} ta</b>`]
  shown.forEach((s, i) => lines.push(studentCard(s, i)))
  if (matches.length > 8) lines.push(`<i>…va yana ${matches.length - 8} nafar. Aniqroq yozing.</i>`)
  return { text: lines.join('\n'), markup: malumotnomaButtons(shown) }
}

/** Har bir topilgan talaba uchun "📄 Ma'lumotnoma" tugmasi (ma'lumotnoma berib bo'lmaydiganlarga — yo'q) */
function malumotnomaButtons(list: Student[]) {
  const ok = list.map((s, i) => ({ s, i })).filter(({ s }) => !malumotnomaBlocker(s))
  if (!ok.length) return BOT_KEYBOARD
  const btns: Btn[] = ok.map(({ s, i }) => ({
    text: list.length === 1 ? "📄 Ma'lumotnoma olish" : `📄 ${i + 1}. ${shortFish(s.fish)}`,
    callback_data: `mal:${s.row}`,
  }))
  return { inline_keyboard: chunk(btns, 2) }
}

/** "Ergasheva Feruzaxon Asror qizi" → "Ergasheva F." (tugmaga sig'sin) */
const shortFish = (fish: string) => {
  const [fam, ism] = String(fish || '').trim().split(/\s+/)
  return ism ? `${fam} ${ism[0]}.` : fam || '—'
}

/** Ma'lumotnoma rasmini yuborish (muhrli hujjat — faqat asosiy hisobot chatiga) */
async function sendMalumotnoma(chatId: string | number, s: Student) {
  if (String(chatId) !== DEFAULT_CHAT_ID) {
    await sendMessage(chatId, "⛔ Ma'lumotnoma faqat asosiy chatda beriladi.")
    return
  }
  const blocker = malumotnomaBlocker(s)
  if (blocker) {
    await sendMessage(chatId, `❌ ${esc(s.fish)}: ${esc(blocker)}`)
    return
  }
  await tgCall('sendChatAction', { chat_id: chatId, action: 'upload_photo' })
  const data = malumotnomaData(s)
  await tgSendPhoto(chatId, await renderMalumotnomaJpg(data), malumotnomaFileName(s),
    `📄 <b>O‘qiyotganligi haqida ma’lumotnoma</b>\n👤 <b>${esc(s.fish)}</b>\n👥 Guruh ${esc(s.group)} · Shartnoma №${esc(s.shnum || '—')}\n🗓 Sana: ${esc(data.sana)}`,
    BOT_KEYBOARD)
}

/** /malumotnoma 285 — bitta talaba topilsa ma'lumotnoma rasmini (JPG) yuboradi */
async function malumotnomaCommand(chatId: string | number, query: string) {
  const q = norm(query)
  if (!q) {
    await sendMessage(chatId, "📄 Ma'lumotnoma uchun shartnoma raqami yoki F.I.SH yozing:\n<code>/malumotnoma 285</code>")
    return
  }
  const students = await loadStudentsDb()
  const exact = students.filter((s) => norm(s.shnum) === q)
  const found = exact.length ? exact : students.filter((s) => norm(s.fish).includes(q))
  if (!found.length) {
    await sendMessage(chatId, '❓ Bunday talaba topilmadi.')
    return
  }
  if (found.length > 1) {
    // Bir nechta talaba (shartnoma raqami turli kurslarda takrorlanadi) — tugma bilan tanlanadi
    const list = found.slice(0, 10)
    await sendMessage(chatId, `🔍 <b>${found.length} ta talaba topildi</b> — keraklisini tanlang:\n` +
      quote(list.map((s, i) => `${i + 1}. ${esc(s.fish)} — ${esc(s.group || '—')}`), false), malumotnomaButtons(list))
    return
  }
  await sendMalumotnoma(chatId, found[0])
}

const notConfigured = () =>
  Response.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID sozlanmagan (Netlify → Site configuration → Environment variables, keyin qayta deploy)' }, { status: 500 })

/** Telegram xatosini tushunarli qilish (eng ko'p uchraydiganlari) */
function explainTgError(r: { ok?: boolean; error_code?: number; description?: string }) {
  if (r.ok) return undefined
  if (r.error_code === 401) return "Token noto'g'ri yoki bekor qilingan — @BotFather'dan olingan yangi tokenni TELEGRAM_BOT_TOKEN ga qo'yib, qayta deploy qiling"
  if (r.error_code === 404) return "Token formati noto'g'ri (123456789:AA... ko'rinishida bo'lishi kerak)"
  return r.description || "Telegram'ga ulanib bo'lmadi"
}

async function botStatus(expectedUrl: string) {
  const me = await tgCall('getMe')
  const info = me.ok ? await tgCall('getWebhookInfo') : null
  const w = info?.result ?? {}
  return {
    ok: !!me.ok && w.url === expectedUrl,
    bot: me.ok ? `@${me.result.username}` : null,
    error: explainTgError(me),
    webhook: me.ok ? {
      url: w.url || null,
      connected: w.url === expectedUrl,
      pending_updates: w.pending_update_count ?? 0,
      last_error: w.last_error_message || null,
      last_error_at: w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : null,
    } : null,
    allowed_chats: TG_ALLOWED_IDS.size,
  }
}

/** ➕ Yangi talaba — hujjat rasmini yoki matnni kutish rejimi */
async function startAddStudent(chatId: string | number) {
  setUserMode(chatId, 'add_student')
  await sendMessage(chatId, [
    "🎓 <b>Yangi talaba qo'shish</b>",
    quote([
      "📸 <b>Hujjat rasmini yuboring</b> — pasport / ID-karta yoki shahodatnoma / diplom",
      "🤖 AI o'qib, tasdiqlash uchun ko'rsatadi",
      "✍️ Yoki matn: <code>Aliyev Vali Olim o'g'li, 15.05.2007, AE1234567, 31505075590024, 26-02</code>",
    ], false),
    '❌ Bekor qilish: /bekor',
  ].join('\n'))
}

/** ➕ Yangi xodim — hujjat rasmini yoki matnni kutish rejimi */
async function startAddStaff(chatId: string | number) {
  setUserMode(chatId, 'add_staff')
  await sendMessage(chatId, [
    "👔 <b>Yangi xodim qo'shish</b>",
    quote([
      '📸 <b>Hujjat rasmini yuboring</b> — pasport / ID-karta, diplom yoki obyektivka',
      "🤖 AI o'qib, tasdiqlash uchun ko'rsatadi",
      "✍️ Yoki matn: <code>Karimov Jamshid Olimovich, Hamshiralik ishi o'qituvchisi, Asosiy, +998901234567</code>",
    ], false),
    '❌ Bekor qilish: /bekor',
  ].join('\n'))
}

/** /start va 🏠 — bo'limlar haqida qisqacha */
function startText() {
  return [
    '🏛 <b>Shahrisabz Tibbiyot Texnikumi</b> — talabalar va xodimlar boti',
    quote([
      `${MENU.talabalar} — guruhlar, kontingent, kamchiliklar, yangi talaba`,
      `${MENU.xodimlar} — asosiy va o'rindosh o'qituvchilar, shtat, yangi xodim`,
      `${MENU.hisobotlar} — Excel, guruh ro'yxatlari (PDF), JSON baza`,
      `${MENU.majlis} — o'qituvchilar majlisi davomati`,
    ], false),
    "🔍 <b>Qidiruv:</b> talaba ismi, shartnoma №, pasport yoki JSHSHIR ni yozing.",
    "📄 <code>/malumotnoma 285</code> — o'qiyotganligi haqida ma'lumotnoma",
  ].join('\n')
}

/** Majlis davomati: Mini App tugmasi + oxirgi majlis natijasi */
async function majlisCommand(chatId: string | number, origin: string) {
  const db = await loadMajlisDb().catch(() => null)
  const last = db?.majlislar[0]
  const text = (last && db ? `${majlisMatni(last, db.oqituvchilar)}\n\n` : '') +
    "🗓 <b>O'qituvchilar majlisi davomati</b>\nYangi majlis ochish, asosiy va o'rindosh o'qituvchilarni belgilash va hisobot — pastdagi tugma orqali."
  return sendMessage(chatId, text, {
    inline_keyboard: [[{ text: '📋 Davomatni ochish', web_app: { url: `${origin}/majlis` } }]],
  })
}

export async function GET(request: NextRequest) {
  const action = (request.nextUrl.searchParams.get('action') || '').toLowerCase()
  if (!action) return Response.json({ ok: true, configured: !!(BOT_TOKEN && DEFAULT_CHAT_ID), hint: 'Holat: ?action=status, ulash: ?action=setup' })
  if (!BOT_TOKEN || !DEFAULT_CHAT_ID) return notConfigured()
  const webhookUrl = `${siteOrigin(request.nextUrl.origin)}/api/telegram_webhook`

  if (action === 'status') return Response.json(await botStatus(webhookUrl))

  if (action === 'migrate_bot' || action === 'setup') {
    const set = await tgCall('setWebhook', {
      url: webhookUrl,
      secret_token: TG_WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
      max_connections: 10,
    })
    if (set.ok) {
      await tgCall('setMyCommands', {
        commands: [
          { command: 'start', description: 'Menyu va tugmalar' },
          { command: 'yangi_talaba', description: 'Yangi talaba qo\'shish (AI)' },
          { command: 'yangi_xodim', description: 'Yangi xodim qo\'shish (AI)' },
          { command: 'bekor', description: 'Joriy amalni bekor qilish' },
          { command: 'kontingent', description: 'Guruhlar kesimida kontingent' },
          { command: 'royxat', description: "Guruhlar ro'yxati (matn + rasm)" },
          { command: 'malumotnoma', description: "O'qiyotganligi haqida ma'lumotnoma: /malumotnoma 285" },
          { command: 'majlis', description: "O'qituvchilar majlisi davomati (Mini App)" },
          { command: 'id', description: 'Chat ID raqamim' },
        ],
      })
      // Ruxsat berilgan xodimlarda chap pastdagi menyu tugmasi "Majlis" Mini App'ini ochadi
      const menu = { type: 'web_app', text: 'Majlis', web_app: { url: `${siteOrigin(request.nextUrl.origin)}/majlis` } }
      await Promise.all([...TG_ALLOWED_IDS].map((id) => tgCall('setChatMenuButton', { chat_id: id, menu_button: menu })))
    }
    // Bot tokeni hech qachon javobda qaytarilmaydi
    const status = await botStatus(webhookUrl)
    return Response.json({ ...status, ok: !!set.ok && status.ok, set_webhook: set.ok ? 'ulandi' : explainTgError(set) }, { status: set.ok ? 200 : 502 })
  }

  // Kunlik hisobotlar — faqat Netlify jadval funksiyasi (netlify/functions/kunlik-*.mts) kalit bilan chaqiradi
  if ((action === 'kontingent' || action === 'backup_json') && request.nextUrl.searchParams.get('key') !== TG_REPORT_KEY) {
    return Response.json({ ok: false, error: 'Kalit noto‘g‘ri' }, { status: 403 })
  }
  await loadGroupSettings()
  if (action === 'kontingent') {
    const result = await sendMessage(DEFAULT_CHAT_ID, await kontingentText('Kunlik 09:00 avto-hisobot'))
    return Response.json({ ok: !!result.ok, action, error: explainTgError(result) }, { status: result.ok ? 200 : 502 })
  }
  if (action === 'backup_json') {
    const { stamp } = tashkentStamp()
    const json = await readRepoFile(REPO_PATHS.baza, BOT_CACHE)
    const excel = await readRepoFileIn(REPO_PATHS.rollar, '4_Toliq_Malumotlar_Bazasi.xlsx', BOT_CACHE)
    const rj = json ? await sendDocument(DEFAULT_CHAT_ID, json, 'talabalar_bazasi.json', `📦 <b>Talabalar bazasi (.json) — Kunlik 18:00 avto-zahira</b>\n🕒 Sana: ${stamp}`) : null
    const rx = excel ? await sendDocument(DEFAULT_CHAT_ID, excel, '4_Toliq_Malumotlar_Bazasi.xlsx', `📊 <b>4. To'liq Ma'lumotlar Bazasi (.xlsx)</b>\n🕒 Sana: ${stamp}`) : null
    const ok = !!rj?.ok && !!rx?.ok
    return Response.json({ ok, action, sent: { json: !!rj?.ok, excel: !!rx?.ok }, error: rj && !rj.ok ? explainTgError(rj) : undefined }, { status: ok ? 200 : 502 })
  }
  return Response.json({ ok: false, error: `Noma'lum action: ${action}` }, { status: 400 })
}

export async function POST(request: NextRequest) {
  if (!BOT_TOKEN) return notConfigured()
  // Faqat Telegram'ning o'zi (setup paytida berilgan maxfiy kalit bilan) xabar yubora oladi
  if (request.headers.get('x-telegram-bot-api-secret-token') !== TG_WEBHOOK_SECRET) {
    return Response.json({ ok: false }, { status: 403 })
  }
  // Telegram har doim 200 kutadi — aks holda xabarni qayta-qayta yuboradi
  let chatId: string | number | null = null
  try {
    const body = await request.json().catch(() => ({}))
    const cq = body.callback_query
    const msg = body.message ?? cq?.message
    if (!msg?.chat?.id) return Response.json({ ok: true })
    chatId = msg.chat.id as string | number
    // Tugma bosilganda Telegram "soat" belgisini ko'rsatib turadi — darhol javob beramiz
    if (cq?.id) void tgCall('answerCallbackQuery', { callback_query_id: cq.id })
    const text = cq ? '' : String(msg.text || '').trim()
    // "/start@bot_nomi" (guruh chatlarida) → "/start"
    const t = norm(text).replace(/^(\/\w+)@\w+/, '$1')

    if (t === '/id') {
      await sendMessage(chatId, `🆔 Chat ID: <code>${esc(chatId)}</code>`)
      return Response.json({ ok: true })
    }
    // Bot shaxsiy ma'lumot (pasport, JSHSHIR, telefon) beradi — faqat ruxsat berilgan chatlarga
    if (!TG_ALLOWED_IDS.has(String(chatId))) {
      await sendMessage(chatId,
        `⛔ Bu bot faqat texnikum xodimlari uchun.\n\nKirish kerak bo'lsa, administratorga ID raqamingizni yuboring: <code>${esc(chatId)}</code>`)
      return Response.json({ ok: true })
    }
    // "yozmoqda…" darhol ko'rinsin; sozlamalar bilan bir vaqtda
    await Promise.all([
      tgCall('sendChatAction', { chat_id: chatId, action: 'typing' }),
      loadGroupSettings().catch(() => null),
    ])
    const { stamp } = tashkentStamp()

    if (cq) {
      const data = String(cq.data || '')
      const msgId = Number(cq.message?.message_id) || undefined
      // Bo'lim menyulari va ularning amallari
      if (data === 'm:st') await showView(chatId, await studentsMenuView(), msgId)
      else if (data === 'm:xd') await showView(chatId, await staffMenuView(), msgId)
      else if (data === 'm:rep') await showView(chatId, reportsMenuView(), msgId)
      else if (data === 'st:kont') await sendMessage(chatId, await kontingentText("So'rov bo'yicha"))
      else if (data === 'st:kam') await sendMessage(chatId, await kamchiliklarText())
      else if (data === 'st:mal') await sendMessage(chatId, "📄 <b>Ma'lumotnoma</b>\n" + quote([
        "Talabani qidiring (ismi yoki shartnoma №) — natija ostida 📄 tugmasi chiqadi.",
        "Yoki buyruq bilan:",
        '<code>/malumotnoma 285</code>',
        '<code>/malumotnoma Aliyeva Malika</code>',
      ], false))
      else if (data === 'add:st') await startAddStudent(chatId)
      else if (data === 'add:xd') await startAddStaff(chatId)
      else if (data === 'rep:json') {
        const buf = await readRepoFile(REPO_PATHS.baza, BOT_CACHE)
        if (buf) await sendDocument(chatId, buf, 'talabalar_bazasi.json', `📦 <b>talabalar_bazasi.json</b> — to'liq baza\n🕒 ${stamp}`)
        else await sendMessage(chatId, '❌ JSON baza fayli topilmadi.')
      }
      else if (data.startsWith('mal:')) {
        const row = Number(data.slice(4))
        const s = (await loadStudentsDb()).find((x) => Number(x.row) === row)
        if (s) await sendMalumotnoma(chatId, s)
        else await sendMessage(chatId, '❓ Talaba topilmadi (baza yangilangan bo\'lishi mumkin) — qaytadan qidiring.')
      }
      else if (data === 'gl') await showView(chatId, await coursePickerView(), msgId)
      else if (data.startsWith('k:')) await showView(chatId, await courseGroupsView(Number(data.slice(2))), msgId)
      else if (data.startsWith('g:')) await sendGroupList(chatId, data.slice(2))
      else if (data === 'rep:excel') await showView(chatId, excelReportsView(), msgId)
      else if (data === 'rep:pdf' || data === 'dvm:pdf') await sendGuruhlarPdf(chatId)
      else if (data === 'tch:all') await showView(chatId, teachersListView(await loadStaffDb(), 'all'), msgId)
      else if (data === 'tch:asosiy') await showView(chatId, teachersListView(await loadStaffDb(), 'asosiy'), msgId)
      else if (data === 'tch:orindosh') await showView(chatId, teachersListView(await loadStaffDb(), 'orindosh'), msgId)
      else if (data === 'stf:shtat') await showView(chatId, shtatStaffView(await loadStaffDb()), msgId)
      else if (data === 'doc:tch') await sendStaffExcelDocument(chatId, 'teachers')
      else if (data === 'doc:stf') await sendStaffExcelDocument(chatId, 'shtat')
      else if (data === 'doc:all_stf') await sendStaffExcelDocument(chatId, 'all')
      else if (data === 'doc:bux') await sendRoleExcelDirect(chatId, '1_Buxgalteriya_Shartnoma_va_Pasport.xlsx', '1. Buxgalteriya (Shartnoma № va Pasport)')
      else if (data === 'doc:adm') await sendRoleExcelDirect(chatId, '2_Baza_Admin_Pasport_va_Shahodatnoma.xlsx', '2. Baza Administratori (Pasport va Shahodatnoma/Diplom)')
      else if (data === 'doc:grh') await sendRoleExcelDirect(chatId, '3_Guruh_Rahbarlari_Talabalar_Malumotlari.xlsx', '3. Guruh Rahbarlari')
      else if (data === 'doc:tol') await sendRoleExcelDirect(chatId, '4_Toliq_Malumotlar_Bazasi.xlsx', "4. To'liq Ma'lumotlar Bazasi")
      else if (data.startsWith('sav_st:')) {
        const [, dId, grp] = data.split(':')
        const draft = getPendingDraft(dId)
        if (!draft) {
          await sendMessage(chatId, "⚠️ Hujjat ma'lumoti topilmadi yoki eskirgan. Qaytadan yuboring.")
          return Response.json({ ok: true })
        }
        const d = draft.data
        const allSt = await loadStudentsDb()
        const nums = allSt
          .map((s) => parseInt(String(s.shnum || '').replace(/\D/g, ''), 10))
          .filter((n) => !isNaN(n) && n > 0 && n < 9000)
        const nextShnum = nums.length ? Math.max(...nums) + 1 : 286
        const ism = d.ism || d.fish || ''
        const ota = d.ota || ''

        await sendChange({
          type: 'add_student',
          data: {
            ism,
            ota,
            dob: d.dob || '',
            pv: d.pv || '',
            pinfl: d.pinfl || '',
            tel: d.tel || '',
            mak: d.maktab || '',
            yil: d.yil || '',
            sh_doc: d.sh_doc || '',
            doc_tur: d.doc_tur || 'Shahodatnoma',
            group: grp,
            shnum: String(nextShnum),
            ber: d.pass_ber || '',
            yon: d.mutaxassislik || 'Hamshiralik ishi',
          },
        })
        deletePendingDraft(dId)
        setUserMode(chatId, null)

        const displayFish = d.fish || `${ism} ${ota}`.trim()
        await sendMessage(chatId, [
          "🎉 <b>Yangi talaba qo'shildi</b>",
          quote([
            `👤 <b>${esc(displayFish)}</b>`,
            `👥 Guruh: <b>${esc(grp)}</b> · 📄 Shartnoma №<b>${nextShnum}</b>`,
            `🪪 Pasport: <code>${esc(d.pv || '—')}</code>`,
            `🔢 JSHSHIR: <code>${esc(d.pinfl || '—')}</code>`,
            `📅 Tug'ilgan: ${esc(d.dob || '—')} · 📞 ${esc(d.tel || '—')}`,
          ], false),
          `✅ <i>Baza, Supabase va Web Jurnalga qo'shildi · ${stamp}</i>`,
        ].join('\n'), BOT_KEYBOARD)
        return Response.json({ ok: true })
      } else if (data.startsWith('sav_stf:')) {
        const [, dId, cat] = data.split(':')
        const draft = getPendingDraft(dId)
        if (!draft) {
          await sendMessage(chatId, "⚠️ Hujjat ma'lumoti topilmadi yoki eskirgan. Qaytadan yuboring.")
          return Response.json({ ok: true })
        }
        const d = draft.data
        const staff = await loadStaffDb()
        const existingNums = staff
          .map((s) => {
            const m = s.id?.match(/(\d+)/)
            return m ? parseInt(m[1], 10) : 0
          })
          .filter((n) => n > 0)
        const nextNum = (existingNums.length ? Math.max(...existingNums) : 0) + 1
        const newId = `X-${String(nextNum).padStart(3, '0')}`

        let kategoriyaTitle = "ShTAT - xodimlar"
        let ishTuri = 'Shtat'
        let bolim = "Ma'muriy"
        let lavozim = d.lavozim || 'Xodim'

        if (cat === 'asosiy') {
          kategoriyaTitle = "Asosiy o'qituvchilar"
          ishTuri = 'Asosiy'
          bolim = 'Pedagog'
          lavozim = d.mutaxassislik ? `${d.mutaxassislik} o'qituvchisi` : "O'qituvchi"
        } else if (cat === 'orindosh') {
          kategoriyaTitle = "O'rindosh o'qituvchilar"
          ishTuri = "O'rindosh"
          bolim = 'Pedagog'
          lavozim = d.mutaxassislik ? `${d.mutaxassislik} o'qituvchisi` : "O'qituvchi"
        }

        const ismOta = `${d.ism || ''} ${d.ota || ''}`.trim()
        const newMember: StaffMember = {
          id: newId,
          fish: d.fish || ismOta || 'Yangi xodim',
          lavozim,
          kategoriya: kategoriyaTitle,
          bolim,
          ish_turi: ishTuri,
          stavka: '1.0',
          tel: d.tel || '',
          pinfl: d.pinfl || '',
          pv: d.pv || '',
          dob: d.dob || '',
          tamomlagan_otm: d.maktab || '',
          otm_tamom_yili: d.yil || '',
          mutaxassislik: d.mutaxassislik || '',
          status: 'faol',
          pasport_berilgan_joy: d.yashash_joyi || '',
        }

        staff.push(newMember)
        await saveStaff(staff, `Telegram bot orqali yangi xodim qo'shildi: ${newMember.fish}`)
        deletePendingDraft(dId)
        setUserMode(chatId, null)

        await sendMessage(chatId, [
          "🎉 <b>Yangi xodim qo'shildi</b>",
          quote([
            `👤 <b>${esc(newMember.fish)}</b> · <code>${newMember.id}</code>`,
            `👔 ${esc(newMember.kategoriya)} · 💼 ${esc(newMember.lavozim)}`,
            `🪪 Pasport: <code>${esc(newMember.pv || '—')}</code>`,
            `🔢 JSHSHIR: <code>${esc(newMember.pinfl || '—')}</code>`,
            `📅 Tug'ilgan: ${esc(newMember.dob || '—')} · 📞 ${esc(newMember.tel || '—')}`,
          ], false),
          `✅ <i>Xodimlar bazasiga saqlandi · ${stamp}</i>`,
        ].join('\n'), BOT_KEYBOARD)
        return Response.json({ ok: true })
      } else if (data.startsWith('grp_pick:')) {
        const dId = data.slice('grp_pick:'.length)
        await showView(chatId, groupPickerForDraft(dId), msgId)
        return Response.json({ ok: true })
      } else if (data.startsWith('stf_pick:')) {
        const dId = data.slice('stf_pick:'.length)
        await showView(chatId, staffPickerForDraft(dId), msgId)
        return Response.json({ ok: true })
      } else if (data.startsWith('dft_back:')) {
        const dId = data.slice('dft_back:'.length)
        const draft = getPendingDraft(dId)
        if (draft) await showView(chatId, pendingDraftView(draft), msgId)
        return Response.json({ ok: true })
      } else if (data.startsWith('cancel:')) {
        const dId = data.slice('cancel:'.length)
        deletePendingDraft(dId)
        setUserMode(chatId, null)
        await sendMessage(chatId, "❌ Qo'shish bekor qilindi.", BOT_KEYBOARD)
        return Response.json({ ok: true })
      }
      return Response.json({ ok: true })
    }
    // 📸 Rasm yoki skanerlangan hujjat kelganda (AI Vision tahlili)
    const photoList = msg.photo as Array<{ file_id: string; file_size?: number }> | undefined
    const doc = msg.document as { file_id: string; mime_type?: string; file_name?: string } | undefined
    let photoFileId: string | null = null
    if (Array.isArray(photoList) && photoList.length > 0) {
      photoFileId = photoList[photoList.length - 1].file_id
    } else if (doc && (doc.mime_type?.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(doc.file_name || ''))) {
      photoFileId = doc.file_id
    }

    if (photoFileId) {
      await tgCall('sendChatAction', { chat_id: chatId, action: 'typing' })
      await sendMessage(chatId, "🤖 <b>Hujjat rasmi qabul qilindi. AI tahlil qilmoqda...</b>\n<i>Iltimos, bir necha soniya kuting.</i>")

      const fileRes = await tgCall('getFile', { file_id: photoFileId })
      if (!fileRes.ok || !fileRes.result?.file_path) {
        await sendMessage(chatId, "❌ Hujjat rasmini yuklab bo'lmadi.")
        return Response.json({ ok: true })
      }

      const imgRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fileRes.result.file_path}`)
      const imgBuf = Buffer.from(await imgRes.arrayBuffer())
      const aiRes = await analyzeDocumentImage(imgBuf)

      if (aiRes.success && aiRes.data && (aiRes.data.fish || aiRes.data.pv || aiRes.data.pinfl)) {
        const curUserMode = getUserMode(chatId) || 'neutral'
        const sessId = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        const draft: PendingDraft = {
          id: sessId,
          chatId: String(chatId),
          mode: curUserMode,
          data: aiRes.data,
          createdAt: Date.now(),
        }
        savePendingDraft(draft)
        const view = pendingDraftView(draft)
        await sendMessage(chatId, view.text, view.markup)
      } else {
        const errMsg = aiRes.error || "AI hujjatdan ma'lumotlarni to'liq ajrata olmadi."
        await sendMessage(chatId,
          `⚠️ <b>AI tahlilida kamchilik:</b>\n<i>${esc(errMsg)}</i>\n\n` +
          `Iltimos, ma'lumotlarni matn ko'rinishida yuboring:\n` +
          `<code>Familiya Ism Sharif, GG.OO.YYYY, Pasport, JSHSHIR</code>`)
      }
      return Response.json({ ok: true })
    }

    // Asosiy menyu tugmalari — "yangi talaba/xodim" rejimini ham yopadi (tugma matni ism deb o'qilmasin).
    // Eski klaviaturadagi yozuvlar (Kontingent, Excel hisobotlar…) pastda ham ishlayveradi.
    const menuKey = plainText(t)
    const menuView =
      menuKey === 'talabalar' || t === '/talabalar' ? () => studentsMenuView()
      : menuKey === 'xodimlar' || t === '/xodimlar' ? () => staffMenuView()
      : menuKey === 'hisobotlar' || t === '/hisobotlar' ? async () => reportsMenuView()
      : null
    if (menuView) {
      setUserMode(chatId, null)
      await showView(chatId, await menuView())
      return Response.json({ ok: true })
    }
    if (menuKey === 'majlis' || t === '/majlis') {
      setUserMode(chatId, null)
      await majlisCommand(chatId, siteOrigin(request.nextUrl.origin))
      return Response.json({ ok: true })
    }

    // ✍️ Foydalanuvchi Yangi talaba yoki Yangi xodim rejimida bo'lsa va matn yozsa
    const activeUserMode = getUserMode(chatId)
    if (activeUserMode && text && !text.startsWith('/')) {
      const parsed = parseTextData(text)
      if (parsed && (parsed.fish || parsed.pv || parsed.pinfl)) {
        const sessId = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        const draft: PendingDraft = {
          id: sessId,
          chatId: String(chatId),
          mode: activeUserMode,
          data: parsed,
          createdAt: Date.now(),
        }
        savePendingDraft(draft)
        const view = pendingDraftView(draft)
        await sendMessage(chatId, view.text, view.markup)
        return Response.json({ ok: true })
      }
    }

    // ➕ Rejim buyruqlari
    if (t.includes('yangi talaba') || t === '/yangi_talaba' || t === '/talaba_qoshish' || t === '/talaba') {
      await startAddStudent(chatId)
      return Response.json({ ok: true })
    }
    if (t.includes('yangi xodim') || t === '/yangi_xodim' || t === '/xodim_qoshish' || t === '/xodim') {
      await startAddStaff(chatId)
      return Response.json({ ok: true })
    }

    if (t === '/bekor' || t === 'bekor' || t === '/cancel') {
      setUserMode(chatId, null)
      await sendMessage(chatId, "✅ Joriy amal bekor qilindi.", BOT_KEYBOARD)
      return Response.json({ ok: true })
    }

    if (t.includes("guruhlar ro'yxati") || t.includes('guruhlar royxati') || t === '/guruhlar_royxati' || t === '/royxat') {
      await showView(chatId, await coursePickerView())
      return Response.json({ ok: true })
    }

    if (t.includes('majlis')) {
      await majlisCommand(chatId, siteOrigin(request.nextUrl.origin))
      return Response.json({ ok: true })
    }

    if (['/start', '/menu', '/help', 'menyu', 'start'].includes(t)) {
      await sendMessage(chatId, startText())
      return Response.json({ ok: true })
    }
    const cert = /^\/?ma['‘’`]?lumotnoma(?:@\w+)?(?:\s+(.*))?$/i.exec(text)
    if (cert) {
      // Muhrli hujjat — faqat hisobot chatida (TELEGRAM_CHAT_ID)
      if (String(chatId) !== DEFAULT_CHAT_ID) await sendMessage(chatId, "⛔ Ma'lumotnoma faqat asosiy chatda beriladi.")
      else await malumotnomaCommand(chatId, cert[1] ?? '')
      return Response.json({ ok: true })
    }
    const groupOnly = /^(2[4-9]-\d{2})$/.exec(t)
    if (groupOnly) {
      await sendGroupList(chatId, groupOnly[1])
      return Response.json({ ok: true })
    }

    if (t.includes("o'qituvchi") || t.includes("oqituvchi") || t === '/oqituvchilar' || t === '/ustozlar') {
      const st = await loadStaffDb()
      await showView(chatId, teachersListView(st, 'all'))
      await sendStaffExcelDocument(chatId, 'teachers')
      return Response.json({ ok: true })
    }
    if (t.includes('shtat') || t === '/shtat' || t.includes('xodimlar') || t === '/xodimlar') {
      const st = await loadStaffDb()
      await showView(chatId, shtatStaffView(st))
      await sendStaffExcelDocument(chatId, 'shtat')
      return Response.json({ ok: true })
    }
    if (t.includes('excel hisobot') || t === '/hisobotlar' || t === 'excel hisobotlar') {
      await showView(chatId, excelReportsView())
      return Response.json({ ok: true })
    }

    if (t.includes('kontingent') || t.includes('kontengent')) {
      await sendMessage(chatId, await kontingentText("So'rov bo'yicha"))
      return Response.json({ ok: true })
    }
    if (t.includes('kamchilik')) {
      await sendMessage(chatId, await kamchiliklarText())
      return Response.json({ ok: true })
    }
    for (const rf of ROLE_FILES) {
      if (rf.match.some((m) => t.includes(m))) {
        const buf = await readRepoFileIn(REPO_PATHS.rollar, rf.file, BOT_CACHE)
        if (buf) {
          const total = (await loadStudentsDb()).length
          await sendDocument(chatId, buf, rf.file, `📊 <b>${rf.title}</b>\n🕒 Sana: ${stamp}\n👥 Jami talabalar: ${total} nafar`)
        } else {
          await sendMessage(chatId, `❌ Fayl yuklashda xatolik: ${rf.file}`)
        }
        return Response.json({ ok: true })
      }
    }
    if (t.includes('json')) {
      const buf = await readRepoFile(REPO_PATHS.baza, BOT_CACHE)
      if (buf) await sendDocument(chatId, buf, 'talabalar_bazasi.json', `📦 <b>talabalar_bazasi.json (To'liq baza)</b>\n🕒 Sana: ${stamp}`)
      else await sendMessage(chatId, '❌ JSON baza fayli topilmadi.')
      return Response.json({ ok: true })
    }
    if (t.includes('guruh jurnallari') || t === '/guruhlar') {
      const buf = await readRepoFileIn(REPO_PATHS.pdfJurnallar, 'Barcha_Guruhlar_Jurnali.pdf', BOT_CACHE)
      if (buf) await sendDocument(chatId, buf, 'Barcha_Guruhlar_Jurnali.pdf', `📑 <b>Barcha ${pdfGroups().length} ta guruh jurnallari (A4 PDF)</b>\n🕒 Sana: ${stamp}`)
      else await sendMessage(chatId, '❌ PDF jurnal topilmadi.')
      return Response.json({ ok: true })
    }
    if (text.length >= 2) {
      const res = await searchText(text)
      if (res) {
        await sendMessage(chatId, res.text, res.markup)
        return Response.json({ ok: true })
      }
    }
    await sendMessage(chatId, '❓ Bunday talaba topilmadi. Pastdagi tugmalardan birini bosing yoki talaba familiyasini / shartnoma raqamini yozing:')
    return Response.json({ ok: true })
  } catch (err) {
    console.error('Webhook error:', err)
    // Foydalanuvchi javobsiz qolmasin
    if (chatId !== null) await sendMessage(chatId, "⚠️ Ichki xatolik yuz berdi, birozdan keyin qayta urinib ko'ring.").catch(() => null)
    return Response.json({ ok: true })
  }
}
