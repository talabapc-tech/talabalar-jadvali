import { ACADEMIC_LEAVE_GROUP, COURSES, GROUP_CODE, GROUPS, GROUP_TITLES, OQUV_YILI_BOSHI, SECRET_GROUP, WITHDRAWN_GROUP } from './config'
import type { EditFields, Student } from './types'

export function isWithdrawn(g: string | undefined): boolean {
  const gl = String(g || '').trim().toLowerCase()
  return gl === 'n' || gl.includes('chiqaril') || gl.includes('chetlat')
}

export function isAcademicLeave(g: string | undefined): boolean {
  return String(g || '').trim().toLowerCase().includes('akademik')
}

/** Maxfiy guruh (26-07) — darslarga kelmaydiganlar, kontraktlarga kirmaydi */
export function isSecretGroup(g: string | undefined): boolean {
  return String(g || '').trim() === SECRET_GROUP
}

/** Rasmiy kontingentdagi akademik guruh (ro'yxatdagi yoki "YY-NN" ko'rinishidagi) */
export function isOfficialGroup(g: string | undefined): boolean {
  const t = String(g || '').trim()
  return GROUPS.includes(t) || GROUP_CODE.test(t)
}

/** Safdan chiqarilgan yoki guruhsiz — na akademik guruhda, na akademik ta'tilda */
export function isOutside(g: string | undefined): boolean {
  return !isOfficialGroup(g) && !isAcademicLeave(g)
}

/** Guruh qaysi kursga tegishli: ro'yxatdan, bo'lmasa guruh kodidagi qabul yilidan */
export function kursOf(g: string | undefined): number | null {
  const t = String(g || '').trim()
  const c = COURSES.find((x) => x.groups.includes(t))
  if (c) return c.kurs
  const m = /^(\d{2})-\d{2}$/.exec(t)
  return m ? Math.max(1, OQUV_YILI_BOSHI - (2000 + Number(m[1])) + 1) : null
}

/** Akademik guruhlar (ro'yxatdagilar + bazada uchraganlar), kerak bo'lsa bitta kurs bo'yicha */
export function academicGroups(students: Student[], kurs?: number | null): string[] {
  const set = new Set<string>(GROUPS)
  for (const s of students) if (isOfficialGroup(s.group)) set.add(s.group.trim())
  return [...set].filter((g) => !kurs || kursOf(g) === kurs).sort((a, b) => {
    const ka = kursOf(a) ?? 99
    const kb = kursOf(b) ?? 99
    if (ka !== kb) return ka - kb
    return a.localeCompare(b, undefined, { numeric: true })
  })
}

export function groupTitle(g: string): string {
  return GROUP_TITLES[g] || 'Hamshiralik ishi'
}

/** Guruh tanlash ro'yxati: akademik guruhlar va maxsus guruhlar */
/** Safdan chiqarish yoki akademik ta'tilga o'tkazish — buyruq raqami va sanasi so'raladi */
export function needsOrder(from: string | undefined, to: string | undefined): boolean {
  const t = String(to || '').trim()
  if (!t || t === String(from || '').trim()) return false
  return isWithdrawn(t) || isAcademicLeave(t)
}

/** Akademik ta'til yoki safdan chiqarilganlar — "qaysi guruhdan chiqqan" ko'rsatiladigan guruhlar */
export function isLeftGroup(g: string | undefined): boolean {
  return isWithdrawn(g) || isAcademicLeave(g)
}

/** Talabaning hozirgi guruhiga o'tkazilgan oxirgi yozuv (qachon, qaysi buyruq bilan) */
export function lastMoveInto(s: Pick<Student, 'group' | 'guruh_tarixi'>) {
  const g = String(s.group || '').trim()
  return [...(s.guruh_tarixi ?? [])].reverse().find((m) => m.to === g)
}

/** Buyruq sanasi: KK.OO.YYYY */
export const ORDER_DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/

export function groupOptions(students: Student[]): [string, string][] {
  return [
    ...academicGroups(students).map((g) => [g, isSecretGroup(g)
      ? `${g} (maxfiy guruh)`
      : `${g} (${kursOf(g)}-kurs, ${groupTitle(g).replace(/ ishi$/, '')})`] as [string, string]),
    [ACADEMIC_LEAVE_GROUP, ACADEMIC_LEAVE_GROUP],
    [WITHDRAWN_GROUP, WITHDRAWN_GROUP],
  ]
}

/** Shartnoma raqamidan o'quv yili va "Sh/A" ni olib tashlash: '26/27 SH/A 15' → '15'
 *  (2-, 3-kurslarda shunday yozilgan edi; telegram_sync_service.normalize_shnum bilan bir xil) */
export function normalizeShnum(v: unknown): string {
  const s = String(v ?? '').trim()
  const m = /^\d{2}\s*\/\s*\d{2}\s*sh\s*\/\s*a\s*(\d+)$/i.exec(s)
  return m ? m[1] : s
}

export function fullName(s: Pick<Student, 'fish' | 'ism' | 'ota'>): string {
  return (s.fish || `${s.ism || ''} ${s.ota || ''}`).trim()
}

export const byName = (a: Student, b: Student) =>
  fullName(a).localeCompare(fullName(b), 'uz', { sensitivity: 'base' })

/* ------------------------------ JSHSHIR ------------------------------ */

const PINFL_WEIGHTS = [7, 3, 1, 7, 3, 1, 7, 3, 1, 7, 3, 1, 7]
const PINFL_REGIONS: Record<string, string> = {
  '001': 'Toshkent shahri', '002': 'Andijon viloyati', '003': 'Buxoro viloyati',
  '004': 'Jizzax viloyati', '005': 'Qashqadaryo viloyati', '006': 'Navoiy viloyati',
  '007': 'Namangan viloyati', '008': 'Samarqand viloyati', '009': 'Surxondaryo viloyati',
  '010': 'Sirdaryo viloyati', '011': 'Toshkent viloyati', '012': "Farg'ona viloyati",
  '013': 'Xorazm viloyati', '014': "Qoraqalpog'iston Respublikasi",
}
const PINFL_CENTURY: Record<string, [number, string]> = {
  '1': [1800, 'Erkak'], '2': [1800, 'Ayol'],
  '3': [1900, 'Erkak'], '4': [1900, 'Ayol'],
  '5': [2000, 'Erkak'], '6': [2000, 'Ayol'],
}

/** Tug'ilgan tuman kodi (JSHSHIR ning 8–10 raqamlari) — Excel eksport uchun */
const TUMAN_KODI: Record<string, string> = {
  '559': 'Shahrisabz tumani',
  '568': 'Kitob tumani',
  '573': "Yakkabog' tumani",
  '789': 'Shahrisabz shahri',
  '256': 'Shahrisabz tumani',
  '572': 'Chiroqchi tumani',
  '563': 'Qamashi tumani',
}

export function decodePinfl(raw: string) {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length !== 14) return null
  const c = PINFL_CENTURY[d[0]]
  const kod = d.slice(7, 10)
  const sum = PINFL_WEIGHTS.reduce((acc, w, i) => acc + w * Number(d[i]), 0) % 10
  return {
    raw: d,
    jins: c ? c[1] : "Noma'lum",
    sana: `${d.slice(1, 3)}.${d.slice(3, 5)}.${c ? c[0] + Number(d.slice(5, 7)) : '20' + d.slice(5, 7)}`,
    kod,
    joy: PINFL_REGIONS[kod] || TUMAN_KODI[kod] || `Hudud kodi: ${kod}`,
    tartib: d.slice(10, 13),
    nazorat: sum === Number(d[13]),
  }
}

/** JSHSHIR dan tug'ilgan sanani (DD.MM.YYYY) chiqarish */
export function dobFromPinfl(raw: string): string | null {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length < 7) return null
  const dd = Number(d.slice(1, 3))
  const mm = Number(d.slice(3, 5))
  if (!(dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12)) return null
  const century = PINFL_CENTURY[d[0]]?.[0] ?? (Number(d.slice(5, 7)) <= 30 ? 2000 : 1900)
  return `${d.slice(1, 3)}.${d.slice(3, 5)}.${century + Number(d.slice(5, 7))}`
}

export function tugilganTuman(pinfl: string): string {
  const p = String(pinfl || '').replace(/\s/g, '')
  if (!/^\d{14}$/.test(p)) return ''
  return TUMAN_KODI[p.slice(7, 10)] || ''
}

export function formatPinfl(v: string): string {
  const d = String(v || '').replace(/\D/g, '')
  return d.length === 14 ? `${d.slice(0, 6)} ${d.slice(6, 10)} ${d.slice(10)}` : d
}

/** Sanani doim DD.MM.YYYY ko'rinishiga keltirish */
export function formatDate(val: string): string {
  let s = String(val || '').trim()
  if (!s || s === '—' || s === '-') return ''
  s = s.split(' ')[0]
  const m1 = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (m1) return `${m1[1].padStart(2, '0')}.${m1[2].padStart(2, '0')}.${m1[3]}`
  const m2 = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/)
  if (m2) return `${m2[3].padStart(2, '0')}.${m2[2].padStart(2, '0')}.${m2[1]}`
  return s
}

export function passTypeShort(s: Pick<Student, 'pass_type' | 'pv'>): 'ID' | 'Bio' | '' {
  const pv = (s.pv || '').toUpperCase()
  if (s.pass_type === 'ID-karta' || pv.startsWith('AD') || pv.startsWith('AE')) return 'ID'
  if (s.pass_type === 'Biometrik Pasport' || /^A[ABC]/.test(pv)) return 'Bio'
  return ''
}

/* ----------------------------- DUBLIKATLAR ----------------------------- */

const cleanPv = (v: string) => String(v || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
const cleanPin = (v: string) => String(v || '').replace(/\D/g, '')

export interface DuplicateHit { student: Student; matchPv: string; matchPinfl: string }

export function findDuplicates(students: Student[], pv: string, pinfl: string, excludeRow?: number): DuplicateHit[] {
  const p = cleanPv(pv)
  const n = cleanPin(pinfl)
  const checkPv = p.length >= 6 && p !== 'NONE'
  const checkPin = n.length >= 10
  if (!checkPv && !checkPin) return []
  const hits: DuplicateHit[] = []
  for (const s of students) {
    if (excludeRow && s.row === excludeRow) continue
    const mPv = checkPv && cleanPv(s.pv) === p ? p : ''
    const mPin = checkPin && cleanPin(s.pinfl) === n ? n : ''
    if (mPv || mPin) hits.push({ student: s, matchPv: mPv, matchPinfl: mPin })
  }
  return hits
}

export interface DuplicateGroup { kind: 'Pasport' | 'JSHSHIR'; value: string; students: Student[] }

export function scanDuplicates(students: Student[]): DuplicateGroup[] {
  const pv = new Map<string, Student[]>()
  const pin = new Map<string, Student[]>()
  for (const s of students) {
    const a = cleanPv(s.pv)
    const b = cleanPin(s.pinfl)
    if (a.length >= 6 && a !== 'NONE') pv.set(a, [...(pv.get(a) ?? []), s])
    if (b.length >= 10) pin.set(b, [...(pin.get(b) ?? []), s])
  }
  const out: DuplicateGroup[] = []
  for (const [value, list] of pv) if (list.length > 1) out.push({ kind: 'Pasport', value, students: list })
  for (const [value, list] of pin) if (list.length > 1) out.push({ kind: 'JSHSHIR', value, students: list })
  return out
}

/* ------------------------------- FILTRLAR ------------------------------- */

export interface Filters {
  search: string
  kurs: string // '' | '1' | '2' | '3'
  group: string // '' | '26-01' ... | ACADEMIC_LEAVE | WITHDRAWN
  passType: string
  docType: string
  status: string
  nameFlag: string // '' | 'none' | ok | translit | farq | tekshir | boshqa
  verified: string // '' | 'TASDIQLANDI' | 'KUTILMOQDA'
  baza: string // '' | 'KIRITILDI' | 'KIRITILMAGAN'
  yon: string
}

export const EMPTY_FILTERS: Filters = {
  search: '', kurs: '', group: '', passType: '', docType: '', status: '', nameFlag: '', verified: '', baza: '', yon: '',
}

export function isBazaEntered(s: Pick<Student, 'baza'>): boolean {
  return (s.baza || 'KIRITILDI') !== 'KIRITILMAGAN'
}

/** Qidiruv uchun bir marta tayyorlanadigan kichik harfli matn */
export function searchText(s: Student): string {
  return [s.group, s.shnum, fullName(s), s.pv, s.pinfl, s.mak, s.doc_file, s.pass_fish, s.cert_fish, s.sh_doc, s.tel]
    .join(' ')
    .toLowerCase()
}

/** Filtrdagi guruhlar: Ctrl bilan bir nechtasi tanlanganda "24-11,24-12" */
export function selectedGroups(group: string): string[] {
  return group.includes(',') ? group.split(',').map((g) => g.trim()).filter(Boolean) : group ? [group] : []
}

export function matches(s: Student, text: string, f: Filters, q: string): boolean {
  if (q && !text.includes(q)) return false
  if (f.group.includes(',')) {
    if (!selectedGroups(f.group).includes(s.group)) return false
  } else if (f.group) {
    if (isWithdrawn(f.group)) {
      if (!isOutside(s.group)) return false
    } else if (isAcademicLeave(f.group)) {
      if (!isAcademicLeave(s.group)) return false
    } else if (s.group !== f.group) return false
  } else if (f.kurs && kursOf(s.group) !== Number(f.kurs)) {
    // Kurs tanlanganda maxsus guruhlar faqat o'z filtri bilan ko'rinadi
    return false
  }
  if (f.passType && s.pass_type !== f.passType) return false
  if (f.docType && s.doc_tur !== f.docType) return false
  if (f.status && s.status !== f.status) return false
  if (f.nameFlag) {
    if (f.nameFlag === 'none' ? s.name_flag !== '' : s.name_flag !== f.nameFlag) return false
  }
  if (f.verified && (s.verified || 'KUTILMOQDA') !== f.verified) return false
  if (f.baza && (s.baza || 'KIRITILDI') !== f.baza) return false
  if (f.yon && !(s.yon || '').toLowerCase().includes(f.yon.toLowerCase())) return false
  return true
}

export const NAME_FLAGS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' }> = {
  ok: { label: "Ro'yxat bilan aynan mos", tone: 'ok' },
  translit: { label: 'Imlo farqi (q/k, x/h) — bir odam', tone: 'warn' },
  farq: { label: "Ro'yxatdan haqiqiy farq — tekshiring", tone: 'bad' },
  tekshir: { label: "Tekshiruvdan o'tmadi — qo'lda ko'rish kerak", tone: 'info' },
  boshqa: { label: 'Boshqa odamning hujjati', tone: 'bad' },
}

/** Yangi qo'shilgan (hali students.json ga tushmagan) talaba yozuvi */
export function buildAddedStudent(f: EditFields, row: number): Student {
  const ism = (f.ism || '').trim()
  const ota = (f.ota || '').trim()
  const fish = `${ism} ${ota}`.trim()
  const pv = (f.pv || '').trim().toUpperCase()
  const pass_type = pv.startsWith('AD') || pv.startsWith('AE') ? 'ID-karta' : /^A[ABC]/.test(pv) ? 'Biometrik Pasport' : ''
  const hasFull = !!(pv && f.pinfl && f.dob && f.sh_doc)
  return {
    row,
    tr: row - 1,
    shnum: f.shnum || '',
    sana: new Date().toLocaleDateString('ru-RU'),
    ism,
    ota,
    fish,
    yon: f.yon || 'Hamshiralik ishi - 3 yillik',
    group: f.group || '26-02',
    pv,
    pass_type,
    pinfl: f.pinfl || '',
    dob: f.dob || '',
    ber: f.ber || '',
    sh_doc: f.sh_doc || '',
    sh_qr: '',
    mak: f.mak || '',
    doc_tur: f.doc_tur || 'Shahodatnoma',
    yil: f.yil || '2024',
    tel: f.tel || '',
    doc_file: f.doc_file || '',
    status: hasFull ? 'full' : (pv || f.sh_doc) ? 'chala' : 'yoq',
    pass_fish: '',
    cert_fish: '',
    name_match: '',
    name_flag: '',
    verified: 'KUTILMOQDA',
    baza: 'KIRITILDI',
  }
}
