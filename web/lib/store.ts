'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildAddedStudent, fullName, normalizeShnum } from './student'
import { EDIT_FIELDS, type BazaStatus, type Change, type EditFields, type Student, type StudentsPayload, type VerifyStatus } from './types'
import { supabase } from './supabase'

/*
  Serverdagi ma'lumot tahrirdan ~30–90 soniya keyin yangilanadi (Python xizmati
  Excelga yozadi, students.json ni qayta yaratadi, GitHub'ga yuboradi). Shu
  oraliqda sahifa yangilansa tahrir "yo'qolgandek" ko'rinmasligi uchun har bir
  o'zgarish brauzerda (localStorage) kutilayotgan holda saqlanadi va server
  ma'lumoti ustiga qo'yiladi. Server yetib olgach yozuv o'zi o'chadi.

  - Serverga yetgan (sent) yozuv 20 daqiqadan keyin baribir o'chadi — server
    qiymatni biroz o'zgartirib saqlasa ham, eski tahrir uni abadiy to'sib qolmasin.
  - Tarmoq xatosi tufayli yetmagan yozuv 7 kun saqlanadi va har yangilanishda
    qayta yuboriladi.
*/

const KEY = 'portal_v2_pending'
const TTL_UNSENT = 7 * 24 * 60 * 60 * 1000
const TTL_SENT = 20 * 60 * 1000
// Jonli o'zgarishlar Supabase Realtime orqali keladi; bu — zaxira tekshiruv (ETag bilan, o'zgarmagan bo'lsa bo'sh javob)
const REFRESH_MS = 5 * 60_000

/** Qator raqami o'chirishdan keyin surilishi mumkin — shuning uchun asl shaxsni ham eslab qolamiz */
interface Identity { row: number; shnum: string; pinfl: string; fish: string }
interface Meta { id: Identity; ts: number; sent: boolean }
interface PendingEdit extends Meta { fields: EditFields }
interface PendingVerify extends Meta { status: VerifyStatus }
interface PendingBaza extends Meta { status: BazaStatus }
type PendingDelete = Meta

interface PendingAdd { key: string; fields: EditFields; ts: number; sent: boolean }

interface Pending {
  edits: Record<string, PendingEdit>
  verifies: Record<string, PendingVerify>
  bazas: Record<string, PendingBaza>
  deletes: PendingDelete[]
  adds: PendingAdd[]
}

const EMPTY: Pending = { edits: {}, verifies: {}, bazas: {}, deletes: [], adds: [] }

function readPending(): Pending {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (raw && typeof raw === 'object') return { ...EMPTY, ...raw, bazas: raw.bazas || {}, adds: Array.isArray(raw.adds) ? raw.adds : [] }
  } catch { /* shaxsiy oyna yoki buzilgan qiymat */ }
  return EMPTY
}

function writePending(p: Pending) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* joy yo'q — xotirada ishlayveradi */ }
}

const expired = (m: { ts: number; sent: boolean }, now: number) => now - m.ts > (m.sent ? TTL_SENT : TTL_UNSENT)

/** Taqqoslashda bo'sh joy, katta-kichik harf va apostrof turlari farq qilmasin */
const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[\s'`ʻʼ‘’]/g, '')

const pinOf = (s: Student) => String(s.pinfl || '').replace(/\s/g, '')

const identityOf = (s: Student): Identity => ({
  row: s.row, shnum: String(s.shnum || '').trim(), pinfl: pinOf(s), fish: fullName(s).toLowerCase(),
})

/** Server ro'yxatidagi talaba shu shaxsmi? Avval JSHSHIR (shartnoma raqamlari turli kurslarda
 *  takrorlanadi — raqam bo'yicha bitta talabani o'chirsa shu raqamlilarning hammasi yashirinardi),
 *  keyin shartnoma raqami + qator, oxirida ism. */
function isSame(s: Student, id: Identity, altShnum?: string): boolean {
  if (id.pinfl && pinOf(s)) return pinOf(s) === id.pinfl
  const sh = String(s.shnum || '').trim()
  if (id.shnum && sh) {
    const shOk = sh === id.shnum || (!!altShnum && sh === altShnum.trim())
    return shOk && (s.row === id.row || fullName(s).toLowerCase() === id.fish)
  }
  return fullName(s).toLowerCase() === id.fish
}

/** Server ma'lumoti + kutilayotgan o'zgarishlar; server yetib olgan yozuvlar `next` ga tushmaydi */
function merge(server: Student[], pending: Pending, now: number) {
  const next: Pending = { edits: {}, verifies: {}, bazas: {}, deletes: [], adds: [] }

  for (const d of pending.deletes) {
    if (!expired(d, now) && server.some((s) => isSame(s, d.id))) next.deletes.push(d)
  }

  const list: Student[] = []
  for (const s0 of server) {
    if (next.deletes.some((d) => isSame(s0, d.id))) continue
    const key = String(s0.row)
    let s = s0

    const e = pending.edits[key]
    if (e && !expired(e, now) && isSame(s0, e.id, e.fields.shnum)) {
      const differs = Object.entries(e.fields).some(([f, v]) => norm(s0[f as keyof Student]) !== norm(v))
      if (differs) {
        s = { ...s, ...e.fields }
        s.fish = `${s.ism || ''} ${s.ota || ''}`.trim()
        next.edits[key] = e
      }
    }

    const v = pending.verifies[key]
    if (v && !expired(v, now) && isSame(s0, v.id) && (s0.verified || 'KUTILMOQDA') !== v.status) {
      s = { ...s, verified: v.status }
      next.verifies[key] = v
    }

    const b = pending.bazas?.[key]
    if (b && !expired(b, now) && isSame(s0, b.id) && (s0.baza || 'KIRITILDI') !== b.status) {
      s = { ...s, baza: b.status }
      next.bazas[key] = b
    }
    list.push(s)
  }

  let nextRow = (server.reduce((m, s) => Math.max(m, s.row), 1) || 1) + 1
  for (const a of pending.adds || []) {
    if (expired(a, now)) continue
    const fishLow = `${a.fields.ism || ''} ${a.fields.ota || ''}`.trim().toLowerCase()
    const id: Identity = { row: nextRow, shnum: (a.fields.shnum || '').trim(), pinfl: (a.fields.pinfl || '').replace(/\s/g, ''), fish: fishLow }
    if (server.some((s) => isSame(s, id))) continue
    next.adds.push(a)
    list.push(buildAddedStudent(a.fields, nextRow++))
  }

  const changed =
    Object.keys(next.edits).length !== Object.keys(pending.edits).length ||
    Object.keys(next.verifies).length !== Object.keys(pending.verifies).length ||
    Object.keys(next.bazas).length !== Object.keys(pending.bazas || {}).length ||
    next.deletes.length !== pending.deletes.length ||
    next.adds.length !== (pending.adds?.length ?? 0)
  return { list, next, changed }
}

class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

/** Sessiya tugagan (401) — kirish sahifasiga, keyin shu joyga qaytish */
function toLogin() {
  const next = `${window.location.pathname}${window.location.search}`
  window.location.replace(`/login${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`)
}

async function postChange(change: Change) {
  const res = await fetch('/api/changes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  })
  // 401 — tahrir rad etilmagan: brauzerda saqlanib turadi va qayta kirgach yuboriladi
  if (res.status === 401) {
    toLogin()
    throw new HttpError('Kirish talab qilinadi', 0)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.success) throw new HttpError(body.error || `Server ${res.status} qaytardi`, res.status)
}

/** 4xx — so'rov rad etildi (qayta yuborishdan foyda yo'q); boshqasi — vaqtinchalik xato */
const isRejected = (e: unknown) => e instanceof HttpError && e.status >= 400 && e.status < 500

export type LoadState = 'loading' | 'ready' | 'error'

export function useStudents() {
  const [server, setServer] = useState<Student[] | null>(null)
  const [source, setSource] = useState<StudentsPayload['source']>('local')
  const [fetchedAt, setFetchedAt] = useState('')
  const [pending, setPending] = useState<Pending>(EMPTY)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const inflight = useRef(false)
  const version = useRef('')
  const inFlightAdds = useRef(new Set<string>())
  const lastFetchTime = useRef(0)
  const pendingRef = useRef(pending)
  useEffect(() => { pendingRef.current = pending }, [pending])

  const updatePending = useCallback((fn: (p: Pending) => Pending) => {
    setPending((prev) => {
      const next = fn(prev)
      writePending(next)
      return next
    })
  }, [])

  const markSent = useCallback((kind: 'edits' | 'verifies' | 'bazas' | 'deletes', key: string | Identity) => {
    updatePending((p) => {
      if (kind === 'deletes') return { ...p, deletes: p.deletes.map((d) => (d.id === key ? { ...d, sent: true, ts: Date.now() } : d)) }
      const k = key as string
      const item = p[kind]?.[k]
      return item ? { ...p, [kind]: { ...p[kind], [k]: { ...item, sent: true, ts: Date.now() } } } : p
    })
  }, [updatePending])

  /** Tarmoq xatosi sababli yetmay qolgan o'zgarishlarni qayta yuborish */
  const retryUnsent = useCallback(async () => {
    const p = pendingRef.current
    for (const [key, e] of Object.entries(p.edits)) {
      if (e.sent) continue
      try {
        await postChange({
          type: 'update_student',
          data: {
            row: e.id.row,
            fields: e.fields,
            shnum: e.id.shnum,
            pinfl: e.id.pinfl,
            ism: e.id.fish,
          },
        })
        markSent('edits', key)
      } catch { return }
    }
    for (const [key, v] of Object.entries(p.verifies)) {
      if (v.sent) continue
      try {
        await postChange({ type: 'verify_student', data: { row: v.id.row, status: v.status, shnum: v.id.shnum, pinfl: v.id.pinfl, ism: '' } })
        markSent('verifies', key)
      } catch { return }
    }
    for (const [key, b] of Object.entries(p.bazas || {})) {
      if (b.sent) continue
      try {
        await postChange({ type: 'baza_student', data: { row: b.id.row, status: b.status, shnum: b.id.shnum, pinfl: b.id.pinfl, ism: '' } })
        markSent('bazas', key)
      } catch { return }
    }
    for (const a of p.adds || []) {
      if (a.sent || inFlightAdds.current.has(a.key)) continue
      // Agar talaba hali yaqindagina yuborilgan bo'lsa (15s ichida), shoshilib qayta yubormaymiz
      if (Date.now() - a.ts < 15_000) continue

      const fishLow = `${a.fields.ism || ''} ${a.fields.ota || ''}`.trim().toLowerCase()
      const aPinfl = (a.fields.pinfl || '').replace(/\s/g, '')
      const id: Identity = { row: 0, shnum: (a.fields.shnum || '').trim(), pinfl: aPinfl, fish: fishLow }
      if (server?.some((s) => isSame(s, id))) {
        // Allaqachon serverda mavjud bo'lsa, navbatdan olib tashlaymiz
        updatePending((prev) => ({
          ...prev,
          adds: (prev.adds || []).filter((x) => x.key !== a.key),
        }))
        continue
      }

      inFlightAdds.current.add(a.key)
      try {
        await postChange({ type: 'add_student', data: a.fields })
        updatePending((prev) => ({
          ...prev,
          adds: (prev.adds || []).map((x) => (x.key === a.key ? { ...x, sent: true, ts: Date.now() } : x)),
        }))
      } catch { return }
      finally {
        inFlightAdds.current.delete(a.key)
      }
    }
  }, [markSent, updatePending, server])

  const refresh = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      // Oxirgi versiya yuboriladi — o'zgarmagan bo'lsa server ro'yxatni qayta yubormaydi ({ unchanged: true })
      const res = await fetch('/api/students', { cache: 'no-store', headers: version.current ? { 'x-students-version': version.current } : {} })
      if (res.status === 401) {
        toLogin()
        return
      }
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `Server ${res.status}`)
      if (!body.unchanged) {
        const payload = body as StudentsPayload & { version?: string }
        setServer(payload.students)
        setSource(payload.source)
        version.current = payload.version || ''
      }
      setFetchedAt(new Date().toISOString())
      lastFetchTime.current = Date.now()
      setState('ready')
      setError('')
      void retryUnsent()
    } catch (e) {
      setError((e as Error).message)
      setState((s) => (s === 'ready' ? 'ready' : 'error'))
    } finally {
      inflight.current = false
    }
  }, [retryUnsent])

  useEffect(() => { setPending(readPending()) }, [])

  // Birinchi yuklash, keyin har 5 daqiqada (REFRESH_MS). Oyna ko'ringanda faqat 60s dan keyin so'rash
  useEffect(() => {
    void refresh()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, REFRESH_MS)
    const onFocusOrVisible = () => {
      // Oynani tez-tez almashtirganda Vercel Serverless Function chaqiruvlari tejaladi
      if (document.visibilityState === 'visible' && Date.now() - lastFetchTime.current > 60_000) {
        void refresh()
      }
    }
    window.addEventListener('focus', onFocusOrVisible)
    document.addEventListener('visibilitychange', onFocusOrVisible)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocusOrVisible)
      document.removeEventListener('visibilitychange', onFocusOrVisible)
    }
  }, [refresh])

  // Supabase Real-time: boshqa har qanday qurilma yoki foydalanuvchi tahrir qilganda darhol (0.1s) ekranda jonli yangilanadi
  useEffect(() => {
    try {
      const channel = supabase
        .channel('realtime:students')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'students' },
          () => {
            void refresh()
          }
        )
        .subscribe()

      return () => {
        void supabase.removeChannel(channel)
      }
    } catch (e) {
      console.warn('Realtime subscription error:', e)
    }
  }, [refresh])

  const merged = useMemo(() => (server ? merge(server, pending, Date.now()) : null), [server, pending])

  // Server yetib olgan yozuvlarni saqlangan navbatdan ham olib tashlaymiz
  useEffect(() => {
    if (merged?.changed) {
      setPending(merged.next)
      writePending(merged.next)
    }
  }, [merged])

  const originalOf = useCallback((s: Student) => server?.find((x) => x.row === s.row) ?? s, [server])

  const saveEdit = useCallback(async (student: Student, fields: EditFields) => {
    const clean: EditFields = {}
    for (const f of EDIT_FIELDS) if (fields[f] !== undefined) clean[f] = String(fields[f]).trim()
    if (clean.shnum !== undefined) clean.shnum = normalizeShnum(clean.shnum)
    const key = String(student.row)
    const prev = pendingRef.current.edits[key]
    updatePending((p) => ({
      ...p,
      edits: { ...p.edits, [key]: { id: prev?.id ?? identityOf(originalOf(student)), fields: { ...prev?.fields, ...clean }, ts: Date.now(), sent: false } },
    }))
    try {
      await postChange({
        type: 'update_student',
        data: {
          row: student.row,
          fields: clean,
          shnum: student.shnum || '',
          pinfl: student.pinfl || '',
          ism: student.ism || '',
        },
      })
      markSent('edits', key)
    } catch (e) {
      if (isRejected(e)) {
        updatePending((p) => {
          const edits = { ...p.edits }
          if (prev) edits[key] = prev
          else delete edits[key]
          return { ...p, edits }
        })
      }
      throw e
    }
  }, [originalOf, updatePending, markSent])

  const toggleVerify = useCallback(async (student: Student): Promise<VerifyStatus> => {
    const status: VerifyStatus = student.verified === 'TASDIQLANDI' ? 'KUTILMOQDA' : 'TASDIQLANDI'
    const key = String(student.row)
    const prev = pendingRef.current.verifies[key]
    updatePending((p) => ({ ...p, verifies: { ...p.verifies, [key]: { id: identityOf(originalOf(student)), status, ts: Date.now(), sent: false } } }))
    try {
      await postChange({
        type: 'verify_student',
        data: { row: student.row, status, shnum: student.shnum || '', pinfl: student.pinfl || '', ism: student.ism || '' },
      })
      markSent('verifies', key)
    } catch (e) {
      if (isRejected(e)) {
        updatePending((p) => {
          const verifies = { ...p.verifies }
          if (prev) verifies[key] = prev
          else delete verifies[key]
          return { ...p, verifies }
        })
      }
      throw e
    }
    return status
  }, [originalOf, updatePending, markSent])

  const toggleBaza = useCallback(async (student: Student): Promise<BazaStatus> => {
    const status: BazaStatus = (student.baza || 'KIRITILDI') === 'KIRITILMAGAN' ? 'KIRITILDI' : 'KIRITILMAGAN'
    const key = String(student.row)
    const prev = pendingRef.current.bazas?.[key]
    updatePending((p) => ({ ...p, bazas: { ...p.bazas, [key]: { id: identityOf(originalOf(student)), status, ts: Date.now(), sent: false } } }))
    try {
      await postChange({
        type: 'baza_student',
        data: { row: student.row, status, shnum: student.shnum || '', pinfl: student.pinfl || '', ism: student.ism || '' },
      })
      markSent('bazas', key)
    } catch (e) {
      if (isRejected(e)) {
        updatePending((p) => {
          const bazas = { ...p.bazas }
          if (prev) bazas[key] = prev
          else delete bazas[key]
          return { ...p, bazas }
        })
      }
      throw e
    }
    return status
  }, [originalOf, updatePending, markSent])

  const remove = useCallback(async (student: Student) => {
    const original = originalOf(student)
    const id = identityOf(original)
    updatePending((p) => ({ ...p, deletes: [...p.deletes, { id, ts: Date.now(), sent: false }] }))
    try {
      await postChange({
        type: 'delete_student',
        data: { row: original.row, shnum: id.shnum, pinfl: id.pinfl, ism: original.ism || '', fish: fullName(original) },
      })
      markSent('deletes', id)
    } catch (e) {
      // O'chirishni jimgina qayta yubormaymiz — xato bo'lsa talaba ro'yxatga qaytadi
      updatePending((p) => ({ ...p, deletes: p.deletes.filter((d) => d.id !== id) }))
      throw e
    }
  }, [originalOf, updatePending, markSent])

  const addStudent = useCallback(async (fields: EditFields) => {
    const clean: EditFields = {}
    for (const f of EDIT_FIELDS) if (fields[f] !== undefined) clean[f] = String(fields[f]).trim()
    if (clean.shnum !== undefined) clean.shnum = normalizeShnum(clean.shnum)
    const cleanPinfl = (clean.pinfl || '').replace(/\s/g, '')
    const cleanFish = `${clean.ism || ''} ${clean.ota || ''}`.trim().toLowerCase()
    const cleanGroup = String(clean.group || '').trim()

    // 1. Allaqachon serverda mavjud bo'lsa, xato berish (takroriy kiritishning oldini olish)
    if (server?.some((s) => {
      if (cleanPinfl && cleanPinfl.length === 14 && pinOf(s) === cleanPinfl) return true
      if (cleanFish && fullName(s).toLowerCase() === cleanFish && (s.group || '').trim() === cleanGroup) return true
      return false
    })) {
      throw new Error("Bu talaba bazada allaqachon mavjud!")
    }

    // 2. Allaqachon yuborilayotgan (kutilayotgan) bo'lsa, qayta bosishni to'xtatish
    if (pendingRef.current.adds?.some((a) => {
      const aP = (a.fields.pinfl || '').replace(/\s/g, '')
      const aF = `${a.fields.ism || ''} ${a.fields.ota || ''}`.trim().toLowerCase()
      if (cleanPinfl && cleanPinfl.length === 14 && aP === cleanPinfl) return true
      if (cleanFish && aF === cleanFish && (a.fields.group || '').trim() === cleanGroup) return true
      return false
    })) {
      throw new Error("Bu talaba hozirgina yuborildi, iltimos kuting...")
    }

    const key = `add_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    inFlightAdds.current.add(key)
    updatePending((p) => ({
      ...p,
      adds: [...(p.adds || []), { key, fields: clean, ts: Date.now(), sent: false }],
    }))
    try {
      await postChange({ type: 'add_student', data: clean })
      updatePending((p) => ({
        ...p,
        adds: (p.adds || []).map((a) => (a.key === key ? { ...a, sent: true, ts: Date.now() } : a)),
      }))
    } catch (e) {
      if (isRejected(e)) {
        updatePending((p) => ({ ...p, adds: (p.adds || []).filter((a) => a.key !== key) }))
      }
      throw e
    } finally {
      inFlightAdds.current.delete(key)
    }
  }, [server, updatePending])

  const pendingCount =
    Object.keys(pending.edits).length +
    Object.keys(pending.verifies).length +
    Object.keys(pending.bazas || {}).length +
    pending.deletes.length +
    (pending.adds?.length ?? 0)

  return {
    students: merged?.list ?? [],
    state, error, source, fetchedAt, pendingCount,
    refresh, saveEdit, toggleVerify, toggleBaza, remove, addStudent,
  }
}
