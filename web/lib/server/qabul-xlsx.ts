import 'server-only'
import { buildRoleXlsx, type Role } from '../excel-build'
import ISTISNOLAR from '../qabul-istisnolar.json'
import { qabulRow, type QabulIstisno, type QabulRow } from '../qabul'
import type { Student } from '../types'
import { translateInstitutions } from './qabul-translate'

/*
  Telegram bot uchun jonli .xlsx: portaldagi "Excel eksport" bilan aynan bir xil builder
  (lib/excel-build.ts), faqat serverda. Fayl nomidagi vaqt — Toshkent vaqti (UTC+5).
  QABUL - 2026 da qoidalar tanimagan muassasa nomlari AI orqali tarjima qilinadi (portaldagidek);
  AI ishlamasa yoki vaqt tugasa — qoidalar natijasi, katak sariq (qo'lda tekshirish) bo'lib qoladi.
*/

interface Tarjima { uz: string; ru: string; en: string }

/** Bir nom qayta tarjima qilinmasligi uchun (server nusxasi tirik turguncha) */
const aiCache = new Map<string, Tarjima>()
const keyOf = (makUz: string) => makUz.trim().toLowerCase()
const needsAi = (r: QabulRow) => r.review.includes('makEn') && !!r.makUz

const rowOf = (s: Student) => qabulRow(s, (ISTISNOLAR as Record<string, QabulIstisno>)[String(s.pinfl || '').replace(/\D/g, '')])

/** AI ga ajratilgan umumiy vaqt (ms): bot webhook uzoq kutmasin */
const AI_BUDGET_MS = 25_000

async function prepareQabul(list: Student[]) {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return
  const todo = new Map<string, QabulRow>()
  for (const s of list) {
    const r = rowOf(s)
    if (needsAi(r) && !aiCache.has(keyOf(r.makUz))) todo.set(keyOf(r.makUz), r)
  }
  const rows = [...todo.values()]
  const deadline = Date.now() + AI_BUDGET_MS
  for (let i = 0; i < rows.length && Date.now() < deadline; i += 40) {
    const chunk = rows.slice(i, i + 40)
    try {
      const res = await translateInstitutions(key, chunk.map((r) => ({ uz: r.makUz, hudud: r.viloyat, turi: r.eduType })))
      for (const t of res) aiCache.set(keyOf(t.source), { uz: t.uz, ru: t.ru, en: t.en })
    } catch (err) {
      console.error('QABUL AI tarjima xatosi:', (err as Error).message)
      return
    }
  }
}

function translate(r: QabulRow): QabulRow {
  if (!needsAi(r)) return r
  const t = aiCache.get(keyOf(r.makUz))
  if (!t) return r
  return { ...r, makUz: t.uz, makRu: t.ru, makEn: t.en, review: r.review.filter((k) => k !== 'makEn' && k !== 'makRu') }
}

/** Bot uchun tayyor fayl: QABUL - 2026 (barcha guruhlar) yoki To'liq ma'lumotlar */
export function buildBotXlsx(students: Student[], role: Role) {
  return buildRoleXlsx(students, role, { prepareQabul, translate, utcOffsetHours: 5 })
}
