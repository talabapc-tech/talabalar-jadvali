/*
 * "QABUL - 2026.xlsx" — qabul jadvali: 16 ustun (guruhi, tug'ilgan sana, muassasa nomi UZ / EN / RU).
 * Ruscha nom (makRu) AI tarjimada ham oraliq bosqich.
 *
 * Yagona manba: portal eksporti (lib/excel.ts) ham, scripts/generate_qabul_shablon.py ham
 * (node web/scripts/qabul-rows.mjs orqali) shu fayldagi qoidalardan foydalanadi.
 * Tashqi importlar yo'q — Node o'zi to'g'ridan-to'g'ri ishga tushira olishi uchun.
 *
 * Tarjima qoidalari:
 *  - Tuman / shahar nomlari: EN — o'zbek lotin yozuvi asosida (Kitob District, Shahrisabz City),
 *    viloyatlar — xalqaro qabul qilingan shakl (Kashkadarya / Surkhandarya Region);
 *    RU — rasmiy ruscha nomlar (Китабский район, город Шахрисабз, Яккабагский район).
 *  - "N-sonli umumiy o'rta ta'lim maktabi" → "General Secondary School No. N" / "Общеобразовательная школа №N".
 *  - Kollejlar: joy + soha + (kasb-hunar →) Vocational / профессиональный + College / колледж.
 *  - Qoidaga tushmagan nom — umumiy tarjima qilinadi va `review` ga yoziladi (Excelda sariq rang).
 */

export interface QabulInput {
  fish?: string
  dob?: string
  ism?: string
  ota?: string
  pinfl?: string
  pv?: string
  tel?: string
  mak?: string
  doc_tur?: string
  sh_doc?: string
  yil?: string
  group?: string
  /** Bazada telefon bo'lmasa qo'shimcha manbadan (masalan shartnoma .docx) topilgan raqamlar */
  extraPhones?: string[]
  manzil_tuman?: string
  manzil_mfy?: string
  manzil_kocha?: string
  manzil_uy?: string
  manzil_toliq?: string
  tel_shaxsiy?: string
  tel_otaona?: string
}

export interface QabulIstisno {
  /** "Boshlagan va tugatgan yili" ustuniga aynan shu qiymat yoziladi (masalan "2025 (eksternat)") */
  shablon_yillar?: string
  /** Yashash hududi aniq ma'lum bo'lsa (masalan "Qashqadaryo, Yakkabog' tumani") — JSHSHIR kodidan ustun turadi */
  viloyat?: string
}

export interface QabulRow {
  fio: string
  /** Tug'ilgan sana — kun.oy.yil (01.02.2006) */
  dob: string
  pinfl: string
  pv: string
  tel1: string
  tel2: string
  viloyat: string
  manzil: string
  makUz: string
  makEn: string
  makRu: string
  eduType: string
  diplom: string
  yillar: string
  group: string
  /** Qo'lda tekshirish kerak bo'lgan ustunlar (tarjima qoidasi topilmadi va h.k.) */
  review: string[]
}

export const QABUL_HEADERS = [
  '№',
  'Guruhi',
  'F.I.O',
  "Tug'ilgan sana (kun.oy.yil)",
  'JSHSHIR',
  'Pasport seriya raqami',
  'Tel raqam(pastdagi shablondagidek kiritilsin)',
  '2-Tel raqam(pastdagi shablondagidek kiritilsin)',
  'Yashash viloyat+tumani',
  'UY manzili',
  'Avval o`qigan muassasa nomi(Uzbek tilida)',
  'Avval o`qigan muassasa nomi(Ingliz tilida)',
  'Avval o`qigan muassasa nomi(Rus tilida)',
  'Maktab, kollej va HK',
  'Avval olgan diplom seriya+raqami',
  'Boshlagan va tugatgan yili',
]
/** Ustun kengliklari (Excel birligida) */
export const QABUL_WIDTHS = [5, 9, 34, 15, 17, 14, 17, 17, 26, 26, 38, 34, 38, 14, 19, 13]
/** Sahifa nomi */
export const QABUL_SHEET = 'Лист1'

/* ------------------------------------------------------------ hududlar */

interface District {
  re: RegExp
  /** "Yashash viloyat+tumani" ustuni */
  full: string
  /** Muassasa nomi oldidan (o'zbekcha) */
  uz: string
  en: string
  /** "...школа №5 Китабского района" */
  ru: string
}

const D = (re: RegExp, full: string, uz: string, en: string, ru: string): District => ({ re, full, uz, en, ru })

// Tartib muhim: "shahrisabz shahar" "shahrisabz" dan oldin
const DISTRICTS: District[] = [
  D(/shahrisabz\s+sh(ahar|ahri|\.|\b)/, 'Qashqadaryo, Shahrisabz shahri', 'Shahrisabz shahri', 'Shahrisabz City', 'города Шахрисабз'),
  D(/shahrisabz/, 'Qashqadaryo, Shahrisabz tumani', 'Shahrisabz tumani', 'Shahrisabz District', 'Шахрисабзского района'),
  D(/kitob/, 'Qashqadaryo, Kitob tumani', 'Kitob tumani', 'Kitob District', 'Китабского района'),
  D(/[yj]akkabog/, "Qashqadaryo, Yakkabog' tumani", "Yakkabog' tumani", 'Yakkabog District', 'Яккабагского района'),
  D(/qamashi/, 'Qashqadaryo, Qamashi tumani', 'Qamashi tumani', 'Qamashi District', 'Камашинского района'),
  D(/chiroqchi/, 'Qashqadaryo, Chiroqchi tumani', 'Chiroqchi tumani', 'Chiroqchi District', 'Чиракчинского района'),
  D(/ko'?kdala/, "Qashqadaryo, Ko'kdala tumani", "Ko'kdala tumani", 'Kokdala District', 'Кукдалинского района'),
  D(/g'?uzor/, "Qashqadaryo, G'uzor tumani", "G'uzor tumani", 'Guzor District', 'Гузарского района'),
  D(/qarshi\s+sh(ahar|ahri|\.|\b)/, 'Qashqadaryo, Qarshi shahri', 'Qarshi shahri', 'Qarshi City', 'города Карши'),
  D(/qarshi/, 'Qashqadaryo, Qarshi tumani', 'Qarshi tumani', 'Qarshi District', 'Каршинского района'),
  D(/koson/, 'Qashqadaryo, Koson tumani', 'Koson tumani', 'Koson District', 'Касанского района'),
  D(/kasbi/, 'Qashqadaryo, Kasbi tumani', 'Kasbi tumani', 'Kasbi District', 'Касбийского района'),
  D(/dehqonobod/, 'Qashqadaryo, Dehqonobod tumani', 'Dehqonobod tumani', 'Dehqonobod District', 'Дехканабадского района'),
  D(/mirishkor/, 'Qashqadaryo, Mirishkor tumani', 'Mirishkor tumani', 'Mirishkor District', 'Миришкорского района'),
  D(/muborak/, 'Qashqadaryo, Muborak tumani', 'Muborak tumani', 'Muborak District', 'Мубарекского района'),
  D(/nishon/, 'Qashqadaryo, Nishon tumani', 'Nishon tumani', 'Nishon District', 'Нишанского района'),
  D(/surxondaryo/, 'Surxondaryo viloyati', 'Surxondaryo viloyati', 'Surkhandarya Region', 'Сурхандарьинской области'),
  D(/samarqand/, 'Samarqand viloyati', 'Samarqand viloyati', 'Samarkand Region', 'Самаркандской области'),
]

const byFull = (full: string) => DISTRICTS.find((d) => d.full === full) ?? null

/** JSHSHIR 8–10 raqamlari — hujjat berilgan hudud kodi */
const PINFL_DISTRICT: Record<string, string> = {
  '559': 'Qashqadaryo, Shahrisabz tumani',
  // 573 — TAXMINIY (26.09.2026): shu kodli yagona talabaning muassasasi Yakkabog' kolleji,
  // maktablari (69, 70, 75-son) ham shu hududga mos; rasmiy kod ro'yxati topilmadi.
  '573': "Qashqadaryo, Yakkabog' tumani",
  '572': 'Qashqadaryo, Shahrisabz shahri',
  '568': 'Qashqadaryo, Kitob tumani',
  '264': 'Qashqadaryo, Kitob tumani',
  '570': "Qashqadaryo, Yakkabog' tumani",
  '253': "Qashqadaryo, Yakkabog' tumani",
  '566': 'Qashqadaryo, Qamashi tumani',
  '256': 'Qashqadaryo, Qamashi tumani',
  '563': 'Qashqadaryo, Chiroqchi tumani',
  '275': 'Qashqadaryo, Chiroqchi tumani',
  '564': "Qashqadaryo, G'uzor tumani",
  '259': "Qashqadaryo, G'uzor tumani",
  '558': 'Qashqadaryo, Qarshi shahri',
  '560': 'Qashqadaryo, Qarshi tumani',
  '561': 'Qashqadaryo, Koson tumani',
  '562': 'Qashqadaryo, Kasbi tumani',
  '565': 'Qashqadaryo, Dehqonobod tumani',
  '567': 'Qashqadaryo, Mirishkor tumani',
  '569': 'Qashqadaryo, Muborak tumani',
  '571': 'Qashqadaryo, Nishon tumani',
  '789': 'Surxondaryo viloyati',
  '549': 'Samarqand viloyati',
}

/** Kollej nomidagi joy: EN, RU sifat shakli */
const PLACES: [RegExp, string, string][] = [
  [/shahrisabz/, 'Shahrisabz', 'Шахрисабзский'],
  [/kitob/, 'Kitob', 'Китабский'],
  [/qarshi/, 'Qarshi', 'Каршинский'],
  [/[yj]akkabog/, 'Yakkabog', 'Яккабагский'],
  [/miroq/, 'Miroq', 'Мирокский'],
  [/mahrid/, 'Mahrid', 'Махридский'],
  [/toshkent/, 'Tashkent', 'Ташкентский'],
  [/samarqand/, 'Samarkand', 'Самаркандский'],
  [/g'?uzor/, 'Guzor', 'Гузарский'],
  [/qamashi/, 'Qamashi', 'Камашинский'],
  [/chiroqchi/, 'Chiroqchi', 'Чиракчинский'],
  [/koson/, 'Koson', 'Касанский'],
]

/*
 * Kollej sohalari (uzunroq ifoda birinchi).
 * enAdj — "Shahrisabz Medical College", enOf — "Kitob College of Economics";
 * ruAdj — "медицинский колледж", ruGen — "колледж агробизнеса".
 */
interface Field { re: RegExp; enAdj?: string; enOf?: string; ruAdj?: string; ruGen?: string }
const FIELDS: Field[] = [
  { re: /agrobiznes va xizmat ko'rsatish/, enOf: 'Agribusiness and Services', ruGen: 'агробизнеса и сервиса' },
  { re: /agroservis( xizmat ko'rsatish)?/, enOf: 'Agro-Services', ruGen: 'агросервиса' },
  { re: /agrobiznes/, enOf: 'Agribusiness', ruGen: 'агробизнеса' },
  { re: /agrosanoat/, enAdj: 'Agro-Industrial', ruAdj: 'агропромышленный' },
  { re: /qishloq xo'jalig?i?/, enAdj: 'Agricultural', ruAdj: 'сельскохозяйственный' },
  { re: /yengil sanoat va xizmat ko'rsatish/, enOf: 'Light Industry and Services', ruGen: 'лёгкой промышленности и сервиса' },
  { re: /yengil sanoat/, enOf: 'Light Industry', ruGen: 'лёгкой промышленности' },
  { re: /sanoat va xizmat ko'rsatish/, enOf: 'Industry and Services', ruGen: 'промышленности и сервиса' },
  { re: /maishiy xizmat( ko'rsatish)?/, enOf: 'Consumer Services', ruGen: 'бытового обслуживания' },
  { re: /qur[iu]lish va maishiy texnika(lar)?/, enOf: 'Construction and Household Appliances', ruGen: 'строительства и бытовой техники' },
  { re: /qur[iu]lish/, enAdj: 'Construction', ruAdj: 'строительный' },
  { re: /pedagogika va turizm/, enOf: 'Pedagogy and Tourism', ruGen: 'педагогики и туризма' },
  { re: /sport pedagogika/, enAdj: 'Sports and Pedagogical', ruAdj: 'спортивно-педагогический' },
  { re: /pedagogika/, enAdj: 'Pedagogical', ruAdj: 'педагогический' },
  { re: /tibbiyot/, enAdj: 'Medical', ruAdj: 'медицинский' },
  { re: /iqtisodiyot/, enOf: 'Economics', ruAdj: 'экономический' },
  { re: /axborot texnologiyalari/, enOf: 'Information Technologies', ruGen: 'информационных технологий' },
  { re: /tex[nm][ao]logiya/, enOf: 'Technology', ruAdj: 'технологический' },
  { re: /transport/, enAdj: 'Transport', ruAdj: 'транспортный' },
  { re: /neft va gaz/, enOf: 'Oil and Gas', ruGen: 'нефти и газа' },
  { re: /energetika/, enOf: 'Power Engineering', ruAdj: 'энергетический' },
  { re: /san'at/, enOf: 'Arts', ruGen: 'искусств' },
  { re: /musiqa/, enAdj: 'Music', ruAdj: 'музыкальный' },
  { re: /turizm/, enOf: 'Tourism', ruGen: 'туризма' },
  { re: /sport/, enAdj: 'Sports', ruAdj: 'спортивный' },
]

/** Qoidalar bilan chiqmaydigan nomlar — aynan tarjima (kalit: normallashtirilgan o'zbekcha nom, kichik harf) */
const OVERRIDES: Record<string, [string, string, string]> = {
  "toshkent irrigatsiya va melioratsiya instituti qoshidagi akademik litsey": [
    "Toshkent irrigatsiya va melioratsiya instituti qoshidagi akademik litsey",
    'Academic Lyceum under the Tashkent Institute of Irrigation and Melioration',
    'Академический лицей при Ташкентском институте ирригации и мелиорации',
  ],
}

/* ------------------------------------------------------------ yordamchi */

const APOS = /[‘’ʻʼ`´]/g

export function cleanText(v: unknown): string {
  return String(v ?? '').replace(/\+/g, ' ').replace(APOS, "'").replace(/\s+/g, ' ').trim()
}

function normDoc(v: unknown): string {
  const s = cleanText(v).toUpperCase().replace(/№/g, ' ').replace(/\s+/g, ' ').trim()
  const m = s.match(/^([A-Z'-]+?)\s*(\d{5,9})$/)
  return m ? `${m[1]} ${m[2]}` : s
}

function splitPhones(v: unknown): string[] {
  const out: string[] = []
  for (const part of String(v ?? '').split(/[;,/]+/)) {
    let d = part.replace(/\D/g, '')
    if (d.length === 12 && d.startsWith('998')) d = d.slice(3)
    if (d.length === 9 && !out.includes(d)) out.push(d)
  }
  return out
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/* ------------------------------------------------------------ muassasa */

export interface Institution { uz: string; en: string; ru: string; type: string; review: boolean }

/** O'zbekcha nomni tozalash: apostrof, kelishik qo'shimchasi, imlo xatolari */
function normalizeUz(raw: string): string {
  return cleanText(raw)
    .replace(/maktabini\b/gi, 'maktabi')
    .replace(/maktab-internatini\b/gi, 'maktab-internati')
    .replace(/\bmaktab$/i, 'maktabi')
    .replace(/texnalogiya/gi, 'texnologiya')
    .replace(/qurulish/gi, 'qurilish')
    .replace(/\bjakkabog'?/gi, "Yakkabog'")
    .replace(/^qashqadaryo viloyati,?\s*/i, '')
}

/** Hudud: avval nomdagi tuman, keyin aniq ma'lum hudud (istisno), oxirida JSHSHIR kodi */
function districtOf(text: string, pinfl: string, known?: string): District | null {
  const low = text.toLowerCase()
  for (const d of DISTRICTS) if (d.re.test(low)) return d
  const k = known ? byFull(known) : null
  if (k) return k
  if (pinfl.length === 14) return byFull(PINFL_DISTRICT[pinfl.slice(7, 10)] ?? '')
  return null
}

export function translateInstitution(makRaw: string, docTur: string, shDoc: string, pinfl: string, knownDistrict?: string): Institution {
  const uz0 = normalizeUz(makRaw)
  const low = uz0.toLowerCase()
  const ov = OVERRIDES[low]
  if (ov) return { uz: ov[0], en: ov[1], ru: ov[2], type: /litsey/.test(low) ? 'Litsey' : 'Kollej', review: false }

  const dist = districtOf(uz0, pinfl, knownDistrict)
  const dUz = dist ? `${dist.uz} ` : ''
  const dEn = dist ? `, ${dist.en}` : ''
  const dRu = dist ? ` ${dist.ru}` : ''
  const doc = shDoc.toUpperCase()

  if (!uz0) {
    return { uz: '', en: '', ru: '', type: docTur === 'Diplom' || /^(K|PT|D|L) /.test(doc) ? 'Kollej' : 'Maktab', review: false }
  }

  const num = (re: RegExp) => { const m = low.match(re); return m ? m[1] : '' }

  // Akademik litsey
  if (/akademik litsey/.test(low)) {
    return { uz: uz0, en: `Academic Lyceum${dEn}`, ru: `Академический лицей${dRu}`, type: 'Litsey', review: true }
  }
  // Politexnikum / texnikum
  if (/politexnikum/.test(low)) {
    const n = num(/(\d+)\s*-?\s*son(li)?\s+politexnikum/)
    return {
      uz: `${dUz}${n ? `${n}-son ` : ''}politexnikumi`,
      en: `Polytechnic College${n ? ` No. ${n}` : ''}${dEn}`,
      ru: `Политехникум${n ? ` №${n}` : ''}${dRu}`,
      type: 'Texnikum', review: false,
    }
  }
  if (/texnikum/.test(low)) {
    const field = FIELDS.find((f) => f.re.test(low))
    if (field) {
      // "Shahrisabz tibbiyot texnikumi" → "Shahrisabz Medical Technical School" / "Шахрисабзский медицинский техникум"
      const place = PLACES.find(([re]) => re.test(low))
      const en = [place?.[1], field.enAdj, 'Technical School'].filter(Boolean).join(' ') + (field.enOf ? ` of ${field.enOf}` : '')
      const ru = cap([place?.[2], field.ruAdj, 'техникум', field.ruGen].filter(Boolean).join(' '))
      return { uz: uz0, en, ru, type: 'Texnikum', review: !place }
    }
    const n = num(/(\d+)\s*-?\s*son(li)?\s+texnikum/)
    return {
      uz: `${dUz}${n ? `${n}-son ` : ''}texnikumi`,
      en: `Technical School${n ? ` No. ${n}` : ''}${dEn}`,
      ru: `Техникум${n ? ` №${n}` : ''}${dRu}`,
      type: 'Texnikum', review: false,
    }
  }
  // Prezident maktabi
  if (/prezident maktab/.test(low)) {
    return { uz: `${dUz}Prezident maktabi`, en: `Presidential School${dEn}`, ru: `Президентская школа${dRu}`, type: 'Maktab', review: false }
  }
  // Kasb-hunar maktabi
  if (/kasb-?hunar maktab/.test(low)) {
    const n = num(/(\d+)\s*-?\s*son(li)?\s+kasb/)
    return {
      uz: `${dUz}${n ? `${n}-son ` : ''}kasb-hunar maktabi`,
      en: `Vocational School${n ? ` No. ${n}` : ''}${dEn}`,
      ru: `Профессиональная школа${n ? ` №${n}` : ''}${dRu}`,
      type: 'Kollej', review: false,
    }
  }
  // Kollejlar
  if (/kollej/.test(low)) {
    const place = PLACES.find(([re]) => re.test(low))
    const field = FIELDS.find((f) => f.re.test(low))
    const voc = /kasb-?hunar/.test(low)
    const en = [place?.[1], field?.enAdj, voc ? 'Vocational' : '', 'College'].filter(Boolean).join(' ') + (field?.enOf ? ` of ${field.enOf}` : '')
    const ru = cap([place?.[2], field?.ruAdj, voc ? 'профессиональный' : '', 'колледж', field?.ruGen].filter(Boolean).join(' '))
    return { uz: uz0, en, ru, type: 'Kollej', review: !field || !place }
  }
  // Ixtisoslashtirilgan maktab (chuqur o'rganiladigan)
  if (/ixtisoslash/.test(low)) {
    const n = num(/(\d+)\s*-?\s*son(li)?/)
    const deep = /chuqur/.test(low)
    const internat = /internat/.test(low)
    const noun = internat ? 'maktab-internati' : 'maktabi'
    const uzName = deep
      ? `${n ? `${n}-sonli ` : ''}ayrim fanlar chuqur o'rganiladigan ixtisoslashtirilgan ${noun}`
      : `${n ? `${n}-sonli ` : ''}ixtisoslashtirilgan ${noun}`
    return {
      uz: `${dUz}${uzName}`,
      en: `Specialized ${internat ? 'Boarding ' : ''}School${n ? ` No. ${n}` : ''}${deep ? ' with In-Depth Study of Certain Subjects' : ''}${dEn}`,
      ru: `Специализированная школа${internat ? '-интернат' : ''}${n ? ` №${n}` : ''}${deep ? ' с углублённым изучением отдельных предметов' : ''}${dRu}`,
      type: 'Maktab', review: false,
    }
  }
  // Umumiy o'rta ta'lim maktabi: "28-sonli umumiy o'rta ta'lim maktabi", "26-umumiy ...", "24-maktab"
  const n = num(/(\d+)\s*-?\s*(?:sonli|son)?\s*-?\s*(?:umumiy o'rta ta'lim )?maktab/) || num(/(\d+)\s*-\s*umumiy/)
  if (n) {
    return {
      uz: `${dUz}${n}-sonli umumiy o'rta ta'lim maktabi`,
      en: `General Secondary School No. ${n}${dEn}`,
      ru: `Общеобразовательная школа №${n}${dRu}`,
      type: 'Maktab', review: false,
    }
  }
  // Tanilmagan nom — umumiy tarjima, qo'lda tekshirish uchun belgilanadi
  const college = docTur === 'Diplom' || /^(K|PT|D|L) /.test(doc)
  return {
    uz: uz0,
    en: `${college ? 'Vocational College' : 'Secondary School'}${dEn}`,
    ru: `${college ? 'Профессиональный колледж' : 'Общеобразовательная школа'}${dRu}`,
    type: college ? 'Kollej' : 'Maktab',
    review: true,
  }
}

function studyYears(yil: string, type: string): string {
  const y = cleanText(yil)
  if (/^\d{4}\s*-\s*\d{4}$/.test(y)) return y.replace(/\s+/g, '')
  const m = y.match(/\b(19\d{2}|20\d{2})\b/)
  if (!m) return ''
  const end = Number(m[1])
  return `${end - (type === 'Maktab' ? 11 : 3)}-${end}`
}

/* ------------------------------------------------------------ qator */

/** Tug'ilgan sanani kun.oy.yil (01.02.2006) ko'rinishiga keltiradi; tanib bo'lmasa — o'zi */
function normDob(v: unknown): string {
  const t = String(v ?? '').trim().split(' ')[0]
  if (!t || t === '—' || t === '-') return ''
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t)
  if (dmy) return `${dmy[1].padStart(2, '0')}.${dmy[2].padStart(2, '0')}.${dmy[3]}`
  const ymd = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(t)
  if (ymd) return `${ymd[3].padStart(2, '0')}.${ymd[2].padStart(2, '0')}.${ymd[1]}`
  return t
}

export function qabulRow(s: QabulInput, istisno?: QabulIstisno): QabulRow {
  const pinfl = String(s.pinfl ?? '').replace(/\D/g, '')
  const fio = cleanText(s.fish) || cleanText(`${s.ism ?? ''} ${s.ota ?? ''}`)
  const mak = /^noma'?lum$/i.test(cleanText(s.mak)) ? '' : cleanText(s.mak)
  const shDoc = normDoc(s.sh_doc)
  const phones = splitPhones(s.tel)
  const all = phones.length ? phones : (s.extraPhones ?? []).filter((p) => /^\d{9}$/.test(p))

  const cleanP = (p: string | undefined) => (p ? p.replace(/\D/g, '').slice(-9) : '')
  const tel1 = cleanP(s.tel_shaxsiy) || (all[0] ?? '')
  const tel2 = cleanP(s.tel_otaona) || (all[1] ?? '')

  let viloyat = ''
  if (s.manzil_tuman) {
    viloyat = s.manzil_tuman.toLowerCase().includes('viloyat')
      ? s.manzil_tuman
      : `Qashqadaryo, ${s.manzil_tuman}`
  } else {
    const residence = districtOf(mak, pinfl, istisno?.viloyat)
    viloyat = residence?.full ?? ''
  }

  let manzil = ''
  if (s.manzil_mfy || s.manzil_kocha || s.manzil_uy) {
    const parts = [s.manzil_mfy, s.manzil_kocha, s.manzil_uy].filter(Boolean)
    manzil = parts.join(', ')
  } else if (s.manzil_toliq) {
    manzil = s.manzil_toliq
  }

  const inst = translateInstitution(mak, cleanText(s.doc_tur), shDoc, pinfl, istisno?.viloyat)
  const review: string[] = []
  if (inst.review) review.push('makEn', 'makRu')
  if (!viloyat) review.push('viloyat')

  return {
    fio,
    dob: normDob(s.dob),
    pinfl,
    pv: cleanText(s.pv).replace(/\s+/g, '').toUpperCase(),
    tel1,
    tel2,
    viloyat,
    manzil,
    makUz: inst.uz,
    makEn: inst.en,
    makRu: inst.ru,
    eduType: inst.type,
    diplom: shDoc,
    yillar: istisno?.shablon_yillar || studyYears(String(s.yil ?? ''), inst.type),
    group: cleanText(s.group),
    review,
  }
}

/** Excel qatori (№ bilan) — QABUL_HEADERS tartibida (16 ustun) */
export function qabulCells(r: QabulRow, idx: number): (string | number)[] {
  const num9 = (t: string) => (/^\d{9}$/.test(t) ? Number(t) : t)
  return [
    idx + 1, r.group, r.fio, r.dob, r.pinfl, r.pv, num9(r.tel1), num9(r.tel2), r.viloyat, r.manzil,
    r.makUz, r.makEn, r.makRu, r.eduType, r.diplom, r.yillar,
  ]
}

/** review maydon nomi → 0 dan boshlangan ustun indeksi (sariq — qo'lda tekshirish) */
export const REVIEW_COL: Record<string, number> = { viloyat: 8, makEn: 11, makRu: 12 }
/** JSHSHIR ustuni (matn sifatida yoziladi) */
export const QABUL_PINFL_COL = 4
export const QABUL_FILE = 'QABUL - 2026'
