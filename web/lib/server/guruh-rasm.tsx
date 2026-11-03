import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { GROUP_LEADERS } from '@/lib/config'
import { byName, groupTitle, isAcademicLeave, isOutside, kursOf } from '@/lib/student'
import type { Student } from '@/lib/types'

/*
  Guruh ro'yxatining PNG rasmi — bot ("👥 Guruhlar ro'yxati" → guruh tanlanadi) va portal
  (Guruhlar jurnali → "Telegramga yuborish") shu bitta koddan foydalanadi.
  Har safar jonli ma'lumotdan chiziladi — hisobotlar/pdf_jurnallar dagi tayyor rasmlar
  Python hisobot yasalgandagina yangilanadi. Shrift: Liberation Serif (assets/malumotnoma).
*/

const ASSETS = path.join(process.cwd(), 'assets', 'malumotnoma')
const W = 1240
const ROW = 46
const HEAD = 250
const FOOT = 70

let fontsPromise: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | null = null
function loadFonts() {
  const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  fontsPromise ??= Promise.all([
    readFile(path.join(ASSETS, 'LiberationSerif-Regular.ttf')),
    readFile(path.join(ASSETS, 'LiberationSerif-Bold.ttf')),
  ]).then(([r, b]) => ({ regular: ab(r), bold: ab(b) }))
    .catch((e) => { fontsPromise = null; throw e })
  return fontsPromise
}

export interface GroupImageInput {
  title: string // "Guruh 26-01" yoki "Akademik ta'til olganlar"
  subtitle: string // yo'nalish · kurs
  leader?: string
  stamp: string // sana
  students: Student[]
  /** Akademik / safdan chiqarilganlar: shartnoma va telefon o'rniga qaysi guruhdan va qachon */
  special?: boolean
}

/** Rasmiy kontingentga kirmaydigan ro'yxatlar — kaliti guruh kodi o'rnida keladi */
export const SPECIAL_LISTS = {
  akademik: { title: "Akademik ta'til olganlar", pick: (s: Student) => isAcademicLeave(s.group) },
  safdan: { title: 'Talabalar safidan chiqarilganlar', pick: (s: Student) => isOutside(s.group) },
} as const
export type SpecialList = keyof typeof SPECIAL_LISTS

/** Guruh kaliti (26-01, akademik, safdan) bo'yicha rasm ma'lumoti; talabasi bo'lmasa null.
 *  Rahbar va yo'nalish — applyGroupSettings() qo'llangan sozlamalardan. */
export function groupListInput(key: string, students: Student[], stamp: string): GroupImageInput | null {
  const special = key in SPECIAL_LISTS ? SPECIAL_LISTS[key as SpecialList] : null
  const list = students.filter(special ? special.pick : (s) => String(s.group || '').trim() === key).sort(byName)
  if (!list.length) return null
  return {
    title: special ? special.title : `Guruh ${key}`,
    subtitle: special ? 'Rasmiy kontingentga kirmaydi' : `${kursOf(key)}-kurs · ${groupTitle(key)}`,
    leader: special ? '' : GROUP_LEADERS[key] || '',
    stamp,
    students: list,
    special: !!special,
  }
}

export const groupListFileName = (key: string) =>
  key === 'akademik' ? 'Akademik_tatil_royxati.png' : key === 'safdan' ? 'Safdan_chiqarilganlar_royxati.png' : `Guruh_${key}_royxati.png`

/** Katakdan chiqmasin: satori'da overflow:hidden har katakka kesish maskasi qo'shadi va 37 qatorli
 *  ro'yxatni 11 soniyada chizardi (busiz 0,7 s) — shuning uchun matnni o'zimiz qisqartiramiz */
const fit = (v: string, max: number) => (v.length > max ? `${v.slice(0, max - 1)}…` : v)

const phoneOf = (s: Student) => String(s.tel_shaxsiy || s.tel || '').split(/[/,;]/)[0].trim()

/** PNG qaytaradi: JPEG'ga o'girish (jpeg-js) katta ro'yxatda 5–10 soniya olardi, Telegram PNG'ni ham qabul qiladi */
export async function renderGroupListPng(g: GroupImageInput): Promise<Buffer> {
  const fonts = await loadFonts()
  const cols = g.special
    ? [{ h: '№', w: 70 }, { h: 'F.I.SH', w: 580 }, { h: "Tug'ilgan sana", w: 170 }, { h: 'Qaysi guruhdan', w: 170 }, { h: 'Buyruq sanasi', w: 170 }]
    : [{ h: '№', w: 70 }, { h: 'F.I.SH', w: 580 }, { h: "Tug'ilgan sana", w: 170 }, { h: 'Shartnoma №', w: 140 }, { h: 'Telefon', w: 200 }]
  const cells = (s: Student, i: number) => g.special
    ? [String(i + 1), fit(s.fish, 46), s.dob || '—', s.chiqqan_guruh || '—', fit(s.buyruq_sana || '—', 12)]
    : [String(i + 1), fit(s.fish, 46), s.dob || '—', fit(s.shnum || '—', 10), fit(phoneOf(s) || '—', 17)]
  const H = HEAD + ROW + g.students.length * ROW + FOOT
  const accent = g.special ? '#7C3AED' : '#1D4ED8'

  const el = (
    <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: '#FFFFFF', fontFamily: 'Serif', color: '#0F172A', padding: '40px 40px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: HEAD - 40 }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 1, color: '#334155' }}>SHAHRISABZ TIBBIYOT TEXNIKUMI</div>
        <div style={{ fontSize: 46, fontWeight: 700, marginTop: 14, color: accent }}>{g.title}</div>
        <div style={{ fontSize: 24, marginTop: 8, color: '#475569' }}>{g.subtitle}</div>
        <div style={{ display: 'flex', fontSize: 24, marginTop: 10, color: '#0F172A' }}>
          {`${g.leader ? `Guruh rahbari: ${g.leader}  ·  ` : ''}Talabalar soni: ${g.students.length} nafar`}
        </div>
      </div>
      <div style={{ display: 'flex', background: accent, color: '#FFFFFF', fontSize: 22, fontWeight: 700, height: ROW, alignItems: 'center' }}>
        {cols.map((c) => (
          <div key={c.h} style={{ width: c.w, display: 'flex', justifyContent: c.h === 'F.I.SH' ? 'flex-start' : 'center', paddingLeft: c.h === 'F.I.SH' ? 14 : 0 }}>{c.h}</div>
        ))}
      </div>
      {g.students.map((s, i) => (
        <div key={s.row} style={{ display: 'flex', height: ROW, alignItems: 'center', fontSize: 23, background: i % 2 ? '#F1F5F9' : '#FFFFFF', borderBottom: '1px solid #CBD5E1' }}>
          {cells(s, i).map((v, j) => (
            <div key={j} style={{
              width: cols[j].w, display: 'flex',
              justifyContent: j === 1 ? 'flex-start' : 'center', paddingLeft: j === 1 ? 14 : 0,
              fontWeight: j === 1 ? 700 : 400, color: j === 0 ? '#64748B' : '#0F172A',
            }}>{v}</div>
          ))}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 20, color: '#64748B', marginTop: 18 }}>{g.stamp}</div>
    </div>
  )

  const res = new ImageResponse(el, {
    width: W,
    height: H,
    fonts: [
      { name: 'Serif', data: fonts.regular, weight: 400, style: 'normal' },
      { name: 'Serif', data: fonts.bold, weight: 700, style: 'normal' },
    ],
  })
  return Buffer.from(await res.arrayBuffer())
}
