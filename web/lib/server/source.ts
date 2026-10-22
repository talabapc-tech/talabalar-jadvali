import 'server-only'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { applyGroupSettings, DEFAULT_GROUP_SETTINGS, sanitizeGroupSettings, SECRET_GROUP, type GroupSettings } from '@/lib/config'
import { buildAddedStudent, fullName, isLeftGroup, lastMoveInto, normalizeShnum, isWithdrawn, isOfficialGroup } from '@/lib/student'
import type { Change, EditFields, GroupMove, Student } from '@/lib/types'
import type { StaffMember } from '@/lib/staff'
import { getServiceSupabase } from '@/lib/supabase'
import { syncStudentsToWebJurnal, withdrawStudentFromWebJurnal } from '@/lib/server/webjurnal'

/*
  Ma'lumot ikki xil yo'l bilan o'qiladi/yoziladi:

  local  — kompyuterda `npm run dev`: talabalar ota papkadagi data/students.json dan
           o'qiladi, o'zgarishlar Python xizmatining (localhost:8080) mavjud
           /api/update_student, /api/verify_student, /api/delete_student
           endpointlariga yuboriladi. Xizmat darhol Excelga yozadi.

  github — Vercel: talabalar GitHub'dagi data/students.json dan o'qiladi,
           o'zgarishlar scripts/remote_changes.json navbatiga qo'shiladi.
           Kompyuterdagi Python xizmati navbatni tortib Excelga qo'llaydi.
*/

export type SyncMode = 'local' | 'github'

export function syncMode(): SyncMode {
  const m = process.env.SYNC_MODE
  if (m === 'local' || m === 'github') return m
  // Internetdagi sayt (Vercel yoki Netlify) — GitHub navbati; kompyuterda — Python xizmati
  return process.env.VERCEL || process.env.NETLIFY || process.env.SITE_ID ? 'github' : 'local'
}

const REPO_DIR = process.env.REPO_DIR || path.resolve(process.cwd(), '..')
const LOCAL_API = (process.env.LOCAL_API || 'http://localhost:8080').replace(/\/$/, '')

const GH_OWNER = process.env.GITHUB_OWNER || 'talabapc-tech'
const GH_REPO = process.env.GITHUB_REPO || 'talabalar-jadvali'
const GH_BRANCH = process.env.GITHUB_BRANCH || 'main'
const QUEUE_PATH = 'scripts/remote_changes.json'
const GROUP_SETTINGS_PATH = 'data/guruhlar.json'
/** Maxfiy guruh talabalarining asl guruhlari: { "<row>": { asl, fish, pinfl } } */
const ASL_GURUH_PATH = 'data/asl_guruhlar.json'
/** Guruh almashtirishlar tarixi: { "<row>": { fish, pinfl, moves: [{ from, to, buyruq, buyruq_sana, vaqt }] } } */
const GROUP_HISTORY_PATH = 'data/guruh_tarixi.json'

/*
  Loyiha papkalari (26.09.2026 dan). GitHub'da ham, kompyuterda ham shu yo'llar.
  Ikkinchi qiymat — ko'chirishdan oldingi eski joy (o'tish davri uchun zaxira).
*/
export const REPO_PATHS = {
  students: ['data/students.json', 'students.json'],
  baza: ['data/talabalar_bazasi.json', 'talabalar_bazasi.json'],
  eskiIndex: ['eski_portal/index.html', 'index.html'],
  hujjatlar: ['hujjatlar/shartnomalar', 'files'],
  pdfJurnallar: ['hisobotlar/pdf_jurnallar', 'pdf_jurnallar'],
  rollar: ['hisobotlar/rollar', ''],
} as const

function ghHeaders(accept = 'application/vnd.github+json'): HeadersInit {
  const h: Record<string, string> = { Accept: accept, 'User-Agent': 'talabalar-portal' }
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return h
}

function contentsUrl(p: string) {
  const enc = p.split('/').map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${enc}`
}

/** GitHub'dan faylni xom holda (1 MB dan katta bo'lsa ham) o'qish */
async function ghReadRaw(p: string): Promise<Buffer | null> {
  const res = await fetch(`${contentsUrl(p)}?ref=${GH_BRANCH}`, {
    headers: ghHeaders('application/vnd.github.raw'),
    cache: 'no-store',
  })
  if (res.ok) return Buffer.from(await res.arrayBuffer())
  if (res.status === 404) return null
  // Token yo'q yoki limit — ommaviy raw manziliga urinamiz (5 daqiqagacha kesh bo'lishi mumkin)
  const raw = await fetch(
    `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${p.split('/').map(encodeURIComponent).join('/')}`,
    { cache: 'no-store' },
  )
  return raw.ok ? Buffer.from(await raw.arrayBuffer()) : null
}

/** students.json hali yaratilmagan bo'lsa — index.html ichidagi RAW_STUDENTS dan ajratib olamiz */
function parseFromIndexHtml(html: string): Student[] {
  const marker = 'var RAW_STUDENTS = '
  const i = html.indexOf(marker)
  if (i === -1) throw new Error("index.html ichida RAW_STUDENTS topilmadi")
  const start = i + marker.length
  const end = html.indexOf('\n', start)
  return JSON.parse(html.slice(start, end).trim().replace(/;$/, ''))
}

/*
  GitHub fayllari keshi (faqat internetdagi sayt). Bot har xabarda bir nechta faylni GitHub'dan
  ketma-ket o'qirdi — har biri 0,3–0,8 s. Kam o'zgaradigan fayllar maxAgeMs bilan o'qiladi;
  saveRepoJsonFile o'sha faylni keshdan o'chiradi. students.json va navbat keshlanmaydi.
*/
const ghFileCache = new Map<string, { buf: Buffer | null; expiresAt: number }>()

export interface ReadOpts {
  /** Shu muddat ichida qayta o'qilsa GitHub'ga bormaydi (ms) */
  maxAgeMs?: number
}

async function ghReadCached(rel: string, maxAgeMs?: number): Promise<Buffer | null> {
  if (!maxAgeMs) return ghReadRaw(rel)
  const hit = ghFileCache.get(rel)
  if (hit && hit.expiresAt > Date.now()) return hit.buf
  const buf = await ghReadRaw(rel)
  ghFileCache.set(rel, { buf, expiresAt: Date.now() + maxAgeMs })
  return buf
}

/**
 * Loyiha faylini o'qish: kompyuterda — diskdan, internetda — GitHub'dan.
 * candidates — birinchi topilgani qaytariladi (yangi joy, keyin eski joy).
 */
export async function readRepoFile(candidates: readonly string[], opts: ReadOpts = {}): Promise<Buffer | null> {
  for (const rel of candidates) {
    if (!rel) continue
    if (syncMode() === 'local') {
      try {
        return await readFile(path.join(REPO_DIR, ...rel.split('/')))
      } catch { /* keyingi nomzod */ }
    } else {
      const buf = await ghReadCached(rel, opts.maxAgeMs)
      if (buf) return buf
    }
  }
  return null
}

/** Papka ichidagi faylni o'qish (masalan hujjatlar/shartnomalar/<fayl>) */
export function readRepoFileIn(dirs: readonly string[], name: string, opts: ReadOpts = {}): Promise<Buffer | null> {
  return readRepoFile(dirs.map((d) => (d ? `${d}/${name}` : name)), opts)
}

async function loadBaseStudents(): Promise<Student[]> {
  const json = await readRepoFile(REPO_PATHS.students)
  if (json) return JSON.parse(json.toString('utf-8'))
  const html = await readRepoFile(REPO_PATHS.eskiIndex)
  if (!html) throw new Error("Talabalar ma'lumotini o'qib bo'lmadi (data/students.json topilmadi)")
  return parseFromIndexHtml(html.toString('utf-8'))
}

/** GitHub'dagi navbat: Vercel'dan yuborilgan, lekin Python xizmati hali Excelga qo'llamagan o'zgarishlar */
async function loadQueue(): Promise<Change[]> {
  const buf = await ghReadRaw(QUEUE_PATH).catch(() => null)
  if (!buf) return []
  try {
    const list = JSON.parse(buf.toString('utf-8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/**
 * Navbatdagi o'zgarishlarni students.json ustiga qo'yamiz — aks holda kompyuterdagi
 * xizmat navbatni qo'llamaguncha (yoki kompyuter o'chiq bo'lsa) Vercel eski ma'lumotni
 * ko'rsatadi va tahrir "joyiga qaytib qolgandek" bo'ladi. Qoidalar telegram_sync_service.py
 * dagi process_remote_github_changes() bilan bir xil.
 */
function applyQueue(base: Student[], queue: Change[]): Student[] {
  let list = base.slice()
  let nextRow = list.reduce((m, s) => Math.max(m, s.row), 1) + 1
  const pin = (v: unknown) => String(v ?? '').replace(/\s/g, '')

  for (const chg of queue) {
    if (!chg || typeof chg !== 'object' || !chg.data) continue
    if (chg.type === 'add_student') {
      if (!String(chg.data.ism || '').trim()) continue
      list.push(buildAddedStudent(chg.data, nextRow++))
      continue
    }
    if (chg.type === 'delete_student') {
      const d = chg.data
      const sh = String(d.shnum || '').trim()
      const p = pin(d.pinfl)
      const name = String(d.ism || d.fish || '').trim().toLowerCase()
      // Shartnoma raqami turli kurslarda takrorlanadi — avval JSHSHIR va qator, raqam faqat yagona bo'lsa
      const byShnum = sh && sh !== '—' && sh !== '-' ? list.filter((s) => String(s.shnum || '').trim() === sh) : []
      const hit =
        (p ? list.find((s) => pin(s.pinfl) === p) : undefined) ??
        list.find((s) => s.row === Number(d.row) && (!p || !pin(s.pinfl))) ??
        (byShnum.length === 1 ? byShnum[0] : undefined) ??
        (name ? list.find((s) => String(s.ism || '').trim().toLowerCase() === name || fullName(s).toLowerCase() === name) : undefined)
      if (hit) list = list.filter((s) => s !== hit)
      continue
    }
    const d = chg.data as unknown as Record<string, unknown>
    const sh = pin(d.shnum)
    const p = pin(d.pinfl)

    // Aniq qatorni aniqlash: avval row bo'yicha qaraymiz, lekin PINFL yoki shartnoma raqamini tekshiramiz
    let i = list.findIndex((s) => s.row === Number(d.row))
    if (i !== -1 && (p || sh)) {
      const s = list[i]
      const s_p = pin(s.pinfl)
      const s_sh = pin(s.shnum)
      if ((p && s_p && p !== s_p) || (sh && s_sh && s_sh !== '—' && s_sh !== '-' && sh !== s_sh)) {
        // Qator surilib qolgan! PINFL yoki shnum bo'yicha haqiqiy talabani topamiz
        const found = p ? list.findIndex((x) => pin(x.pinfl) === p) : -1
        const bySh = found === -1 && sh ? list.flatMap((x, j) => (pin(x.shnum) === sh ? [j] : [])) : []
        if (found !== -1) i = found
        else if (bySh.length === 1) i = bySh[0]
      }
    } else if (i === -1 && (p || sh)) {
      i = p ? list.findIndex((x) => pin(x.pinfl) === p) : -1
      const bySh = i === -1 && sh ? list.flatMap((x, j) => (pin(x.shnum) === sh ? [j] : [])) : []
      if (bySh.length === 1) i = bySh[0]
    }
    if (i === -1) continue

    if (chg.type === 'verify_student') {
      list[i] = { ...list[i], verified: chg.data.status }
    } else if (chg.type === 'baza_student') {
      list[i] = { ...list[i], baza: chg.data.status }
    } else if (chg.type === 'update_student') {
      const f = { ...chg.data.fields }
      // Xizmat bo'sh ism/otasining ismini yozmaydi
      if (!f.ism) delete f.ism
      if (!f.ota) delete f.ota
      const s = { ...list[i], ...f }
      s.fish = `${s.ism || ''} ${s.ota || ''}`.trim()
      list[i] = s
    }
  }
  return list
}

let cachedStudents: { data: Student[]; source: 'supabase' | 'local' | 'github'; expiresAt: number } | null = null
const CACHE_TTL_MS = 10_000 // 10 soniya server in-memory kesh (Vercel Serverless CPU vaqti va Supabase chiqishini tejaydi)

export function invalidateCache() {
  cachedStudents = null
}

async function loadFromSupabase(): Promise<Student[] | null> {
  try {
    const sb = getServiceSupabase()
    const { data, error } = await sb.from('students').select('*').order('row', { ascending: true })
    if (error || !data || data.length === 0) return null
    return data as Student[]
  } catch {
    return null
  }
}

async function enrichSurveyData(students: Student[]): Promise<Student[]> {
  try {
    const buf = await readRepoFile(['data/sorovnoma_1kurs.json', 'sorovnoma_1kurs.json'], { maxAgeMs: 5 * 60_000 })
    if (buf) {
      const map = JSON.parse(buf.toString('utf-8')) as Record<string, Partial<Student>>
      for (const s of students) {
        const sr = map[String(s.row)] || (s.tr ? map[String(s.tr)] : undefined)
        if (sr) {
          if (sr.manzil_tuman) s.manzil_tuman = sr.manzil_tuman
          if (sr.manzil_mfy) s.manzil_mfy = sr.manzil_mfy
          if (sr.manzil_kocha) s.manzil_kocha = sr.manzil_kocha
          if (sr.manzil_uy) s.manzil_uy = sr.manzil_uy
          if (sr.manzil_toliq) s.manzil_toliq = sr.manzil_toliq
          if (sr.qatnov) s.qatnov = sr.qatnov
          if (sr.tel_shaxsiy) s.tel_shaxsiy = sr.tel_shaxsiy
          if (sr.tel_otaona) s.tel_otaona = sr.tel_otaona
          if (sr.tel_otaona_kim) s.tel_otaona_kim = sr.tel_otaona_kim
        }
      }
    }
  } catch (e) {
    console.error("So'rovnoma boyitishda xato:", e)
  }
  return students
}

/* ------------------------------ ASL GURUHLAR (maxfiy guruh) ------------------------------ */

type AslGuruhRecord = { asl: string; fish?: string; pinfl?: string }
type AslGuruhMap = Record<string, AslGuruhRecord>

// GitHub'dan o'qish kechikishi mumkin — oxirgi yozilgan holat shu yerda turadi
let aslGuruhOverlay: AslGuruhMap | null = null

async function loadAslGuruhlar(): Promise<AslGuruhMap> {
  if (aslGuruhOverlay) return aslGuruhOverlay
  try {
    const buf = await readRepoFile([ASL_GURUH_PATH], { maxAgeMs: 60_000 })
    if (buf) {
      const parsed = JSON.parse(buf.toString('utf-8'))
      if (parsed && typeof parsed === 'object') return parsed as AslGuruhMap
    }
  } catch { /* buzilgan fayl — bo'sh */ }
  return {}
}

async function enrichAslGuruh(students: Student[]): Promise<Student[]> {
  const map = await loadAslGuruhlar()
  for (const s of students) {
    const rec = map[String(s.row)]
    if (rec?.asl) s.asl_guruh = rec.asl
  }
  return students
}

/** Bitta talabaning asl guruhini yozish (bo'sh qiymat — yozuvni o'chiradi) */
async function saveAslGuruh(s: Pick<Student, 'row' | 'fish' | 'pinfl'>, asl: string): Promise<void> {
  const map = { ...(await loadAslGuruhlar()) }
  const key = String(s.row)
  if (asl) map[key] = { asl, fish: s.fish || '', pinfl: String(s.pinfl || '').replace(/\s/g, '') }
  else delete map[key]
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => Number(a) - Number(b)))
  await saveRepoJsonFile(ASL_GURUH_PATH, sorted, `Asl guruh: ${s.fish || key} → ${asl || "o'chirildi"}`)
  aslGuruhOverlay = sorted
}

/**
 * update_student dagi asl_guruh maydonini ajratib, alohida faylga yozadi (Supabase va Excel'da
 * bunday ustun yo'q). Talaba maxfiy guruhga o'tkazilsa va asl guruh berilmagan bo'lsa —
 * oldingi guruhi asl guruh sifatida yoziladi. Qolgan maydonlar bilan o'zgarishni qaytaradi
 * (boshqa maydon qolmasa — null).
 */
async function splitAslGuruh(change: Change): Promise<Change | null> {
  if (change.type !== 'update_student') return change
  const { asl_guruh, ...rest } = change.data.fields
  const toSecret = rest.group === SECRET_GROUP
  if (asl_guruh === undefined && !toSecret) return change

  const current = (await loadStudents()).find((s) => s.row === change.data.row)
  if (current) {
    let asl = asl_guruh?.trim()
    if (asl === undefined && toSecret && !current.asl_guruh && current.group && current.group !== SECRET_GROUP) {
      asl = current.group.trim()
    }
    if (asl !== undefined && asl !== (current.asl_guruh || '')) await saveAslGuruh(current, asl)
  }
  if (!Object.keys(rest).length) return null
  return { ...change, data: { ...change.data, fields: rest } }
}

/* ------------------------------ GURUH TARIXI (akademik / safdan chiqarilganlar) ------------------------------ */

type GroupHistoryRecord = { fish?: string; pinfl?: string; moves: GroupMove[] }
type GroupHistoryMap = Record<string, GroupHistoryRecord>

let groupHistoryOverlay: GroupHistoryMap | null = null

async function loadGroupHistory(): Promise<GroupHistoryMap> {
  if (groupHistoryOverlay) return groupHistoryOverlay
  try {
    const buf = await readRepoFile([GROUP_HISTORY_PATH], { maxAgeMs: 60_000 })
    if (buf) {
      const parsed = JSON.parse(buf.toString('utf-8'))
      if (parsed && typeof parsed === 'object') return parsed as GroupHistoryMap
    }
  } catch { /* buzilgan fayl — bo'sh */ }
  return {}
}

async function enrichGroupHistory(students: Student[]): Promise<Student[]> {
  const map = await loadGroupHistory()
  for (const s of students) {
    const moves = map[String(s.row)]?.moves
    if (!moves?.length) continue
    s.guruh_tarixi = moves
    if (isLeftGroup(s.group)) {
      const last = lastMoveInto(s)
      if (last?.from) s.chiqqan_guruh = last.from
    }
  }
  return students
}

/**
 * update_student dagi guruh o'zgarishini tarixga yozadi va chiqqan_guruh maydonini ajratib oladi
 * (Supabase va Excel'da bunday ustun yo'q):
 *  - guruh o'zgarsa — { qayerdan, qayerga, buyruq, vaqt } qo'shiladi; akademik/safdan chiqarishda
 *    chiqqan_guruh berilgan bo'lsa "qayerdan" shu bo'ladi;
 *  - guruh o'zgarmay chiqqan_guruh yoki buyruq tahrirlansa — oxirgi o'tkazish yozuvi tuzatiladi
 *    (yozuv bo'lmasa, qo'lda kiritilgan deb yaratiladi).
 * Tarixni yozib bo'lmasa ham asosiy tahrir saqlanaveradi.
 */
async function splitGroupHistory(change: Change): Promise<Change | null> {
  if (change.type !== 'update_student') return change
  const { chiqqan_guruh, ...rest } = change.data.fields
  const groupChanged = rest.group !== undefined
  const orderChanged = rest.buyruq !== undefined || rest.buyruq_sana !== undefined
  if (chiqqan_guruh === undefined && !groupChanged && !orderChanged) return change

  try {
    const current = (await loadStudents()).find((s) => s.row === change.data.row)
    if (current) {
      const prev = String(current.group || '').trim()
      const next = groupChanged ? String(rest.group || '').trim() : prev
      const order = { buyruq: rest.buyruq ?? current.buyruq ?? '', buyruq_sana: rest.buyruq_sana ?? current.buyruq_sana ?? '' }
      const map = { ...(await loadGroupHistory()) }
      const key = String(current.row)
      const moves = [...(map[key]?.moves ?? [])]
      let dirty = false

      if (next !== prev) {
        const from = isLeftGroup(next) && chiqqan_guruh?.trim() ? chiqqan_guruh.trim() : prev
        moves.push({ from, to: next, ...(isLeftGroup(next) ? order : {}), vaqt: new Date().toISOString(), manba: 'portal' })
        dirty = true
      } else if (isLeftGroup(prev) && (chiqqan_guruh !== undefined || orderChanged)) {
        const i = moves.map((m) => m.to).lastIndexOf(prev)
        const base = i >= 0 ? moves[i] : { from: '', to: prev, vaqt: '', manba: 'qolda' as const }
        const fixed = { ...base, ...(chiqqan_guruh !== undefined ? { from: chiqqan_guruh.trim() } : {}), ...order }
        if (i >= 0) moves[i] = fixed
        else moves.push(fixed)
        dirty = true
      }

      if (dirty) {
        map[key] = { fish: current.fish || '', pinfl: String(current.pinfl || '').replace(/\s/g, ''), moves }
        const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => Number(a) - Number(b)))
        const last = moves[moves.length - 1]
        await saveRepoJsonFile(GROUP_HISTORY_PATH, sorted, `Guruh tarixi: ${current.fish || key} ${last.from || '?'} → ${last.to}`)
        groupHistoryOverlay = sorted
      }
    }
  } catch (err) {
    console.error('Guruh tarixini yozishda xato (tahrir baribir saqlanadi):', err)
  }
  if (!Object.keys(rest).length) return null
  return { ...change, data: { ...change.data, fields: rest } }
}

/** So'rovnoma, asl guruh va guruh tarixi fayllari bir vaqtda o'qiladi (avval ketma-ket edi) */
async function enrichAll(students: Student[]): Promise<Student[]> {
  await Promise.all([enrichSurveyData(students), enrichAslGuruh(students), enrichGroupHistory(students)])
  return students
}

export async function loadStudentsWithSource(): Promise<{ students: Student[]; source: 'supabase' | 'local' | 'github' }> {
  const now = Date.now()
  if (cachedStudents && cachedStudents.expiresAt > now) {
    return { students: cachedStudents.data, source: cachedStudents.source }
  }

  // 1. Avval Supabase'dan o'qish (eng tezkor, jonli va real vaqt ma'lumot)
  const sbData = await loadFromSupabase()
  if (sbData && sbData.length > 0) {
    const enriched = await enrichAll(sbData)
    cachedStudents = { data: enriched, source: 'supabase', expiresAt: now + CACHE_TTL_MS }
    return { students: enriched, source: 'supabase' }
  }

  // 2. Agar Supabase vaqtincha mavjud bo'lmasa, zaxira sifatida fayllar/GitHub'dan o'qish (kesh bilan)
  const [students, queue] = await Promise.all([
    loadBaseStudents(),
    syncMode() === 'github' ? loadQueue() : Promise.resolve([]),
  ])
  const result = queue.length ? applyQueue(students, queue) : students
  const enriched = await enrichAll(result)
  cachedStudents = { data: enriched, source: syncMode(), expiresAt: now + CACHE_TTL_MS }
  return { students: enriched, source: syncMode() }
}

export async function loadStudents(): Promise<Student[]> {
  const { students } = await loadStudentsWithSource()
  return students
}

/* ------------------------------ YOZISH ------------------------------ */

async function sendLocal(change: Change): Promise<void> {
  if (change.type === 'add_student') {
    const d = change.data
    const res = await fetch(`${LOCAL_API}/api/add_students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        students: [{
          ism: d.ism || '',
          ota: d.ota || '',
          shnum: d.shnum || '',
          pass_val: d.pv || '',
          pinfl: d.pinfl || '',
          dob: d.dob || '',
          ber_sana: d.ber || '',
          cert_val: d.sh_doc || '',
          cert_tur: d.doc_tur || 'Shahodatnoma',
          maktab: d.mak || '',
          yil: d.yil || '2024',
          yonalis: d.yon || ((d.group === '26-01' || (d.group && d.group.endsWith('-01'))) ? 'Farmatsiya ishi' : 'Hamshiralik ishi'),
          tel: d.tel || '',
          group: d.group || '26-02',
        }],
      }),
      cache: 'no-store',
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.success === false) {
      throw new Error(body.error || `Python xizmati ${res.status} qaytardi`)
    }
    return
  }
  const q = new URLSearchParams()
  let endpoint: string
  if (change.type === 'update_student') {
    endpoint = '/api/update_student'
    const d = change.data as { row: number; fields: EditFields; shnum?: string; pinfl?: string; ism?: string }
    q.set('row', String(d.row))
    if (d.shnum) q.set('shnum_verify', String(d.shnum))
    if (d.pinfl) q.set('pinfl_verify', String(d.pinfl))
    if (d.ism) q.set('ism_verify', String(d.ism))
    for (const [k, v] of Object.entries(d.fields)) q.set(k, v != null ? String(v) : '')
  } else if (change.type === 'verify_student') {
    endpoint = '/api/verify_student'
    for (const [k, v] of Object.entries(change.data)) q.set(k, String(v))
  } else if (change.type === 'baza_student') {
    endpoint = '/api/baza_student'
    for (const [k, v] of Object.entries(change.data)) q.set(k, String(v))
  } else {
    endpoint = '/api/delete_student'
    for (const [k, v] of Object.entries(change.data)) q.set(k, String(v))
  }
  // URLSearchParams probelni "+" qiladi, Python xizmati esa unquote() bilan o'qiydi va
  // "+" ni probelga qaytarmaydi ("Azamat+qizi") — shuning uchun %20 bilan kodlaymiz
  const query = [...q].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  const res = await fetch(`${LOCAL_API}${endpoint}?${query}`, { cache: 'no-store' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    throw new Error(body.error || `Python xizmati ${res.status} qaytardi`)
  }
}

/** remote_changes.json navbatiga qo'shish (409 bo'lsa yangi SHA bilan qayta urinadi) */
async function sendGithub(change: Change): Promise<void> {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN sozlanmagan')
  const entry = { ...change, id: `chg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, created_at: new Date().toISOString() }

  let lastErr = ''
  for (let attempt = 1; attempt <= 5; attempt++) {
    const getRes = await fetch(`${contentsUrl(QUEUE_PATH)}?ref=${GH_BRANCH}`, { headers: ghHeaders(), cache: 'no-store' })
    let list: unknown[] = []
    let sha: string | undefined
    if (getRes.ok) {
      const file = await getRes.json()
      sha = file.sha
      try {
        const parsed = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'))
        if (Array.isArray(parsed)) list = parsed
      } catch { /* buzilgan fayl — bo'sh ro'yxatdan boshlaymiz */ }
    }
    if (change.type === 'add_student') {
      const d = change.data as Record<string, unknown>
      const cleanPinfl = d.pinfl ? String(d.pinfl).replace(/\s/g, '') : ''
      const cleanFish = `${d.ism || ''} ${d.ota || ''}`.trim().toLowerCase()
      const cleanGroup = String(d.group || '').trim()
      const alreadyInQueue = list.some((item: unknown) => {
        const it = item as { type?: string; data?: Record<string, unknown> } | null
        if (it?.type !== 'add_student' || !it.data) return false
        const iP = it.data.pinfl ? String(it.data.pinfl).replace(/\s/g, '') : ''
        if (cleanPinfl && cleanPinfl.length === 14 && iP === cleanPinfl) return true
        const iF = `${it.data.ism || ''} ${it.data.ota || ''}`.trim().toLowerCase()
        const iG = String(it.data.group || '').trim()
        return cleanFish && iF === cleanFish && iG === cleanGroup
      })
      if (alreadyInQueue) {
        return
      }
    }

    list.push(entry)

    const putRes = await fetch(contentsUrl(QUEUE_PATH), {
      method: 'PUT',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Remote o'zgarish: ${change.type} (${entry.id})`,
        content: Buffer.from(JSON.stringify(list, null, 2), 'utf-8').toString('base64'),
        branch: GH_BRANCH,
        sha,
      }),
    })
    if (putRes.ok) return
    lastErr = `${putRes.status} ${await putRes.text()}`
    if (putRes.status !== 409 && putRes.status !== 422) break
    await new Promise((r) => setTimeout(r, 300 * attempt))
  }
  throw new Error(`GitHub navbatiga yozilmadi: ${lastErr.slice(0, 200)}`)
}

async function sendSupabase(change: Change): Promise<void> {
  const sb = getServiceSupabase()
  if (change.type === 'update_student') {
    const d = change.data
    const pinfl = d.pinfl
    const updateData: Record<string, unknown> = { ...d.fields, updated_at: new Date().toISOString() }
    if (d.fields.ism || d.fields.ota) {
      updateData.fish = `${d.fields.ism || ''} ${d.fields.ota || ''}`.trim()
    }
    let query = sb.from('students').update(updateData)
    // Faqat JSHSHIR yoki qator: shartnoma raqami takrorlanadi va .eq('shnum') hamma mos qatorlarni o'zgartirardi
    if (pinfl) query = query.eq('pinfl', pinfl.replace(/\s/g, ''))
    else query = query.eq('row', d.row)
    const { error } = await query
    if (error) throw error
  } else if (change.type === 'verify_student') {
    const d = change.data
    let query = sb.from('students').update({ verified: d.status, updated_at: new Date().toISOString() })
    if (d.pinfl) query = query.eq('pinfl', d.pinfl.replace(/\s/g, ''))
    else query = query.eq('row', d.row)
    const { error } = await query
    if (error) throw error
  } else if (change.type === 'baza_student') {
    const d = change.data
    let query = sb.from('students').update({ baza: d.status, updated_at: new Date().toISOString() })
    if (d.pinfl) query = query.eq('pinfl', d.pinfl.replace(/\s/g, ''))
    else query = query.eq('row', d.row)
    const { error } = await query
    if (error) throw error
  } else if (change.type === 'delete_student') {
    const d = change.data
    let query = sb.from('students').delete()
    if (d.pinfl) query = query.eq('pinfl', d.pinfl.replace(/\s/g, ''))
    else query = query.eq('row', d.row)
    const { error } = await query
    if (error) throw error
  } else if (change.type === 'add_student') {
    const d = change.data
    const cleanPinfl = d.pinfl ? String(d.pinfl).replace(/\s/g, '') : ''
    const cleanFish = `${d.ism || ''} ${d.ota || ''}`.trim().toLowerCase()
    const cleanGroup = String(d.group || '').trim()

    // 1. Agar JSHSHIR (14 xonali) bo'yicha talaba mavjud bo'lsa, takroriy qo'shilmasin
    if (cleanPinfl && cleanPinfl.length === 14) {
      const { data: existing } = await sb.from('students').select('row').eq('pinfl', cleanPinfl).limit(1)
      if (existing && existing.length > 0) {
        console.warn(`[sendSupabase] Talaba PINFL ${cleanPinfl} bilan allaqachon mavjud, takroriy kiritish bekor qilindi`)
        return
      }
    }

    // 2. Agar F.I.SH va guruh bo'yicha allaqachon mavjud bo'lsa, takroriy qo'shilmasin
    if (cleanFish) {
      const { data: existing } = await sb.from('students').select('row, fish, group')
      if (existing) {
        const found = existing.some(
          (s) => (s.fish || '').trim().toLowerCase() === cleanFish && (s.group || '').trim() === cleanGroup
        )
        if (found) {
          console.warn(`[sendSupabase] Talaba ${cleanFish} (${cleanGroup}) allaqachon mavjud, takroriy kiritish bekor qilindi`)
          return
        }
      }
    }

    // Row hisoblash: count emas, mavjud eng katta row + 1
    const { data: maxRowData } = await sb.from('students').select('row').order('row', { ascending: false }).limit(1)
    const maxRow = maxRowData && maxRowData.length > 0 ? Number(maxRowData[0].row) : 562
    const nextRow = maxRow + 1
    const newStudent = buildAddedStudent(d, nextRow)
    const { error } = await sb.from('students').insert(newStudent)
    if (error) throw error
  }
}

export async function sendChange(incoming: Change): Promise<void> {
  invalidateCache()
  // "26/27 SH/A 15" → "15" (portal, bot va boshqa mijozlardan kelgan har qanday yozuv)
  if ((incoming.type === 'update_student' || incoming.type === 'add_student')) {
    const f = incoming.type === 'update_student' ? incoming.data.fields : incoming.data
    if (f.shnum !== undefined) f.shnum = normalizeShnum(f.shnum)
  }
  // Tarix tahrirdan OLDIN yoziladi — hozirgi (eski) guruh "qayerdan" bo'lib qoladi
  const withHistory = await splitGroupHistory(incoming)
  const change = withHistory && await splitAslGuruh(withHistory)
  if (!change) return
  let supabaseOk = false
  try {
    await sendSupabase(change)
    supabaseOk = true
  } catch (err) {
    console.error('Supabase write error, continuing to local/github:', err)
  }
  try {
    if (syncMode() === 'local') {
      await sendLocal(change)
    } else {
      await sendGithub(change)
    }
  } catch (err) {
    if (!supabaseOk) {
      throw err
    }
  } finally {
    invalidateCache()
  }

  // ── Web Jurnal avtomatik sinxronlash (qo'shish, safdan chiqarish, o'chirish) ──
  if (change.type === 'add_student') {
    const d = change.data
    const groupName = String(d.group || '26-02').trim()
    const studentName = `${d.ism || ''} ${d.ota || ''}`.trim()
    if (groupName && studentName) {
      try {
        await syncStudentsToWebJurnal(groupName, [studentName])
      } catch (syncErr) {
        console.warn('[WebJurnal Auto-Sync Error]', syncErr)
      }
    }
  } else if (change.type === 'delete_student') {
    const d = change.data
    const studentName = String(d.fish || d.ism || '').trim()
    if (studentName) {
      try {
        await withdrawStudentFromWebJurnal(studentName, "Talabalar bazasidan o'chirib yuborilgan")
      } catch (withdrawErr) {
        console.warn('[WebJurnal Auto-Withdraw Error]', withdrawErr)
      }
    }
  } else if (change.type === 'update_student') {
    const d = change.data
    const fields = d.fields || {}
    if (fields.group) {
      const nextGroup = String(fields.group).trim()
      const studentName = String(d.ism || '').trim()
      if (isWithdrawn(nextGroup) || nextGroup.toLowerCase().includes('chiqaril')) {
        try {
          let fullStudentName = studentName
          const cur = (await loadStudents()).find((s) => s.row === d.row)
          if (cur?.fish) fullStudentName = cur.fish.trim()
          await withdrawStudentFromWebJurnal(fullStudentName, `Talabalar safidan chiqarildi (${fields.buyruq || ''})`)
        } catch (withdrawErr) {
          console.warn('[WebJurnal Auto-Withdraw Error]', withdrawErr)
        }
      } else if (isOfficialGroup(nextGroup)) {
        let fullStudentName = studentName
        const cur = (await loadStudents()).find((s) => s.row === d.row)
        if (cur?.fish) fullStudentName = cur.fish.trim()
        if (fullStudentName) {
          try {
            await syncStudentsToWebJurnal(nextGroup, [fullStudentName])
          } catch (syncErr) {
            console.warn('[WebJurnal Auto-Sync Error]', syncErr)
          }
        }
      }
    }
  }
}

/* ------------------------------ HOLAT ------------------------------ */

export async function localSyncStatus() {
  const res = await fetch(`${LOCAL_API}/api/git_sync_status?t=${Date.now()}`, { cache: 'no-store' })
  return res.json()
}

export async function localFlush() {
  const res = await fetch(`${LOCAL_API}/api/flush_to_git?t=${Date.now()}`, { cache: 'no-store' })
  return res.json()
}

/* ---------------------------- HUJJAT FAYLI ---------------------------- */

export async function loadDocFile(name: string): Promise<Buffer | null> {
  return readRepoFileIn(REPO_PATHS.hujjatlar, name)
}

/* ------------------------------ GURUH SOZLAMALARI ------------------------------ */

/** data/guruhlar.json (bo'lmasa — config.ts dagi boshlang'ich qiymatlar) va server xotirasiga qo'llash */
export async function loadGroupSettings(): Promise<GroupSettings> {
  let settings = DEFAULT_GROUP_SETTINGS
  try {
    const buf = await readRepoFile([GROUP_SETTINGS_PATH], { maxAgeMs: 60_000 })
    if (buf) {
      const parsed = sanitizeGroupSettings(JSON.parse(buf.toString('utf-8')))
      if (Object.keys(parsed).length) settings = parsed
    }
  } catch { /* buzilgan fayl — boshlang'ich qiymatlar */ }
  applyGroupSettings(settings)
  return settings
}

/**
 * Umumiy repo JSON faylini saqlash (Lokal yoki GitHub orqali)
 */
export async function saveRepoJsonFile(relPath: string, data: unknown, commitMsg: string): Promise<void> {
  const text = JSON.stringify(data, null, 2) + '\n'
  ghFileCache.delete(relPath)

  if (syncMode() === 'local') {
    const file = path.join(REPO_DIR, ...relPath.split('/'))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, text, 'utf-8')
    await fetch(`${LOCAL_API}/api/flush_to_git?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null)
  } else {
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN sozlanmagan')
    let lastErr = ''
    for (let attempt = 1; attempt <= 4; attempt++) {
      const getRes = await fetch(`${contentsUrl(relPath)}?ref=${GH_BRANCH}`, { headers: ghHeaders(), cache: 'no-store' })
      const sha = getRes.ok ? (await getRes.json()).sha : undefined
      const putRes = await fetch(contentsUrl(relPath), {
        method: 'PUT',
        headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMsg, content: Buffer.from(text, 'utf-8').toString('base64'), branch: GH_BRANCH, sha }),
      })
      if (putRes.ok) { lastErr = ''; break }
      lastErr = `${putRes.status} ${(await putRes.text()).slice(0, 160)}`
      if (putRes.status !== 409 && putRes.status !== 422) break
      await new Promise((r) => setTimeout(r, 300 * attempt))
    }
    if (lastErr) throw new Error(`GitHub'ga yozilmadi: ${lastErr}`)
  }
}

/**
 * Sozlamalarni saqlash. Lokal: faylni diskka yozib, Python xizmatiga GitHub'ga yuborishni
 * aytadi. Vercel: GitHub'dagi faylni to'g'ridan-to'g'ri yangilaydi (xizmat uni git pull bilan oladi).
 */
export async function saveGroupSettings(raw: unknown): Promise<GroupSettings> {
  const settings = sanitizeGroupSettings(raw)
  if (!Object.keys(settings).length) throw new Error("Guruh sozlamalari bo'sh yoki noto'g'ri")
  await saveRepoJsonFile(GROUP_SETTINGS_PATH, settings, "Guruh sozlamalari yangilandi")
  applyGroupSettings(settings)
  return settings
}


/* ------------------------------ XODIMLAR (STAFF) ------------------------------ */

export async function loadStaff(): Promise<StaffMember[]> {
  try {
    const buf = await readRepoFile(['data/xodimlar.json', 'xodimlar.json'], { maxAgeMs: 10_000 })
    if (buf) {
      const list = JSON.parse(buf.toString('utf-8'))
      if (Array.isArray(list)) return list as StaffMember[]
    }
  } catch { /* bo'sh */ }
  return []
}

export async function saveStaff(list: StaffMember[], msg = "Xodimlar ma'lumoti yangilandi"): Promise<void> {
  await saveRepoJsonFile('data/xodimlar.json', list, msg)
}
