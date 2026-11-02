'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  Award,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  Loader2,
  Redo2,
  Save,
  Undo2,
  Users,
} from 'lucide-react'
import { parseBaho } from '@/lib/baholar'

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
  teacherName?: string
}

interface GradeRow {
  pinfl: string
  yakuniy?: number | null
  joriy?: number | null
  oraliq?: number | null
  r_semestr?: number | null
}

function TeacherGradesContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [share, setShare] = useState<ShareData | null>(null)
  const [students, setStudents] = useState<StudentItem[]>([])
  const [gradesMap, setGradesMap] = useState<Record<string, GradeRow>>({})
  const [edits, setEdits] = useState<Record<string, string>>({}) // key: pinfl|col

  // Undo / Redo
  const [undoStack, setUndoStack] = useState<Record<string, string>[]>([])
  const [redoStack, setRedoStack] = useState<Record<string, string>[]>([])

  const [saving, setSaving] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const tableRef = useRef<HTMLDivElement>(null)

  const loadData = useCallback(async () => {
    if (!token) {
      setError("Havola manzili to'liq emas (token yo'q)")
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/baholar/share?token=${encodeURIComponent(token)}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.error || 'Havola yaroqsiz yoki muddati tugagan')
        return
      }

      setShare(data.share)
      setStudents(data.students || [])

      const map: Record<string, GradeRow> = {}
      for (const g of data.grades || []) {
        map[g.pinfl] = g
      }
      setGradesMap(map)
      setEdits({})
      setUndoStack([])
      setRedoStack([])
    } catch (err) {
      setError(`Server bilan aloqa xatosi: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const cols = useMemo(() => ['yakuniy', 'joriy', 'oraliq', 'r_semestr'] as const, [])

  const getShownVal = (pinfl: string, col: (typeof cols)[number]) => {
    const editKey = `${pinfl}|${col}`
    if (editKey in edits) return edits[editKey]
    const val = gradesMap[pinfl]?.[col]
    return val !== null && val !== undefined ? String(val) : ''
  }

  const handleCellChange = (pinfl: string, col: (typeof cols)[number], val: string) => {
    setSavedSuccess(false)
    const key = `${pinfl}|${col}`
    const original = gradesMap[pinfl]?.[col]
    const origStr = original !== null && original !== undefined ? String(original) : ''
    if ((edits[key] ?? origStr) === val.trim()) return

    // Undo stack
    setUndoStack((u) => [...u.slice(-50), edits])
    setRedoStack([])

    setEdits((prev) => {
      const next = { ...prev }
      if (val.trim() === origStr) {
        delete next[key]
      } else {
        next[key] = val
      }
      return next
    })
  }

  const handleUndo = useCallback(() => {
    setUndoStack((u) => {
      if (!u.length) return u
      const prev = u[u.length - 1]
      const nextU = u.slice(0, -1)
      setEdits((cur) => {
        setRedoStack((r) => [...r.slice(-50), cur])
        return prev
      })
      return nextU
    })
  }, [])

  const handleRedo = useCallback(() => {
    setRedoStack((r) => {
      if (!r.length) return r
      const next = r[r.length - 1]
      const nextR = r.slice(0, -1)
      setEdits((cur) => {
        setUndoStack((u) => [...u.slice(-50), cur])
        return next
      })
      return nextR
    })
  }, [])

  const dirtyCount = Object.keys(edits).length

  const handleSave = useCallback(async () => {
    if (!dirtyCount || !token) return

    for (const [k, v] of Object.entries(edits)) {
      if (v.trim() !== '' && parseBaho(v) === undefined) {
        alert("Noto'g'ri baho kiritilgan! Faqat 2, 3, 4 yoki 5 bo'lishi kerak.")
        return
      }
    }

    setSaving(true)
    try {
      const touchedPinfls = new Set(Object.keys(edits).map((k) => k.split('|')[0]))
      const items = Array.from(touchedPinfls).map((pinfl) => ({
        pinfl,
        yakuniy: getShownVal(pinfl, 'yakuniy'),
        joriy: getShownVal(pinfl, 'joriy'),
        oraliq: getShownVal(pinfl, 'oraliq'),
        r_semestr: getShownVal(pinfl, 'r_semestr'),
      }))

      const res = await fetch('/api/baholar/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveTeacherGrades',
          token,
          items,
        }),
      })

      const data = await res.json()
      if (data.ok) {
        setSavedSuccess(true)
        await loadData()
      } else {
        alert(data.error || 'Saqlashda xatolik yuz berdi')
      }
    } catch (err) {
      alert(`Xatolik: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [dirtyCount, token, edits, loadData])

  // Global tezkor klavishlar
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ctrl + S: Saqlash
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirtyCount && !saving) void handleSave()
        return
      }

      // Ctrl + Z: Undo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) handleRedo()
        else handleUndo()
        return
      }

      // Ctrl + Y: Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        handleRedo()
        return
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [handleUndo, handleRedo, handleSave, dirtyCount, saving])

  const handleKeyNav = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    colIndex: number,
  ) => {
    let nextRow = rowIndex
    let nextCol = colIndex

    if (e.key === 'ArrowDown') {
      nextRow = rowIndex + 1
    } else if (e.key === 'ArrowUp') {
      nextRow = rowIndex - 1
    } else if (e.key === 'ArrowRight') {
      nextCol = colIndex + 1
      if (nextCol >= cols.length && rowIndex + 1 < students.length) {
        nextCol = 0
        nextRow = rowIndex + 1
      }
    } else if (e.key === 'ArrowLeft') {
      nextCol = colIndex - 1
      if (nextCol < 0 && rowIndex > 0) {
        nextCol = cols.length - 1
        nextRow = rowIndex - 1
      }
    } else if (e.key === 'Enter') {
      nextRow = e.shiftKey ? rowIndex - 1 : rowIndex + 1
    } else if (e.key === 'Tab') {
      nextCol = e.shiftKey ? colIndex - 1 : colIndex + 1
      if (nextCol >= cols.length && rowIndex + 1 < students.length) {
        nextCol = 0
        nextRow = rowIndex + 1
      } else if (nextCol < 0 && rowIndex > 0) {
        nextCol = cols.length - 1
        nextRow = rowIndex - 1
      }
    } else if (e.key === 'Home') {
      if (e.ctrlKey) {
        nextRow = 0
        nextCol = 0
      } else {
        nextCol = 0
      }
    } else if (e.key === 'End') {
      if (e.ctrlKey) {
        nextRow = students.length - 1
        nextCol = cols.length - 1
      } else {
        nextCol = cols.length - 1
      }
    } else if (e.key === 'PageDown') {
      nextRow = Math.min(rowIndex + 10, students.length - 1)
    } else if (e.key === 'PageUp') {
      nextRow = Math.max(rowIndex - 10, 0)
    } else if (e.key === 'Escape') {
      e.currentTarget.blur()
      return
    } else {
      return
    }

    if (nextRow >= 0 && nextRow < students.length && nextCol >= 0 && nextCol < cols.length) {
      e.preventDefault()
      const target = tableRef.current?.querySelector<HTMLInputElement>(
        `[data-cell="${nextRow}:${nextCol}"]`,
      )
      if (target) {
        target.focus()
        target.select()
      }
    }
  }

  // Excel paste
  const handlePaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    startR: number,
    startC: number,
  ) => {
    const clip = e.clipboardData.getData('text')
    if (!clip) return

    const lines = clip.split(/\r?\n/).filter((l) => l.trim() !== '')
    if (lines.length > 1 || lines[0].includes('\t')) {
      e.preventDefault()
      const newEdits: Record<string, string> = {}
      lines.forEach((line, rOffset) => {
        const targetR = startR + rOffset
        if (targetR >= students.length) return
        const values = line.split('\t')
        values.forEach((v, cOffset) => {
          const targetC = startC + cOffset
          if (targetC >= cols.length) return
          const clean = v.trim()
          const p = parseBaho(clean)
          if (p !== undefined && p !== null) {
            newEdits[`${students[targetR].pinfl}|${cols[targetC]}`] = String(p)
          }
        })
      })

      if (Object.keys(newEdits).length > 0) {
        setUndoStack((u) => [...u.slice(-50), edits])
        setRedoStack([])
        setEdits((prev) => ({ ...prev, ...newEdits }))
      }
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
            {error || 'Ushbu baholash havolasi mavjud emas yoki texnikum ma\'muriyati tomonidan bekor qilingan.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ink-950 text-fg p-3 sm:p-6 pb-20">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Yuqori Panel */}
        <div className="panel p-4 sm:p-5 bg-ink-900/90 border-line shadow-xl space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <GraduationCap size={20} className="text-sky" />
                <span className="text-[12px] font-bold text-fg-subtle tracking-wider uppercase">
                  Shahrisabz Abu Ali ibn Sino nomidagi JTSM
                </span>
              </div>
              <h1 className="text-[18px] sm:text-[22px] font-black text-fg tracking-tight">
                {share.fan}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
                <span>Guruh: <b className="text-fg">{share.guruh}</b></span>
                <span>·</span>
                <span>Semestr: <b className="text-fg">{share.semestr}-semestr</b></span>
                {share.teacherName && (
                  <>
                    <span>·</span>
                    <span className="text-sky-soft">O'qituvchi: <b>{share.teacherName}</b></span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Undo / Redo */}
              <div className="flex items-center gap-0.5 rounded-xl border border-line bg-ink-950 p-0.5">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  className="size-8 grid place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800 disabled:opacity-25 transition-all"
                  title="Bekor qilish (Ctrl + Z)"
                >
                  <Undo2 size={14} />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  className="size-8 grid place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800 disabled:opacity-25 transition-all"
                  title="Qaytarish (Ctrl + Y)"
                >
                  <Redo2 size={14} />
                </button>
              </div>

              {dirtyCount > 0 && (
                <span className="chip border-amber/50 bg-amber/10 text-amber font-bold">
                  {dirtyCount} ta o'zgarish
                </span>
              )}
              {savedSuccess && (
                <span className="chip border-emerald/50 bg-emerald/10 text-emerald-soft font-bold flex items-center gap-1">
                  <CheckCircle2 size={13} />
                  <span>Saqlandi</span>
                </span>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !dirtyCount}
                className="btn-success h-10 px-5 text-[13.5px] font-bold shadow-lg flex items-center gap-1.5"
                title="Saqlash (Ctrl + S)"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                <span>Saqlash</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11.5px] text-fg-subtle border-t border-line/60 pt-2.5">
            <div className="flex items-center gap-1.5">
              <Users size={13} className="text-emerald" />
              <span>Talabalar soni: <b className="text-fg">{students.length} nafar</b></span>
            </div>
            <div className="hidden sm:inline">
              Tezkor: <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg-muted font-mono">Ctrl+Z</kbd> bekor qilish, <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg-muted font-mono">Ctrl+Y</kbd> qaytarish, <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg-muted font-mono">Ctrl+S</kbd> saqlash, <kbd className="px-1 py-0.5 rounded bg-ink-800 text-fg-muted font-mono">Ctrl+V</kbd> Excel'dan joylash.
            </div>
          </div>
        </div>

        {/* Baholar Jadvali */}
        <div className="panel overflow-hidden border-line bg-ink-900 shadow-2xl">
          <div ref={tableRef} className="overflow-x-auto max-h-[75vh]">
            <table className="w-full text-left text-[13px] border-collapse">
              <thead className="sticky top-0 z-10 bg-ink-950/95 backdrop-blur-sm border-b border-line text-[11px] font-bold text-fg-subtle uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3 w-12 text-center">№</th>
                  <th className="py-3 px-4 min-w-[200px]">Talaba F.I.Sh.</th>
                  <th className="py-3 px-2 w-20 text-center">Yakuniy</th>
                  <th className="py-3 px-2 w-20 text-center">Joriy</th>
                  <th className="py-3 px-2 w-20 text-center">Oraliq</th>
                  <th className="py-3 px-2 w-24 text-center text-amber">R-semestr</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/40">
                {students.map((s, r) => (
                  <tr key={s.pinfl} className="hover:bg-ink-850/60 transition-colors">
                    <td className="py-2.5 px-3 text-center text-[12px] font-mono text-fg-muted">
                      {s.tartib}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-fg">
                      {s.name}
                    </td>
                    {cols.map((col, c) => {
                      const val = getShownVal(s.pinfl, col)
                      const isEdited = `${s.pinfl}|${col}` in edits
                      const isInvalid = val.trim() !== '' && parseBaho(val) === undefined

                      return (
                        <td key={col} className="py-2 px-2 text-center">
                          <input
                            data-cell={`${r}:${c}`}
                            type="text"
                            inputMode="numeric"
                            maxLength={1}
                            value={val}
                            onChange={(e) => handleCellChange(s.pinfl, col, e.target.value)}
                            onKeyDown={(e) => handleKeyNav(e, r, c)}
                            onPaste={(e) => handlePaste(e, r, c)}
                            onFocus={(e) => e.currentTarget.select()}
                            className={`h-9 w-12 rounded-lg border text-center text-[14px] font-bold tabular-nums outline-none transition-all ${
                              isInvalid
                                ? 'border-rose bg-rose/10 text-rose'
                                : isEdited
                                  ? 'border-amber/70 bg-amber/15 text-fg'
                                  : 'border-line bg-ink-950 text-fg focus:border-sky focus:ring-1 focus:ring-sky/40'
                            }`}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-3 bg-ink-950/80 border-t border-line text-[11.5px] text-fg-subtle flex items-center justify-between">
            <span>Baho faqat 2, 3, 4 yoki 5 kiritiladi. Bo'sh qoldirilsa baho belgilanmagan hisoblanadi.</span>
            <span className="font-semibold text-sky-soft">Shahrisabz Abu Ali ibn Sino nomidagi JTSM</span>
          </div>
        </div>
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
