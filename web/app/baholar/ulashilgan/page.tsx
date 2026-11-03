'use client'

/*
  O'qituvchi baho qo'yadigan sahifa (/baholar/ulashilgan?token=...).
  Havola bitta fan uchun yoki guruhning shu semestrdagi BARCHA fanlari uchun bo'lishi mumkin.
  Barcha fanlarda: fan dropdown orqali tanlanadi (har birida baholangan talabalar soni) yoki
  "Butun jadval" — barcha fanlar yonma-yon, asosiy portaldagi kabi. "Saqlash" barcha fanlardagi
  o'zgarishlarni birdaniga saqlaydi. Ustun sarlavhasi bosilsa — baholarni boshqa ustunga ko'chirish.
*/

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  LayoutGrid,
  Layers,
  Loader2,
  Redo2,
  Save,
  Undo2,
  Users,
} from 'lucide-react'
import { parseBaho } from '@/lib/baholar'
import { parseClipboardGrid, useEditHistory } from '@/lib/use-edit-history'
import XScroll from '@/components/XScroll'
import CopyColMenu from '@/components/CopyColMenu'

interface StudentItem {
  tartib: number
  pinfl: string
  name: string
}

interface ShareData {
  id: string
  token: string
  guruh: string
  semestr: number
  fan: string
  allFanlar?: boolean
  teacherName?: string
}

interface GradeRow {
  pinfl: string
  fan?: string
  yakuniy?: number | null
  joriy?: number | null
  oraliq?: number | null
  r_semestr?: number | null
}

const COLS = ['yakuniy', 'joriy', 'oraliq', 'r_semestr'] as const
type Col = (typeof COLS)[number]
const COL_LABEL: Record<Col, string> = { yakuniy: 'Yakuniy', joriy: 'Joriy', oraliq: 'Oraliq', r_semestr: 'R-semestr' }
/** Telefonda tor ustun sarlavhalari */
const COL_SHORT: Record<Col, string> = { yakuniy: 'Yak.', joriy: 'Jor.', oraliq: 'Ora.', r_semestr: 'R-sem' }
const COL_LIST = COLS.map((key) => ({ key, label: COL_LABEL[key] }))
const BUTUN = '__butun__'

/** Tahrir kaliti: pinfl|fan|ustun (fan nomida "|" bo'lsa ham pinfl boshida, ustun oxirida) */
const editKey = (pinfl: string, fan: string, col: Col) => `${pinfl}|${fan}|${col}`
const splitKey = (k: string) => ({
  pinfl: k.slice(0, k.indexOf('|')),
  fan: k.slice(k.indexOf('|') + 1, k.lastIndexOf('|')),
})

function TeacherGradesContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [share, setShare] = useState<ShareData | null>(null)
  const [students, setStudents] = useState<StudentItem[]>([])
  const [fanlar, setFanlar] = useState<string[]>([])
  const [activeFan, setActiveFan] = useState('')
  /** Barcha fanlar yonma-yon (butun jadval) — keng ekranda boshlang'ich ko'rinish */
  const [butun, setButun] = useState(false)
  const butunInit = useRef(false)
  const [gradesMap, setGradesMap] = useState<Record<string, GradeRow>>({}) // key: pinfl|fan

  // Tahrirlar (key: pinfl|fan|ustun) — Undo / Redo tarixi bilan
  const history = useEditHistory()
  const { edits, apply: applyEdits, reset: resetEdits, undo: handleUndo, redo: handleRedo } = history

  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'info' | 'success'; text: string } | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const loadData = useCallback(
    async (keepFan?: string) => {
      if (!token) {
        setError("Havola manzili to'liq emas (token yo'q)")
        setLoading(false)
        return false
      }
      setError(null)
      try {
        const res = await fetch(`/api/baholar/ulashilgan?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        if (!data) {
          // Login sahifasiga yo'naltirilgan yoki server JSON qaytarmagan
          setError(
            res.status === 401 || res.redirected
              ? "Sayt bu havolani loginsiz ochishga ruxsat bermadi. Ma'muriyatga murojaat qiling."
              : `Server javobi noto'g'ri (${res.status})`,
          )
          return false
        }
        if (!res.ok || !data.ok) {
          setError(data.error || 'Havola yaroqsiz yoki muddati tugagan')
          return false
        }

        const sh = data.share as ShareData
        const list: string[] = Array.isArray(data.fanlar) && data.fanlar.length ? data.fanlar : sh.allFanlar ? [] : [sh.fan]
        if (!butunInit.current) {
          butunInit.current = true
          setButun(list.length > 1 && window.innerWidth >= 1024)
        }
        setShare(sh)
        setStudents(data.students || [])
        setFanlar(list)
        setActiveFan((cur) => {
          const want = keepFan ?? cur
          return want && list.includes(want) ? want : list[0] || ''
        })
        const map: Record<string, GradeRow> = {}
        for (const g of (data.grades || []) as GradeRow[]) map[`${g.pinfl}|${g.fan ?? sh.fan}`] = g
        setGradesMap(map)
        resetEdits({})
        return true
      } catch (err) {
        setError(`Server bilan aloqa xatosi: ${(err as Error).message}`)
        return false
      } finally {
        setLoading(false)
      }
    },
    [token, resetEdits],
  )

  useEffect(() => {
    void loadData()
  }, [loadData])

  const dirtyCount = Object.keys(edits).length

  // Saqlanmagan baholar bilan sahifa yopilsa ogohlantirish
  useEffect(() => {
    if (!dirtyCount) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirtyCount])

  const origVal = useCallback(
    (pinfl: string, fan: string, col: Col) => {
      const val = gradesMap[`${pinfl}|${fan}`]?.[col]
      return val !== null && val !== undefined ? String(val) : ''
    },
    [gradesMap],
  )

  const getShownVal = useCallback(
    (pinfl: string, fan: string, col: Col) => edits[editKey(pinfl, fan, col)] ?? origVal(pinfl, fan, col),
    [edits, origVal],
  )

  const setCells = (cells: { pinfl: string; col: Col; value: string; fan?: string }[], fan = activeFan) => {
    setSavedSuccess(false)
    setMessage(null)
    applyEdits((prev) => {
      const next = { ...prev }
      for (const c of cells) {
        const f = c.fan ?? fan
        const key = editKey(c.pinfl, f, c.col)
        const v = c.value.trim()
        if (v === origVal(c.pinfl, f, c.col)) delete next[key]
        else next[key] = v
      }
      return next
    })
  }

  /** Fandagi bir ustun baholarini (masalan Yakuniy) boshqa ustun(lar)ga ko'chirish — bitta Undo qadami */
  const copyCol = (fan: string, from: Col, to: Col[], onlyEmpty: boolean) => {
    const cells: { pinfl: string; col: Col; value: string; fan: string }[] = []
    for (const s of students) {
      const v = getShownVal(s.pinfl, fan, from).trim()
      if (!v || parseBaho(v) === undefined) continue
      for (const col of to) {
        const cur = getShownVal(s.pinfl, fan, col).trim()
        if (cur === v || (onlyEmpty && cur)) continue
        cells.push({ pinfl: s.pinfl, col, value: v, fan })
      }
    }
    const nomlar = to.map((c) => COL_LABEL[c]).join(', ')
    if (!cells.length) {
      setMessage({ type: 'info', text: `Ko'chiriladigan baho yo'q — ${COL_LABEL[from]} bo'sh yoki ${nomlar} allaqachon bir xil.` })
      return
    }
    setCells(cells)
    setMessage({
      type: 'success',
      text: `«${fan}»: ${COL_LABEL[from]} → ${nomlar} — ${cells.length} ta katak to'ldirildi. Saqlashni unutmang (Ctrl+Z — bekor qilish).`,
    })
  }

  const isInvalid = (v: string) => v.trim() !== '' && parseBaho(v) === undefined
  const invalidCount = useMemo(() => Object.values(edits).filter(isInvalid).length, [edits])

  /** Har bir fan bo'yicha: baholangan talabalar soni, saqlanmagan va noto'g'ri kataklar */
  const fanStats = useMemo(() => {
    const m = new Map<string, { done: number; dirty: number; bad: number }>()
    for (const f of fanlar) {
      let done = 0
      for (const s of students) if (COLS.some((c) => getShownVal(s.pinfl, f, c).trim() !== '')) done++
      m.set(f, { done, dirty: 0, bad: 0 })
    }
    for (const [k, v] of Object.entries(edits)) {
      const st = m.get(splitKey(k).fan)
      if (!st) continue
      st.dirty++
      if (isInvalid(v)) st.bad++
    }
    return m
  }, [fanlar, students, edits, getShownVal])

  const fanIdx = Math.max(0, fanlar.indexOf(activeFan))
  const goFan = useCallback(
    (i: number) => {
      const f = fanlar[i]
      if (!f) return
      setButun(false)
      setActiveFan(f)
    },
    [fanlar],
  )

  const handleSave = useCallback(async () => {
    if (!dirtyCount || !token || savingRef.current) return
    if (invalidCount) {
      setMessage({ type: 'error', text: "Noto'g'ri baho kiritilgan (qizil katak)! Faqat 2, 3, 4 yoki 5 bo'lishi kerak." })
      // Birinchi noto'g'ri katak bor fanga o'tish
      const bad = Object.entries(edits).find(([, v]) => isInvalid(v))
      if (bad && !butun) {
        const i = fanlar.indexOf(splitKey(bad[0]).fan)
        if (i >= 0) goFan(i)
      }
      return
    }

    savingRef.current = true
    setSaving(true)
    setMessage(null)
    try {
      // Tegilgan har bir talaba × fan juftligi to'liq yuboriladi
      const pairs = new Map<string, { pinfl: string; fan: string }>()
      for (const k of Object.keys(edits)) {
        const p = splitKey(k)
        pairs.set(`${p.pinfl}|${p.fan}`, p)
      }
      const items = [...pairs.values()].map(({ pinfl, fan }) => ({
        pinfl,
        fan,
        yakuniy: getShownVal(pinfl, fan, 'yakuniy'),
        joriy: getShownVal(pinfl, fan, 'joriy'),
        oraliq: getShownVal(pinfl, fan, 'oraliq'),
        r_semestr: getShownVal(pinfl, fan, 'r_semestr'),
      }))
      const fanCount = new Set(items.map((i) => i.fan)).size

      const res = await fetch('/api/baholar/ulashilgan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveTeacherGrades', token, items }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setSavedSuccess(true)
        await loadData(activeFan)
        setMessage({
          type: 'success',
          text:
            fanCount > 1
              ? `${fanCount} ta fan bo'yicha ${items.length} ta baho qatori saqlandi.`
              : `${items.length} ta talabaning bahosi saqlandi.`,
        })
      } else {
        setMessage({
          type: 'error',
          text: `Saqlanmadi: ${data.error || `server ${res.status} qaytardi`}. Baholaringiz jadvalda qoldi, qayta urinib ko'ring.`,
        })
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text: `Internet bilan aloqa yo'q: ${(err as Error).message}. Baholaringiz jadvalda qoldi, qayta urinib ko'ring.`,
      })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [dirtyCount, token, edits, invalidCount, getShownVal, loadData, activeFan, fanlar, goFan, butun])

  // Global tezkor klavishlar
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      // Ctrl + S: barcha fanlardagi o'zgarishlarni saqlash
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirtyCount && !saving) void handleSave()
        return
      }
      // Alt + ← / →: oldingi / keyingi fan
      if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && fanlar.length > 1 && !butun) {
        e.preventDefault()
        goFan(e.key === 'ArrowRight' ? Math.min(fanIdx + 1, fanlar.length - 1) : Math.max(fanIdx - 1, 0))
        return
      }

      const el = document.activeElement as HTMLElement | null
      const otherInput = (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') && !el.hasAttribute('data-cell')

      if (mod && e.key.toLowerCase() === 'z') {
        if (otherInput) return
        e.preventDefault()
        if (e.shiftKey) handleRedo()
        else handleUndo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (otherInput) return
        e.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [handleUndo, handleRedo, handleSave, dirtyCount, saving, fanlar.length, fanIdx, goFan, butun])

  const handleKeyNav = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) => {
    if (e.altKey) return // Alt+strelka — fan almashtirish
    let nextRow = rowIndex
    let nextCol = colIndex
    const last = (butun ? fanlar.length * COLS.length : COLS.length) - 1

    if (e.key === 'ArrowDown') nextRow = rowIndex + 1
    else if (e.key === 'ArrowUp') nextRow = rowIndex - 1
    else if (e.key === 'ArrowRight') {
      nextCol = colIndex + 1
      if (nextCol > last && rowIndex + 1 < students.length) {
        nextCol = 0
        nextRow = rowIndex + 1
      }
    } else if (e.key === 'ArrowLeft') {
      nextCol = colIndex - 1
      if (nextCol < 0 && rowIndex > 0) {
        nextCol = last
        nextRow = rowIndex - 1
      }
    } else if (e.key === 'Enter') nextRow = e.shiftKey ? rowIndex - 1 : rowIndex + 1
    else if (e.key === 'Tab') {
      nextCol = e.shiftKey ? colIndex - 1 : colIndex + 1
      if (nextCol > last && rowIndex + 1 < students.length) {
        nextCol = 0
        nextRow = rowIndex + 1
      } else if (nextCol < 0 && rowIndex > 0) {
        nextCol = last
        nextRow = rowIndex - 1
      }
    } else if (e.key === 'Home') {
      nextCol = 0
      if (e.ctrlKey) nextRow = 0
    } else if (e.key === 'End') {
      nextCol = last
      if (e.ctrlKey) nextRow = students.length - 1
    } else if (e.key === 'PageDown') nextRow = Math.min(rowIndex + 10, students.length - 1)
    else if (e.key === 'PageUp') nextRow = Math.max(rowIndex - 10, 0)
    else if (e.key === 'Escape') {
      e.currentTarget.blur()
      return
    } else return

    if (nextRow >= 0 && nextRow < students.length && nextCol >= 0 && nextCol <= last) {
      e.preventDefault()
      const target = tableRef.current?.querySelector<HTMLInputElement>(`[data-cell="${nextRow}:${nextCol}"]`)
      if (target) {
        target.focus()
        target.select()
      }
    }
  }

  // Excel paste: bir nechta katak bitta qadamda (Ctrl+Z bilan bittada bekor qilinadi)
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, startR: number, startC: number) => {
    const grid = parseClipboardGrid(e.clipboardData.getData('text'))
    if (!grid.length) return
    e.preventDefault()
    const cells: { pinfl: string; col: Col; value: string; fan: string }[] = []
    let skipped = 0
    grid.forEach((line, rOffset) => {
      const st = students[startR + rOffset]
      if (!st) return
      line.forEach((raw, cOffset) => {
        const i = startC + cOffset
        // Butun jadvalda katak raqami: fan × 4 + ustun
        const col = butun ? COLS[i % COLS.length] : COLS[i]
        const fan = butun ? fanlar[Math.floor(i / COLS.length)] : activeFan
        if (!col || !fan) return
        const v = raw.trim()
        if (!v) return
        const p = parseBaho(v)
        if (p === undefined || p === null) {
          skipped++
          return
        }
        cells.push({ pinfl: st.pinfl, col, value: String(p), fan })
      })
    })
    if (cells.length) setCells(cells)
    if (skipped) {
      setMessage({ type: 'info', text: `${skipped} ta noto'g'ri qiymat o'tkazib yuborildi (faqat 2, 3, 4 yoki 5).` })
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-950 text-fg p-4">
        <div className="panel p-8 text-center space-y-3 max-w-sm">
          <Loader2 size={32} className="animate-spin text-sky mx-auto" />
          <div className="text-[14px] font-bold">O'qituvchi baholash oynasi ochilmoqda…</div>
        </div>
      </div>
    )
  }

  if (error || !share) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-950 text-fg p-4">
        <div className="panel p-8 text-center space-y-4 max-w-md border-rose/40 bg-ink-900">
          <AlertTriangle size={40} className="text-rose mx-auto" />
          <h2 className="text-[17px] font-extrabold text-fg">Havola faol emas</h2>
          <p className="text-[13px] text-fg-muted leading-relaxed">
            {error || "Ushbu baholash havolasi mavjud emas yoki texnikum ma'muriyati tomonidan bekor qilingan."}
          </p>
        </div>
      </div>
    )
  }

  const multi = fanlar.length > 1 || !!share.allFanlar
  const totalDone = [...fanStats.values()].reduce((a, s) => a + s.done, 0)
  const totalCells = fanlar.length * students.length
  const keng = multi && butun && fanlar.length > 0

  /** Baho katagi (bitta fan ko'rinishi ham, butun jadval ham) */
  const cell = (s: StudentItem, r: number, fan: string, col: Col, idx: number, className = '') => {
    const val = getShownVal(s.pinfl, fan, col)
    const isEdited = editKey(s.pinfl, fan, col) in edits
    const bad = isInvalid(val)
    return (
      <td key={fan + col} className={`py-2 px-0.5 sm:px-2 text-center ${className}`}>
        <input
          data-cell={`${r}:${idx}`}
          type="text"
          inputMode="numeric"
          maxLength={1}
          autoComplete="off"
          aria-label={`${s.name} — ${fan} — ${COL_LABEL[col]}`}
          value={val}
          onChange={(e) => setCells([{ pinfl: s.pinfl, col, value: e.target.value, fan }])}
          onKeyDown={(e) => handleKeyNav(e, r, idx)}
          onPaste={(e) => handlePaste(e, r, idx)}
          onFocus={(e) => e.currentTarget.select()}
          className={`h-9 w-9 ${keng ? 'sm:w-10' : 'sm:w-12'} rounded-lg border text-center text-[14px] font-bold tabular-nums outline-none transition-all ${
            bad
              ? 'border-rose bg-rose/10 text-rose'
              : isEdited
                ? 'border-amber/70 bg-amber/15 text-fg'
                : 'border-line bg-ink-950 text-fg focus:border-sky focus:ring-1 focus:ring-sky/40'
          } ${col === 'r_semestr' && !bad && !isEdited ? 'border-amber/40 text-amber' : ''}`}
        />
      </td>
    )
  }
  const colHead = (fan: string, c: Col, short = false) => (
    <CopyColMenu from={c} cols={COL_LIST} title={fan} onCopy={(to, onlyEmpty) => copyCol(fan, c, to, onlyEmpty)}
      className="inline-flex items-center gap-0.5 rounded px-1 uppercase hover:bg-ink-800 hover:text-fg">
      {short ? COL_SHORT[c] : (
        <>
          <span className="sm:hidden">{COL_SHORT[c]}</span>
          <span className="hidden sm:inline">{COL_LABEL[c]}</span>
        </>
      )}
    </CopyColMenu>
  )

  return (
    <div className="min-h-screen bg-ink-950 text-fg p-3 sm:p-6 pb-20">
      <div className={`${keng ? 'max-w-[1800px]' : 'max-w-4xl'} mx-auto space-y-4`}>
        {/* Yuqori Panel */}
        <div className="panel p-4 sm:p-5 bg-ink-900 border-line shadow-xl space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <GraduationCap size={20} className="text-sky shrink-0" />
                <span className="text-[12px] font-bold text-fg-subtle tracking-wider uppercase">
                  Shahrisabz Tibbiyot Texnikumi
                </span>
              </div>
              <h1 className="text-[18px] sm:text-[22px] font-black text-fg tracking-tight flex items-center gap-2">
                {multi && <Layers size={20} className="text-sky shrink-0" />}
                <span>{multi ? `${share.guruh} guruhi — barcha fanlar` : share.fan}</span>
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
                <span>
                  Guruh: <b className="text-fg">{share.guruh}</b>
                </span>
                <span>·</span>
                <span>
                  Semestr: <b className="text-fg">{share.semestr}-semestr</b>
                </span>
                {multi && (
                  <>
                    <span>·</span>
                    <span>
                      Fanlar: <b className="text-fg">{fanlar.length} ta</b>
                    </span>
                  </>
                )}
                {share.teacherName && (
                  <>
                    <span>·</span>
                    <span className="text-sky-soft">
                      O'qituvchi: <b>{share.teacherName}</b>
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <div className="flex items-center gap-0.5 rounded-xl border border-line bg-ink-950 p-0.5">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!history.canUndo}
                  className="size-8 grid place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800 disabled:opacity-25 transition-all"
                  title="Bekor qilish (Ctrl + Z)"
                  aria-label="Bekor qilish"
                >
                  <Undo2 size={14} />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={!history.canRedo}
                  className="size-8 grid place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800 disabled:opacity-25 transition-all"
                  title="Qaytarish (Ctrl + Y)"
                  aria-label="Qaytarish"
                >
                  <Redo2 size={14} />
                </button>
              </div>

              {dirtyCount > 0 && (
                <span className="chip border-amber/50 bg-amber/10 text-amber font-bold">{dirtyCount} ta o'zgarish</span>
              )}
              {savedSuccess && !dirtyCount && (
                <span className="chip border-emerald/50 bg-emerald/10 text-emerald-soft font-bold flex items-center gap-1">
                  <CheckCircle2 size={13} />
                  <span>Saqlandi</span>
                </span>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !dirtyCount || invalidCount > 0}
                className="btn-success h-10 px-5 text-[13.5px] font-bold shadow-lg flex items-center gap-1.5"
                title={multi ? "Barcha fanlardagi o'zgarishlarni saqlash (Ctrl + S)" : 'Saqlash (Ctrl + S)'}
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                <span>{multi ? 'Hammasini saqlash' : 'Saqlash'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-fg-subtle border-t border-line/60 pt-2.5">
            <div className="flex items-center gap-1.5">
              <Users size={13} className="text-emerald" />
              <span>
                Talabalar soni: <b className="text-fg">{students.length} nafar</b>
              </span>
              {multi && totalCells > 0 && (
                <span className="ml-2">
                  · Baholangan: <b className="text-fg">{Math.round((totalDone / totalCells) * 100)}%</b>
                </span>
              )}
            </div>
            <div className="hidden sm:inline">
              <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg-muted font-mono">Ctrl+S</kbd> saqlash,{' '}
              <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg-muted font-mono">Ctrl+Z</kbd> bekor qilish,{' '}
              <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg-muted font-mono">Ctrl+V</kbd> Excel'dan
              {multi && (
                <>
                  , <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg-muted font-mono">Alt+→</kbd> keyingi fan
                </>
              )}
            </div>
          </div>
        </div>

        {/* Fan tanlash (barcha fanlar havolasida): dropdown + butun jadval */}
        {multi && fanlar.length > 0 && (
          <div className="panel flex flex-wrap items-center gap-2 p-2 bg-ink-900 border-line">
            <div className="flex items-center gap-0.5 rounded-xl border border-line bg-ink-950 p-0.5">
              <button
                type="button"
                onClick={() => setButun(true)}
                aria-pressed={butun}
                className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-bold transition-colors ${butun ? 'bg-sky text-white' : 'text-fg-muted hover:text-fg'}`}
              >
                <LayoutGrid size={14} /> Butun jadval
              </button>
              <button
                type="button"
                onClick={() => goFan(fanIdx)}
                aria-pressed={!butun}
                className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-bold transition-colors ${!butun ? 'bg-sky text-white' : 'text-fg-muted hover:text-fg'}`}
              >
                <BookOpen size={14} /> Bitta fan
              </button>
            </div>
            <select
              value={butun ? BUTUN : activeFan}
              onChange={(e) => (e.target.value === BUTUN ? setButun(true) : goFan(fanlar.indexOf(e.target.value)))}
              aria-label="Fanni tanlash"
              className="field h-9 min-w-[14rem] flex-1 cursor-pointer py-0 text-[13px] font-semibold"
            >
              <option value={BUTUN}>Barcha fanlar — butun jadval ({fanlar.length} ta fan)</option>
              {fanlar.map((f, i) => {
                const st = fanStats.get(f) ?? { done: 0, dirty: 0, bad: 0 }
                const full = students.length > 0 && st.done === students.length
                return (
                  <option key={f} value={f}>
                    {i + 1}. {f} — {full ? '✓ ' : ''}{st.done}/{students.length}
                    {st.dirty > 0 ? ` · ${st.dirty} ${st.bad ? 'xato' : "o'zgarish"}` : ''}
                  </option>
                )
              })}
            </select>
            {!butun && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => goFan(fanIdx - 1)} disabled={fanIdx === 0} className="btn-ghost size-9 p-0 disabled:opacity-30" title="Oldingi fan (Alt + ←)" aria-label="Oldingi fan">
                  <ChevronLeft size={16} />
                </button>
                <button type="button" onClick={() => goFan(fanIdx + 1)} disabled={fanIdx >= fanlar.length - 1} className="btn-ghost size-9 p-0 disabled:opacity-30" title="Keyingi fan (Alt + →)" aria-label="Keyingi fan">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}

        {message && (
          <div
            role={message.type === 'error' ? 'alert' : 'status'}
            className={`panel flex items-start gap-2 p-3 text-[13px] ${
              message.type === 'error'
                ? 'border-rose/40 bg-rose/10 text-rose'
                : message.type === 'success'
                  ? 'border-emerald/40 bg-emerald/10 text-emerald-soft'
                  : 'border-amber/40 bg-amber/10 text-amber'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            )}
            <span className="flex-1">{message.text}</span>
            <button type="button" onClick={() => setMessage(null)} className="text-[12px] font-bold opacity-80 hover:opacity-100">
              Yopish
            </button>
          </div>
        )}

        {fanlar.length === 0 && (
          <div className="panel p-6 text-center text-[13px] text-fg-muted">
            Bu guruhda {share.semestr}-semestr uchun fanlar hali kiritilmagan. Ma'muriyatga murojaat qiling.
          </div>
        )}

        {students.length === 0 && fanlar.length > 0 && (
          <div className="panel p-6 text-center text-[13px] text-fg-muted">
            Bu havolada baho qo'yiladigan talaba yo'q. Ma'muriyatga murojaat qiling.
          </div>
        )}

        {/* Butun jadval: barcha fanlar yonma-yon */}
        {keng && students.length > 0 && (
          <div className="panel overflow-clip border-line bg-ink-900 shadow-2xl">
            <XScroll ref={tableRef}>
              <table className="text-left text-[13px] border-collapse">
                <thead className="sticky top-0 z-10 bg-ink-950 border-b border-line text-[10.5px] font-bold text-fg-subtle uppercase tracking-wider">
                  <tr>
                    <th rowSpan={2} className="sticky left-0 z-20 w-9 sm:w-11 bg-ink-950 py-2 px-1 text-center border-b border-line">№</th>
                    <th rowSpan={2} className="sticky left-9 sm:left-11 z-20 min-w-[9rem] sm:min-w-[15rem] bg-ink-950 py-2 px-2 sm:px-3 border-b border-r border-line">Talaba F.I.Sh.</th>
                    {fanlar.map((f, fi) => {
                      const st = fanStats.get(f) ?? { done: 0, dirty: 0, bad: 0 }
                      return (
                        <th key={f} colSpan={COLS.length} className="border-b border-r border-line px-2 py-1.5 text-center normal-case tracking-normal">
                          <button
                            type="button"
                            onClick={() => goFan(fi)}
                            className="mx-auto block max-w-[15rem] truncate text-[12px] font-extrabold text-fg hover:text-sky-soft"
                            title={`${f} — faqat shu fanni ochish`}
                          >
                            {fi + 1}. {f}
                          </button>
                          <span className={`text-[10.5px] font-semibold ${students.length && st.done === students.length ? 'text-emerald-soft' : 'text-fg-subtle'}`}>
                            {st.done}/{students.length}
                            {st.dirty > 0 && <span className={st.bad ? 'text-rose' : 'text-amber'}> · {st.dirty} {st.bad ? 'xato' : "o'zgarish"}</span>}
                          </span>
                        </th>
                      )
                    })}
                  </tr>
                  <tr>
                    {fanlar.map((f) =>
                      COLS.map((c, ci) => (
                        <th
                          key={f + c}
                          className={`border-b border-line bg-ink-900 px-0.5 py-1 text-center whitespace-nowrap ${c === 'r_semestr' ? 'text-amber' : ''} ${ci === COLS.length - 1 ? 'border-r' : ''}`}
                        >
                          {colHead(f, c, true)}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {students.map((s, r) => (
                    <tr key={s.pinfl} className="group">
                      <td className="sticky left-0 z-[1] bg-ink-900 group-hover:bg-ink-850 py-2 px-1 text-center text-[12px] font-mono text-fg-muted">{s.tartib}</td>
                      <td className="sticky left-9 sm:left-11 z-[1] bg-ink-900 group-hover:bg-ink-850 py-2 px-2 sm:px-3 border-r border-line text-[12.5px] leading-snug font-semibold text-fg sm:whitespace-nowrap">{s.name}</td>
                      {fanlar.map((f, fi) =>
                        COLS.map((col, c) => cell(s, r, f, col, fi * COLS.length + c, c === COLS.length - 1 ? 'border-r border-line' : '')),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </XScroll>
            <div className="p-3 bg-ink-950/80 border-t border-line text-[11.5px] text-fg-subtle">
              Baho faqat 2, 3, 4 yoki 5. Ustun nomini bosing — baholarni boshqa ustunga ko‘chirish (masalan Yakuniy → Oraliq). Fan nomini bosing — faqat shu fan ochiladi.
            </div>
          </div>
        )}

        {/* Baholar Jadvali (tanlangan fan) */}
        {!keng && activeFan && students.length > 0 && (
          <div className="panel overflow-clip border-line bg-ink-900 shadow-2xl">
            {multi && (
              <div className="flex items-center gap-2 border-b border-line bg-ink-950/70 px-3 py-2.5">
                <BookOpen size={16} className="text-sky shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold text-fg">{activeFan}</span>
                <span className="text-[11.5px] font-semibold text-fg-subtle">
                  {fanIdx + 1}/{fanlar.length}
                </span>
              </div>
            )}
            <XScroll ref={tableRef}>
              <table className="w-full text-left text-[13px] border-collapse">
                <thead className="sticky top-0 z-10 bg-ink-950/95 backdrop-blur-sm border-b border-line text-[11px] font-bold text-fg-subtle uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-1 sm:px-3 w-8 sm:w-12 text-center">№</th>
                    <th className="py-3 px-1.5 sm:px-4 sm:min-w-[200px]">Talaba F.I.Sh.</th>
                    {COLS.map((c) => (
                      <th
                        key={c}
                        className={`py-3 px-0.5 sm:px-2 text-center whitespace-nowrap ${c === 'r_semestr' ? 'sm:w-24 text-amber' : 'sm:w-20'}`}
                      >
                        {colHead(activeFan, c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {students.map((s, r) => (
                    <tr key={s.pinfl} className="hover:bg-ink-850/60 transition-colors">
                      <td className="py-2.5 px-1 sm:px-3 text-center text-[12px] font-mono text-fg-muted">{s.tartib}</td>
                      <td className="py-2.5 px-1.5 sm:px-4 text-[12.5px] sm:text-[13px] leading-snug font-semibold text-fg">{s.name}</td>
                      {COLS.map((col, c) => cell(s, r, activeFan, col, c))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </XScroll>

            <div className="p-3 bg-ink-950/80 border-t border-line text-[11.5px] text-fg-subtle flex flex-wrap items-center justify-between gap-2">
              {multi ? (
                <>
                  <button
                    type="button"
                    onClick={() => goFan(fanIdx - 1)}
                    disabled={fanIdx === 0}
                    className="btn-ghost h-9 px-3 text-[12.5px] font-bold disabled:opacity-30"
                  >
                    <ChevronLeft size={15} /> Oldingi fan
                  </button>
                  <span className="hidden sm:inline">Baho faqat 2, 3, 4 yoki 5. O'zgarishlar barcha fanlar uchun birga saqlanadi.</span>
                  <button
                    type="button"
                    onClick={() => goFan(fanIdx + 1)}
                    disabled={fanIdx >= fanlar.length - 1}
                    className="btn-primary h-9 px-3 text-[12.5px] font-bold disabled:opacity-30"
                  >
                    Keyingi fan <ChevronRight size={15} />
                  </button>
                </>
              ) : (
                <>
                  <span>Baho faqat 2, 3, 4 yoki 5 kiritiladi. Bo'sh qoldirilsa baho belgilanmagan hisoblanadi.</span>
                  <span className="font-semibold text-sky-soft">Shahrisabz Tibbiyot Texnikumi</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TeacherGradesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-ink-950 text-fg">
          <Loader2 size={32} className="animate-spin text-sky" />
        </div>
      }
    >
      <TeacherGradesContent />
    </Suspense>
  )
}
