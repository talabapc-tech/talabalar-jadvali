/*
  Majlislar davomati — o'qituvchilar (asosiy va o'rindosh) majlisga kelgan-kelmaganini belgilash.
  Ma'lumot: data/majlislar.json { oqituvchilar, majlislar } (kompyuterda diskda, internetda GitHub'da).
  Bu modul brauzerda ham, serverda ham ishlaydi: turlar, tekshirish va hisob-kitob.
*/

export type OqituvchiTur = 'asosiy' | 'orindosh'
export const TURLAR: OqituvchiTur[] = ['asosiy', 'orindosh']
export const TUR_NOMI: Record<OqituvchiTur, string> = { asosiy: 'Asosiy', orindosh: "O'rindosh" }
export const TUR_TOLIQ: Record<OqituvchiTur, string> = { asosiy: "Asosiy o'qituvchilar", orindosh: "O'rindosh o'qituvchilar" }

export interface Oqituvchi {
  id: string
  fish: string
  tur: OqituvchiTur
  /** false — ishdan ketgan: yangi majlislarga qo'shilmaydi, eski davomatda nomi qoladi */
  faol: boolean
}

export type Holat = 'keldi' | 'sababli' | 'kelmadi'
export const HOLATLAR: Holat[] = ['keldi', 'sababli', 'kelmadi']
export const HOLAT_META: Record<Holat, { nomi: string; belgi: string }> = {
  keldi: { nomi: 'Keldi', belgi: '+' },
  sababli: { nomi: 'Sababli', belgi: 'S' },
  kelmadi: { nomi: 'Kelmadi', belgi: '−' },
}

/** Majlisga kimlar chaqirilgan */
export type Qatnashchilar = 'hammasi' | OqituvchiTur
export const QATNASHCHILAR_NOMI: Record<Qatnashchilar, string> = {
  hammasi: 'Hammasi',
  asosiy: 'Faqat asosiy',
  orindosh: "Faqat o'rindosh",
}

export interface Majlis {
  id: string
  /** YYYY-MM-DD */
  sana: string
  /** HH:MM yoki bo'sh */
  vaqt: string
  mavzu: string
  qatnashchilar: Qatnashchilar
  /** Majlisga chaqirilgan o'qituvchilar (yaratilgan paytdagi ro'yxat) */
  tarkib: string[]
  davomat: Record<string, Holat>
  /** Sabab yoki izoh (sababli / kelmadi uchun) */
  izoh: Record<string, string>
  yangilangan?: string
}

export interface MajlisDb {
  oqituvchilar: Oqituvchi[]
  majlislar: Majlis[]
}

/* -------------------------------------------------------------- yordamchilar */

const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const ID_RE = /^[a-z0-9_-]{1,40}$/i
const isTur = (v: unknown): v is OqituvchiTur => v === 'asosiy' || v === 'orindosh'
const isHolat = (v: unknown): v is Holat => HOLATLAR.includes(v as Holat)

export function newId(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Bugungi sana Toshkent vaqti bo'yicha: YYYY-MM-DD */
export function todayIso(now = new Date()) {
  return new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10)
}

/** 2026-10-22 → 22.10.2026 */
export function sanaUz(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

const HAFTA = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba']
export function haftaKuni(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? '' : HAFTA[d.getUTCDay()]
}

export function sanitizeOqituvchilar(raw: unknown): Oqituvchi[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Oqituvchi[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Partial<Oqituvchi>
    const id = str(o.id, 40)
    const fish = str(o.fish, 120)
    if (!ID_RE.test(id) || !fish || seen.has(id)) continue
    seen.add(id)
    out.push({ id, fish, tur: isTur(o.tur) ? o.tur : 'asosiy', faol: o.faol !== false })
  }
  return out
}

export function sanitizeMajlis(raw: unknown): Majlis | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<Majlis>
  const id = str(m.id, 40)
  const sana = str(m.sana, 10)
  if (!ID_RE.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(sana)) return null
  const vaqt = /^\d{2}:\d{2}$/.test(str(m.vaqt, 5)) ? str(m.vaqt, 5) : ''
  const tarkib = Array.isArray(m.tarkib) ? [...new Set(m.tarkib.map((x) => str(x, 40)).filter((x) => ID_RE.test(x)))] : []
  const inTarkib = new Set(tarkib)
  const davomat: Record<string, Holat> = {}
  for (const [k, v] of Object.entries(m.davomat ?? {})) if (inTarkib.has(k) && isHolat(v)) davomat[k] = v
  const izoh: Record<string, string> = {}
  for (const [k, v] of Object.entries(m.izoh ?? {})) {
    const t = str(v, 200)
    if (inTarkib.has(k) && t) izoh[k] = t
  }
  const q = m.qatnashchilar
  return {
    id, sana, vaqt,
    mavzu: str(m.mavzu, 300),
    qatnashchilar: q === 'asosiy' || q === 'orindosh' ? q : 'hammasi',
    tarkib, davomat, izoh,
    yangilangan: typeof m.yangilangan === 'string' ? m.yangilangan.slice(0, 40) : undefined,
  }
}

export function sanitizeDb(raw: unknown): MajlisDb {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<MajlisDb>
  const majlislar = (Array.isArray(r.majlislar) ? r.majlislar : []).map(sanitizeMajlis).filter((m): m is Majlis => !!m)
  return { oqituvchilar: sanitizeOqituvchilar(r.oqituvchilar), majlislar: sortMajlislar(majlislar) }
}

/** Eng yangi majlis birinchi */
export function sortMajlislar(list: Majlis[]) {
  return [...list].sort((a, b) => (b.sana + b.vaqt).localeCompare(a.sana + a.vaqt))
}

/** Familiya bo'yicha alifbo tartibi (o', g' va h.k. bilan) */
export const byFish = (a: { fish: string }, b: { fish: string }) => a.fish.localeCompare(b.fish, 'uz')

/** Yangi majlisga chaqiriladiganlar: faol o'qituvchilar, kerakli turdagilar */
export function defaultTarkib(oqituvchilar: Oqituvchi[], q: Qatnashchilar) {
  return oqituvchilar.filter((o) => o.faol && (q === 'hammasi' || o.tur === q)).map((o) => o.id)
}

export function yangiMajlis(oqituvchilar: Oqituvchi[], q: Qatnashchilar = 'hammasi'): Majlis {
  const now = new Date(Date.now() + 5 * 3600_000)
  return {
    id: newId('m'),
    sana: todayIso(),
    vaqt: now.toISOString().slice(11, 16),
    mavzu: '',
    qatnashchilar: q,
    tarkib: defaultTarkib(oqituvchilar, q),
    davomat: {},
    izoh: {},
  }
}

/** Majlis tarkibidagi o'qituvchilar — turi bo'yicha, alifbo tartibida. Ro'yxatdan o'chirilgan bo'lsa ham nomi chiqadi. */
export function majlisOqituvchilari(m: Majlis, oqituvchilar: Oqituvchi[], tur: OqituvchiTur): Oqituvchi[] {
  const byId = new Map(oqituvchilar.map((o) => [o.id, o]))
  return m.tarkib
    .map((id) => byId.get(id) ?? { id, fish: `(o'chirilgan: ${id})`, tur: 'asosiy' as const, faol: false })
    .filter((o) => o.tur === tur)
    .sort(byFish)
}

export interface Hisob {
  jami: number
  keldi: number
  sababli: number
  kelmadi: number
  belgilanmagan: number
  /** Kelganlar foizi, belgilanganlar ichida */
  foiz: number
}

export function hisobla(list: Oqituvchi[], davomat: Record<string, Holat>): Hisob {
  const h: Hisob = { jami: list.length, keldi: 0, sababli: 0, kelmadi: 0, belgilanmagan: 0, foiz: 0 }
  for (const o of list) {
    const s = davomat[o.id]
    if (s) h[s]++
    else h.belgilanmagan++
  }
  const belgilangan = h.jami - h.belgilanmagan
  h.foiz = belgilangan ? Math.round((h.keldi / belgilangan) * 100) : 0
  return h
}

/* ------------------------------------------------ Telegram matnlari (kontingent uslubida) */

const escHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** "Botirova Gulandon Shokirovna" → "Botirova G.Sh." — jadvalda ustunlar tekis tursin */
export function qisqaFish(fish: string) {
  const [fam, ...rest] = fish.replace(/\s+/g, ' ').trim().split(' ')
  const ini = rest
    .filter((p) => !/^(qizi|o['‘’`]?g['‘’`]?li|ugli|ogli)$/i.test(p))
    .map((p) => (/^(sh|ch)/i.test(p) ? p.slice(0, 2) : p.slice(0, 1)).replace(/^./, (c) => c.toUpperCase()) + '.')
    .join('')
  return ini ? `${fam} ${ini}` : fam
}

/** Daraxt qatorlari: ├─ … / oxirgisi └─ … (monospace <pre> ichida) */
const tree = (rows: string[]) => rows.map((r, i) => `${i === rows.length - 1 ? '└─' : '├─'} ${r}`)
const pre = (rows: string[]) => ['<pre>', ...rows, '</pre>']
const num = (n: number, w = 2) => String(n).padStart(w, ' ')

/** Bitta majlis davomati — Telegram uchun (kontingent hisobotidek daraxtsimon jadval) */
export function majlisMatni(m: Majlis, oqituvchilar: Oqituvchi[]): string {
  const parts = TURLAR.map((tur) => ({ tur, list: majlisOqituvchilari(m, oqituvchilar, tur) })).filter((x) => x.list.length)
  const all = hisobla(parts.flatMap((x) => x.list), m.davomat)
  const lines = [
    `📋 <b>MAJLIS DAVOMATI</b>`,
    `🕒 Sana: <b>${sanaUz(m.sana)}${m.vaqt ? ` | ${m.vaqt}` : ''}</b> (${haftaKuni(m.sana)})`,
  ]
  if (m.mavzu) lines.push(`📝 Mavzu: <i>${escHtml(m.mavzu)}</i>`)
  lines.push('', '┌─ 📊 <b>UMUMIY HOLAT</b>', ...pre(tree([
    `Chaqirilgan    | ${num(all.jami)} nafar`,
    `Keldi          | ${num(all.keldi)} nafar`,
    `Sababli        | ${num(all.sababli)} nafar`,
    `Kelmadi        | ${num(all.kelmadi)} nafar`,
    ...(all.belgilanmagan ? [`Belgilanmagan  | ${num(all.belgilanmagan)} nafar`] : []),
    `Qatnashish     | ${num(all.foiz, 3)} %`,
  ])))
  for (const { tur, list } of parts) {
    const h = hisobla(list, m.davomat)
    const w = Math.max(...list.map((o) => qisqaFish(o.fish).length))
    lines.push('', `┌─ ${tur === 'asosiy' ? '📗' : '📘'} <b>${TUR_TOLIQ[tur].toUpperCase()} (${h.keldi}/${h.jami} keldi)</b>`)
    lines.push(...pre(tree(list.map((o) => {
      const s = m.davomat[o.id]
      const holat = s === 'kelmadi' ? 'KELMADI' : s === 'sababli' ? 'sababli' : s === 'keldi' ? 'keldi' : '—'
      const izoh = m.izoh[o.id] ? ` (${m.izoh[o.id]})` : ''
      return escHtml(`${qisqaFish(o.fish).padEnd(w, ' ')} | ${holat}${izoh}`)
    }))))
  }
  return lines.join('\n')
}

/** Davr hisoboti (bir necha majlis) — har o'qituvchi: keldi / sababli / kelmadi va foiz */
export function majlisHisobotMatni(majlislar: Majlis[], oqituvchilar: Oqituvchi[], davr: string): string {
  const lines = [
    `📊 <b>MAJLISLAR DAVOMATI</b>`,
    `🗓 Davr: <b>${escHtml(davr)}</b> · ${majlislar.length} ta majlis`,
    '<i>Ustunlar: keldi / sababli / kelmadi · qatnashish %</i>',
  ]
  const byId = new Map(oqituvchilar.map((o) => [o.id, o]))
  for (const tur of TURLAR) {
    const stat = new Map<string, { o: Oqituvchi; keldi: number; sababli: number; kelmadi: number }>()
    for (const m of majlislar) {
      for (const id of m.tarkib) {
        const o = byId.get(id)
        if (!o || o.tur !== tur) continue
        const r = stat.get(id) ?? { o, keldi: 0, sababli: 0, kelmadi: 0 }
        const h = m.davomat[id]
        if (h) r[h]++
        stat.set(id, r)
      }
    }
    const rows = [...stat.values()].sort((a, b) => byFish(a.o, b.o))
    if (!rows.length) continue
    const w = Math.max(...rows.map((r) => qisqaFish(r.o.fish).length))
    const keldi = rows.reduce((s, r) => s + r.keldi, 0)
    const jami = rows.reduce((s, r) => s + r.keldi + r.sababli + r.kelmadi, 0)
    lines.push('', `┌─ ${tur === 'asosiy' ? '📗' : '📘'} <b>${TUR_TOLIQ[tur].toUpperCase()} (${rows.length} nafar, ${jami ? Math.round((keldi / jami) * 100) : 0}%)</b>`)
    lines.push(...pre(tree(rows.map((r) => {
      const marked = r.keldi + r.sababli + r.kelmadi
      const foiz = marked ? Math.round((r.keldi / marked) * 100) : 0
      return escHtml(`${qisqaFish(r.o.fish).padEnd(w, ' ')} | ${num(r.keldi)} / ${num(r.sababli)} / ${num(r.kelmadi)} | ${num(foiz, 3)}%`)
    }))))
  }
  return lines.join('\n')
}
