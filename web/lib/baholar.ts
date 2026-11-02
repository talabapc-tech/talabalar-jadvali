/*
  Baholar bo'limi: server (app/api/baholar) va brauzer (BaholarSection, Excel) uchun umumiy tiplar va hisob-kitob.
  Jadvallar: web/supabase/baholar.sql

  Tizim: texnikumda baho 5 ballik (2–5) kiritiladi, bazaning adminiga esa 100 ballik reyting kerak.
  5 ballik baho aniq ballni saqlamaydi, shuning uchun reyting AVTOMATIK hosil qilinadi:
    • har bir baho o'z oralig'idan ball oladi (BALL_ORALIQ),
    • R-semestr (reyting) = Yakuniy, Joriy, Oraliq reytinglarining o'rtachasi,
    • R-semestr ball mezondan chiqmaydi: 5 ballik R-semestr = uch bahoning yaxlitlangan o'rtachasi,
      100 ballik R-semestr esa shu bahoga mos oraliqqa (86+ → 5, 71+ → 4, 55+ → 3, undan past → 2) tushadi.
  Ball tasodifiy, lekin DETERMINISTIK: bir xil talaba/fan/baho har safar bir xil ball beradi (Excel qayta yuklansa o'zgarmaydi).
*/

/** Fan bo'yicha baho turlari. Tartib admin jadvalidagidek: Yakuniy, Joriy, Oraliq, R-semestr */
export const BAHO_TURLARI = [
  { key: 'yakuniy', label: 'Yakuniy', nazorat: 'Yakuniy nazorat' },
  { key: 'joriy', label: 'Joriy', nazorat: 'Joriy nazorat' },
  { key: 'oraliq', label: 'Oraliq', nazorat: 'Oraliq nazorat' },
  { key: 'r_semestr', label: 'R-semestr', nazorat: 'R-semestr' },
] as const

export type BahoTuri = (typeof BAHO_TURLARI)[number]['key']
/** Qo'lda kiritiladigan 3 ta baho (R-semestr o'zi hisoblanadi) */
export const KIRITILADIGAN = ['yakuniy', 'joriy', 'oraliq'] as const
export type Kiritiladigan = (typeof KIRITILADIGAN)[number]

export const SEMESTRLAR = [1, 2, 3, 4, 5, 6] as const
export const DEFAULT_AMALIYOT = 'Malakaviy amaliyot'

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

/** Bazadagi bitta qator: talaba × fan. *100 — avtomatik hosil qilingan reyting */
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

function ballFor(seed: string, baho: number): number {
  const [lo, hi] = BALL_ORALIQ[baho]
  return lo + Math.floor(rnd(seed) * (hi - lo + 1))
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface Reyting {
  yakuniy100: number | null
  joriy100: number | null
  oraliq100: number | null
  /** Faqat uchala baho ham bo'lganda */
  r100: number | null
  /** 5 ballik R-semestr: uchala bahoning yaxlitlangan o'rtachasi */
  r_semestr: number | null
}

/**
 * Uch bahodan (5 ballik) reyting hosil qiladi. seed — talaba|semestr|fan (bir xil kirish → bir xil natija).
 * Uchala baho bo'lsa: R-semestr = uch reyting o'rtachasi va u r_semestr bahosining mezonida bo'ladi.
 */
export function hisoblaReyting(seed: string, g: Record<Kiritiladigan, number | null>): Reyting {
  const make = (attempt: number) => {
    const out: Record<Kiritiladigan, number | null> = { yakuniy: null, joriy: null, oraliq: null }
    for (const k of KIRITILADIGAN) out[k] = g[k] === null ? null : ballFor(`${seed}|${k}|${g[k]}|${attempt}`, g[k]!)
    return out
  }
  const first = make(0)
  const res: Reyting = { yakuniy100: first.yakuniy, joriy100: first.joriy, oraliq100: first.oraliq, r100: null, r_semestr: null }
  if (g.yakuniy === null || g.joriy === null || g.oraliq === null) return res

  const want = Math.round((g.yakuniy + g.joriy + g.oraliq) / 3)
  let pick = first
  let r = (first.yakuniy! + first.joriy! + first.oraliq!) / 3
  for (let a = 1; bahoOf(r) !== want && a <= 400; a++) {
    pick = make(a)
    r = (pick.yakuniy! + pick.joriy! + pick.oraliq!) / 3
  }
  res.yakuniy100 = pick.yakuniy
  res.joriy100 = pick.joriy
  res.oraliq100 = pick.oraliq
  res.r100 = round2(r)
  // Mezon mos kelmay qolsa (amalda bo'lmaydi) — baho reytingga moslanadi, ikkalasi doim bir-biriga mos qoladi
  res.r_semestr = bahoOf(r) === want ? want : bahoOf(r)
  return res
}

/** Bitta bahodan (malakaviy amaliyot) reyting */
export function amaliyotReyting(seed: string, baho: number | null): number | null {
  return baho === null ? null : ballFor(`${seed}|${baho}`, baho)
}

export const reytingSeed = (pinfl: string, semestr: number, fan: string) => `${pinfl}|${semestr}|${fan}`
