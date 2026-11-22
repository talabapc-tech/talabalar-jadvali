import { COURSES, GROUP_TITLES, SECRET_GROUP } from './config'
import { decodePinfl } from './student'

export type SurveyAudience = 'talabalar' | 'xodimlar' | 'ochiq'

export type QuestionType =
  | 'phone'
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'pinfl'
  | 'passport'
  | 'card'
  | 'tuman'
  | 'group'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'yes_no'
  | 'rating'

export interface SurveyQuestion {
  id: string
  type: QuestionType
  label: string
  hint?: string
  placeholder?: string
  required: boolean
  options?: string[]
  allowOther?: boolean
  min?: number | null
  max?: number | null
  unit?: string
}

export interface Survey {
  id: string
  slug: string
  title: string
  description: string
  audience: SurveyAudience
  target_courses: number[]
  target_groups: string[]
  questions: SurveyQuestion[]
  active: boolean
  allow_update: boolean
  expires_at: string | null
  created_at: string
  updated_at: string
  response_count?: number
}

export interface SurveyResponseRow {
  id: number
  survey_id: string
  respondent_key: string
  respondent_type: SurveyAudience
  respondent_name: string
  respondent_group: string
  respondent_pinfl: string
  answers: Record<string, string | string[] | number>
  created_at: string
  updated_at: string
}

export const AUDIENCE_META: Record<SurveyAudience, { label: string; sub: string }> = {
  talabalar: { label: 'Talabalar', sub: 'Kurs → Guruh → F.I.Sh. orqali aniq topshiradi' },
  xodimlar: { label: "O'qituvchi va xodimlar", sub: 'Toifa → F.I.Sh. ro‘yxatidan tanlab topshiradi' },
  ochiq: { label: 'Ochiq (hamma uchun)', sub: "F.I.Sh. kiritib istalgan kishi to'ldira oladi" },
}

export const QUESTION_TYPE_META: Record<
  QuestionType,
  { label: string; short: string; example: string; category: 'aloqa' | 'matn' | 'tanlov' | 'hujjat' }
> = {
  phone: {
    label: 'Telefon raqam (+998)',
    short: 'Telefon',
    example: '+998 88 123-45-67',
    category: 'aloqa',
  },
  short_text: {
    label: 'Qisqa javob (matn)',
    short: 'Qisqa matn',
    example: "Masalan: Chorshanbe MFY, 12-uy",
    category: 'matn',
  },
  long_text: {
    label: 'Batafsil matn (izoh)',
    short: 'Batafsil',
    example: "Ko'p qatorli taklif yoki izoh",
    category: 'matn',
  },
  number: {
    label: 'Raqam / son',
    short: 'Raqam',
    example: 'Masalan: 15 (min/max cheklov bilan)',
    category: 'matn',
  },
  date: {
    label: 'Sana (KK.OO.YYYY)',
    short: 'Sana',
    example: '15.05.2007',
    category: 'hujjat',
  },
  pinfl: {
    label: 'JSHSHIR (14 raqam)',
    short: 'JSHSHIR',
    example: '51505075590012',
    category: 'hujjat',
  },
  passport: {
    label: 'Pasport / ID karta',
    short: 'Pasport',
    example: 'AD 1234567',
    category: 'hujjat',
  },
  card: {
    label: 'Plastik karta (16 raqam)',
    short: 'Karta',
    example: '9860 0000 0000 0000',
    category: 'hujjat',
  },
  tuman: {
    label: 'Tuman / Shahar tanlovi',
    short: 'Tuman',
    example: 'Shahrisabz tumani, Kitob tumani…',
    category: 'aloqa',
  },
  group: {
    label: 'Guruh tanlovi',
    short: 'Guruh',
    example: '26-01, 26-02, 25-01…',
    category: 'aloqa',
  },
  select: {
    label: "Ro'yxatdan tanlash (Dropdown)",
    short: "Ro'yxat",
    example: 'Variantlardan birini tanlash',
    category: 'tanlov',
  },
  radio: {
    label: 'Bitta variant (Radio)',
    short: 'Bitta tanlov',
    example: "Bir nechta tugmadan bittasi",
    category: 'tanlov',
  },
  checkbox: {
    label: "Bir nechta variant (Checkbox)",
    short: "Ko'p tanlov",
    example: 'Bir nechta javob belgilash',
    category: 'tanlov',
  },
  yes_no: {
    label: "Ha / Yo'q",
    short: "Ha / Yo'q",
    example: "Tezkor rozilik yoki holat tugmasi",
    category: 'tanlov',
  },
  rating: {
    label: 'Baho / Yulduzcha (1–5)',
    short: 'Baho 1–5',
    example: "1 dan 5 gacha yulduzcha bahosi",
    category: 'tanlov',
  },
}

export const QASHQADARYO_TUMANLARI = [
  'Shahrisabz shahri',
  'Shahrisabz tumani',
  'Kitob tumani',
  "Yakkabog' tumani",
  'Chiroqchi tumani',
  "Ko'kdala tumani",
  'Qamashi tumani',
  "G'uzor tumani",
  'Dehqonobod tumani',
  'Qarshi shahri',
  'Qarshi tumani',
  'Koson tumani',
  'Kasbi tumani',
  'Mirishkor tumani',
  'Muborak tumani',
  'Nishon tumani',
] as const

/** O'zbekiston mobil va shahar telefon prefikslari */
export const UZ_PHONE_CODES = new Set([
  '20', '33', '50', '55',
  '61', '62', '65', '66', '67', '69',
  '70', '71', '72', '73', '74', '75', '76', '77', '78', '79',
  '88', '90', '91', '93', '94', '95', '97', '98', '99',
])

export function cleanText(v: unknown, max = 500): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
}

export function cleanMultilineText(v: unknown, max = 3000): string {
  return String(v ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
}

export interface OfficialGroupOption {
  code: string
  kurs: number
  title: string
}

export function officialGroupOptions(): OfficialGroupOption[] {
  const out: OfficialGroupOption[] = []
  for (const c of COURSES) {
    for (const g of c.groups) {
      if (g === SECRET_GROUP) continue
      out.push({ code: g, kurs: c.kurs, title: GROUP_TITLES[g] || 'Hamshiralik ishi' })
    }
  }
  return out
}

/** +998 prefiksidan keyingi 9 ta mahalliy raqamni ajratib olish (masalan: 881234567) */
export function extractUzPhoneDigits(raw: string): string {
  const stripped = String(raw || '').replace(/^\s*\+998[\s()-]*/, '')
  let d = stripped.replace(/\D/g, '')
  if (d.startsWith('998') && d.length >= 12) {
    d = d.slice(3)
  } else if (d.startsWith('8') && d.length === 10 && !d.startsWith('88')) {
    d = d.slice(1)
  }
  return d.slice(0, 9)
}

/** 9 ta raqamni chiroyli ko'rinishga keltirish: 88 123-45-67 */
export function formatUzPhoneLocal(rawOrDigits: string): string {
  const d = extractUzPhoneDigits(rawOrDigits)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)} ${d.slice(2)}`
  if (d.length <= 7) return `${d.slice(0, 2)} ${d.slice(2, 5)}-${d.slice(5)}`
  return `${d.slice(0, 2)} ${d.slice(2, 5)}-${d.slice(5, 7)}-${d.slice(7, 9)}`
}

export function normalizeUzPhone(raw: string): { ok: boolean; value: string; error?: string } {
  const d = extractUzPhoneDigits(raw)
  if (!d) return { ok: false, value: '', error: 'Telefon raqami kiritilmagan' }
  if (d.length !== 9) {
    return { ok: false, value: '', error: `Telefon raqami 9 ta raqamdan iborat bo'lishi kerak (hozir ${d.length} ta)` }
  }
  const code = d.slice(0, 2)
  if (!UZ_PHONE_CODES.has(code)) {
    return {
      ok: false,
      value: '',
      error: `Operator kodi (+998 ${code}) noto'g'ri. Masalan: 88, 90, 91, 93, 94, 95, 97, 99, 77, 33, 20`,
    }
  }
  return { ok: true, value: `+998 ${d.slice(0, 2)} ${d.slice(2, 5)}-${d.slice(5, 7)}-${d.slice(7, 9)}` }
}

/** JSHSHIR kiritish maskasi: faqat 14 tagacha raqam */
export function formatPinflInput(raw: string): string {
  return String(raw || '').replace(/\D/g, '').slice(0, 14)
}

export function validatePinfl(raw: string): { ok: boolean; value: string; error?: string; warning?: string } {
  const d = formatPinflInput(raw)
  if (d.length !== 14) {
    return { ok: false, value: d, error: `JSHSHIR aynan 14 ta raqamdan iborat bo'lishi kerak (hozir ${d.length} ta)` }
  }
  if (!/^[3-6]/.test(d)) {
    return { ok: false, value: d, error: "JSHSHIR 3, 4, 5 yoki 6 raqami bilan boshlanishi kerak" }
  }
  const dd = Number(d.slice(1, 3))
  const mm = Number(d.slice(3, 5))
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) {
    return { ok: false, value: d, error: "JSHSHIR ichidagi tug'ilgan kun/oy qismi noto'g'ri" }
  }
  const decoded = decodePinfl(d)
  const warning = decoded && !decoded.nazorat ? "Nazorat raqami odatiy qoidaga to'liq mos kelmadi — tekshirib ko'ring" : undefined
  return { ok: true, value: d, warning }
}

const CYR_TO_LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X',
}

/** Pasport / ID karta maskasi: AA 1234567 */
export function formatPassportInput(raw: string): string {
  const upper = String(raw || '').toUpperCase().replace(/[^A-ZАВЕКМНОРСТХ0-9]/g, '')
  let letters = ''
  let digits = ''
  for (const ch of upper) {
    const mapped = CYR_TO_LAT[ch] ?? ch
    if (letters.length < 2) {
      if (/[A-Z]/.test(mapped)) letters += mapped
    } else if (/[0-9]/.test(mapped) && digits.length < 7) {
      digits += mapped
    }
  }
  return digits ? `${letters} ${digits}` : letters
}

export function validatePassport(raw: string): { ok: boolean; value: string; error?: string } {
  const fmt = formatPassportInput(raw)
  if (!/^[A-Z]{2} \d{7}$/.test(fmt)) {
    return { ok: false, value: fmt, error: 'Pasport formati 2 ta harf va 7 ta raqam: masalan AD 1234567' }
  }
  return { ok: true, value: fmt }
}

/** Plastik karta maskasi: XXXX XXXX XXXX XXXX */
export function formatCardInput(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 16)
  return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

export function validateCard(raw: string): { ok: boolean; value: string; error?: string } {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 16)
  if (d.length !== 16) {
    return { ok: false, value: formatCardInput(d), error: `Karta raqami 16 ta raqam bo'lishi kerak (hozir ${d.length} ta)` }
  }
  return { ok: true, value: formatCardInput(d) }
}

/** Sana maskasi: KK.OO.YYYY (YYYY-MM-DD ham qabul qilinadi) */
export function formatDateInput(raw: string): string {
  const s = String(raw || '').trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`
  const d = s.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 8)}`
}

export function dateToIsoInput(ddmmyyyy: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(ddmmyyyy || '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

export function validateDate(raw: string): { ok: boolean; value: string; error?: string } {
  const s = String(raw || '').trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  const dm = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s)
  let day = 0
  let month = 0
  let year = 0
  if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else if (dm) {
    day = Number(dm[1])
    month = Number(dm[2])
    year = Number(dm[3])
  } else {
    return { ok: false, value: s, error: 'Sana formati KK.OO.YYYY bo‘lishi kerak (masalan: 15.05.2007)' }
  }
  if (year < 1940 || year > 2035 || month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, value: s, error: "Kiritilgan sana haqiqiy emas" }
  }
  const dt = new Date(year, month - 1, day)
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return { ok: false, value: s, error: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year} — kalendarda bunday sana yo'q` }
  }
  return {
    ok: true,
    value: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`,
  }
}

export function validateAndNormalizeAnswers(
  questions: SurveyQuestion[],
  rawAnswers: Record<string, unknown> | null | undefined,
): { ok: true; answers: Record<string, string | string[] | number> } | { ok: false; errors: Record<string, string>; firstError: string } {
  const input = rawAnswers && typeof rawAnswers === 'object' ? rawAnswers : {}
  const normalized: Record<string, string | string[] | number> = {}
  const errors: Record<string, string> = {}

  for (const q of questions) {
    const raw = input[q.id]

    if (q.type === 'checkbox') {
      const arr = Array.isArray(raw)
        ? [...new Set(raw.map((x) => cleanText(x, 200)).filter(Boolean))]
        : []
      if (q.required && arr.length === 0) {
        errors[q.id] = `"${q.label}" — kamida bitta variant tanlang`
      } else {
        normalized[q.id] = arr
      }
      continue
    }

    if (q.type === 'rating') {
      const valStr = String(raw ?? '').trim()
      if (!valStr) {
        if (q.required) errors[q.id] = `"${q.label}" — 1 dan 5 gacha baho tanlang`
        else normalized[q.id] = ''
        continue
      }
      const n = Number(valStr)
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        errors[q.id] = `"${q.label}" — baho 1 dan 5 gacha bo'lishi kerak`
      } else {
        normalized[q.id] = n
      }
      continue
    }

    if (q.type === 'number') {
      const valStr = String(raw ?? '').replace(/\s+/g, '').replace(',', '.').trim()
      if (!valStr) {
        if (q.required) errors[q.id] = `"${q.label}" — raqam kiriting`
        else normalized[q.id] = ''
        continue
      }
      const n = Number(valStr)
      if (!Number.isFinite(n)) {
        errors[q.id] = `"${q.label}" — faqat raqam kiriting`
        continue
      }
      if (q.min !== null && q.min !== undefined && n < q.min) {
        errors[q.id] = `"${q.label}" — kamida ${q.min} bo'lishi kerak`
        continue
      }
      if (q.max !== null && q.max !== undefined && n > q.max) {
        errors[q.id] = `"${q.label}" — ko'pi bilan ${q.max} bo'lishi kerak`
        continue
      }
      normalized[q.id] = n
      continue
    }

    const strVal = q.type === 'long_text' ? cleanMultilineText(raw, 3000) : cleanText(raw, 400)
    if (!strVal) {
      if (q.required) {
        errors[q.id] = `"${q.label}" — to'ldirilishi shart`
      } else {
        normalized[q.id] = ''
      }
      continue
    }

    switch (q.type) {
      case 'phone': {
        const res = normalizeUzPhone(strVal)
        if (!res.ok) errors[q.id] = `${q.label}: ${res.error}`
        else normalized[q.id] = res.value
        break
      }
      case 'pinfl': {
        const res = validatePinfl(strVal)
        if (!res.ok) errors[q.id] = `${q.label}: ${res.error}`
        else normalized[q.id] = res.value
        break
      }
      case 'passport': {
        const res = validatePassport(strVal)
        if (!res.ok) errors[q.id] = `${q.label}: ${res.error}`
        else normalized[q.id] = res.value
        break
      }
      case 'card': {
        const res = validateCard(strVal)
        if (!res.ok) errors[q.id] = `${q.label}: ${res.error}`
        else normalized[q.id] = res.value
        break
      }
      case 'date': {
        const res = validateDate(strVal)
        if (!res.ok) errors[q.id] = `${q.label}: ${res.error}`
        else normalized[q.id] = res.value
        break
      }
      case 'yes_no': {
        const low = strVal.toLowerCase()
        if (low === 'ha' || low === 'yes' || low === 'true') normalized[q.id] = 'Ha'
        else if (low === "yo'q" || low === 'yoq' || low === 'no' || low === 'false') normalized[q.id] = "Yo'q"
        else errors[q.id] = `${q.label}: Ha yoki Yo'q ni tanlang`
        break
      }
      default: {
        normalized[q.id] = strVal
      }
    }
  }

  const firstKey = Object.keys(errors)[0]
  if (firstKey) {
    return { ok: false, errors, firstError: errors[firstKey] }
  }
  return { ok: true, answers: normalized }
}

export function formatAnswerDisplay(q: SurveyQuestion, val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean).join(', ')
  if (q.type === 'rating' && typeof val === 'number') return `${val} / 5`
  if (q.type === 'number' && q.unit && typeof val === 'number') return `${val} ${q.unit}`
  return String(val)
}

export function makeQuestionId(): string {
  return `q_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`
}

export function studentRespondentKey(pinfl: string | undefined, row: number): string {
  const p = String(pinfl || '').replace(/\D/g, '')
  return p.length === 14 ? p : `row:${row}`
}

const CYRILLIC_TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
}

export function makeSlug(title: string): string {
  const lower = String(title || '').toLowerCase()
  let out = ''
  for (const ch of lower) {
    out += CYRILLIC_TRANSLIT[ch] ?? ch
  }
  const clean = out
    .replace(/['‘’ʻʼ`"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return clean || `sorovnoma-${Date.now().toString(36)}`
}

const VALID_TYPES = new Set<QuestionType>(Object.keys(QUESTION_TYPE_META) as QuestionType[])

export function sanitizeQuestions(raw: unknown): SurveyQuestion[] {
  if (!Array.isArray(raw)) return []
  const usedIds = new Set<string>()
  const result: SurveyQuestion[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const rawType = String(rec.type || 'short_text') as QuestionType
    const type: QuestionType = VALID_TYPES.has(rawType) ? rawType : 'short_text'
    const label = cleanText(rec.label, 200) || QUESTION_TYPE_META[type].label

    let id = String(rec.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
    if (!id || usedIds.has(id)) id = makeQuestionId()
    usedIds.add(id)

    const options =
      type === 'select' || type === 'radio' || type === 'checkbox'
        ? (Array.isArray(rec.options) ? rec.options : [])
            .map((o) => cleanText(o, 140))
            .filter(Boolean)
            .slice(0, 60)
        : undefined

    const minNum = rec.min !== '' && rec.min !== null && rec.min !== undefined && Number.isFinite(Number(rec.min))
      ? Number(rec.min)
      : null
    const maxNum = rec.max !== '' && rec.max !== null && rec.max !== undefined && Number.isFinite(Number(rec.max))
      ? Number(rec.max)
      : null

    result.push({
      id,
      type,
      label,
      hint: cleanText(rec.hint, 240) || undefined,
      placeholder: cleanText(rec.placeholder, 140) || undefined,
      required: Boolean(rec.required),
      options: options && options.length ? options : type === 'select' || type === 'radio' || type === 'checkbox' ? ['Variant 1', 'Variant 2'] : undefined,
      allowOther: (type === 'radio' || type === 'checkbox') && Boolean(rec.allowOther),
      min: type === 'number' ? minNum : null,
      max: type === 'number' ? maxNum : null,
      unit: type === 'number' ? cleanText(rec.unit, 24) || undefined : undefined,
    })
  }
  return result
}

export interface SurveyTemplate {
  id: string
  name: string
  sub: string
  defaultTitle: string
  defaultDescription: string
  audience: SurveyAudience
  questions: Omit<SurveyQuestion, 'id'>[]
}

export const SURVEY_TEMPLATES: SurveyTemplate[] = [
  {
    id: 'blank',
    name: "Bo'sh so'rovnoma",
    sub: "Noldan o'zingiz savollar qo'shasiz",
    defaultTitle: "Yangi so'rovnoma",
    defaultDescription: "Iltimos, quyidagi ma'lumotlarni diqqat bilan to'ldiring.",
    audience: 'talabalar',
    questions: [
      {
        type: 'phone',
        label: 'Telefon raqamingiz',
        hint: "Faqat +998 dan keyingi 9 ta raqamni kiriting",
        required: true,
      },
    ],
  },
  {
    id: 'address_phone',
    name: 'Yashash manzili va aloqa',
    sub: 'Tuman, MFY, qatnov holati, +998 telefonlar',
    defaultTitle: 'Yashash manzili va telefon raqamlari',
    defaultDescription: "Talabalarning joriy yashash manzili va bog'lanish telefonlarini yangilash.",
    audience: 'talabalar',
    questions: [
      { type: 'tuman', label: 'Tuman / Shahar', required: true },
      { type: 'short_text', label: 'MFY / Mahalla', placeholder: 'Masalan: Chorshanbe MFY', required: true },
      { type: 'short_text', label: "Ko'cha va uy raqami", placeholder: "Masalan: Navbahor ko'chasi, 15-uy", required: false },
      {
        type: 'radio',
        label: 'Texnikumga qatnov holati',
        options: ["O'z uyidan", 'Ijarada', 'Yaqin qarindoshinikidan', 'Yotoqxonada'],
        required: true,
      },
      { type: 'phone', label: "Talabaning o'z telefoni", required: true },
      { type: 'phone', label: 'Ota-onasi / yaqinining telefoni', required: false },
      {
        type: 'select',
        label: "Qo'shimcha raqam kimniki?",
        options: ['Onasi', 'Otasi', 'Otasi / Onasi', "Turmush o'rtog'i", 'Akasi / Opasi', 'Boshqa'],
        required: false,
      },
    ],
  },
  {
    id: 'docs_card',
    name: 'Hujjat va rekvizitlar',
    sub: 'Pasport, JSHSHIR, sana, plastik karta, telefon',
    defaultTitle: "Pasport va bank rekvizitlari yig'imi",
    defaultDescription: "Hujjat raqamlarini aniq namunadagidek xatosiz kiriting.",
    audience: 'talabalar',
    questions: [
      { type: 'passport', label: 'Pasport / ID seriya va raqami', required: true },
      { type: 'pinfl', label: 'JSHSHIR (PINFL, 14 ta raqam)', required: true },
      { type: 'date', label: "Tug'ilgan sana", required: true },
      { type: 'card', label: 'Plastik karta raqami (16 raqam)', required: false },
      { type: 'phone', label: 'Bog‘lanish telefoni', required: true },
    ],
  },
  {
    id: 'feedback',
    name: 'Fikr-mulohaza va baholash',
    sub: "1–5 yulduzcha, Ha/Yo'q, takliflar",
    defaultTitle: "O'quv jarayoni bo'yicha fikr-mulohaza",
    defaultDescription: "Fikringiz biz uchun muhim — barcha javoblar tahlil qilinadi.",
    audience: 'talabalar',
    questions: [
      { type: 'rating', label: "Darslar sifatini 1 dan 5 gacha baholang", required: true },
      { type: 'yes_no', label: "Amaliyot mashg'ulotlari sizga yetarlimi?", required: true },
      { type: 'long_text', label: 'Taklif va mulohazalaringiz', placeholder: 'Fikringizni yozing…', required: false },
    ],
  },
]

export function makeDefaultQuestion(type: QuestionType): SurveyQuestion {
  return {
    id: makeQuestionId(),
    type,
    label: QUESTION_TYPE_META[type].label,
    required: true,
    options: type === 'select' || type === 'radio' || type === 'checkbox' ? ['Variant 1', 'Variant 2'] : undefined,
  }
}

export const SOROVNOMA_SETUP_SQL = `-- SHAHRISABZ TIBBIYOT TEXNIKUMI — SO'ROVNOMALAR JADVALLARI
create table if not exists public.sorovnomalar (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  title          text not null,
  description    text not null default '',
  audience       text not null default 'talabalar' check (audience in ('talabalar', 'xodimlar', 'ochiq')),
  target_courses smallint[] not null default '{}',
  target_groups  text[] not null default '{}',
  questions      jsonb not null default '[]'::jsonb,
  active         boolean not null default true,
  allow_update   boolean not null default true,
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sorovnomalar_created_at_idx on public.sorovnomalar (created_at desc);

create table if not exists public.sorovnoma_javoblar (
  id               bigint generated always as identity primary key,
  survey_id        uuid not null references public.sorovnomalar(id) on delete cascade,
  respondent_key   text not null,
  respondent_type  text not null default 'ochiq' check (respondent_type in ('talabalar', 'xodimlar', 'ochiq')),
  respondent_name  text not null default '',
  respondent_group text not null default '',
  respondent_pinfl text not null default '',
  answers          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (survey_id, respondent_key)
);
create index if not exists sorovnoma_javoblar_survey_created_idx on public.sorovnoma_javoblar (survey_id, created_at desc);
create index if not exists sorovnoma_javoblar_survey_group_idx   on public.sorovnoma_javoblar (survey_id, respondent_group);

alter table public.sorovnomalar       enable row level security;
alter table public.sorovnoma_javoblar enable row level security;`
