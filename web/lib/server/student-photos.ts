import 'server-only'
import { createHash } from 'node:crypto'
import { getServiceSupabase } from '@/lib/server/supabase'
import { fullName } from '@/lib/student'
import type { Student } from '@/lib/types'

export const PHOTO_BUCKET = 'student-photos'
export const PHOTO_META_BUCKET = 'student-photos-meta'
const META_PATH = 'index.json'
const MAX_PHOTO_BYTES = 5 * 1024 * 1024 // 5 MB
const INDEX_CACHE_TTL_MS = 10_000

export interface StudentPhotoRecord {
  key: string
  path: string
  url: string
  updatedAt: string
  row?: number
  pinfl?: string
  fish?: string
}

export interface StudentPhotoIndex {
  version: 1
  items: Record<string, StudentPhotoRecord>
}

const cleanPin = (v: unknown) => String(v ?? '').replace(/\D/g, '').trim()
const normFish = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]/g, '')

export function photoKeyOf(id: { pinfl?: string; row?: number }): string | null {
  const p = cleanPin(id.pinfl)
  if (p.length === 14) return `p:${p}`
  const r = Number(id.row)
  if (Number.isInteger(r) && r >= 2) return `r:${r}`
  return null
}

/** Magic baytlar bo'yicha haqiqiy rasm formatini aniqlash (MIME soxtalashtirishdan himoya) */
export function detectImageType(buf: Buffer): { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' } | null {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' }
  }
  return null
}

let indexCache: { data: StudentPhotoIndex; expiresAt: number } | null = null
let bucketsEnsured = false

export function invalidatePhotoIndexCache() {
  indexCache = null
}

async function ensureBuckets(): Promise<void> {
  if (bucketsEnsured) return
  const sb = getServiceSupabase()
  const { data: buckets } = await sb.storage.listBuckets()
  const names = new Set((buckets ?? []).map((b) => b.name))
  if (!names.has(PHOTO_BUCKET)) {
    await sb.storage.createBucket(PHOTO_BUCKET, {
      public: true,
      fileSizeLimit: MAX_PHOTO_BYTES,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    })
  }
  if (!names.has(PHOTO_META_BUCKET)) {
    await sb.storage.createBucket(PHOTO_META_BUCKET, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ['application/json'],
    })
  }
  bucketsEnsured = true
}

export async function loadPhotoIndex(force = false): Promise<StudentPhotoIndex> {
  const now = Date.now()
  if (!force && indexCache && indexCache.expiresAt > now) {
    return indexCache.data
  }
  try {
    const sb = getServiceSupabase()
    const { data, error } = await sb.storage.from(PHOTO_META_BUCKET).download(META_PATH)
    if (error || !data) {
      const empty: StudentPhotoIndex = { version: 1, items: {} }
      indexCache = { data: empty, expiresAt: now + INDEX_CACHE_TTL_MS }
      return empty
    }
    const text = await data.text()
    const parsed = JSON.parse(text) as Partial<StudentPhotoIndex>
    const idx: StudentPhotoIndex = {
      version: 1,
      items: parsed && typeof parsed.items === 'object' && parsed.items ? parsed.items : {},
    }
    indexCache = { data: idx, expiresAt: now + INDEX_CACHE_TTL_MS }
    return idx
  } catch {
    return indexCache?.data ?? { version: 1, items: {} }
  }
}

async function savePhotoIndex(idx: StudentPhotoIndex): Promise<void> {
  await ensureBuckets()
  const sb = getServiceSupabase()
  const body = Buffer.from(JSON.stringify(idx, null, 2), 'utf-8')
  const { error } = await sb.storage.from(PHOTO_META_BUCKET).upload(META_PATH, body, {
    contentType: 'application/json',
    upsert: true,
    cacheControl: '0',
  })
  if (error) throw new Error(`Rasm indeksini saqlashda xato: ${error.message}`)
  indexCache = { data: idx, expiresAt: Date.now() + INDEX_CACHE_TTL_MS }
}

/** Talabalar ro'yxatini saqlangan rasmlar bilan boyitish */
export async function enrichStudentPhotos(students: Student[]): Promise<Student[]> {
  const idx = await loadPhotoIndex()
  const values = Object.values(idx.items)
  if (!values.length) return students

  const byPinfl = new Map<string, StudentPhotoRecord>()
  const byRow = new Map<number, StudentPhotoRecord>()
  const byFishCount = new Map<string, number>()
  const byFishRec = new Map<string, StudentPhotoRecord>()

  for (const rec of values) {
    if (!rec?.url) continue
    const p = cleanPin(rec.pinfl)
    if (p.length === 14 && !byPinfl.has(p)) byPinfl.set(p, rec)
    if (rec.row && Number.isInteger(rec.row) && !byRow.has(rec.row)) byRow.set(rec.row, rec)
    const fn = normFish(rec.fish)
    if (fn) {
      byFishCount.set(fn, (byFishCount.get(fn) ?? 0) + 1)
      byFishRec.set(fn, rec)
    }
  }

  for (const s of students) {
    const sPin = cleanPin(s.pinfl)
    const sFish = normFish(s.fish || fullName(s))

    let hit: StudentPhotoRecord | undefined
    if (sPin.length === 14) {
      hit = idx.items[`p:${sPin}`] ?? byPinfl.get(sPin)
    }
    if (!hit) {
      const rowRec = idx.items[`r:${s.row}`] ?? byRow.get(s.row)
      if (rowRec) {
        const recPin = cleanPin(rowRec.pinfl)
        const pinOk = !recPin || !sPin || recPin === sPin
        const recFish = normFish(rowRec.fish)
        const fishOk = !recFish || !sFish || recFish === sFish
        if (pinOk && fishOk) hit = rowRec
      }
    }
    if (!hit && sFish && byFishCount.get(sFish) === 1) {
      const fishRec = byFishRec.get(sFish)
      const recPin = cleanPin(fishRec?.pinfl)
      if (fishRec && (!recPin || !sPin || recPin === sPin)) {
        hit = fishRec
      }
    }
    if (hit?.url) {
      s.photo_url = hit.url
    }
  }
  return students
}

/** Yangi rasmni Supabase Storage ga yuklash va indeksni yangilash */
export async function uploadStudentPhoto(params: {
  row?: number
  pinfl?: string
  fish?: string
  buffer: Buffer
}): Promise<StudentPhotoRecord> {
  const { buffer } = params
  if (!buffer.length) throw new Error("Rasm fayli bo'sh")
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new Error('Rasm hajmi 5 MB dan oshmasligi kerak')
  }
  const detected = detectImageType(buffer)
  if (!detected) {
    throw new Error('Faqat JPG, PNG yoki WebP rasm yuklash mumkin')
  }

  const key = photoKeyOf(params)
  if (!key) throw new Error('Talaba identifikatori (JSHSHIR yoki qator) topilmadi')

  await ensureBuckets()
  const sb = getServiceSupabase()

  // Ommaviy URL ichida shaxsiy JSHSHIR/ism ko'rinmasligi uchun qisqa xesh + vaqt ishlatiladi
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12)
  const storagePath = `p_${hash}_${Date.now().toString(36)}.${detected.ext}`

  const { error: uploadErr } = await sb.storage.from(PHOTO_BUCKET).upload(storagePath, buffer, {
    contentType: detected.mime,
    cacheControl: '31536000',
    upsert: false,
  })
  if (uploadErr) throw new Error(`Rasm yuklanmadi: ${uploadErr.message}`)

  const { data: pub } = sb.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath)
  const url = pub.publicUrl
  const updatedAt = new Date().toISOString()
  const pinfl = cleanPin(params.pinfl)
  const row = Number.isInteger(Number(params.row)) && Number(params.row) >= 2 ? Number(params.row) : undefined
  const fish = String(params.fish || '').trim()

  const idx = await loadPhotoIndex(true)
  const oldPaths = new Set<string>()

  // Avvalgi yozuvlarni tozalash (masalan, oldin r:<row> da bo'lib, endi p:<pinfl> ga o'tgan bo'lsa)
  const keysToRemove: string[] = []
  for (const [k, rec] of Object.entries(idx.items)) {
    const samePin = pinfl.length === 14 && cleanPin(rec.pinfl) === pinfl
    const sameRow = row !== undefined && rec.row === row && (!pinfl || !cleanPin(rec.pinfl) || cleanPin(rec.pinfl) === pinfl)
    if (k === key || samePin || sameRow) {
      if (rec.path && rec.path !== storagePath) oldPaths.add(rec.path)
      if (k !== key) keysToRemove.push(k)
    }
  }
  for (const k of keysToRemove) delete idx.items[k]

  const record: StudentPhotoRecord = {
    key,
    path: storagePath,
    url,
    updatedAt,
    ...(row !== undefined ? { row } : {}),
    ...(pinfl.length === 14 ? { pinfl } : {}),
    ...(fish ? { fish } : {}),
  }
  idx.items[key] = record
  await savePhotoIndex(idx)

  // Eski rasm faylini storage dan tozalash (xato bo'lsa ham yangi rasm saqlangan)
  if (oldPaths.size > 0) {
    await sb.storage.from(PHOTO_BUCKET).remove([...oldPaths]).catch(() => null)
  }

  return record
}

/** Talaba rasmini o'chirish */
export async function deleteStudentPhoto(params: {
  row?: number
  pinfl?: string
  fish?: string
}): Promise<boolean> {
  const key = photoKeyOf(params)
  const pinfl = cleanPin(params.pinfl)
  const row = Number.isInteger(Number(params.row)) && Number(params.row) >= 2 ? Number(params.row) : undefined
  const sFish = normFish(params.fish)

  const idx = await loadPhotoIndex(true)
  const pathsToDelete: string[] = []
  const keysToDelete: string[] = []

  for (const [k, rec] of Object.entries(idx.items)) {
    const recPin = cleanPin(rec.pinfl)
    const hitKey = key && k === key
    const hitPin = pinfl.length === 14 && recPin === pinfl
    const hitRow = row !== undefined && rec.row === row && (!pinfl || !recPin || recPin === pinfl)
    const hitFish = !hitKey && !hitPin && !hitRow && sFish && normFish(rec.fish) === sFish && (!pinfl || !recPin)
    if (hitKey || hitPin || hitRow || hitFish) {
      keysToDelete.push(k)
      if (rec.path) pathsToDelete.push(rec.path)
    }
  }

  if (!keysToDelete.length) return false
  for (const k of keysToDelete) delete idx.items[k]
  await savePhotoIndex(idx)

  if (pathsToDelete.length) {
    const sb = getServiceSupabase()
    await sb.storage.from(PHOTO_BUCKET).remove(pathsToDelete).catch(() => null)
  }
  return true
}
