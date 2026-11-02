/*
  Baholar bo'limi: server (app/api/baholar) va brauzer (BaholarSection, Excel) uchun umumiy tiplar va hisob-kitob.
  Jadvallar: web/supabase/baholar.sql

  Tizim: texnikumda baho 5 ballik (2–5) kiritiladi, bazaning adminiga esa 100 ballik reyting kerak.
  Foydalanuvchi talabi: R-semestr avtomatik hisoblanmaydi, uni foydalanuvchi/o'qituvchi o'zi qo'yadi.
*/

/** Fan bo'yicha baho turlari: Yakuniy, Joriy, Oraliq, R-semestr */
export const BAHO_TURLARI = [
  { key: 'yakuniy', label: 'Yakuniy', nazorat: 'Yakuniy nazorat' },
  { key: 'joriy', label: 'Joriy', nazorat: 'Joriy nazorat' },
  { key: 'oraliq', label: 'Oraliq', nazorat: 'Oraliq nazorat' },
  { key: 'r_semestr', label: 'R-semestr', nazorat: 'R-semestr' },
] as const

export type BahoTuri = (typeof BAHO_TURLARI)[number]['key']

/** Qo'lda kiritiladigan baholar: Yakuniy, Joriy, Oraliq va R-semestr (o'zimiz qo'yamiz) */
export const KIRITILADIGAN = ['yakuniy', 'joriy', 'oraliq', 'r_semestr'] as const
export type Kiritiladigan = (typeof KIRITILADIGAN)[number]

export const SEMESTRLAR = [1, 2, 3, 4, 5, 6] as const
export const DEFAULT_AMALIYOT = 'Malakaviy amaliyot'
export const AM_FIELDS = ['joy', 'boshlanish', 'tugash', 'ball', 'izoh'] as const
export type AmField = (typeof AM_FIELDS)[number]

/** Har bir 5 ballik baho uchun reyting ball oralig'i (ikkala chegara ham kiradi) */
export const BALL_ORALIQ: Record<number, readonly [number, number]> = {
  2: [45, 54],
  3: [65, 70],
  4: [71, 85],
  5: [87, 95],
}

/** Reyting ballini 5 ballik bahoga aylantirish mezoni */
export function bahoOf(ball: number): 2 | 3 | 4 | 5 {
  return ball >= 86 ? 5 : ball >= 71 ? 4 : ball >= 55 ? 3 : 2
}

export interface Fan { nom: string; tartib: number }

/** Bazadagi bitta qator: talaba × fan. *100 — reyting */
export interface BahoRow {
  pinfl: string
  fan: string
  yakuniy: number | null
  joriy: number | null
  oraliq: number | null
  r_semestr: number | null
  yakuniy100: number | null
  joriy100: number | null
  oraliq100: number | null
  r100: number | null
}

export interface AmaliyotRow {
  pinfl: string
  nom: string
  joy: string
  boshlanish: string
  tugash: string
  ball: number | null
  ball100: number | null
  izoh: string
}

export interface BaholarPayload {
  ok: true
  fanlar: Fan[]
  baholar: BahoRow[]
  amaliyot: AmaliyotRow[]
}

/** "4" → 4; bo'sh → null; 2..5 dan boshqa → undefined (yaroqsiz) */
export function parseBaho(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  if (t === '') return null
  return /^[2-5]$/.test(t) ? Number(t) : undefined
}

export function isPinfl(v: unknown): v is string {
  return typeof v === 'string' && /^\d{14}$/.test(v)
}

export function isSemestr(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 8
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
}

export const bahoText = (n: number | null | undefined): string => (n === null || n === undefined ? '' : String(n))

/* ---------------------------------------------------------------- reyting hosil qilish */

/** FNV-1a: matndan 32 bitli son */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

/** Mulberry32: urug'dan [0,1) son */
function rnd(seed: string): number {
  let a = hash(seed) + 0x6d2b79f5
  a = Math.imul(a ^ (a >>> 15), a | 1)
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61)
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296
}

export function ballFor(seed: string, baho: number): number {
  const [lo, hi] = BALL_ORALIQ[baho] || [60, 70]
  return lo + Math.floor(rnd(seed) * (hi - lo + 1))
}

export interface Reyting {
  yakuniy100: number | null
  joriy100: number | null
  oraliq100: number | null
  r100: number | null
  r_semestr: number | null
}

/**
 * Baholardan reyting hosil qiladi.
 * R-semestr foydalanuvchi tomonidan kiritilsa, shu qiymat saqlanadi.
 */
export function hisoblaReyting(
  seed: string,
  g: { yakuniy: number | null; joriy: number | null; oraliq: number | null; r_semestr?: number | null },
): Reyting {
  const yakuniy100 = g.yakuniy !== null ? ballFor(`${seed}|yakuniy|${g.yakuniy}`, g.yakuniy) : null
  const joriy100 = g.joriy !== null ? ballFor(`${seed}|joriy|${g.joriy}`, g.joriy) : null
  const oraliq100 = g.oraliq !== null ? ballFor(`${seed}|oraliq|${g.oraliq}`, g.oraliq) : null

  // Foydalanuvchi R-semestrni o'zi kiritgan bo'lsa
  let r_semestr: number | null = null
  let r100: number | null = null

  if (g.r_semestr !== undefined && g.r_semestr !== null) {
    r_semestr = g.r_semestr
    r100 = ballFor(`${seed}|r_semestr|${r_semestr}`, r_semestr)
  }

  return {
    yakuniy100,
    joriy100,
    oraliq100,
    r100,
    r_semestr,
  }
}

/** Bitta bahodan (malakaviy amaliyot) reyting */
export function amaliyotReyting(seed: string, baho: number | null): number | null {
  return baho === null ? null : ballFor(`${seed}|${baho}`, baho)
}

export const reytingSeed = (pinfl: string, semestr: number, fan: string) => `${pinfl}|${semestr}|${fan}`
