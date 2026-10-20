import { dobFromPinfl } from './student'
import type { EditFields } from './types'

/** OpenRouter modellari — Python xizmatidagi SUPPORTED_AI_MODELS bilan bir xil.
 *  Narx (1M token, kirish/chiqish, 2026-10): Haiku 5.5 $0.10/$0.50, Gemini 3.8 Flash $0.75/$3.75, 2.5 Flash $0.30/$2.50 */
export const AI_MODELS = [
  ['google/gemini-3.8-flash', 'Gemini 3.8 Flash (tez)'],
  ['anthropic/claude-haiku-5.5', 'Claude Haiku 5.5 (eng arzon)'],
  ['google/gemini-2.5-flash', 'Gemini 2.5 Flash'],
  ['google/gemini-2.5-pro', 'Gemini 2.5 Pro (aniq)'],
  ['openai/gpt-4o', 'GPT-4o'],
] as const

export const DEFAULT_AI_MODEL: AiModelId = 'google/gemini-3.8-flash'

export type AiModelId = (typeof AI_MODELS)[number][0] | string

const MODEL_STORAGE_KEY = 'portal_ai_model'
const LOCAL_PY_SERVER = 'http://localhost:8080'

export function getSavedAiModel(): string {
  if (typeof window === 'undefined') return DEFAULT_AI_MODEL
  const saved = localStorage.getItem(MODEL_STORAGE_KEY)
  if (saved) return saved
  return DEFAULT_AI_MODEL
}

export function setSavedAiModel(model: string) {
  try { localStorage.setItem(MODEL_STORAGE_KEY, model) } catch { /* ignore */ }
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error("Faylni o'qib bo'lmadi"))
    r.readAsDataURL(file)
  })
}

/** .docx (ZIP) ichidan word/document.xml matni va word/media/* rasmlarini brauzerning o'zida ajratib olish */
export async function extractDocxClient(file: File): Promise<{ text: string; images: string[] }> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)
  const images: string[] = []
  let text = ''

  let offset = 0
  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true)
    if (sig !== 0x04034b50) break
    const method = view.getUint16(offset + 8, true)
    const compSize = view.getUint32(offset + 18, true)
    const nameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)
    const nameBytes = bytes.subarray(offset + 30, offset + 30 + nameLen)
    const name = new TextDecoder().decode(nameBytes)
    const dataStart = offset + 30 + nameLen + extraLen
    const dataEnd = dataStart + compSize
    if (dataEnd > bytes.length) break
    const rawSlice = bytes.subarray(dataStart, dataEnd)

    const decompress = async (): Promise<Uint8Array | null> => {
      if (method === 0) return rawSlice
      if (method === 8 && typeof DecompressionStream !== 'undefined') {
        try {
          const ds = new DecompressionStream('deflate-raw')
          const writer = ds.writable.getWriter()
          writer.write(rawSlice)
          writer.close()
          const resBuf = await new Response(ds.readable).arrayBuffer()
          return new Uint8Array(resBuf)
        } catch {
          return null
        }
      }
      return null
    }

    if (name === 'word/document.xml') {
      const dec = await decompress()
      if (dec) {
        const xml = new TextDecoder().decode(dec)
        text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      }
    } else if (name.startsWith('word/media/') && /\.(png|jpe?g|webp)$/i.test(name)) {
      const dec = await decompress()
      if (dec && dec.byteLength > 1024) {
        const mime = name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
        const blob = new Blob([new Uint8Array(dec)], { type: mime })
        images.push(await fileToDataUrl(blob))
      }
    }
    offset = dataEnd
  }

  return { text, images }
}

/** Matndan pasport, JSHSHIR, shartnoma, telefon va F.I.SH ni regex orqali dastlabki aniqlash */
export function parseFieldsFromText(text: string): Partial<EditFields> & { sh_qr?: string } {
  const out: Partial<EditFields> & { sh_qr?: string } = {}
  if (!text) return out

  const pinflMatch = text.match(/\b([3456]\d{13})\b/)
  if (pinflMatch) {
    out.pinfl = pinflMatch[1]
    const dob = dobFromPinfl(out.pinfl)
    if (dob) out.dob = dob
  }

  const pvMatch = text.match(/\b(A[A-E]|FA|XS|KA)\s*(\d{7})\b/i)
  if (pvMatch) {
    out.pv = (pvMatch[1] + pvMatch[2]).toUpperCase()
  }

  const certMatch = text.match(/\b(UM|U|AB|AA|DT|K|S|T|V)\s*№?\s*(\d{6,8})\b/i)
  if (certMatch && (!out.pv || (certMatch[1] + certMatch[2]).toUpperCase() !== out.pv)) {
    out.sh_doc = `${certMatch[1].toUpperCase()} ${certMatch[2]}`
  }

  const telMatch = text.match(/(?:\+?998[\s-]?)?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/)
  if (telMatch) {
    out.tel = telMatch[0].trim()
  }

  const shMatch = text.match(/shartnoma\s*(?:№|#|\s)\s*(\d{1,4})/i)
  if (shMatch) {
    out.shnum = shMatch[1]
  }

  const qrMatch = text.match(/https?:\/\/[^\s"'<>]+(?:uzedu\.uz|edu\.uz|gov\.uz)[^\s"'<>]*/i)
  if (qrMatch) {
    out.sh_qr = qrMatch[0]
  }

  return out
}

/** Brauzer buferidan (Ctrl+V) yoki Windows Clipboard API dan fayl/rasmlarni olish */
export async function getFilesFromClipboard(): Promise<File[]> {
  const files: File[] = []

  // 1. Browser Clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type)
            const ext = type.split('/')[1] || 'png'
            files.push(new File([blob], `clipboard_${Date.now()}.${ext}`, { type }))
          }
        }
      }
    } catch {
      // Ruxsat berilmagan yoki fayl nusxalangan bo'lsa, keyingi bosqichga o'tamiz
    }
  }

  if (files.length > 0) return files

  // 2. Local Python server Windows Clipboard API (/api/get_clipboard_files)
  try {
    // Python bu endpointni faqat GET orqali qabul qiladi (eski portal ham GET ishlatgan)
    const res = await fetch(`${LOCAL_PY_SERVER}/api/get_clipboard_files?t=${Date.now()}`, { cache: 'no-store' })
    const data = await res.json()
    // Javob: { success, files: [{ filename, base64: "data:...", mime }] }
    if (data.success && Array.isArray(data.files)) {
      for (const f of data.files) {
        const resp = await fetch(f.base64)
        const blob = await resp.blob()
        files.push(new File([blob], f.filename || 'clipboard.jpg', { type: f.mime || blob.type }))
      }
    }
  } catch {
    // Local Python server o'chiq bo'lishi mumkin
  }

  return files
}

/* ------------------------------ QR KOD ------------------------------ */

type Detector = { detect: (img: ImageBitmap) => Promise<{ rawValue?: string }[]> }
type DetectorCtor = new (opts: { formats: string[] }) => Detector

/** Rasmni QR o'qish uchun piksellarga aylantirish (katta telefon rasmlari kichraytiriladi — jsQR tezroq) */
async function toImageData(bmp: ImageBitmap, max = 1600): Promise<ImageData> {
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * k)
  canvas.height = Math.round(bmp.height * k)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * Barcha rasmlardagi QR kodlar. Brauzerning BarcodeDetector'i bo'lsa — u (Android, macOS);
 * Windows'dagi Chrome'da u yo'q, shuning uchun jsQR (avval QR umuman o'qilmasdi).
 */
export async function scanQrCodes(dataUrls: string[]): Promise<string[]> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
  let detector: Detector | null = null
  try { if (Ctor) detector = new Ctor({ formats: ['qr_code'] }) } catch { detector = null }
  const jsQR = detector ? null : (await import('jsqr')).default
  const out: string[] = []
  for (const src of dataUrls) {
    try {
      const bmp = await createImageBitmap(await (await fetch(src)).blob())
      if (detector) {
        for (const c of await detector.detect(bmp)) if (c.rawValue) out.push(c.rawValue)
      } else if (jsQR) {
        const img = await toImageData(bmp)
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
        if (code?.data) out.push(code.data)
      }
    } catch { /* o'qilmagan rasm — keyingisi */ }
  }
  return [...new Set(out)]
}

/** Birinchi topilgan QR kod (eski chaqiruvlar uchun) */
export async function scanQrFromDataUrls(dataUrls: string[]): Promise<string | null> {
  return (await scanQrCodes(dataUrls))[0] ?? null
}

/** ICAO 9303 nazorat raqami (7-3-1) */
function mrzCheck(s: string): number {
  const val = (c: string) => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55)
  return [...s].reduce((sum, c, i) => sum + val(c) * [7, 3, 1][i % 3], 0) % 10
}

/**
 * ID-karta orqasidagi QR — MRZ (TD1, 3×30): "IUUZB" + hujjat raqami (9) + nazorat + JSHSHIR (14).
 * Masalan IUUZBAE3226696662703085680021< → AE3226696, 62703085680021. Nazorat raqami mos kelmasa — null.
 */
export function parseIdCardQr(text: string): { pv: string; pinfl: string; dob?: string } | null {
  const line = text.toUpperCase().replace(/[\r\n\s]/g, '')
  const m = /^I[A-Z<]UZB([A-Z]{2}\d{7})(\d)([3-6]\d{13})/.exec(line)
  if (!m || mrzCheck(m[1]) !== Number(m[2])) return null
  return { pv: m[1], pinfl: m[3], dob: dobFromPinfl(m[3]) ?? undefined }
}

/** QR kodlardan maydonlar: ID-karta MRZ → pasport, JSHSHIR, tug'ilgan sana; boshqasi → shahodatnoma QR */
export function fieldsFromQr(codes: string[]): Partial<EditFields> & { sh_qr?: string } {
  const out: Partial<EditFields> & { sh_qr?: string } = {}
  for (const code of codes) {
    const id = parseIdCardQr(code)
    if (id) {
      out.pv = id.pv
      out.pinfl = id.pinfl
      if (id.dob) out.dob = id.dob
    } else if (!out.sh_qr) {
      out.sh_qr = code
      const m = code.match(/\b(UM|U|AB|AA|DT|K|S)\s*(\d{6,8})\b/i)
      if (m) out.sh_doc = `${m[1].toUpperCase()} ${m[2]}`
    }
  }
  return out
}

type AiFields = Partial<EditFields> & { sh_qr?: string }

export interface DocAnalysisResult {
  fields: AiFields
  docFile?: string
  qrFound?: string
  images: string[]
  message: string
  /** Ism/otasining ismi yangi biriktirilgan shartnomadan olingan (Python ularni Excelga ham yozgan) */
  namesFromDoc?: boolean
}

/** "IBODULLAYEVA ASILZODA" → "Ibodullayeva Asilzoda", "LATIF QIZI" → "Latif qizi" (Python clean_uz_name kabi) */
function cleanUzName(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[`‘’ʻʼ´]/g, "'")
    .trim()
    .split(' ')
    .map((w) => {
      const low = w.toLowerCase()
      if (low === 'qizi' || low === 'kizi') return 'qizi'
      if (["o'g'li", 'ogli', 'ugli', "o'gli"].includes(low)) return "o'g'li"
      return low.charAt(0).toUpperCase() + low.slice(1)
    })
    .join(' ')
}

/**
 * Python xizmati (eski portal endpointlari) va /api/ai-analyze qaytaradigan kalitlar →
 * portal maydonlari. Eski portaldagi applyAnalysisResultToForm / reanalyzeCurrentStudent
 * bilan bir xil: pass_ser/pass_val → pv, pass_ber/ber_sana → ber, cert_val → sh_doc, maktab → mak.
 */
export function mapAiData(d: Record<string, unknown> | null | undefined): AiFields {
  if (!d) return {}
  const str = (v: unknown) => (v == null ? '' : String(v).trim())
  const pairs: [keyof AiFields, unknown][] = [
    ['ism', d.ism],
    ['ota', d.ota],
    ['pv', d.pass_ser ?? d.pass_val ?? d.pv],
    ['pinfl', d.pinfl],
    ['dob', d.dob],
    ['ber', d.pass_ber ?? d.ber_sana ?? d.ber],
    ['sh_doc', d.sh_doc ?? d.cert_val],
    ['doc_tur', d.doc_tur ?? d.cert_tur],
    ['mak', d.maktab ?? d.mak],
    ['yil', d.yil],
    ['tel', d.tel],
    ['shnum', d.shnum],
    ['sh_qr', d.sh_qr],
  ]
  const out: AiFields = {}
  for (const [k, v] of pairs) {
    const t = str(v)
    if (t && t !== '—') out[k] = t
  }
  if (out.ism) out.ism = cleanUzName(out.ism)
  if (out.ota) out.ota = cleanUzName(out.ota)
  if (out.pv) out.pv = out.pv.replace(/\s/g, '').toUpperCase()
  if (out.pinfl) {
    out.pinfl = out.pinfl.replace(/\D/g, '')
    const dob = out.dob || dobFromPinfl(out.pinfl)
    if (dob) out.dob = dob
  }
  return out
}

const isDocx = (f: File) => f.name.toLowerCase().endsWith('.docx')
const isImage = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name)

type PyResult = Record<string, unknown> & { success?: boolean; error?: string }

/** Python xizmatiga so'rov; xizmat ishlamasa (yoki Vercel sahifasidan yetib bo'lmasa) null */
async function py(path: string, body?: unknown): Promise<PyResult | null> {
  try {
    const res = await fetch(`${LOCAL_PY_SERVER}${path}`, body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return (await res.json()) as PyResult
  } catch {
    return null
  }
}

async function toItems(files: File[]) {
  return Promise.all(files.map(async (f) => ({ filename: f.name || `rasm_${Date.now()}.jpg`, base64: await fileToDataUrl(f) })))
}

/** Katta telefon rasmlarini serverga yuborishdan oldin kichraytirish (Vercel so'rov chegarasi ~4.5 MB) */
async function shrinkDataUrl(src: string, max = 1800): Promise<string> {
  try {
    const bmp = await createImageBitmap(await (await fetch(src)).blob())
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * k)
    canvas.height = Math.round(bmp.height * k)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.88)
  } catch {
    return src
  }
}

/** Rasmlarni portal serveri orqali OpenRouter AI ga yuborish (eski portaldagi brauzer AI zaxirasi o'rnida) */
async function analyzeImagesViaPortal(images: string[], model: string): Promise<AiFields> {
  let customKey = ''
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('portal_app_settings_v2') : null
    if (raw) {
      const parsed = JSON.parse(raw) as { openrouterKey?: string }
      if (parsed.openrouterKey) customKey = parsed.openrouterKey.trim()
    }
  } catch { /* ignore */ }

  const res = await fetch('/api/ai-analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      openrouterKey: customKey || undefined,
      images: await Promise.all(images.slice(0, 6).map((s) => shrinkDataUrl(s))),
    }),
  })
  const body = (await res.json().catch(() => ({}))) as PyResult & { data?: Record<string, unknown> }
  if (!res.ok || !body.success) throw new Error(body.error || `AI tahlil xatosi (${res.status})`)
  return mapAiData(body.data)
}

/** QR kodlarni o'qib AI natijasiga qo'shadi: ID-karta MRZ (pasport, JSHSHIR, sana) AI o'qiganidan ustun */
async function mergeQrFields(fields: AiFields, images: string[]): Promise<{ fields: AiFields; idCard: boolean }> {
  if (!images.length) return { fields, idCard: false }
  const qr = fieldsFromQr(await scanQrCodes(images))
  const merged: AiFields = { ...fields, ...qr }
  // Shahodatnoma QR/raqami — AI yoki Python o'qigani bo'lsa o'shasi qoladi
  if (fields.sh_qr) merged.sh_qr = fields.sh_qr
  if (fields.sh_doc) merged.sh_doc = fields.sh_doc
  return { fields: merged, idCard: !!qr.pinfl }
}

const countFields = (fields: AiFields) => Object.keys(fields).filter((k) => k !== 'sh_qr').length
const NOTHING_READ = "AI hujjatdan ma'lumot o'qiy olmadi — rasm aniqroq bo'lsin yoki boshqa modelni tanlang"

/**
 * Talaba hujjatlarini AI + QR orqali o'qish — eski portal (eski_portal/js/app.js) bilan bir xil yo'l:
 *  - mavjud talaba, yangi fayllar: Python /api/upload_student_section_files (analyze: true)
 *  - mavjud talaba, fayl tanlanmagan: Python /api/reanalyze_student (saqlangan .docx ni qayta o'qish)
 *    (ikkalasi ham natijani Excelga o'zi yozadi)
 *  - yangi talaba, .docx: Python /api/analyze_docx
 *  - rasmlar yoki Python ishlamasa: /api/ai-analyze
 */
export async function analyzeAndUploadDocs(opts: {
  row?: number
  student?: { ism?: string; ota?: string; group?: string }
  docFile?: string
  /** Mavjud talabaga biriktiriladigan shartnoma .docx */
  docxFile?: File
  passFiles?: File[]
  certFiles?: File[]
  generalFiles?: File[]
  existingImages?: string[]
  model?: AiModelId
}): Promise<DocAnalysisResult> {
  const model = opts.model || getSavedAiModel()
  const pass = opts.passFiles || []
  const cert = opts.certFiles || []
  const general = opts.generalFiles || []
  const allFiles = [...pass, ...cert, ...general]

  const fileImages: string[] = []
  const docxImages: string[] = []
  for (const f of allFiles) {
    if (isDocx(f)) docxImages.push(...(await extractDocxClient(f)).images)
    else if (isImage(f)) fileImages.push(await fileToDataUrl(f))
  }
  const previewImages = [...docxImages, ...fileImages]

  // 1a. Mavjud talaba, shartnoma .docx — eski portaldagi «Hujjatni biriktirish»
  if (opts.row && opts.row >= 2 && opts.docxFile) {
    const res = await py('/api/upload_and_attach_to_student', {
      row: opts.row,
      filename: opts.docxFile.name,
      file_base64: (await fileToDataUrl(opts.docxFile)).split(',')[1] || '',
      model,
    })
    if (res?.success && res.data) {
      const images = Array.isArray(res.images) && res.images.length ? (res.images as string[]) : (await extractDocxClient(opts.docxFile)).images
      const { fields } = await mergeQrFields(mapAiData(res.data as Record<string, unknown>), images)
      const n = countFields(fields)
      return {
        fields,
        docFile: typeof res.filename === 'string' ? res.filename : undefined,
        qrFound: fields.sh_qr,
        images,
        namesFromDoc: true,
        message: n ? `Shartnoma biriktirildi, AI ${n} ta maydonni o'qib Excelga saqladi${fields.sh_qr ? ' (QR-kod tasdiqlandi ✓)' : ''}` : NOTHING_READ,
      }
    }
    if (res) throw new Error(res.error || 'Python xizmati hujjatni biriktira olmadi')
    throw new Error("Shartnomani biriktirish uchun kompyuterdagi Python xizmati (8080) ishlab turishi kerak")
  }

  // 1b. Mavjud yoki yangi talaba — fayllarni yuklash va tahlil qilish
  if ((opts.row && opts.row >= 2 && (allFiles.length || opts.docFile)) || (!opts.row && allFiles.length)) {
    const res = allFiles.length
      ? await py('/api/upload_student_section_files', {
          row: opts.row || 0,
          ism: opts.student?.ism || '',
          ota: opts.student?.ota || '',
          group: opts.student?.group || '',
          doc_file: opts.docFile || '',
          analyze: true,
          model,
          passport_files: await toItems([...pass, ...general]),
          diploma_files: await toItems(cert),
        })
      : await py(`/api/reanalyze_student?file=${encodeURIComponent(opts.docFile || '')}&row=${opts.row}&model=${encodeURIComponent(model)}`)
    if (res?.success && res.data) {
      const images = Array.isArray(res.images) && res.images.length ? (res.images as string[]) : previewImages
      const { fields } = await mergeQrFields(mapAiData(res.data as Record<string, unknown>), images)
      const n = countFields(fields)
      return {
        fields,
        docFile: typeof res.filename === 'string' ? res.filename : undefined,
        qrFound: fields.sh_qr,
        images,
        message: n ? `AI ${n} ta maydonni o'qidi va Excelga saqladi${fields.sh_qr ? ' (QR-kod tasdiqlandi ✓)' : ''}` : NOTHING_READ,
      }
    }
    if (res && opts.row) throw new Error(res.error || 'Python xizmati tahlil qila olmadi')
    // res === null: Python xizmati ishlamayapti — pastdagi zaxira yo'l
  }

  let fields: AiFields = {}
  let docxDone = false

  // 2. Yangi talaba, Word (.docx) — Python /api/analyze_docx (jadval matni + ichidagi rasmlarni AI o'qiydi)
  const docx = opts.row ? undefined : allFiles.find(isDocx)
  if (docx) {
    const res = await py('/api/analyze_docx', {
      filename: docx.name,
      file_base64: (await fileToDataUrl(docx)).split(',')[1] || '',
      model,
      use_pro: model.includes('pro'),
    })
    if (res && res.success !== false) {
      fields = mapAiData(res)
      docxDone = true
    } else {
      fields = parseFieldsFromText((await extractDocxClient(docx)).text)
    }
  }

  // 3. Rasmlar — portal serveri orqali AI (Python .docx ni o'qigan bo'lsa, faqat alohida rasmlar)
  const aiImages = docxDone ? fileImages : previewImages.length ? previewImages : opts.existingImages || []
  let aiError = ''
  if (aiImages.length) {
    try {
      fields = { ...fields, ...(await analyzeImagesViaPortal(aiImages, model)) }
    } catch (e) {
      aiError = (e as Error).message
    }
  }

  const qrImages = previewImages.length ? previewImages : opts.existingImages || []
  const { fields: merged, idCard } = await mergeQrFields(fields, qrImages)
  fields = merged
  const qr = fields.sh_qr

  const n = countFields(fields)
  if (!n && aiError) throw new Error(aiError)
  const notes = [idCard && "ID-karta QR'idan pasport va JSHSHIR olindi ✓", qr && 'QR-kod topildi ✓', aiError && `eslatma: ${aiError}`].filter(Boolean)
  return {
    fields,
    qrFound: qr || undefined,
    images: qrImages,
    message: n ? `${aiError ? 'QR' : 'AI'} ${n} ta maydonni aniqladi${notes.length ? ` — ${notes.join(', ')}` : ''}` : NOTHING_READ,
  }
}
