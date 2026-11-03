'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Briefcase,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  Database,
  Edit2,
  Eye,
  EyeOff,
  FileSpreadsheet,
  GripVertical,
  Link as LinkIcon,
  Loader2,
  Maximize2,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Save,
  Share2,
  Trash2,
  Undo2,
  Users,
  X,
  Zap,
} from 'lucide-react'
import type { OquvReja } from '@/lib/curriculum'
import { GROUP_SETTINGS } from '@/lib/config'
import { academicGroups, byName, fullName, kursOf } from '@/lib/student'
import type { Student } from '@/lib/types'
import {
  BAHO_TURLARI,
  DEFAULT_AMALIYOT,
  KIRITILADIGAN,
  SEMESTRLAR,
  amaliyotReyting,
  bahoOf,
  bahoText,
  hisoblaReyting,
  parseBaho,
  reytingSeed,
  type AmField,
  type AmaliyotRow,
  type BahoRow,
  type BaholarPayload,
  type Fan,
  type Kiritiladigan,
  type Reyting,
} from '@/lib/baholar'
import { exportBaza, exportHisobot, exportQaydnomalar, type BaholarExportData, type ExportAmaliyot, type ExportGrade } from '@/lib/baholar-excel'
import BaholarExportModal, { type ExportTanlov } from './BaholarExportModal'
import XScroll from './XScroll'
import CopyColMenu from './CopyColMenu'
import { parseClipboardGrid, useEditHistory } from '@/lib/use-edit-history'
import { useFlip, useSortable } from '@/lib/use-sortable'
import type { Notify } from './Toast'
import { cx } from './ui'

type SubView = 'baholar' | 'amaliyot'
type Birlik = 'ball5' | 'reyting'
const PREF_KEY = 'baholar_prefs_v2'
const AM_FIELDS = ['joy', 'boshlanish', 'tugash', 'ball', 'izoh'] as const

/** Ulashish oynasidagi "Barcha fanlar" tanlovi */
const ALL_FANS = '__ALL__'

interface ShareLinkItem {
  id: string
  token: string
  guruh: string
  semestr: number
  fan: string
  /** Havola guruhning shu semestrdagi barcha fanlari uchun */
  allFanlar?: boolean
  teacherName?: string
  hiddenPinfls: string[]
  active: boolean
  createdAt: string
  updatedAt: string
}

function readPrefs(): { guruh?: string; semestr?: number; view?: SubView; birlik?: Birlik } {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

const mean = (vals: (number | null)[], dec = 1) => {
  const n = vals.filter((v): v is number => v !== null)
  if (!n.length) return null
  const k = 10 ** dec
  return Math.round((n.reduce((a, b) => a + b, 0) / n.length) * k) / k
}

/** Bahoga qarab matn rangi: 5 — yashil, 4 — ko'k, 3 — sariq, 2 — qizil */
const BAHO_RANG: Record<number, string> = {
  5: 'text-emerald-soft',
  4: 'text-sky-soft',
  3: 'text-amber',
  2: 'text-rose',
}

const cellCls = (changed: boolean, bad: boolean) =>
  cx(
    'h-8 w-10 sm:w-11 rounded-md border bg-ink-950/70 text-center text-base font-semibold tabular-nums text-fg outline-none transition-colors sm:text-[13px]',
    'focus:border-sky/70 focus:ring-2 focus:ring-sky/20',
    bad ? 'border-rose bg-rose/10 text-rose' : changed ? 'border-amber/60 bg-amber/10' : 'border-line',
  )

interface Calc {
  g: Record<Kiritiladigan, number | null>
  rey: Reyting
}

export default function BaholarSection({
  students,
  notify,
}: {
  students: Student[]
  notify: Notify
}) {
  const groups = useMemo(() => academicGroups(students), [students])
  const [guruh, setGuruh] = useState('')
  const [semestr, setSemestr] = useState<number>(1)
  const [view, setView] = useState<SubView>('baholar')
  const [birlikTanlov, setBirlik] = useState<Birlik>('ball5')
  const [data, setData] = useState<BaholarPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ text: string; setup: boolean } | null>(null)
  const [saving, setSaving] = useState(false)

  // Baholar tahrirlari (key: pinfl|fan|key) — Bekor qilish (Undo) va Qaytarish (Redo) tarixi bilan
  const history = useEditHistory()
  const { edits, apply: applyEdits, reset: resetEdits, undo: handleUndo, redo: handleRedo } = history
  const [amEdits, setAmEdits] = useState<Record<string, string>>({}) // amaliyot: pinfl|field

  const [newFan, setNewFan] = useState('')
  const [amNom, setAmNom] = useState(DEFAULT_AMALIYOT)
  const [newAm, setNewAm] = useState('')
  const [bulk, setBulk] = useState({ joy: '', boshlanish: '', tugash: '' })
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [curriculumPlan, setCurriculumPlan] = useState<OquvReja | null>(null)
  const [curriculumLoading, setCurriculumLoading] = useState(false)
  const [importingPlan, setImportingPlan] = useState(false)
  const tableRef = useRef<HTMLDivElement>(null)
  const reorderListRef = useRef<HTMLDivElement>(null)
  const focusTableRef = useRef<HTMLDivElement>(null)

  // 1. Talabalar maxsus tartibi (Telegram uslubida silliq animatsiyali reorder)
  const [studentOrder, setStudentOrder] = useState<string[]>([])
  const [justMovedPinfl, setJustMovedPinfl] = useState<string | null>(null)
  const [reorderModalOpen, setReorderModalOpen] = useState(false)

  // 2. Yashirilgan fanlar ro'yxati
  const [hiddenFanlar, setHiddenFanlar] = useState<string[]>([])
  const [fanVisibilityModalOpen, setFanVisibilityModalOpen] = useState(false)

  // 3. Fanni alohida ochib baholash (Fokus rejimi)
  const [focusedFan, setFocusedFan] = useState<string | null>(null)

  // 4. O'qituvchiga ulashish modal holati
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [groupShares, setGroupShares] = useState<ShareLinkItem[]>([])
  const [sharesLoading, setSharesLoading] = useState(false)
  const [newShareFan, setNewShareFan] = useState('')
  const [newShareTeacher, setNewShareTeacher] = useState('')
  const [newShareHiddenPinfls, setNewShareHiddenPinfls] = useState<string[]>([])
  const [editingShare, setEditingShare] = useState<ShareLinkItem | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [shareBusy, setShareBusy] = useState(false)

  /* ---------------------------- Tanlov (guruh, semestr) ---------------------------- */

  useEffect(() => {
    const p = readPrefs()
    if (p.semestr && SEMESTRLAR.includes(p.semestr as never)) setSemestr(p.semestr)
    if (p.view === 'amaliyot') setView('amaliyot')
    if (p.birlik === 'reyting') setBirlik('reyting')
    setGuruh(p.guruh || '')
    setPrefsLoaded(true)
  }, [])

  useEffect(() => {
    if (!groups.length) return
    setGuruh((g) => (g && groups.includes(g) ? g : groups[0]))
  }, [groups])

  useEffect(() => {
    if (!prefsLoaded) return
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ guruh, semestr, view, birlik: birlikTanlov }))
    } catch {
      /* bo'sh */
    }
  }, [guruh, semestr, view, birlikTanlov, prefsLoaded])

  // Talabalarning maxsus tartibini yuklash: avval brauzer keshidan (tez), keyin serverdan (asosiy manba)
  useEffect(() => {
    if (!guruh) return
    let cancelled = false
    let local: string[] = []
    try {
      const raw = JSON.parse(localStorage.getItem(`baholar_order_${guruh}`) || '[]')
      if (Array.isArray(raw)) local = raw.filter((x): x is string => typeof x === 'string')
    } catch {
      /* bo'sh */
    }
    // Boshqa guruhning tartibi ko'rinib qolmasin
    setStudentOrder(local)
    fetch(`/api/baholar/order?guruh=${encodeURIComponent(guruh)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.ok || !Array.isArray(d.order)) return
        // Saqlanishi kutilayotgan o'zgarish bo'lsa serverdagi eski tartib uni bosib ketmasin
        if (orderSaveRef.current.timer && orderSaveRef.current.guruh === guruh) return
        captureRef.current()
        setStudentOrder(d.order)
        try {
          if (d.order.length) localStorage.setItem(`baholar_order_${guruh}`, JSON.stringify(d.order))
          else localStorage.removeItem(`baholar_order_${guruh}`)
        } catch {
          /* bo'sh */
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [guruh])

  // Yashirilgan fanlar keshini yuklash
  useEffect(() => {
    if (!guruh) return
    try {
      const local = localStorage.getItem(`baholar_hidden_fanlar_${guruh}_${semestr}`)
      if (local) setHiddenFanlar(JSON.parse(local))
      else setHiddenFanlar([])
    } catch {
      setHiddenFanlar([])
    }
  }, [guruh, semestr])

  const list = useMemo(() => students.filter((s) => s.group.trim() === guruh).sort(byName), [students, guruh])
  const baseRows = useMemo(() => list.filter((s) => s.pinfl), [list])
  const noPinfl = useMemo(() => list.filter((s) => !s.pinfl), [list])

  // Maxsus tartiblangan talabalar qatorlari
  const rows = useMemo(() => {
    if (!studentOrder.length) return baseRows
    const orderMap = new Map(studentOrder.map((pinfl, idx) => [pinfl, idx]))
    return [...baseRows].sort((a, b) => {
      const ai = orderMap.has(a.pinfl) ? orderMap.get(a.pinfl)! : 9999
      const bi = orderMap.has(b.pinfl) ? orderMap.get(b.pinfl)! : 9999
      if (ai !== bi) return ai - bi
      return fullName(a).localeCompare(fullName(b))
    })
  }, [baseRows, studentOrder])

  /** 2 yillik guruhlar faqat 5 ballik tizimda baholanadi — 100 ballik reyting ko'rsatilmaydi */
  const faqat5 = curriculumPlan
    ? /2\s*yillik/i.test(curriculumPlan.muddati || '')
    : rows.some((s) => /2\s*yillik/i.test(s.yon || ''))
  const birlik: Birlik = faqat5 ? 'ball5' : birlikTanlov

  /*
    Tartibni serverga yuborish kechiktiriladi (1,5 s): ketma-ket bir nechta ko'chirish bitta saqlash
    (GitHub'da bitta commit) bo'ladi. Guruh almashsa yoki sahifa yopilsa — darhol yuboriladi.
  */
  const orderSaveRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; guruh: string; order: string[] }>({
    timer: null,
    guruh: '',
    order: [],
  })

  const flushOrder = useCallback(async () => {
    const pending = orderSaveRef.current
    if (!pending.timer) return
    clearTimeout(pending.timer)
    pending.timer = null
    try {
      const res = await fetch('/api/baholar/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guruh: pending.guruh, order: pending.order }),
        keepalive: true,
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) throw new Error(d.error || `Server ${res.status} qaytardi`)
    } catch (e) {
      notify(`Tartib serverga saqlanmadi (faqat shu brauzerda saqlandi): ${(e as Error).message}`, 'warning')
    }
  }, [notify])

  const queueOrderSave = useCallback(
    (g: string, order: string[]) => {
      const pending = orderSaveRef.current
      if (pending.timer && pending.guruh !== g) void flushOrder()
      if (pending.timer) clearTimeout(pending.timer)
      pending.guruh = g
      pending.order = order
      pending.timer = setTimeout(() => void flushOrder(), 1500)
    },
    [flushOrder],
  )

  // Guruh almashganda yoki bo'limdan chiqilganda kutilayotgan tartibni yuborish
  useEffect(() => () => void flushOrder(), [guruh, flushOrder])
  useEffect(() => {
    const h = () => void flushOrder()
    window.addEventListener('pagehide', h)
    return () => window.removeEventListener('pagehide', h)
  }, [flushOrder])

  const saveOrderLocal = (g: string, order: string[]) => {
    try {
      if (order.length) localStorage.setItem(`baholar_order_${g}`, JSON.stringify(order))
      else localStorage.removeItem(`baholar_order_${g}`)
    } catch {
      /* bo'sh */
    }
  }

  // Talaba tartibini o'zgartirish
  const handleReorder = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= rows.length || toIdx >= rows.length) return
    const copy = [...rows]
    const [moved] = copy.splice(fromIdx, 1)
    copy.splice(toIdx, 0, moved)
    const newOrder = copy.map((s) => s.pinfl)
    setStudentOrder(newOrder)
    saveOrderLocal(guruh, newOrder)
    queueOrderSave(guruh, newOrder)
    // Ko'chirilgan qator bir lahza yumshoq belgilanadi (ko'zni chalg'itmaydi)
    setJustMovedPinfl(moved.pinfl)
    if (justMovedTimer.current) clearTimeout(justMovedTimer.current)
    justMovedTimer.current = setTimeout(() => setJustMovedPinfl(null), 900)
  }
  const justMovedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /*
    Animatsiyalar (Telegram uslubida): sudrashda boshqa qatorlar silliq surilib joy bo'shatadi,
    tugma bilan ko'chirishda / alifbo tiklashda qatorlar eski joyidan yangisiga suzib o'tadi.
  */
  const orderKey = useMemo(() => rows.map((s) => s.pinfl).join(','), [rows])
  const captureTable = useFlip(tableRef, orderKey)
  const captureModal = useFlip(reorderListRef, orderKey)
  const captureRef = useRef(() => {})
  captureRef.current = () => {
    captureTable()
    captureModal()
  }
  // Jadval ichki scrollsiz — sudrashda chetga yetganda sahifaning o'zi aylanadi
  const pageScrollRef = useRef<HTMLElement | null>(null)
  useEffect(() => { pageScrollRef.current = document.scrollingElement as HTMLElement | null }, [])
  const tableSort = useSortable({ containerRef: tableRef, scrollRef: pageScrollRef, onMove: handleReorder })
  const modalSort = useSortable({ containerRef: reorderListRef, onMove: handleReorder })

  /** Tugma bilan ko'chirish — silliq animatsiya bilan */
  const moveWithAnimation = (fromIdx: number, toIdx: number) => {
    captureRef.current()
    handleReorder(fromIdx, toIdx)
  }

  const handleResetOrder = () => {
    if (!studentOrder.length) return
    captureRef.current()
    setStudentOrder([])
    saveOrderLocal(guruh, [])
    queueOrderSave(guruh, [])
    notify("Talabalar tartibi alifbo bo'yicha qayta tiklandi", 'info')
  }

  const dirty = Object.keys(edits).length + Object.keys(amEdits).length
  const confirmLeave = useCallback(
    () => dirty === 0 || window.confirm("Saqlanmagan o'zgarishlar bor. Ular yo'qoladi. Davom etasizmi?"),
    [dirty],
  )
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  /* ---------------------------- Yuklash ---------------------------- */

  // Tez-tez guruh/semestr almashtirilganda eski so'rov javobi yangisini bosib ketmasin
  const loadSeq = useRef(0)
  const load = useCallback(async (): Promise<boolean> => {
    if (!guruh) return false
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/baholar?guruh=${encodeURIComponent(guruh)}&semestr=${semestr}`, {
        cache: 'no-store',
      })
      const body = await res.json().catch(() => ({}))
      if (seq !== loadSeq.current) return false
      if (!res.ok || !body.ok) {
        setData(null)
        setError({ text: body.error || `Server ${res.status} qaytardi`, setup: !!body.setup })
        return false
      }
      setData(body as BaholarPayload)
      resetEdits({})
      setAmEdits({})
      return true
    } catch (e) {
      if (seq !== loadSeq.current) return false
      setData(null)
      setError({ text: `Server bilan aloqa yo'q: ${(e as Error).message}`, setup: false })
      return false
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [guruh, semestr, resetEdits])

  useEffect(() => {
    if (prefsLoaded && guruh) void load()
  }, [load, prefsLoaded, guruh])

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch('/api/baholar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guruh, semestr, ...payload }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) throw new Error(body.error || `Server ${res.status} qaytardi`)
      return body as { ok: true; saved?: number; removed?: number }
    },
    [guruh, semestr],
  )

  /* ---------------------------- O'quv rejasini yuklash ---------------------------- */

  const loadCurriculum = useCallback(async (g: string) => {
    if (!g) {
      setCurriculumPlan(null)
      return
    }
    setCurriculumLoading(true)
    try {
      const res = await fetch(`/api/curriculum?guruh=${encodeURIComponent(g)}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (body.ok && body.plan) {
        setCurriculumPlan(body.plan)
      } else {
        setCurriculumPlan(null)
      }
    } catch {
      setCurriculumPlan(null)
    } finally {
      setCurriculumLoading(false)
    }
  }, [])

  useEffect(() => {
    if (guruh) void loadCurriculum(guruh)
  }, [guruh, loadCurriculum])

  // Fanlarni yangilash (Qo'yilgan baholar HECH QACHON o'chmaydi!)
  const handleUpdateSubjectsFromPlan = async () => {
    if (!curriculumPlan || !guruh) return
    const semSubjects = curriculumPlan.semestrlar?.[String(semestr)]?.fanlar || []
    if (!semSubjects.length) {
      notify(`O'quv rejasida ${semestr}-semestr uchun fanlar topilmadi`, 'error')
      return
    }

    setImportingPlan(true)
    const keepEdits = { ...edits }
    try {
      const res = await fetch('/api/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'syncSubjectsToGrades',
          guruh,
          semestr,
          fanlar: semSubjects.map((s, idx) => ({ nom: s.nom, tartib: s.tartib || idx + 1 })),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.ok) {
        notify("Fanlar ro'yxati yangilandi! Baholaringiz to'liq saqlanib qoldi.", 'success')
        // Kiritilgan, saqlanmagan baholarni saqlab qolish
        if ((await load()) && Object.keys(keepEdits).length > 0) resetEdits(keepEdits)
      } else {
        notify(body.error || 'Yangilashda xatolik', 'error')
      }
    } catch (e) {
      notify(`Xatolik: ${(e as Error).message}`, 'error')
    } finally {
      setImportingPlan(false)
    }
  }

  /* ---------------------------- Fanlar va Baholar ---------------------------- */

  const fanlar: Fan[] = data?.fanlar ?? []

  // Ko'rinadigan fanlar (yashirilmaganlari)
  const visibleFanlar = useMemo(() => {
    return fanlar.filter((f) => !hiddenFanlar.includes(f.nom))
  }, [fanlar, hiddenFanlar])

  const storeHidden = (next: string[]) => {
    try {
      if (next.length) localStorage.setItem(`baholar_hidden_fanlar_${guruh}_${semestr}`, JSON.stringify(next))
      else localStorage.removeItem(`baholar_hidden_fanlar_${guruh}_${semestr}`)
    } catch {
      /* bo'sh */
    }
  }
  const toggleHideFan = (fanNom: string) => {
    const next = hiddenFanlar.includes(fanNom) ? hiddenFanlar.filter((n) => n !== fanNom) : [...hiddenFanlar, fanNom]
    setHiddenFanlar(next)
    storeHidden(next)
  }

  const showAllFanlar = () => {
    setHiddenFanlar([])
    try {
      localStorage.removeItem(`baholar_hidden_fanlar_${guruh}_${semestr}`)
    } catch {
      /* bo'sh */
    }
    notify("Barcha fanlar ko'rinishga chiqarildi", 'info')
  }

  const bahoMap = useMemo(() => {
    const m = new Map<string, BahoRow>()
    for (const b of data?.baholar ?? []) m.set(`${b.pinfl}|${b.fan}`, b)
    return m
  }, [data])

  const serverText = useCallback(
    (pinfl: string, fan: string, key: Kiritiladigan) => bahoText(bahoMap.get(`${pinfl}|${fan}`)?.[key]),
    [bahoMap],
  )
  const shown = useCallback(
    (pinfl: string, fan: string, key: Kiritiladigan) =>
      edits[`${pinfl}|${fan}|${key}`] ?? serverText(pinfl, fan, key),
    [edits, serverText],
  )

  /** Har bir talaba × fan uchun baholar va reyting. */
  const calc = useMemo(() => {
    const m = new Map<string, Calc>()
    for (const s of rows) {
      for (const f of fanlar) {
        const key = `${s.pinfl}|${f.nom}`
        const stored = bahoMap.get(key)
        const g = { yakuniy: null, joriy: null, oraliq: null, r_semestr: null } as Record<
          Kiritiladigan,
          number | null
        >
        for (const k of KIRITILADIGAN) {
          const v = parseBaho(edits[`${key}|${k}`] ?? bahoText(stored?.[k]))
          g[k] = v === undefined ? null : v
        }
        const rey: Reyting = hisoblaReyting(reytingSeed(s.pinfl, semestr, f.nom), g)
        m.set(key, { g, rey })
      }
    }
    return m
  }, [rows, fanlar, bahoMap, edits, semestr])

  /* ---------------------------- Undo / Redo Tizimi ---------------------------- */

  /** Bir nechta katakni bitta qadamda o'zgartirish (Undo tarixiga bitta yozuv) */
  const setCells = (cells: { pinfl: string; fan: string; key: Kiritiladigan; value: string }[]) => {
    applyEdits((prev) => {
      const next = { ...prev }
      for (const c of cells) {
        const k = `${c.pinfl}|${c.fan}|${c.key}`
        const v = c.value.trim()
        if (v === serverText(c.pinfl, c.fan, c.key)) delete next[k]
        else next[k] = v
      }
      return next
    })
  }
  const setCell = (pinfl: string, fan: string, key: Kiritiladigan, value: string) =>
    setCells([{ pinfl, fan, key, value }])

  /** Fandagi bir ustun baholarini (masalan Yakuniy) boshqa ustun(lar)ga ko'chirish — bitta Undo qadami */
  const copyColumn = (fan: string, from: Kiritiladigan, to: Kiritiladigan[], onlyEmpty: boolean) => {
    const cells: { pinfl: string; fan: string; key: Kiritiladigan; value: string }[] = []
    for (const s of rows) {
      const v = shown(s.pinfl, fan, from).trim()
      if (!v || parseBaho(v) === undefined) continue
      for (const k of to) {
        const cur = shown(s.pinfl, fan, k).trim()
        if (cur === v || (onlyEmpty && cur)) continue
        cells.push({ pinfl: s.pinfl, fan, key: k, value: v })
      }
    }
    const nomlar = to.map((k) => BAHO_TURLARI.find((t) => t.key === k)?.label).join(', ')
    const from_ = BAHO_TURLARI.find((t) => t.key === from)?.label
    if (!cells.length) {
      notify(`«${fan}»: ko'chiriladigan baho yo'q — ${from_} bo'sh yoki ${nomlar} allaqachon bir xil`, 'info')
      return
    }
    setCells(cells)
    notify(`«${fan}»: ${from_} → ${nomlar} — ${cells.length} ta katak to'ldirildi. Saqlashni unutmang (Ctrl+Z — bekor qilish)`, 'success')
  }

  const invalidCount = useMemo(
    () => Object.values(edits).filter((v) => parseBaho(v) === undefined).length,
    [edits],
  )

  const amInvalid = useMemo(
    () => Object.entries(amEdits).filter(([k, v]) => k.endsWith('|ball') && parseBaho(v) === undefined).length,
    [amEdits],
  )

  const savingRef = useRef(false)
  const saveBaholar = useCallback(async () => {
    if (savingRef.current || !Object.keys(edits).length) return
    if (invalidCount) {
      notify("Noto'g'ri baholar bor (qizil katak): faqat 2, 3, 4 yoki 5", 'error')
      return
    }
    // Kalit: pinfl|fan|tur — fan nomida "|" bo'lsa ham to'g'ri ajratiladi (pinfl boshida, tur oxirida)
    const pairs = new Map<string, { pinfl: string; fan: string }>()
    for (const k of Object.keys(edits)) {
      const pinfl = k.slice(0, k.indexOf('|'))
      const fan = k.slice(k.indexOf('|') + 1, k.lastIndexOf('|'))
      pairs.set(`${pinfl}|${fan}`, { pinfl, fan })
    }
    const items = [...pairs.values()].map(({ pinfl, fan }) => {
      const item: Record<string, string> = { pinfl, fan }
      for (const k of KIRITILADIGAN) item[k] = shown(pinfl, fan, k)
      return item
    })
    savingRef.current = true
    setSaving(true)
    try {
      await post({ action: 'saveBaholar', items })
      notify(`${items.length} ta qator muvaffaqiyatli saqlandi!`, 'success')
      const keepAm = amEdits
      const ok = await load()
      if (ok && Object.keys(keepAm).length) setAmEdits(keepAm)
      if (!ok) notify("Baholar saqlandi, lekin jadvalni qayta yuklab bo'lmadi — sahifani yangilang", 'warning')
    } catch (e) {
      // Tahrirlar o'chmaydi — xatoni tuzatib qayta saqlash mumkin
      notify(`Saqlanmadi: ${(e as Error).message}. O'zgarishlaringiz jadvalda qoldi, qayta urinib ko'ring.`, 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [invalidCount, edits, amEdits, shown, post, notify, load])

  const canSaveBaholar = Object.keys(edits).length > 0 && !invalidCount
  const canSaveAm = Object.keys(amEdits).length > 0 && !amInvalid
  const canSave = view === 'baholar' ? canSaveBaholar : canSaveAm

  /* ---------------------------- Global Tezkor Klavishlar (MS Office / Excel) ---------------------------- */

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null
      const isInput = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA'
      const isCellInput = activeEl?.hasAttribute('data-cell')

      // Ochiq oynalarni Escape bilan yopish
      if (e.key === 'Escape' && !isCellInput) {
        if (tableSort.dragKey || modalSort.dragKey) return // sudrash bekor qilinadi, oyna yopilmaydi
        if (shareModalOpen) setShareModalOpen(false)
        else if (fanVisibilityModalOpen) setFanVisibilityModalOpen(false)
        else if (reorderModalOpen) setReorderModalOpen(false)
        else if (focusedFan) setFocusedFan(null)
        return
      }

      // 1. Ctrl + S: Tezkor saqlash (baholar ham, amaliyot ham)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (saving) return
        if (focusedFan || view === 'baholar') {
          if (canSaveBaholar) void saveBaholar()
          else if (invalidCount) notify("Noto'g'ri baholar bor (qizil katak): faqat 2, 3, 4 yoki 5", 'error')
        } else if (canSaveAm) void saveAmaliyotRef.current()
        else if (amInvalid) notify("Noto'g'ri baho bor (qizil katak): faqat 2, 3, 4 yoki 5", 'error')
        return
      }

      // Undo/Redo faqat baholar jadvali uchun (amaliyotda brauzerning o'zi ishlaydi)
      if (view !== 'baholar' && !focusedFan) return

      // 2. Ctrl + Z: Bekor qilish (Undo)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (isInput && !isCellInput) return
        e.preventDefault()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
        return
      }

      // 3. Ctrl + Y: Qaytarish (Redo)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (isInput && !isCellInput) return
        e.preventDefault()
        handleRedo()
        return
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [
    handleUndo,
    handleRedo,
    canSaveBaholar,
    canSaveAm,
    invalidCount,
    amInvalid,
    saving,
    view,
    saveBaholar,
    notify,
    shareModalOpen,
    fanVisibilityModalOpen,
    reorderModalOpen,
    focusedFan,
    tableSort.dragKey,
    modalSort.dragKey,
  ])

  /* ---------------------------- Kataklararo Harakatlanish va Excel Paste ---------------------------- */

  const cellColsMap = useMemo(() => {
    const arr: { fan: string; key: Kiritiladigan }[] = []
    for (const f of visibleFanlar) {
      arr.push({ fan: f.nom, key: 'yakuniy' })
      arr.push({ fan: f.nom, key: 'joriy' })
      arr.push({ fan: f.nom, key: 'oraliq' })
      arr.push({ fan: f.nom, key: 'r_semestr' })
    }
    return arr
  }, [visibleFanlar])

  const onCellKey = (
    e: React.KeyboardEvent<HTMLInputElement>,
    r: number,
    c: number,
    totalCols: number,
    refContainer: React.RefObject<HTMLDivElement | null>,
  ) => {
    let nextR = r
    let nextC = c

    if (e.key === 'ArrowDown') {
      nextR = r + 1
    } else if (e.key === 'ArrowUp') {
      nextR = r - 1
    } else if (e.key === 'ArrowRight') {
      nextC = c + 1
      if (nextC >= totalCols && r + 1 < rows.length) {
        nextC = 0
        nextR = r + 1
      }
    } else if (e.key === 'ArrowLeft') {
      nextC = c - 1
      if (nextC < 0 && r > 0) {
        nextC = totalCols - 1
        nextR = r - 1
      }
    } else if (e.key === 'Enter') {
      // Excel uslubi: Enter pastga, Shift+Enter tepaga
      nextR = e.shiftKey ? r - 1 : r + 1
    } else if (e.key === 'Tab') {
      // Excel uslubi: Tab o'ngga, Shift+Tab chapga
      nextC = e.shiftKey ? c - 1 : c + 1
      if (nextC >= totalCols && r + 1 < rows.length) {
        nextC = 0
        nextR = r + 1
      } else if (nextC < 0 && r > 0) {
        nextC = totalCols - 1
        nextR = r - 1
      }
    } else if (e.key === 'Home') {
      if (e.ctrlKey) {
        nextR = 0
        nextC = 0
      } else {
        nextC = 0
      }
    } else if (e.key === 'End') {
      if (e.ctrlKey) {
        nextR = rows.length - 1
        nextC = totalCols - 1
      } else {
        nextC = totalCols - 1
      }
    } else if (e.key === 'PageDown') {
      nextR = Math.min(r + 10, rows.length - 1)
    } else if (e.key === 'PageUp') {
      nextR = Math.max(r - 10, 0)
    } else if (e.key === 'Escape') {
      e.currentTarget.blur()
      return
    } else {
      return
    }

    if (nextR >= 0 && nextR < rows.length && nextC >= 0 && nextC < totalCols) {
      e.preventDefault()
      const target = refContainer.current?.querySelector<HTMLInputElement>(
        `[data-cell="${nextR}:${nextC}"]`,
      )
      if (target) {
        target.focus()
        target.select()
      }
    }
  }

  // Excel'dan ko'chirilgan ustun/satr baholarni to'g'ridan-to'g'ri jadvalga joylash (Paste)
  const handlePaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    startR: number,
    startC: number,
    colsList: { fan: string; key: Kiritiladigan }[],
  ) => {
    const grid = parseClipboardGrid(e.clipboardData.getData('text'))
    if (!grid.length) return
    e.preventDefault()
    const cells: { pinfl: string; fan: string; key: Kiritiladigan; value: string }[] = []
    let skipped = 0
    grid.forEach((line, rOffset) => {
      const row = rows[startR + rOffset]
      if (!row) return
      line.forEach((raw, cOffset) => {
        const col = colsList[startC + cOffset]
        if (!col) return
        const v = raw.trim()
        if (!v) return // bo'sh katak — mavjud bahoga tegilmaydi
        const p = parseBaho(v)
        if (p === undefined || p === null) {
          skipped++
          return
        }
        cells.push({ pinfl: row.pinfl, fan: col.fan, key: col.key, value: String(p) })
      })
    })
    if (cells.length) setCells(cells)
    if (cells.length > 1 || skipped) {
      notify(
        `${cells.length} ta baho joylandi${skipped ? `, ${skipped} ta noto'g'ri qiymat o'tkazib yuborildi (faqat 2–5)` : ''}`,
        skipped ? 'warning' : 'success',
      )
    }
  }

  const addFan = async () => {
    const nom = newFan.trim()
    if (!nom) return
    if (fanlar.some((f) => f.nom.toLowerCase() === nom.toLowerCase())) {
      notify(`"${nom}" fani allaqachon mavjud`, 'warning')
      return
    }
    try {
      await post({ action: 'addFan', nom })
      setNewFan('')
      const keep = edits
      if (await load()) resetEdits(keep)
      notify(`"${nom}" fani qo'shildi`, 'success')
    } catch (e) {
      notify(`Fan qo'shilmadi: ${(e as Error).message}`, 'error')
    }
  }

  const deleteFan = async (nom: string) => {
    const count = (data?.baholar ?? []).filter((b) => b.fan === nom).length
    if (
      !window.confirm(
        `"${nom}" fani o'chirilsinmi?${count ? ` Unga kiritilgan ${count} ta talabaning baholari ham o'chadi.` : ''}`,
      )
    )
      return
    try {
      await post({ action: 'deleteFan', nom })
      const keep = Object.fromEntries(Object.entries(edits).filter(([k]) => !k.includes(`|${nom}|`)))
      if (await load()) resetEdits(keep)
      if (hiddenFanlar.includes(nom)) {
        const next = hiddenFanlar.filter((n) => n !== nom)
        setHiddenFanlar(next)
        storeHidden(next)
      }
      if (focusedFan === nom) setFocusedFan(null)
      notify(`"${nom}" fani o'chirildi`, 'warning')
    } catch (e) {
      notify(`O'chirilmadi: ${(e as Error).message}`, 'error')
    }
  }

  /** Jadvalda ko'rsatiladigan son: 5 ball yoki reyting */
  const cellValue = (c: Calc | undefined, key: (typeof BAHO_TURLARI)[number]['key']): number | null => {
    if (!c) return null
    if (birlik === 'reyting') {
      return key === 'yakuniy'
        ? c.rey.yakuniy100
        : key === 'joriy'
          ? c.rey.joriy100
          : key === 'oraliq'
            ? c.rey.oraliq100
            : c.rey.r100
    }
    return key === 'r_semestr' ? c.g.r_semestr ?? c.rey.r_semestr : c.g[key]
  }

  const fmt = (v: number | null) => (v === null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1))
  const rangOf = (v: number | null) =>
    v === null ? 'text-fg-subtle' : BAHO_RANG[birlik === 'reyting' ? bahoOf(v) : Math.round(v)] ?? ''

  /* ---------------------------- Malakaviy amaliyot ---------------------------- */

  const amNoms = useMemo(() => {
    const s = new Set((data?.amaliyot ?? []).map((a) => a.nom))
    s.add(amNom)
    return [...s]
  }, [data, amNom])

  useEffect(() => {
    const noms = (data?.amaliyot ?? []).map((a) => a.nom)
    if (noms.length && !noms.includes(amNom) && amNom === DEFAULT_AMALIYOT) setAmNom(noms[0])
  }, [data, amNom])

  const amMap = useMemo(() => {
    const m = new Map<string, AmaliyotRow>()
    for (const a of data?.amaliyot ?? []) m.set(`${a.pinfl}|${a.nom}`, a)
    return m
  }, [data])

  const amServer = useCallback(
    (pinfl: string, f: AmField, nom = amNom): string => {
      const r = amMap.get(`${pinfl}|${nom}`)
      return r ? (f === 'ball' ? bahoText(r.ball) : r[f]) : ''
    },
    [amMap, amNom],
  )
  const amShown = (pinfl: string, f: AmField) => amEdits[`${pinfl}|${f}`] ?? amServer(pinfl, f)
  const setAm = (pinfl: string, f: AmField, value: string) => {
    const k = `${pinfl}|${f}`
    setAmEdits((e) => {
      const next = { ...e }
      if (value.trim() === amServer(pinfl, f)) delete next[k]
      else next[k] = value
      return next
    })
  }

  const amReyting = (pinfl: string): number | null => {
    const edited = `${pinfl}|ball` in amEdits
    if (!edited) return amMap.get(`${pinfl}|${amNom}`)?.ball100 ?? null
    const b = parseBaho(amEdits[`${pinfl}|ball`])
    return b === undefined ? null : amaliyotReyting(`${pinfl}|${semestr}|${amNom}`, b)
  }

  const pickAm = (nom: string) => {
    if (nom === amNom) return
    if (!confirmLeave()) return
    setAmEdits({})
    setAmNom(nom)
  }
  const createAm = () => {
    const nom = newAm.trim()
    if (!nom) return
    if (!confirmLeave()) return
    setAmEdits({})
    setAmNom(nom)
    setNewAm('')
  }

  const applyBulk = () => {
    setAmEdits((e) => {
      const next = { ...e }
      for (const s of rows) {
        for (const f of ['joy', 'boshlanish', 'tugash'] as const) {
          const v = bulk[f].trim()
          if (!v) continue
          const k = `${s.pinfl}|${f}`
          if (v === amServer(s.pinfl, f)) delete next[k]
          else next[k] = v
        }
      }
      return next
    })
  }

  const saveAmaliyot = async () => {
    if (savingRef.current || !Object.keys(amEdits).length) return
    if (amInvalid) {
      notify("Noto'g'ri baho bor (qizil katak): faqat 2, 3, 4 yoki 5", 'error')
      return
    }
    const pinfls = new Set(Object.keys(amEdits).map((k) => k.split('|')[0]))
    const items = [...pinfls].map((pinfl) => {
      const item: Record<string, string> = { pinfl }
      for (const f of AM_FIELDS) item[f] = amShown(pinfl, f)
      return item
    })
    savingRef.current = true
    setSaving(true)
    try {
      await post({ action: 'saveAmaliyot', nom: amNom, items })
      notify(`${items.length} ta qator saqlandi`, 'success')
      // Baholar jadvalidagi saqlanmagan tahrirlar yo'qolmasin
      const keep = edits
      if ((await load()) && Object.keys(keep).length) resetEdits(keep)
    } catch (e) {
      notify(`Saqlanmadi: ${(e as Error).message}. O'zgarishlaringiz jadvalda qoldi.`, 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const saveAmaliyotRef = useRef(saveAmaliyot)
  saveAmaliyotRef.current = saveAmaliyot

  /* ---------------------------- Excel Eksport ---------------------------- */

  const [exportOpen, setExportOpen] = useState(false)
  const joriyFanNomlari = useMemo(() => fanlar.map((f) => f.nom), [fanlar])

  /**
   * Tanlangan semestr bo'yicha eksport. Fanlar — o'quv rejaning shu semestri (boshqa semestr fanlari
   * aralashmaydi); reja bo'lmasa — semestrdagi baholar jadvali fanlari. Ochiq turgan semestr saqlanmagan
   * tahrirlar bilan olinadi, boshqasi serverdan yuklanadi. Talabalarning hech biri tushib qolmaydi.
   */
  const onExport = async ({ semestr: sem, turi, fanlar: tanlangan }: ExportTanlov) => {
    const talabalar = [...rows, ...noPinfl]
    const planFanlar = [...(curriculumPlan?.semestrlar?.[String(sem)]?.fanlar ?? [])]
      .sort((x, y) => x.tartib - y.tartib)
      .map((f) => f.nom)

    const toExport = (g: Record<Kiritiladigan, number | null>, rey: Reyting): ExportGrade => ({
      y: g.yakuniy, j: g.joriy, o: g.oraliq, r: g.r_semestr ?? rey.r_semestr,
      y100: rey.yakuniy100, j100: rey.joriy100, o100: rey.oraliq100, r100: rey.r100,
    })
    const fromRow = (stored: BahoRow | undefined, pinfl: string, fan: string): ExportGrade => {
      const g = { yakuniy: null, joriy: null, oraliq: null, r_semestr: null } as Record<Kiritiladigan, number | null>
      for (const k of KIRITILADIGAN) g[k] = stored?.[k] ?? null
      return toExport(g, hisoblaReyting(reytingSeed(pinfl, sem, fan), g))
    }
    const BOSH: ExportGrade = { y: null, j: null, o: null, r: null, y100: null, j100: null, o100: null, r100: null }

    let semFanlar: string[]
    let gradeOf: (pinfl: string, fan: string) => ExportGrade
    const amaliyot: ExportAmaliyot[] = []
    const amBosh = (name: string, nom: string): ExportAmaliyot => ({ name, nom, joy: '', boshlanish: '', tugash: '', ball: null, ball100: null, izoh: '' })

    if (sem === semestr) {
      semFanlar = planFanlar.length ? planFanlar : fanlar.map((f) => f.nom)
      gradeOf = (pinfl, fan) => {
        const c = calc.get(`${pinfl}|${fan}`)
        return c ? toExport(c.g, c.rey) : fromRow(bahoMap.get(`${pinfl}|${fan}`), pinfl, fan)
      }
      for (const nom of amNoms) {
        for (const s of talabalar) {
          if (!s.pinfl) { amaliyot.push(amBosh(fullName(s), nom)); continue }
          const cur = nom === amNom
          const get = (f: AmField) => (cur ? amShown(s.pinfl, f) : amServer(s.pinfl, f, nom))
          const ball = parseBaho(get('ball'))
          amaliyot.push({
            name: fullName(s), nom,
            joy: get('joy'), boshlanish: get('boshlanish'), tugash: get('tugash'),
            ball: ball === undefined ? null : ball,
            ball100: cur ? amReyting(s.pinfl) : (amMap.get(`${s.pinfl}|${nom}`)?.ball100 ?? null),
            izoh: get('izoh'),
          })
        }
      }
    } else {
      const res = await fetch(`/api/baholar?guruh=${encodeURIComponent(guruh)}&semestr=${sem}`, { cache: 'no-store' })
      const body = (await res.json().catch(() => ({}))) as Partial<BaholarPayload> & { error?: string }
      if (!res.ok || !body.ok) throw new Error(body.error || `Server ${res.status} qaytardi`)
      const bm = new Map((body.baholar ?? []).map((r) => [`${r.pinfl}|${r.fan}`, r]))
      semFanlar = planFanlar.length ? planFanlar : (body.fanlar ?? []).map((f) => f.nom)
      gradeOf = (pinfl, fan) => fromRow(bm.get(`${pinfl}|${fan}`), pinfl, fan)
      const am = body.amaliyot ?? []
      const noms = [...new Set(am.map((x) => x.nom))]
      const amM = new Map(am.map((x) => [`${x.pinfl}|${x.nom}`, x]))
      for (const nom of noms.length ? noms : [DEFAULT_AMALIYOT]) {
        for (const s of talabalar) {
          const x = s.pinfl ? amM.get(`${s.pinfl}|${nom}`) : undefined
          amaliyot.push(x ? { name: fullName(s), nom, joy: x.joy, boshlanish: x.boshlanish, tugash: x.tugash, ball: x.ball, ball100: x.ball100, izoh: x.izoh } : amBosh(fullName(s), nom))
        }
      }
    }

    const yillik = talabalar.map((s) => /(\d)\s*yillik/i.exec(s.yon || '')?.[1]).find(Boolean)
    const d: BaholarExportData = {
      guruh,
      semestr: sem,
      rahbar: GROUP_SETTINGS[guruh]?.rahbar ?? '',
      davomiylik: curriculumPlan?.muddati || (yillik ? `${yillik} yillik` : ''),
      talabalar: talabalar.map((s) => ({ name: fullName(s) })),
      fanlar: turi === 'qaydnoma' && tanlangan.length ? tanlangan : semFanlar,
      grade: (i, fan) => (talabalar[i].pinfl ? gradeOf(talabalar[i].pinfl, fan) : BOSH),
      amaliyot,
      faqat5,
    }
    if (turi === 'baza') await exportBaza(d)
    else if (turi === 'qaydnoma') await exportQaydnomalar(d)
    else await exportHisobot(d)
    notify(`Excel fayl yuklandi: ${sem}-semestr, ${d.fanlar.length} ta fan`)
  }

  /* ---------------------------- O'qituvchiga ulashish boshqaruvi ---------------------------- */

  const loadGroupShares = useCallback(async () => {
    if (!guruh) return
    setSharesLoading(true)
    try {
      const res = await fetch(
        `/api/baholar/share?action=list&guruh=${encodeURIComponent(guruh)}&semestr=${semestr}`,
        { cache: 'no-store' },
      )
      const d = await res.json().catch(() => ({}))
      if (d.ok && Array.isArray(d.shares)) setGroupShares(d.shares)
      else notify(`Havolalar ro'yxati yuklanmadi: ${d.error || `Server ${res.status}`}`, 'error')
    } catch (e) {
      notify(`Havolalar ro'yxati yuklanmadi: ${(e as Error).message}`, 'error')
    } finally {
      setSharesLoading(false)
    }
  }, [guruh, semestr, notify])

  const openShareModal = () => {
    // Odatiy tanlov — barcha fanlar (o'qituvchi hammasini bitta havolada baholaydi)
    setNewShareFan(ALL_FANS)
    setNewShareTeacher('')
    setNewShareHiddenPinfls([])
    setEditingShare(null)
    setShareModalOpen(true)
    void loadGroupShares()
  }

  const handleCreateOrUpdateShare = async () => {
    if (!newShareFan) {
      notify('Fanni tanlang', 'error')
      return
    }

    setShareBusy(true)
    try {
      const allFanlar = newShareFan === ALL_FANS
      const common = {
        fan: allFanlar ? '' : newShareFan,
        allFanlar,
        teacherName: newShareTeacher,
        hiddenPinfls: newShareHiddenPinfls,
      }
      const payload = editingShare
        ? { action: 'update', id: editingShare.id, ...common }
        : { action: 'create', guruh, semestr, ...common }

      const res = await fetch('/api/baholar/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json().catch(() => ({}))
      if (d.ok) {
        notify(
          editingShare ? 'Ulashish sozlamalari yangilandi!' : "O'qituvchi uchun yangi havola yaratildi!",
          'success',
        )
        setEditingShare(null)
        setNewShareTeacher('')
        setNewShareHiddenPinfls([])
        await loadGroupShares()
        if (!editingShare && d.share?.token) void copyShareLink(d.share.token)
      } else {
        notify(d.error || `Xatolik yuz berdi (server ${res.status})`, 'error')
      }
    } catch (e) {
      notify(`Xatolik: ${(e as Error).message}`, 'error')
    } finally {
      setShareBusy(false)
    }
  }

  const handleDeleteShare = async (id: string) => {
    if (!confirm("Haqiqatan ham ushbu ulashish havolasini o'chirmoqchimisiz?")) return
    try {
      const res = await fetch('/api/baholar/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      })
      const d = await res.json().catch(() => ({}))
      if (d.ok) {
        notify("Havola o'chirildi", 'info')
        if (editingShare?.id === id) setEditingShare(null)
        await loadGroupShares()
      } else {
        notify(d.error || "Havola o'chirilmadi", 'error')
      }
    } catch (e) {
      notify(`Xatolik: ${(e as Error).message}`, 'error')
    }
  }

  const copyShareLink = async (token: string) => {
    const url = `${window.location.origin}/baholar/ulashilgan?token=${encodeURIComponent(token)}`
    let ok = false
    try {
      await navigator.clipboard.writeText(url)
      ok = true
    } catch {
      // HTTP (localhost emas) yoki ruxsat yo'q — eski usul
      try {
        const ta = document.createElement('textarea')
        ta.value = url
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        ta.remove()
      } catch {
        ok = false
      }
    }
    if (ok) {
      setCopiedToken(token)
      notify("O'qituvchi havolasi nusxalandi!", 'success')
      setTimeout(() => setCopiedToken(null), 3000)
    } else {
      window.prompt("Havolani nusxalang (Ctrl+C):", url)
    }
  }

  const groupsByKurs = useMemo(() => {
    const m = new Map<number, string[]>()
    for (const g of groups) m.set(kursOf(g) ?? 0, [...(m.get(kursOf(g) ?? 0) ?? []), g])
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [groups])

  return (
    <div className="space-y-4">
      {/* Yuqori Panel: Guruh, Semestr, Rejimlar, Undo/Redo va Asosiy boshqaruv */}
      <div className="panel space-y-3 p-3 sm:p-3.5">
        {/* 1366 da ham bitta qatorga sig'adi: tanlagichlar ixcham, rejim nomlari 2xl dan kichikda qisqa */}
        <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-end">
          <div className="sm:w-32">
            <label className="label" htmlFor="b-guruh">
              Guruh
            </label>
            <select
              id="b-guruh"
              className="field h-9 cursor-pointer py-1.5 font-bold"
              value={guruh}
              onChange={(e) => {
                if (confirmLeave()) setGuruh(e.target.value)
              }}
            >
              {groupsByKurs.map(([k, gs]) => (
                <optgroup key={k} label={k ? `${k}-kurs` : 'Boshqa'}>
                  {gs.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="sm:w-32">
            <label className="label" htmlFor="b-sem">
              Semestr
            </label>
            <select
              id="b-sem"
              className="field h-9 cursor-pointer py-1.5 font-bold"
              value={semestr}
              onChange={(e) => {
                if (confirmLeave()) setSemestr(Number(e.target.value))
              }}
            >
              {SEMESTRLAR.map((s) => (
                <option key={s} value={s}>
                  {s}-semestr
                </option>
              ))}
            </select>
          </div>

          <div className="seg col-span-2 flex h-9 sm:col-span-1">
            {(
              [
                ['baholar', ClipboardList, "Fanlar bo'yicha baholar", 'Baholar'],
                ['amaliyot', Briefcase, 'Malakaviy amaliyot', 'Amaliyot'],
              ] as const
            ).map(([v, Icon, t, short]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className="seg-btn h-full flex-1 px-3 sm:flex-none"
              >
                <Icon size={15} className={cx('shrink-0', view === v && 'text-sky')} />
                <span className="2xl:hidden">{short}</span>
                <span className="hidden 2xl:inline">{t}</span>
              </button>
            ))}
          </div>

          <div className="col-span-2 flex items-center gap-1.5 sm:gap-2 sm:ml-auto sm:col-span-1 flex-wrap">
            {/* Bekor qilish (Undo) va Qaytarish (Redo) tugmalari */}
            {view === 'baholar' && (
              <div className="seg h-9">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!history.canUndo}
                  className="grid size-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg disabled:opacity-25"
                  title="Bekor qilish (Ctrl + Z)"
                  aria-label="Bekor qilish"
                >
                  <Undo2 size={15} />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={!history.canRedo}
                  className="grid size-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg disabled:opacity-25"
                  title="Qaytarish (Ctrl + Y yoki Ctrl + Shift + Z)"
                  aria-label="Qaytarish"
                >
                  <Redo2 size={15} />
                </button>
              </div>
            )}

            {dirty > 0 && (
              <span className="chip border-amber/50 bg-amber/10 text-amber font-bold">
                {dirty} ta o'zgarish
              </span>
            )}

            {/* O'qituvchiga ulashish tugmasi */}
            {view === 'baholar' && (
              <button
                type="button"
                onClick={openShareModal}
                disabled={!fanlar.length}
                className="btn-ghost h-9 px-3 text-sky-soft"
                title="Fan o'qituvchisiga baho qo'yishi uchun havola ulashish"
              >
                <Share2 size={14} className="text-sky" />
                <span>Ulashish</span>
              </button>
            )}

            <button
              type="button"
              className="btn-ghost h-9 px-3"
              onClick={() => setExportOpen(true)}
              disabled={!data || !rows.length}
              title="Excelga yuklab olish: semestr va fayl turini tanlaysiz"
            >
              <FileSpreadsheet size={15} />
              <span className="hidden sm:inline">Excel</span>
            </button>

            <button
              type="button"
              className="btn-success h-9 px-4"
              onClick={view === 'baholar' ? saveBaholar : saveAmaliyot}
              disabled={!canSave || saving}
              title="Saqlash (Ctrl + S)"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              <span>Saqlash</span>
            </button>
          </div>
        </div>

        {noPinfl.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              JSHSHIR kiritilmagan talabalarga baho yozib bo'lmaydi ({noPinfl.length} ta):{' '}
              {noPinfl.map(fullName).join(', ')}.
            </span>
          </div>
        )}
      </div>

      {error?.setup && (
        <div className="panel space-y-3 border-amber/40 bg-amber/5 p-4 sm:p-5">
          <div className="flex items-center gap-2 text-[14px] font-bold text-amber">
            <Database size={16} /> Baholar jadvallari hali yaratilmagan
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-[13px] text-fg-muted">
            <li>
              Supabase panelida <b className="text-fg">SQL Editor</b> ni oching.
            </li>
            <li>
              <code className="mono rounded bg-ink-800 px-1.5 py-0.5 text-sky-soft">
                web/supabase/baholar.sql
              </code>{' '}
              faylini ishga tushiring.
            </li>
          </ol>
          <button type="button" className="btn-primary h-9 px-4" onClick={load}>
            Qayta tekshirish
          </button>
        </div>
      )}

      {error && !error.setup && (
        <div className="panel flex flex-wrap items-center gap-3 border-rose/40 bg-rose/5 p-4 text-[13px] text-rose">
          <AlertTriangle size={16} /> <span className="min-w-0 flex-1">{error.text}</span>
          <button type="button" className="btn-ghost h-9 px-3" onClick={load}>
            Qayta urinish
          </button>
        </div>
      )}

      {loading && !data && !error && (
        <div className="panel flex items-center justify-center gap-2 px-4 py-16 text-[13px] text-fg-muted">
          <Loader2 size={18} className="animate-spin text-sky" />
          <span>Baholar yuklanmoqda…</span>
        </div>
      )}

      {data && view === 'baholar' && (
        <div className="panel overflow-clip border-line bg-ink-900/60 shadow-xl">
          {/* Sub-Header: Holat, Fanlar yangilash, Fanlar filtri, Reyting/5-ball switch va Fan qo'shish */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line p-3 bg-ink-950/40">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-[13.5px] font-extrabold text-fg">
                {guruh} · {semestr}-semestr
              </div>
              <span className="chip border-line bg-ink-800/80 text-fg-muted font-bold text-[11px]">
                {rows.length} talaba
              </span>
              <span className="chip border-line bg-ink-800/80 text-fg-muted font-bold text-[11px]">
                {fanlar.length} fan
              </span>

              {/* Fanlarni yangilash tugmasi (Mavjud baholarga tegilmaydi!) */}
              {curriculumPlan && curriculumPlan.semestrlar?.[String(semestr)]?.fanlar?.length ? (
                <button
                  type="button"
                  onClick={handleUpdateSubjectsFromPlan}
                  disabled={importingPlan}
                  className="chip border-sky/40 bg-sky/10 text-sky-soft text-[11px] font-bold hover:bg-sky/20 transition-colors flex items-center gap-1.5"
                  title="O'quv rejasidagi yangi fanlarni qo'shish (mavjud baholar o'chmaydi)"
                >
                  <RefreshCw size={11} className={cx(importingPlan && 'animate-spin text-sky')} />
                  <span>Fanlarni yangilash</span>
                </button>
              ) : null}

              {/* Fanlarni ko'rish / yashirish menyusi */}
              {fanlar.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFanVisibilityModalOpen(true)}
                  className={cx(
                    'chip font-bold text-[11px] cursor-pointer transition-colors',
                    hiddenFanlar.length > 0
                      ? 'border-amber/50 bg-amber/10 text-amber'
                      : 'border-line bg-ink-850 text-fg-muted hover:text-fg',
                  )}
                  title="Fanlarni ko'rish yoki yashirish"
                >
                  {hiddenFanlar.length > 0 ? <EyeOff size={12} /> : <Eye size={12} />}
                  <span>
                    Fanlar: {visibleFanlar.length}/{fanlar.length}
                    {hiddenFanlar.length > 0 && ` (${hiddenFanlar.length} yashirilgan)`}
                  </span>
                </button>
              )}

              {/* Telegram uslubida tartiblash modalini ochish tugmasi */}
              <button
                type="button"
                onClick={() => setReorderModalOpen(true)}
                className="chip border-line bg-ink-850 text-fg-muted hover:text-sky text-[11px] font-bold flex items-center gap-1 transition-colors"
                title="Telegram uslubida talabalar tartibini sozlash"
              >
                <GripVertical size={12} />
                <span>Tartiblash</span>
              </button>

              {/* Talabalar tartibi alifbodan o'zgargan bo'lsa tiklash tugmasi */}
              {studentOrder.length > 0 && (
                <button
                  type="button"
                  onClick={handleResetOrder}
                  className="chip border-line bg-ink-950 text-fg-subtle hover:text-fg text-[10.5px]"
                  title="Talabalar tartibini asl alifbo tartibiga qaytarish"
                >
                  <RotateCcw size={11} />
                  <span>Alifbo tartibini tiklash</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* 5 ball yoki Reyting (100) tanlagich; 2 yillik guruhda faqat 5 ballik */}
              {faqat5 ? (
                <span className="chip border-emerald/40 bg-emerald/10 text-emerald-soft" title="2 yillik guruhlar faqat 5 ballik tizimda baholanadi">
                  Faqat 5 ballik · 2 yillik
                </span>
              ) : (
              <div
                className="flex gap-0.5 rounded-xl border border-line bg-ink-950 p-0.5"
                role="group"
              >
                {(
                  [
                    ['ball5', '5 ball'],
                    ['reyting', 'Reyting (100)'],
                  ] as const
                ).map(([v, t]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={birlik === v}
                    onClick={() => setBirlik(v)}
                    className={cx(
                      'rounded-lg px-2.5 py-1 text-[12px] font-bold transition-all',
                      birlik === v ? 'bg-ink-800 text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
              )}

              {/* Yangi fan qo'shish */}
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  void addFan()
                }}
              >
                <input
                  className="field h-8.5 w-44 sm:w-56 text-[12px]"
                  placeholder="Yangi fan nomi…"
                  value={newFan}
                  maxLength={120}
                  onChange={(e) => setNewFan(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn-primary h-8.5 px-3 text-[12px] font-bold"
                  disabled={!newFan.trim()}
                >
                  <Plus size={14} />
                  <span>Fan</span>
                </button>
              </form>
            </div>
          </div>

          {fanlar.length === 0 ? (
            <div className="grid place-items-center gap-2 px-6 py-14 text-center max-w-lg mx-auto">
              <ClipboardList size={32} className="text-fg-subtle" />
              <div className="text-[15px] font-bold text-fg">
                {guruh} guruhida {semestr}-semestr uchun fan kiritilmagan
              </div>
              {curriculumPlan && curriculumPlan.semestrlar?.[String(semestr)]?.fanlar?.length ? (
                <div className="space-y-3 pt-1">
                  <div className="text-[12.5px] text-fg-muted">
                    Ushbu guruh <b className="text-fg">{curriculumPlan.yonalish}</b> o'quv rejasiga biriktirilgan.
                  </div>
                  <button
                    type="button"
                    onClick={handleUpdateSubjectsFromPlan}
                    disabled={importingPlan}
                    className="btn-success mx-auto h-10 px-5 text-[13.5px] font-bold shadow-lg flex items-center gap-2"
                  >
                    {importingPlan ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <RefreshCw size={16} className="text-amber" />
                    )}
                    <span>Fanlarni yuklash ({curriculumPlan.semestrlar[String(semestr)].fanlar.length} ta fan)</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-14 text-center text-[13px] text-fg-muted">Bu guruhda talaba yo'q.</div>
          ) : (
            /* ASOSIY JADVAL */
            <XScroll ref={tableRef}>
              <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th
                      rowSpan={2}
                      className="sticky left-0 z-30 w-12 border-b border-r border-line bg-ink-900 px-1 py-2 text-center text-[11px] font-bold text-fg-subtle select-none"
                      title="Qatorni ushlab tepaga/pastga sudrab tartibni o'zgartirish mumkin"
                    >
                      <div className="flex items-center justify-center gap-0.5">
                        <GripVertical size={12} className="text-fg-subtle/60" />
                        <span>№</span>
                      </div>
                    </th>

                    <th
                      rowSpan={2}
                      className="sticky left-12 z-30 min-w-[9.5rem] sm:min-w-[14rem] max-w-[12rem] sm:max-w-none border-b border-r border-line bg-ink-900 px-2 sm:px-3 py-2 text-left text-[11px] font-bold tracking-wider text-fg-subtle uppercase"
                    >
                      F.I.Sh.
                    </th>

                    {visibleFanlar.map((f) => (
                      <th
                        key={f.nom}
                        colSpan={4}
                        className="border-b border-r border-line bg-ink-900 px-2 py-1.5 text-center group"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          {/* Fanni bosganda alohida ochib baholash */}
                          <button
                            type="button"
                            onClick={() => setFocusedFan(f.nom)}
                            className="text-left font-extrabold text-[12.5px] text-fg hover:text-sky-soft flex items-center gap-1 truncate transition-colors"
                            title={`"${f.nom}" fanini alohida ochib baholash`}
                          >
                            <span className="truncate max-w-[13rem]">{f.nom}</span>
                            <Maximize2 size={11} className="opacity-0 group-hover:opacity-100 text-sky shrink-0" />
                          </button>

                          <div className="flex items-center gap-0.5 shrink-0">
                            {/* Fanni yashirish */}
                            <button
                              type="button"
                              onClick={() => toggleHideFan(f.nom)}
                              className="size-6 grid place-items-center rounded text-fg-subtle hover:text-fg hover:bg-ink-800"
                              title={`"${f.nom}" fanini vaqtincha yashirish`}
                            >
                              <EyeOff size={12} />
                            </button>
                            {/* O'chirish */}
                            <button
                              type="button"
                              onClick={() => deleteFan(f.nom)}
                              className="size-6 grid place-items-center rounded text-fg-subtle hover:text-rose hover:bg-rose/10"
                              title={`"${f.nom}" fanini o'chirish`}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </th>
                    ))}

                    <th
                      rowSpan={2}
                      className="border-b border-line bg-ink-900 px-3 py-2 text-center text-[11px] font-bold tracking-wider text-fg-subtle uppercase"
                    >
                      O'rtacha
                      <br />
                      R-semestr
                    </th>
                  </tr>

                  {/* Ichki Ustunlar: Yakuniy, Joriy, Oraliq, R-semestr */}
                  <tr>
                    {visibleFanlar.map((f) =>
                      BAHO_TURLARI.map((t, ti) => (
                        <th
                          key={f.nom + t.key}
                          className={cx(
                            'border-b border-line px-1 py-1 text-center text-[10.5px] font-bold',
                            t.key === 'r_semestr'
                              ? 'bg-amber/10 text-amber'
                              : 'bg-ink-850 text-fg-muted',
                            ti === BAHO_TURLARI.length - 1 && 'border-r',
                          )}
                        >
                          {birlik === 'reyting' ? (
                            t.label
                          ) : (
                            <CopyColMenu
                              from={t.key as Kiritiladigan}
                              cols={BAHO_TURLARI}
                              title={f.nom}
                              onCopy={(to, onlyEmpty) => copyColumn(f.nom, t.key, to, onlyEmpty)}
                            >
                              {t.label}
                            </CopyColMenu>
                          )}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>

                <tbody>
                  {rows.map((s, r) => {
                    const rs = visibleFanlar.map((f) => cellValue(calc.get(`${s.pinfl}|${f.nom}`), 'r_semestr'))
                    const m = mean(rs, birlik === 'reyting' ? 2 : 1)
                    const totalCols = visibleFanlar.length * 4

                    return (
                      <tr
                        key={s.pinfl}
                        data-sort-key={s.pinfl}
                        className={cx(
                          'group',
                          // Ko'tarilgan (sudralayotgan) qator: to'liq fon va yumshoq soya — ostidagilar ko'rinmaydi
                          tableSort.dragKey === s.pinfl &&
                            '[&>td]:!bg-ink-800 [&>td]:shadow-[inset_0_1px_0_rgba(56,189,248,0.55),inset_0_-1px_0_rgba(56,189,248,0.55),0_12px_24px_-10px_rgba(0,0,0,0.75)]',
                          justMovedPinfl === s.pinfl && !tableSort.dragKey && '[&>td]:bg-sky/10',
                          !tableSort.dragKey && 'hover:bg-ink-850/50',
                        )}
                      >
                        {/* 1. Tartib raqami va sudrab ko'chirish ushlagichi (Telegram uslubida) */}
                        <td
                          onPointerDown={(e) => tableSort.startDrag(e, s.pinfl)}
                          style={{ touchAction: 'none' }}
                          className={cx(
                            'sticky left-0 z-10 w-12 border-b border-r border-line bg-ink-900 px-1 py-1 text-center text-[11.5px] font-mono tabular-nums text-fg-subtle select-none transition-colors duration-500',
                            tableSort.dragKey ? 'cursor-grabbing' : 'cursor-grab group-hover:bg-ink-800',
                          )}
                          title="Ushlab yuqoriga/pastga sudrang"
                        >
                          <div className="flex items-center justify-center gap-1">
                            <GripVertical size={12} className="opacity-40 group-hover:opacity-100 text-sky shrink-0" />
                            <span>{r + 1}</span>
                          </div>
                        </td>

                        {/* 2. Talaba F.I.Sh. */}
                        <td
                          className={cx(
                            'sticky left-12 z-10 min-w-[9.5rem] sm:min-w-[14rem] max-w-[12rem] sm:max-w-none truncate border-b border-r border-line bg-ink-900 px-2 sm:px-3 py-1 font-semibold text-fg transition-colors duration-500',
                            !tableSort.dragKey && 'group-hover:bg-ink-800',
                          )}
                          title={fullName(s)}
                        >
                          {fullName(s)}
                        </td>

                        {/* 3. Fanlar ustunlari */}
                        {visibleFanlar.map((f, fi) =>
                          BAHO_TURLARI.map((t, ti) => {
                            const colIdx = fi * 4 + ti
                            const last = ti === BAHO_TURLARI.length - 1
                            const c = calc.get(`${s.pinfl}|${f.nom}`)

                            // Reyting (100) ko'rinishida barcha kataklar hisoblangan reytingni ko'rsatadi
                            if (birlik === 'reyting') {
                              const v = cellValue(c, t.key)
                              return (
                                <td
                                  key={f.nom + t.key}
                                  className={cx(
                                    'border-b border-line px-1 py-1 text-center tabular-nums font-semibold',
                                    rangOf(v),
                                    last && 'border-r',
                                  )}
                                >
                                  {fmt(v)}
                                </td>
                              )
                            }

                            // 5 ball ko'rinishida BARCHA 4 TA KATAK FOYDALANUVCHI TOMONIDAN TAHRIRLANADI
                            const key = t.key as Kiritiladigan
                            const v = shown(s.pinfl, f.nom, key)
                            const changed = `${s.pinfl}|${f.nom}|${key}` in edits

                            return (
                              <td
                                key={f.nom + t.key}
                                className={cx(
                                  'border-b border-line px-0.5 py-1 text-center',
                                  t.key === 'r_semestr' && 'bg-amber/5',
                                  last && 'border-r',
                                )}
                              >
                                <input
                                  data-cell={`${r}:${colIdx}`}
                                  inputMode="numeric"
                                  autoComplete="off"
                                  maxLength={1}
                                  value={v}
                                  className={cx(
                                    cellCls(changed, parseBaho(v) === undefined),
                                    t.key === 'r_semestr' && 'border-amber/40 text-amber font-bold',
                                  )}
                                  aria-label={`${fullName(s)} — ${f.nom} — ${t.label}`}
                                  onChange={(e) => setCell(s.pinfl, f.nom, key, e.target.value)}
                                  onKeyDown={(e) => onCellKey(e, r, colIdx, totalCols, tableRef)}
                                  onPaste={(e) => handlePaste(e, r, colIdx, cellColsMap)}
                                  onFocus={(e) => e.currentTarget.select()}
                                />
                              </td>
                            )
                          }),
                        )}

                        {/* O'rtacha R-semestr */}
                        <td
                          className={cx(
                            'border-b border-line px-3 py-1 text-center font-bold tabular-nums',
                            rangOf(m),
                          )}
                        >
                          {m ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </XScroll>
          )}

          {/* Pastki eslatma */}
          <div className="border-t border-line px-3 py-2 text-[11.5px] leading-relaxed text-fg-subtle flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-bold text-sky-soft">Tezkor klaviatura:</span>{' '}
              <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg font-mono">Ctrl + Z</kbd> (bekor qilish),{' '}
              <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg font-mono">Ctrl + Y</kbd> (qaytarish),{' '}
              <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg font-mono">Ctrl + S</kbd> (saqlash),{' '}
              <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg font-mono">Ctrl + V</kbd> (Excel'dan joylash). Talabalar tartibini sudrab o'zgartirish yoki «Tartiblash» tugmasini bosing.
            </div>
            {hiddenFanlar.length > 0 && (
              <button
                type="button"
                onClick={showAllFanlar}
                className="text-amber hover:underline font-bold"
              >
                {hiddenFanlar.length} ta yashirilgan fanni ko'rsatish
              </button>
            )}
          </div>
        </div>
      )}

      {/* AMALIYOT BO'LIMI */}
      {data && view === 'amaliyot' && (
        <div className="panel overflow-hidden">
          <div className="space-y-3 border-b border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[13px] font-bold text-fg">
                {guruh} · {semestr}-semestr
              </div>
              {loading && <Loader2 size={14} className="animate-spin text-sky" />}
              <div className="flex flex-wrap gap-1.5">
                {amNoms.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => pickAm(n)}
                    aria-pressed={n === amNom}
                    className={cx(
                      'chip cursor-pointer',
                      n === amNom
                        ? 'border-sky/50 bg-sky/15 text-sky-soft'
                        : 'border-line bg-ink-800/60 text-fg-muted hover:text-fg',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <form
                className="flex w-full gap-2 sm:ml-auto sm:w-auto"
                onSubmit={(e) => {
                  e.preventDefault()
                  createAm()
                }}
              >
                <input
                  className="field h-9 min-w-0 flex-1 sm:w-60"
                  placeholder="Yangi amaliyot nomi"
                  value={newAm}
                  maxLength={120}
                  onChange={(e) => setNewAm(e.target.value)}
                />
                <button type="submit" className="btn-primary h-9 shrink-0 px-3" disabled={!newAm.trim()}>
                  <Plus size={15} /> Amaliyot
                </button>
              </form>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto] sm:items-end">
              <div>
                <label className="label" htmlFor="bulk-joy">
                  Hammaga: amaliyot joyi
                </label>
                <input
                  id="bulk-joy"
                  className="field h-9"
                  placeholder="Masalan: Shahrisabz tuman tibbiyot birlashmasi"
                  value={bulk.joy}
                  onChange={(e) => setBulk((b) => ({ ...b, joy: e.target.value }))}
                />
              </div>
              <div>
                <label className="label" htmlFor="bulk-bosh">
                  Boshlanish
                </label>
                <input
                  id="bulk-bosh"
                  type="date"
                  className="field h-9"
                  value={bulk.boshlanish}
                  onChange={(e) => setBulk((b) => ({ ...b, boshlanish: e.target.value }))}
                />
              </div>
              <div>
                <label className="label" htmlFor="bulk-tug">
                  Tugash
                </label>
                <input
                  id="bulk-tug"
                  type="date"
                  className="field h-9"
                  value={bulk.tugash}
                  onChange={(e) => setBulk((b) => ({ ...b, tugash: e.target.value }))}
                />
              </div>
              <button
                type="button"
                className="btn-ghost h-9 px-3"
                onClick={applyBulk}
                disabled={!bulk.joy.trim() && !bulk.boshlanish && !bulk.tugash}
              >
                Hammaga qo'llash
              </button>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="px-6 py-14 text-center text-[13px] text-fg-muted">Bu guruhda talaba yo'q.</div>
          ) : (
            <XScroll ref={tableRef}>
              <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
                <thead className="sticky top-0 z-20">
                  <tr className="text-[11px] font-bold tracking-wider text-fg-subtle uppercase">
                    <th className="sticky left-0 z-30 w-10 border-b border-r border-line bg-ink-900 px-2 py-2">
                      №
                    </th>
                    <th className="sticky left-10 z-30 min-w-[13rem] border-b border-r border-line bg-ink-900 px-3 py-2 text-left">
                      F.I.Sh.
                    </th>
                    <th className="min-w-[16rem] border-b border-line bg-ink-900 px-2 py-2 text-left">
                      Amaliyot joyi
                    </th>
                    <th className="border-b border-line bg-ink-900 px-2 py-2">Boshlanish</th>
                    <th className="border-b border-line bg-ink-900 px-2 py-2">Tugash</th>
                    <th className="border-b border-line bg-ink-900 px-2 py-2">Baho</th>
                    {!faqat5 && (
                      <th className="border-b border-line bg-ink-900 px-2 py-2" title="Avtomatik hosil qilinadi">
                        Reyting
                      </th>
                    )}
                    <th className="min-w-[12rem] border-b border-line bg-ink-900 px-2 py-2 text-left">
                      Izoh
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, r) => {
                    const ch = (f: AmField) => `${s.pinfl}|${f}` in amEdits
                    const ball = amShown(s.pinfl, 'ball')
                    const rey = amReyting(s.pinfl)
                    const txt = (f: AmField, extra = '') =>
                      cx('field h-8 py-0', extra, ch(f) && 'border-amber/60 bg-amber/10')
                    return (
                      <tr key={s.pinfl} className="group hover:bg-ink-850/50">
                        <td className="sticky left-0 z-10 w-10 border-b border-r border-line bg-ink-900 px-2 py-1 text-center text-[12px] tabular-nums text-fg-subtle group-hover:bg-ink-800">
                          {r + 1}
                        </td>
                        <td
                          className="sticky left-10 z-10 min-w-[13rem] truncate border-b border-r border-line bg-ink-900 px-3 py-1 font-semibold text-fg group-hover:bg-ink-800"
                          title={fullName(s)}
                        >
                          {fullName(s)}
                        </td>
                        <td className="border-b border-line px-1 py-1">
                          <input
                            className={txt('joy')}
                            value={amShown(s.pinfl, 'joy')}
                            maxLength={200}
                            onChange={(e) => setAm(s.pinfl, 'joy', e.target.value)}
                          />
                        </td>
                        <td className="border-b border-line px-1 py-1">
                          <input
                            type="date"
                            className={txt('boshlanish', 'w-[9.5rem]')}
                            value={amShown(s.pinfl, 'boshlanish')}
                            onChange={(e) => setAm(s.pinfl, 'boshlanish', e.target.value)}
                          />
                        </td>
                        <td className="border-b border-line px-1 py-1">
                          <input
                            type="date"
                            className={txt('tugash', 'w-[9.5rem]')}
                            value={amShown(s.pinfl, 'tugash')}
                            onChange={(e) => setAm(s.pinfl, 'tugash', e.target.value)}
                          />
                        </td>
                        <td className="border-b border-line px-1 py-1 text-center">
                          <input
                            data-cell={`${r}:0`}
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={1}
                            value={ball}
                            className={cellCls(ch('ball'), parseBaho(ball) === undefined)}
                            onChange={(e) => setAm(s.pinfl, 'ball', e.target.value)}
                            onKeyDown={(e) => onCellKey(e, r, 0, 1, tableRef)}
                            onFocus={(e) => e.currentTarget.select()}
                          />
                        </td>
                        {!faqat5 && (
                          <td
                            className={cx(
                              'border-b border-line px-2 py-1 text-center font-semibold tabular-nums',
                              rey === null ? 'text-fg-subtle' : BAHO_RANG[bahoOf(rey)],
                            )}
                          >
                            {rey ?? '—'}
                          </td>
                        )}
                        <td className="border-b border-line px-1 py-1">
                          <input
                            className={txt('izoh')}
                            value={amShown(s.pinfl, 'izoh')}
                            maxLength={500}
                            onChange={(e) => setAm(s.pinfl, 'izoh', e.target.value)}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </XScroll>
          )}
        </div>
      )}

      {/* ----------------- MODAL: Telegram uslubida Talabalar tartibini sozlash ----------------- */}
      {reorderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 animate-fade-in">
          <div
            className="fixed inset-0 bg-ink-950/85 backdrop-blur-md"
            onClick={() => setReorderModalOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-xl border border-line bg-ink-900 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scale-up">
            {/* Header */}
            <div className="p-4 border-b border-line bg-ink-950 flex items-center justify-between">
              <div>
                <h3 className="text-[16px] font-extrabold text-fg flex items-center gap-2">
                  <GripVertical size={18} className="text-sky" />
                  <span>Talabalar tartibini sozlash</span>
                </h3>
                <p className="text-[11.5px] text-fg-muted mt-0.5">
                  O'ngdagi <GripVertical size={11} className="inline -mt-0.5" /> belgisidan ushlab sudrang yoki strelkalarni bosing
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReorderModalOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800"
                aria-label="Yopish"
              >
                <X size={16} />
              </button>
            </div>

            {/* List */}
            <div ref={reorderListRef} className="overflow-y-auto overscroll-contain p-3 space-y-1.5 flex-1">
              {rows.map((s, idx) => (
                <div
                  key={s.pinfl}
                  data-sort-key={s.pinfl}
                  className={cx(
                    // transform bu yerda CSS transition'ga kirmaydi — uni use-sortable o'zi boshqaradi
                    'flex items-center justify-between gap-3 p-2.5 rounded-xl border select-none transition-[background-color,border-color,box-shadow,scale] duration-300',
                    modalSort.dragKey === s.pinfl
                      ? 'scale-[1.02] bg-ink-800 border-sky/50 shadow-[0_14px_28px_-12px_rgba(0,0,0,0.8)]'
                      : justMovedPinfl === s.pinfl && !modalSort.dragKey
                        ? 'bg-sky/10 border-sky/30'
                        : cx('border-line/60 bg-ink-950', !modalSort.dragKey && 'hover:bg-ink-850 hover:border-line'),
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="h-6 min-w-6 px-1 grid place-items-center rounded-md bg-ink-900 border border-line text-[11px] font-mono font-bold text-fg-muted shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-[13px] font-semibold text-fg truncate">
                      {fullName(s)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveWithAnimation(idx, idx - 1)}
                      disabled={idx === 0}
                      className="size-8 sm:size-7 grid place-items-center rounded-lg text-fg-subtle hover:text-fg hover:bg-ink-800 disabled:opacity-20"
                      title="Tepaga"
                      aria-label={`${fullName(s)} — tepaga`}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveWithAnimation(idx, idx + 1)}
                      disabled={idx === rows.length - 1}
                      className="size-8 sm:size-7 grid place-items-center rounded-lg text-fg-subtle hover:text-fg hover:bg-ink-800 disabled:opacity-20"
                      title="Pastga"
                      aria-label={`${fullName(s)} — pastga`}
                    >
                      <ArrowDown size={13} />
                    </button>
                    <div
                      onPointerDown={(e) => modalSort.startDrag(e, s.pinfl)}
                      style={{ touchAction: 'none' }}
                      className={cx(
                        'size-9 sm:size-7 grid place-items-center rounded-lg text-fg-subtle hover:text-sky',
                        modalSort.dragKey ? 'cursor-grabbing text-sky' : 'cursor-grab',
                      )}
                      title="Ushlab sudrang"
                      aria-hidden="true"
                    >
                      <GripVertical size={16} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-3 bg-ink-950 border-t border-line flex items-center justify-between">
              <button
                type="button"
                onClick={handleResetOrder}
                className="btn-ghost h-8 px-2.5 text-[12px] text-sky-soft hover:text-sky font-semibold"
              >
                Alifbo bo'yicha tiklash
              </button>
              <button
                type="button"
                onClick={() => setReorderModalOpen(false)}
                className="btn-primary h-8 px-4 text-[12.5px] font-bold"
              >
                Tayyor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- MODAL: Bitta fanni alohida ochib baholash (Fokus rejimi) ----------------- */}
      {focusedFan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 animate-fade-in">
          <div
            className="fixed inset-0 bg-ink-950/85 backdrop-blur-md"
            onClick={() => setFocusedFan(null)}
          />
          <div className="relative w-full max-w-4xl rounded-xl border border-line bg-ink-900 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            {/* Modal Sarlavhasi */}
            <div className="p-4 border-b border-line bg-ink-950 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <BookOpen size={18} className="text-sky" />
                  <h3 className="text-[17px] font-black text-fg">{focusedFan}</h3>
                </div>
                <div className="text-[12px] text-fg-muted mt-0.5">
                  Guruh: <b className="text-fg">{guruh}</b> · Semestr: <b className="text-fg">{semestr}</b> ·{' '}
                  <span className="text-emerald-soft font-bold">{rows.length} nafar talaba</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Fokus oynasida ham Undo / Redo */}
                <div className="flex items-center gap-0.5 rounded-xl border border-line bg-ink-900 p-0.5">
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={!history.canUndo}
                    className="size-8 grid place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800 disabled:opacity-25"
                    title="Bekor qilish (Ctrl + Z)"
                  >
                    <Undo2 size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={handleRedo}
                    disabled={!history.canRedo}
                    className="size-8 grid place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800 disabled:opacity-25"
                    title="Qaytarish (Ctrl + Y)"
                  >
                    <Redo2 size={14} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={saveBaholar}
                  disabled={saving || !canSaveBaholar}
                  className="btn-success h-9 px-4 text-[13px] font-bold flex items-center gap-1.5"
                  title="Saqlash (Ctrl + S)"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  <span>Saqlash</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFocusedFan(null)}
                  className="grid size-9 place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800"
                  aria-label="Yopish"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Alohida Fan Jadvali */}
            <div ref={focusTableRef} className="overflow-auto flex-1 p-3">
              <table className="w-full text-left text-[13px] border-collapse">
                <thead className="sticky top-0 z-10 bg-ink-950 text-[11px] font-bold text-fg-subtle uppercase border-b border-line">
                  <tr>
                    <th className="py-2.5 px-3 w-12 text-center">№</th>
                    <th className="py-2.5 px-4 min-w-[200px]">Talaba F.I.Sh.</th>
                    {BAHO_TURLARI.map((t) => (
                      <th key={t.key} className={cx('py-2.5 px-2 text-center', t.key === 'r_semestr' ? 'w-24 text-amber' : 'w-20')}>
                        <CopyColMenu
                          from={t.key as Kiritiladigan}
                          cols={BAHO_TURLARI}
                          title={focusedFan}
                          onCopy={(to, onlyEmpty) => copyColumn(focusedFan, t.key, to, onlyEmpty)}
                        >
                          {t.label}
                        </CopyColMenu>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {rows.map((s, r) => {
                    const focusCols: Kiritiladigan[] = ['yakuniy', 'joriy', 'oraliq', 'r_semestr']
                    const focusColsList = focusCols.map((k) => ({ fan: focusedFan, key: k }))

                    return (
                      <tr key={s.pinfl} className="hover:bg-ink-850/60 transition-colors">
                        <td className="py-2.5 px-3 text-center text-[12px] font-mono text-fg-subtle">
                          {r + 1}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-fg">{fullName(s)}</td>
                        {focusCols.map((colKey, c) => {
                          const v = shown(s.pinfl, focusedFan, colKey)
                          const changed = `${s.pinfl}|${focusedFan}|${colKey}` in edits
                          return (
                            <td key={colKey} className="py-2 px-2 text-center">
                              <input
                                data-cell={`${r}:${c}`}
                                inputMode="numeric"
                                autoComplete="off"
                                maxLength={1}
                                value={v}
                                className={cx(
                                  cellCls(changed, parseBaho(v) === undefined),
                                  colKey === 'r_semestr' && 'border-amber/40 text-amber font-bold',
                                )}
                                onChange={(e) => setCell(s.pinfl, focusedFan, colKey, e.target.value)}
                                onKeyDown={(e) => onCellKey(e, r, c, 4, focusTableRef)}
                                onPaste={(e) => handlePaste(e, r, c, focusColsList)}
                                onFocus={(e) => e.currentTarget.select()}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-3 bg-ink-950 border-t border-line text-[11.5px] text-fg-subtle flex items-center justify-between">
              <span>
                Klaviatura: <kbd className="font-mono text-fg">Ctrl+Z</kbd> (bekor qilish),{' '}
                <kbd className="font-mono text-fg">Ctrl+Y</kbd> (qaytarish),{' '}
                <kbd className="font-mono text-fg">Ctrl+S</kbd> (saqlash),{' '}
                <kbd className="font-mono text-fg">Ctrl+V</kbd> (Excel'dan joylash).
              </span>
              <button
                type="button"
                onClick={() => setFocusedFan(null)}
                className="btn-ghost h-7 px-2.5 text-[11.5px] text-sky-soft hover:text-sky font-bold"
              >
                Barcha fanlarga qaytish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- MODAL: Fanlarni yashirish / ko'rsatish ----------------- */}
      {exportOpen && (
        <BaholarExportModal
          guruh={guruh}
          semestr={semestr}
          plan={curriculumPlan}
          joriyFanlar={joriyFanNomlari}
          faqat5={faqat5}
          onClose={() => setExportOpen(false)}
          onExport={onExport}
        />
      )}

      {fanVisibilityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div
            className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm"
            onClick={() => setFanVisibilityModalOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-xl border border-line bg-ink-900 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-[15.5px] font-extrabold text-fg">Fanlarni ko'rish yoki yashirish</h3>
                <p className="text-[11.5px] text-fg-muted mt-0.5">
                  Keraksiz fanlarni jadvaldan vaqtincha yashirishingiz mumkin
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFanVisibilityModalOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800"
                aria-label="Yopish"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
              {fanlar.map((f) => {
                const isVisible = !hiddenFanlar.includes(f.nom)
                return (
                  <label
                    key={f.nom}
                    className="flex items-center gap-2.5 p-2 rounded-xl border border-line bg-ink-950/70 hover:bg-ink-850 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => toggleHideFan(f.nom)}
                      className="size-4 rounded accent-sky"
                    />
                    <span className="text-[13px] font-semibold text-fg flex-1">{f.nom}</span>
                    {!isVisible && (
                      <span className="text-[10.5px] text-amber font-bold">Yashirilgan</span>
                    )}
                  </label>
                )
              })}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-line">
              <button
                type="button"
                onClick={showAllFanlar}
                className="btn-ghost h-8 px-2 text-[12px] text-sky-soft hover:text-sky font-semibold"
              >
                Hammasini ko'rsatish
              </button>
              <button
                type="button"
                onClick={() => setFanVisibilityModalOpen(false)}
                className="btn-primary h-8 px-4 text-[12.5px] font-bold"
              >
                Tayyor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- MODAL: Fan o'qituvchisiga ulashish ----------------- */}
      {shareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 animate-fade-in">
          <div
            className="fixed inset-0 bg-ink-950/80 backdrop-blur-md"
            onClick={() => setShareModalOpen(false)}
          />
          <div className="relative w-full max-w-2xl rounded-xl border border-line bg-ink-900 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="p-4 border-b border-line bg-ink-950 flex items-center justify-between">
              <div>
                <h3 className="text-[16px] font-extrabold text-fg flex items-center gap-2">
                  <Share2 size={17} className="text-sky" />
                  <span>Baholash havolasini ulashish</span>
                </h3>
                <p className="text-[11.5px] text-fg-muted mt-0.5">
                  Guruh: <b className="text-fg">{guruh}</b> ({semestr}-semestr)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShareModalOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800"
                aria-label="Yopish"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto p-4 sm:p-5 space-y-5 flex-1">
              {/* Yangi havola shakli */}
              <div className="panel p-4 bg-ink-950/70 border-line space-y-3.5">
                <div className="text-[13px] font-bold text-fg flex items-center justify-between">
                  <span>{editingShare ? 'Havolani tahrirlash' : 'Yangi havola yaratish'}</span>
                  {editingShare && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingShare(null)
                        setNewShareTeacher('')
                        setNewShareHiddenPinfls([])
                      }}
                      className="text-[11px] text-amber hover:underline"
                    >
                      Bekor qilish (Yangi yaratish)
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="share-fan">Qaysi fan(lar)</label>
                    <select
                      id="share-fan"
                      value={newShareFan}
                      onChange={(e) => setNewShareFan(e.target.value)}
                      className="field h-9.5 font-bold cursor-pointer"
                    >
                      <option value={ALL_FANS}>Barcha fanlar ({fanlar.length} ta)</option>
                      <optgroup label="Bitta fan">
                        {fanlar.map((f) => (
                          <option key={f.nom} value={f.nom}>
                            {f.nom}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    {newShareFan === ALL_FANS && (
                      <p className="mt-1 text-[11px] leading-snug text-fg-subtle">
                        Havola egasi barcha fanlarni bitta sahifada baholaydi va hammasini bir tugma bilan saqlaydi.
                        Keyin qo'shilgan fanlar ham avtomatik ko'rinadi.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="label" htmlFor="share-teacher">O'qituvchi F.I.Sh. yoki izoh (ixtiyoriy)</label>
                    <input
                      id="share-teacher"
                      maxLength={120}
                      type="text"
                      placeholder="Masalan: Alimova D."
                      value={newShareTeacher}
                      onChange={(e) => setNewShareTeacher(e.target.value)}
                      className="field h-9.5"
                    />
                  </div>
                </div>

                {/* Talabalar ko'rinishi sozlamalari (Yashirish/Ko'rsatish) */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-bold text-fg">
                      Ko'rinadigan talabalar ({rows.length - newShareHiddenPinfls.length}/{rows.length})
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setNewShareHiddenPinfls([])}
                        className="text-[11px] text-sky-soft hover:text-sky font-semibold"
                      >
                        Hammasi ko'rinsin
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewShareHiddenPinfls(rows.map((s) => s.pinfl))}
                        className="text-[11px] text-rose/80 hover:text-rose font-semibold"
                      >
                        Hammasini yashirish
                      </button>
                    </div>
                  </div>

                  <div className="max-h-44 overflow-y-auto border border-line rounded-xl p-2 bg-ink-900 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {rows.map((s) => {
                      const isHidden = newShareHiddenPinfls.includes(s.pinfl)
                      return (
                        <label
                          key={s.pinfl}
                          className={cx(
                            'flex items-center gap-2 p-1.5 rounded-lg border text-[12px] cursor-pointer select-none transition-colors',
                            isHidden
                              ? 'border-line/40 bg-ink-950/40 text-fg-subtle line-through'
                              : 'border-line bg-ink-950 text-fg hover:bg-ink-850',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={!isHidden}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewShareHiddenPinfls(newShareHiddenPinfls.filter((p) => p !== s.pinfl))
                              } else {
                                setNewShareHiddenPinfls([...newShareHiddenPinfls, s.pinfl])
                              }
                            }}
                            className="size-3.5 rounded accent-sky"
                          />
                          <span className="truncate flex-1">{fullName(s)}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={handleCreateOrUpdateShare}
                    disabled={shareBusy || !newShareFan}
                    className="btn-primary h-9 px-4 text-[13px] font-bold"
                  >
                    {shareBusy && <Loader2 size={14} className="animate-spin" />}
                    {editingShare ? 'Saqlash' : 'Havolani yaratish'}
                  </button>
                </div>
              </div>

              {/* Mavjud havolalar ro'yxati */}
              <div className="space-y-2.5">
                <div className="text-[13px] font-bold text-fg flex items-center justify-between">
                  <span>Mavjud ulashish havolalari ({groupShares.length})</span>
                  {sharesLoading && <Loader2 size={13} className="animate-spin text-sky" />}
                </div>

                {groupShares.length === 0 ? (
                  <div className="text-center py-6 text-[12.5px] text-fg-subtle border border-line/60 rounded-xl bg-ink-950/40">
                    Hozircha faol ulashish havolasi yo'q.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groupShares.map((sh) => {
                      const origin = typeof window !== 'undefined' ? window.location.origin : ''
                      const url = `${origin}/baholar/ulashilgan?token=${sh.token}`
                      const isCopied = copiedToken === sh.token
                      const visibleCount = rows.length - (sh.hiddenPinfls?.length || 0)

                      return (
                        <div
                          key={sh.id}
                          className="panel p-3 border-line bg-ink-950/80 flex flex-wrap items-center justify-between gap-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-extrabold text-[13.5px] text-fg">
                                {sh.allFanlar ? `Barcha fanlar (${fanlar.length} ta)` : sh.fan}
                              </span>
                              {sh.allFanlar && (
                                <span className="chip border-sky/40 bg-sky/10 text-sky-soft text-[10.5px] font-bold">
                                  Hammasi bitta havolada
                                </span>
                              )}
                              {sh.teacherName && (
                                <span className="chip border-line bg-ink-900 text-sky-soft text-[11px] font-bold">
                                  {sh.teacherName}
                                </span>
                              )}
                              <span className="chip border-emerald/40 bg-emerald/10 text-emerald-soft text-[10.5px]">
                                {visibleCount}/{rows.length} talaba ko'rinadi
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-fg-subtle truncate mt-1">
                              {url}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => copyShareLink(sh.token)}
                              className={cx(
                                'btn-ghost h-8 px-2.5 text-[12px] font-bold border transition-all',
                                isCopied
                                  ? 'border-emerald text-emerald-soft bg-emerald/10'
                                  : 'border-line text-sky-soft hover:bg-sky/10',
                              )}
                            >
                              {isCopied ? <Check size={13} /> : <Copy size={13} />}
                              <span>{isCopied ? 'Nusxalandi!' : 'Nusxa olish'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setEditingShare(sh)
                                setNewShareFan(sh.allFanlar ? ALL_FANS : sh.fan)
                                setNewShareTeacher(sh.teacherName || '')
                                setNewShareHiddenPinfls(sh.hiddenPinfls || [])
                              }}
                              className="size-8 grid place-items-center rounded-lg text-fg-subtle hover:text-fg hover:bg-ink-800"
                              title="Tahrirlash"
                            >
                              <Edit2 size={13} />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteShare(sh.id)}
                              className="size-8 grid place-items-center rounded-lg text-rose/70 hover:text-rose hover:bg-rose/10"
                              title="O'chirish"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 bg-ink-950 border-t border-line flex justify-end">
              <button
                type="button"
                onClick={() => setShareModalOpen(false)}
                className="btn-ghost h-8 px-4 text-[12.5px]"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
