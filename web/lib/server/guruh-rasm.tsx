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
const LOGO_FILE = path.join(process.cwd(), 'public', 'logo.png')
const W = 1240

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

let logoPromise: Promise<string | null> | null = null
function loadLogoUri() {
  logoPromise ??= readFile(LOGO_FILE)
    .then((b) => `data:image/png;base64,${b.toString('base64')}`)
    .catch(() => null)
  return logoPromise
}

function formatDob(raw: unknown): string {
  const s = String(raw || '').trim()
  if (!s || s === '—' || s === '-' || s === 'None' || s === 'nan') return '—'
  const mDmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s)
  if (mDmy) return `${mDmy[1].padStart(2, '0')}.${mDmy[2].padStart(2, '0')}.${mDmy[3]}`
  const mYmd = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/.exec(s)
  if (mYmd) return `${mYmd[3].padStart(2, '0')}.${mYmd[2].padStart(2, '0')}.${mYmd[1]}`
  return s
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

/** PNG qaytaradi: A4 nisbatida barcha talabalar 1 ta sahifaga sig'adigan zamonaviy dizayn */
export async function renderGroupListPng(g: GroupImageInput): Promise<Buffer> {
  const [fonts, logoUri] = await Promise.all([loadFonts(), loadLogoUri()])
  const count = Math.max(1, g.students.length)
  const TABLE_HEAD_H = 44
  const FOOTER_H = 38
  const FIXED_OVERHEAD = 320
  const maxTableBodyH = 1754 - FIXED_OVERHEAD
  const rowH = Math.min(44, Math.max(20, Math.floor(maxTableBodyH / count)))
  const fontSize = Math.min(22, Math.max(14, Math.floor(rowH * 0.56)))
  const headFontSize = Math.min(22, Math.max(16, fontSize))
  const H = FIXED_OVERHEAD + count * rowH

  const lowTitle = g.title.toLowerCase()
  const accent = lowTitle.includes('chiqaril') ? '#9F1239' : g.special ? '#5B21B6' : '#1E3A8A'
  const badge = lowTitle.includes('chiqaril')
    ? 'SAFDAN CHIQARILGAN'
    : g.special
      ? "AKADEMIK TA'TIL"
      : g.title.toUpperCase()

  const cols = [
    { h: '№', w: 90 },
    { h: "Talabaning F.I.Sh.", w: 826 },
    { h: "Tug'ilgan sanasi", w: 240 },
  ]

  const el = (
    <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: '#FFFFFF', fontFamily: 'Serif', color: '#0F172A', padding: '30px 40px 24px' }}>
      {/* Yuqori to'q ko'k rasmiy banner */}
      <div style={{
        height: 112,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#0F172A',
        border: '2px solid #1E3A8A',
        borderRadius: 12,
        padding: '0 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {logoUri && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUri} alt="" width={78} height={78} style={{ borderRadius: 39, marginRight: 18 }} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: 0.6, color: '#FFFFFF' }}>
              SHAHRISABZ TIBBIYOT TEXNIKUMI
            </div>
            <div style={{ fontSize: 19, color: '#93C5FD', marginTop: 4 }}>
              2026–2027 o&apos;quv yili · Talabalar ro&apos;yxati
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 25, fontWeight: 700, color: '#FDE68A' }}>{badge}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#E2E8F0', marginTop: 4 }}>
            {`${g.students.length} nafar talaba`}
          </div>
        </div>
      </div>

      {/* Yo'nalish va guruh rahbari qatori */}
      <div style={{
        height: 46,
        marginTop: 10,
        marginBottom: 12,
        padding: '0 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#F1F5F9',
        border: '1.5px solid #CBD5E1',
        borderRadius: 8,
        fontSize: 19,
        color: '#0F172A',
      }}>
        <div style={{ display: 'flex' }}>
          {g.special ? `Maxsus ro'yxat: ${g.title}` : g.subtitle}
        </div>
        <div style={{ display: 'flex', fontWeight: 700 }}>
          {g.leader ? `Guruh rahbari: ${g.leader}` : `Jami: ${g.students.length} nafar talaba`}
        </div>
      </div>

      {/* 3 ustunli toza jadval (№, F.I.Sh., Tug'ilgan sanasi) */}
      <div style={{ display: 'flex', flexDirection: 'column', border: `2px solid ${accent}` }}>
        <div style={{ display: 'flex', background: accent, color: '#FFFFFF', fontSize: headFontSize, fontWeight: 700, height: TABLE_HEAD_H, alignItems: 'center' }}>
          {cols.map((c, idx) => (
            <div
              key={c.h}
              style={{
                width: c.w,
                height: TABLE_HEAD_H,
                display: 'flex',
                alignItems: 'center',
                justifyContent: idx === 1 ? 'flex-start' : 'center',
                paddingLeft: idx === 1 ? 16 : 0,
              }}
            >
              {c.h}
            </div>
          ))}
        </div>

        {g.students.map((s, i) => {
          const vals = [String(i + 1), fit(s.fish, 52), formatDob(s.dob)]
          return (
            <div
              key={s.row}
              style={{
                display: 'flex',
                height: rowH,
                alignItems: 'center',
                fontSize,
                background: i % 2 ? '#F8FAFC' : '#FFFFFF',
                borderTop: '1px solid #CBD5E1',
              }}
            >
              {vals.map((v, j) => (
                <div
                  key={j}
                  style={{
                    width: cols[j].w,
                    height: rowH,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: j === 1 ? 'flex-start' : 'center',
                    paddingLeft: j === 1 ? 16 : 0,
                    fontWeight: j === 2 ? 400 : 700,
                    color: j === 0 ? '#475569' : j === 2 ? '#1E293B' : '#0F172A',
                    borderRight: j < 2 ? '1px solid #E2E8F0' : undefined,
                  }}
                >
                  {v}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* Pastki sana chizig'i */}
      <div style={{ height: FOOTER_H, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 18, color: '#64748B' }}>
        <div style={{ display: 'flex' }}>Shahrisabz Tibbiyot Texnikumi ERP</div>
        <div style={{ display: 'flex' }}>{g.stamp}</div>
      </div>
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
