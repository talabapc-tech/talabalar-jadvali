'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BookOpen, Briefcase, CheckCircle2, ClipboardList, Database, FileSpreadsheet, Loader2, Plus, Save, Sparkles, Trash2, Zap } from 'lucide-react'
import type { OquvReja } from '@/lib/curriculum'
import { GROUP_SETTINGS } from '@/lib/config'
import { academicGroups, byName, fullName, kursOf } from '@/lib/student'
import type { Student } from '@/lib/types'
import {
  BAHO_TURLARI, DEFAULT_AMALIYOT, KIRITILADIGAN, SEMESTRLAR, amaliyotReyting, bahoOf, bahoText, hisoblaReyting, parseBaho, reytingSeed,
  type AmaliyotRow, type BahoRow, type BaholarPayload, type Fan, type Kiritiladigan, type Reyting,
} from '@/lib/baholar'
import { exportBaholar, type ExportGrade } from '@/lib/baholar-excel'
import type { Notify } from './Toast'
import { cx } from './ui'

type SubView = 'baholar' | 'amaliyot'
type Birlik = 'ball5' | 'reyting'
const PREF_KEY = 'baholar_prefs_v2'
const AM_FIELDS = ['joy', 'boshlanish', 'tugash', 'ball', 'izoh'] as const
type AmField = (typeof AM_FIELDS)[number]

function readPrefs(): { guruh?: string; semestr?: number; view?: SubView; birlik?: Birlik } {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {} } catch { return {} }
}

const mean = (vals: (number | null)[], dec = 1) => {
  const n = vals.filter((v): v is number => v !== null)
  if (!n.length) return null
  const k = 10 ** dec
  return Math.round((n.reduce((a, b) => a + b, 0) / n.length) * k) / k
}

/** Bahoga qarab matn rangi: 5 — yashil, 4 — ko'k, 3 — sariq, 2 — qizil */
const BAHO_RANG: Record<number, string> = { 5: 'text-emerald-soft', 4: 'text-sky-soft', 3: 'text-amber', 2: 'text-rose' }

const cellCls = (changed: boolean, bad: boolean) => cx(
  'h-8 w-11 rounded-md border bg-ink-950/70 text-center text-base font-semibold tabular-nums text-fg outline-none transition-colors sm:text-[13px]',
  'focus:border-sky/70 focus:ring-2 focus:ring-sky/20',
  bad ? 'border-rose bg-rose/10 text-rose' : changed ? 'border-amber/60 bg-amber/10' : 'border-line',
)

interface Calc { g: Record<Kiritiladigan, number | null>; rey: Reyting }

export default function BaholarSection({ students, notify }: { students: Student[]; notify: Notify }) {
  const groups = useMemo(() => academicGroups(students), [students])
  const [guruh, setGuruh] = useState('')
  const [semestr, setSemestr] = useState<number>(1)
  const [view, setView] = useState<SubView>('baholar')
  const [birlik, setBirlik] = useState<Birlik>('ball5')
  const [data, setData] = useState<BaholarPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ text: string; setup: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})       // baholar: pinfl|fan|key
  const [amEdits, setAmEdits] = useState<Record<string, string>>({})   // amaliyot: pinfl|field
  const [newFan, setNewFan] = useState('')
  const [amNom, setAmNom] = useState(DEFAULT_AMALIYOT)
  const [newAm, setNewAm] = useState('')
  const [bulk, setBulk] = useState({ joy: '', boshlanish: '', tugash: '' })
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [curriculumPlan, setCurriculumPlan] = useState<OquvReja | null>(null)
  const [curriculumLoading, setCurriculumLoading] = useState(false)
  const [importingPlan, setImportingPlan] = useState(false)
  const tableRef = useRef<HTMLDivElement>(null)

  /* ---------------------------- tanlov (guruh, semestr) ---------------------------- */

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
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ guruh, semestr, view, birlik })) } catch { /* bo'sh */ }
  }, [guruh, semestr, view, birlik, prefsLoaded])

  const list = useMemo(() => students.filter((s) => s.group.trim() === guruh).sort(byName), [students, guruh])
  const rows = useMemo(() => list.filter((s) => s.pinfl), [list])
  const noPinfl = useMemo(() => list.filter((s) => !s.pinfl), [list])

  const dirty = Object.keys(edits).length + Object.keys(amEdits).length
  const confirmLeave = useCallback(
    () => dirty === 0 || window.confirm("Saqlanmagan o'zgarishlar bor. Ular yo'qoladi. Davom etasizmi?"),
    [dirty],
  )
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  /* ---------------------------- yuklash ---------------------------- */

  const load = useCallback(async () => {
    if (!guruh) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/baholar?guruh=${encodeURIComponent(guruh)}&semestr=${semestr}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) { setData(null); setError({ text: body.error || `Server ${res.status} qaytardi`, setup: !!body.setup }); return }
      setData(body as BaholarPayload)
      setEdits({})
      setAmEdits({})
    } catch (e) {
      setData(null)
      setError({ text: (e as Error).message, setup: false })
    } finally {
      setLoading(false)
    }
  }, [guruh, semestr])
  useEffect(() => { if (prefsLoaded && guruh) void load() }, [load, prefsLoaded, guruh])

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/baholar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guruh, semestr, ...payload }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.ok) throw new Error(body.error || `Server ${res.status} qaytardi`)
    return body as { ok: true; saved?: number; removed?: number }
  }, [guruh, semestr])

  /* ---------------------------- o'quv rejasini yuklash ---------------------------- */

  const loadCurriculum = useCallback(async (g: string) => {
    if (!g) { setCurriculumPlan(null); return }
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

  // O'quv rejasidan fanlarni bazaga yuklash
  const importSubjectsFromPlan = async () => {
    if (!curriculumPlan || !guruh) return
    const semSubjects = curriculumPlan.semestrlar?.[String(semestr)]?.fanlar || []
    if (!semSubjects.length) {
      notify(`O'quv rejasida ${semestr}-semestr uchun fanlar topilmadi`, 'error')
      return
    }

    setImportingPlan(true)
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
      const body = await res.json()
      if (body.ok) {
        notify(`${semSubjects.length} ta fan o'quv rejasidan avtomatik yuklandi!`, 'success')
        await load()
      } else {
        notify(body.error || 'Yuklashda xatolik', 'error')
      }
    } catch (e) {
      notify(`Xatolik: ${(e as Error).message}`, 'error')
    } finally {
      setImportingPlan(false)
    }
  }

  /* ---------------------------- fanlar bo'yicha baholar ---------------------------- */

  const fanlar: Fan[] = data?.fanlar ?? []
  const bahoMap = useMemo(() => {
    const m = new Map<string, BahoRow>()
    for (const b of data?.baholar ?? []) m.set(`${b.pinfl}|${b.fan}`, b)
    return m
  }, [data])

  const serverText = useCallback((pinfl: string, fan: string, key: Kiritiladigan) => bahoText(bahoMap.get(`${pinfl}|${fan}`)?.[key]), [bahoMap])
  const shown = useCallback((pinfl: string, fan: string, key: Kiritiladigan) => edits[`${pinfl}|${fan}|${key}`] ?? serverText(pinfl, fan, key), [edits, serverText])

  /** Har bir talaba × fan uchun baholar va avtomatik reyting. O'zgartirilmagan qator — bazada saqlangan qiymat bilan. */
  const calc = useMemo(() => {
    const m = new Map<string, Calc>()
    for (const s of rows) {
      for (const f of fanlar) {
        const key = `${s.pinfl}|${f.nom}`
        const stored = bahoMap.get(key)
        const touched = KIRITILADIGAN.some((k) => `${key}|${k}` in edits)
        const g = { yakuniy: null, joriy: null, oraliq: null } as Record<Kiritiladigan, number | null>
        for (const k of KIRITILADIGAN) { const v = parseBaho(edits[`${key}|${k}`] ?? bahoText(stored?.[k])); g[k] = v === undefined ? null : v }
        const hasStored = !!stored && (stored.yakuniy100 !== null || stored.joriy100 !== null || stored.oraliq100 !== null)
        const rey: Reyting = !touched && stored && hasStored
          ? { yakuniy100: stored.yakuniy100, joriy100: stored.joriy100, oraliq100: stored.oraliq100, r100: stored.r100, r_semestr: stored.r_semestr }
          : hisoblaReyting(reytingSeed(s.pinfl, semestr, f.nom), g)
        m.set(key, { g, rey })
      }
    }
    return m
  }, [rows, fanlar, bahoMap, edits, semestr])

  const setCell = (pinfl: string, fan: string, key: Kiritiladigan, value: string) => {
    const k = `${pinfl}|${fan}|${key}`
    setEdits((e) => {
      const next = { ...e }
      if (value.trim() === serverText(pinfl, fan, key)) delete next[k]
      else next[k] = value
      return next
    })
  }

  const invalidCount = useMemo(() => Object.values(edits).filter((v) => parseBaho(v) === undefined).length, [edits])

  const saveBaholar = async () => {
    if (invalidCount) { notify("Noto'g'ri baholar bor (qizil katak): faqat 2, 3, 4 yoki 5", 'error'); return }
    const pairs = new Set(Object.keys(edits).map((k) => k.split('|').slice(0, 2).join('|')))
    const items = [...pairs].map((p) => {
      const [pinfl, fan] = p.split('|')
      const item: Record<string, string> = { pinfl, fan }
      for (const k of KIRITILADIGAN) item[k] = shown(pinfl, fan, k)
      return item
    })
    setSaving(true)
    try {
      await post({ action: 'saveBaholar', items })
      notify(`${items.length} ta qator saqlandi (reyting avtomatik hisoblandi)`)
      await load()
    } catch (e) {
      notify(`Saqlanmadi: ${(e as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const addFan = async () => {
    const nom = newFan.trim()
    if (!nom) return
    if (fanlar.some((f) => f.nom.toLowerCase() === nom.toLowerCase())) { notify(`"${nom}" fani allaqachon bor`, 'warning'); return }
    try {
      await post({ action: 'addFan', nom })
      setNewFan('')
      const keep = edits
      await load()
      setEdits(keep)
      notify(`"${nom}" fani qo'shildi`)
    } catch (e) {
      notify(`Fan qo'shilmadi: ${(e as Error).message}`, 'error')
    }
  }

  const deleteFan = async (nom: string) => {
    const count = (data?.baholar ?? []).filter((b) => b.fan === nom).length
    if (!window.confirm(`"${nom}" fani o'chirilsinmi?${count ? ` Unga kiritilgan ${count} ta talabaning baholari ham o'chadi.` : ''}`)) return
    try {
      await post({ action: 'deleteFan', nom })
      const keep = Object.fromEntries(Object.entries(edits).filter(([k]) => k.split('|')[1] !== nom))
      await load()
      setEdits(keep)
      notify(`"${nom}" fani o'chirildi`, 'warning')
    } catch (e) {
      notify(`O'chirilmadi: ${(e as Error).message}`, 'error')
    }
  }

  /** Strelka/Enter bilan jadvalda yurish: katak (qator:ustun) */
  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const d = e.key === 'ArrowDown' || e.key === 'Enter' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    tableRef.current?.querySelector<HTMLInputElement>(`[data-cell="${r + d}:${c}"]`)?.focus()
  }

  /** Jadvalda ko'rsatiladigan son: 5 ball yoki reyting */
  const cellValue = (c: Calc | undefined, key: (typeof BAHO_TURLARI)[number]['key']): number | null => {
    if (!c) return null
    if (birlik === 'reyting') return key === 'yakuniy' ? c.rey.yakuniy100 : key === 'joriy' ? c.rey.joriy100 : key === 'oraliq' ? c.rey.oraliq100 : c.rey.r100
    return key === 'r_semestr' ? c.rey.r_semestr : c.g[key]
  }
  const fmt = (v: number | null) => (v === null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(2))
  const rangOf = (v: number | null) => (v === null ? 'text-fg-subtle' : BAHO_RANG[birlik === 'reyting' ? bahoOf(v) : Math.round(v)] ?? '')

  /* ---------------------------- malakaviy amaliyot ---------------------------- */

  const amNoms = useMemo(() => {
    const s = new Set((data?.amaliyot ?? []).map((a) => a.nom))
    s.add(amNom)
    return [...s]
  }, [data, amNom])
  useEffect(() => {
    // Yuklangan ma'lumotda amaliyot bo'lsa va tanlangan nom unda yo'q bo'lsa — birinchisini tanlash
    const noms = (data?.amaliyot ?? []).map((a) => a.nom)
    if (noms.length && !noms.includes(amNom) && amNom === DEFAULT_AMALIYOT) setAmNom(noms[0])
  }, [data, amNom])

  const amMap = useMemo(() => {
    const m = new Map<string, AmaliyotRow>()
    for (const a of data?.amaliyot ?? []) m.set(`${a.pinfl}|${a.nom}`, a)
    return m
  }, [data])
  const amServer = useCallback((pinfl: string, f: AmField, nom = amNom): string => {
    const r = amMap.get(`${pinfl}|${nom}`)
    return r ? (f === 'ball' ? bahoText(r.ball) : r[f]) : ''
  }, [amMap, amNom])
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
  const amInvalid = useMemo(
    () => Object.entries(amEdits).filter(([k, v]) => k.endsWith('|ball') && parseBaho(v) === undefined).length,
    [amEdits],
  )
  /** Amaliyot bahosining reytingi: o'zgartirilmagan — bazadagi, o'zgartirilgan — hisoblangan */
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
    if (amInvalid) { notify("Noto'g'ri baho bor (qizil katak): faqat 2, 3, 4 yoki 5", 'error'); return }
    const pinfls = new Set(Object.keys(amEdits).map((k) => k.split('|')[0]))
    const items = [...pinfls].map((pinfl) => {
      const item: Record<string, string> = { pinfl }
      for (const f of AM_FIELDS) item[f] = amShown(pinfl, f)
      return item
    })
    setSaving(true)
    try {
      await post({ action: 'saveAmaliyot', nom: amNom, items })
      notify(`${items.length} ta qator saqlandi`)
      await load()
    } catch (e) {
      notify(`Saqlanmadi: ${(e as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  /* ---------------------------- Excel ---------------------------- */

  const onExport = async () => {
    try {
      const amaliyot: Parameters<typeof exportBaholar>[0]['amaliyot'] = []
      for (const nom of amNoms) {
        for (const s of rows) {
          const cur = nom === amNom
          const get = (f: AmField) => (cur ? amShown(s.pinfl, f) : amServer(s.pinfl, f, nom))
          const ball = parseBaho(get('ball'))
          const b = ball === undefined ? null : ball
          const r = {
            name: fullName(s), nom, joy: get('joy'), boshlanish: get('boshlanish'), tugash: get('tugash'), ball: b,
            ball100: cur ? amReyting(s.pinfl) : (amMap.get(`${s.pinfl}|${nom}`)?.ball100 ?? null), izoh: get('izoh'),
          }
          if (r.joy || r.boshlanish || r.tugash || r.ball !== null || r.izoh) amaliyot.push(r)
        }
      }
      const yillik = rows.map((s) => /(\d)\s*yillik/i.exec(s.yon || '')?.[1]).find(Boolean)
      await exportBaholar({
        guruh, semestr,
        rahbar: GROUP_SETTINGS[guruh]?.rahbar ?? '',
        davomiylik: yillik ? `${yillik} yillik` : '',
        talabalar: rows.map((s) => ({ name: fullName(s) })),
        fanlar: fanlar.map((f) => f.nom),
        grade: (i, fan): ExportGrade => {
          const c = calc.get(`${rows[i].pinfl}|${fan}`)
          return {
            y: c?.g.yakuniy ?? null, j: c?.g.joriy ?? null, o: c?.g.oraliq ?? null, r: c?.rey.r_semestr ?? null,
            y100: c?.rey.yakuniy100 ?? null, j100: c?.rey.joriy100 ?? null, o100: c?.rey.oraliq100 ?? null, r100: c?.rey.r100 ?? null,
          }
        },
        amaliyot,
      })
      notify('Excel fayl yuklandi')
    } catch (e) {
      notify(`Excel yaratilmadi: ${(e as Error).message}`, 'error')
    }
  }

  /* ---------------------------- ko'rinish ---------------------------- */

  const canSave = view === 'baholar' ? Object.keys(edits).length > 0 && !invalidCount : Object.keys(amEdits).length > 0 && !amInvalid
  const groupsByKurs = useMemo(() => {
    const m = new Map<number, string[]>()
    for (const g of groups) m.set(kursOf(g) ?? 0, [...(m.get(kursOf(g) ?? 0) ?? []), g])
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [groups])

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-end">
          <div className="sm:w-44">
            <label className="label" htmlFor="b-guruh">Guruh</label>
            <select
              id="b-guruh" className="field cursor-pointer" value={guruh}
              onChange={(e) => { if (confirmLeave()) setGuruh(e.target.value) }}
            >
              {groupsByKurs.map(([k, gs]) => (
                <optgroup key={k} label={k ? `${k}-kurs` : 'Boshqa'}>
                  {gs.map((g) => <option key={g} value={g}>{g}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="sm:w-40">
            <label className="label" htmlFor="b-sem">Semestr</label>
            <select
              id="b-sem" className="field cursor-pointer" value={semestr}
              onChange={(e) => { if (confirmLeave()) setSemestr(Number(e.target.value)) }}
            >
              {SEMESTRLAR.map((s) => <option key={s} value={s}>{s}-semestr</option>)}
            </select>
          </div>

          <div className="col-span-2 flex gap-1 rounded-xl border border-line bg-ink-900/60 p-1 sm:col-span-1">
            {([
              ['baholar', ClipboardList, 'Fanlar bo\'yicha baholar', 'Baholar'],
              ['amaliyot', Briefcase, 'Malakaviy amaliyot', 'Amaliyot'],
            ] as const).map(([v, Icon, t, short]) => (
              <button
                key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                className={cx(
                  'flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12.5px] font-bold transition-colors sm:flex-none',
                  view === v ? 'bg-gradient-to-r from-blue/80 to-sky/80 text-white' : 'text-fg-muted hover:text-fg',
                )}
              >
                <Icon size={15} className="shrink-0" />
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{t}</span>
              </button>
            ))}
          </div>

          <div className="col-span-2 flex items-center gap-2 sm:ml-auto sm:col-span-1">
            {dirty > 0 && <span className="chip border-amber/50 bg-amber/10 text-amber">{dirty} ta o'zgarish</span>}
            <button type="button" className="btn-ghost h-9 px-3" onClick={onExport} disabled={!data || !rows.length} title="Admin uchun Excel: reyting (100 ball), 5 ballik varaq, 1–4-shakl va fan hisobotlari">
              <FileSpreadsheet size={15} /> <span className="hidden sm:inline">Excel</span>
            </button>
            <button
              type="button" className="btn-success h-9 flex-1 px-4 sm:flex-none"
              onClick={view === 'baholar' ? saveBaholar : saveAmaliyot} disabled={!canSave || saving}
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Saqlash
            </button>
          </div>
        </div>

        {noPinfl.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              JSHSHIR kiritilmagan talabalarga baho yozib bo'lmaydi ({noPinfl.length} ta): {noPinfl.map(fullName).join(', ')}.
              Avval Talabalar bo'limida JSHSHIR kiriting.
            </span>
          </div>
        )}
      </div>

      {error?.setup && (
        <div className="panel space-y-3 border-amber/40 bg-amber/5 p-4 sm:p-5">
          <div className="flex items-center gap-2 text-[14px] font-bold text-amber"><Database size={16} /> Baholar jadvallari hali yaratilmagan</div>
          <ol className="list-decimal space-y-1 pl-5 text-[13px] text-fg-muted">
            <li>Supabase panelida portal bazasini oching → <b className="text-fg">SQL Editor</b>.</li>
            <li><code className="mono rounded bg-ink-800 px-1.5 py-0.5 text-sky-soft">web/supabase/baholar.sql</code> faylining butun matnini qo'yib, <b className="text-fg">Run</b> bosing (bir marta yetadi).</li>
            <li>Shu yerda «Qayta tekshirish» tugmasini bosing.</li>
          </ol>
          <button type="button" className="btn-primary h-9 px-4" onClick={load}>Qayta tekshirish</button>
        </div>
      )}
      {error && !error.setup && (
        <div className="panel flex flex-wrap items-center gap-3 border-rose/40 bg-rose/5 p-4 text-[13px] text-rose">
          <AlertTriangle size={16} /> <span className="min-w-0 flex-1">{error.text}</span>
          <button type="button" className="btn-ghost h-9 px-3" onClick={load}>Qayta urinish</button>
        </div>
      )}

      {loading && !data && !error && (
        <div className="panel flex items-center gap-2 px-4 py-10 text-[13px] text-fg-muted"><Loader2 size={16} className="animate-spin text-sky" /> Baholar yuklanmoqda…</div>
      )}

      {data && view === 'baholar' && (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <div className="text-[13px] font-bold text-fg">{guruh} · {semestr}-semestr</div>
            <span className="chip border-line bg-ink-800/60 text-fg-muted">{rows.length} talaba</span>
            <span className="chip border-line bg-ink-800/60 text-fg-muted">{fanlar.length} fan</span>

            {/* O'quv reja holati va nishoni */}
            {curriculumLoading ? (
              <span className="chip border-line bg-ink-800/40 text-[11px] text-fg-subtle">
                <Loader2 size={11} className="animate-spin text-sky" /> Reja tekshirilmoqda…
              </span>
            ) : curriculumPlan ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="chip border-indigo-500/40 bg-indigo-500/15 text-indigo-300 text-[11px] font-bold">
                  <BookOpen size={12} className="text-indigo-400" />
                  <span>{curriculumPlan.yonalish} ({curriculumPlan.muddati})</span>
                </span>
                {curriculumPlan.semestrlar?.[String(semestr)]?.fanlar?.length ? (
                  <button
                    type="button"
                    onClick={importSubjectsFromPlan}
                    disabled={importingPlan}
                    className="chip border-emerald/50 bg-emerald/15 text-emerald-soft text-[11px] font-bold hover:bg-emerald/25 transition-colors"
                    title={`O'quv rejasidagi ${curriculumPlan.semestrlar[String(semestr)].fanlar.length} ta fanni bazaga yuklash / yangilash`}
                  >
                    {importingPlan ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} className="text-amber" />}
                    <span>Rejadagi fanlarni sinxronlash</span>
                  </button>
                ) : null}
              </div>
            ) : (
              <span className="chip border-amber/30 bg-amber/10 text-amber text-[11px]">
                Rejaga biriktirilmagan
              </span>
            )}
            {loading && <Loader2 size={14} className="animate-spin text-sky" />}
            <div className="flex gap-1 rounded-xl border border-line bg-ink-900/60 p-0.5" role="group" aria-label="Ko'rinish">
              {([['ball5', '5 ball'], ['reyting', 'Reyting (100)']] as const).map(([v, t]) => (
                <button
                  key={v} type="button" aria-pressed={birlik === v} onClick={() => setBirlik(v)}
                  className={cx('rounded-lg px-2.5 py-1 text-[12px] font-bold transition-colors', birlik === v ? 'bg-ink-700 text-fg' : 'text-fg-muted hover:text-fg')}
                >{t}</button>
              ))}
            </div>
            <form className="flex w-full gap-2 sm:ml-auto sm:w-auto" onSubmit={(e) => { e.preventDefault(); void addFan() }}>
              <input className="field h-9 min-w-0 flex-1 sm:w-60" placeholder="Yangi fan nomi" value={newFan} maxLength={120} onChange={(e) => setNewFan(e.target.value)} aria-label="Yangi fan nomi" />
              <button type="submit" className="btn-primary h-9 shrink-0 px-3" disabled={!newFan.trim()}><Plus size={15} /> Fan</button>
            </form>
          </div>

          {fanlar.length === 0 ? (
            <div className="grid place-items-center gap-2 px-6 py-14 text-center max-w-lg mx-auto">
              <ClipboardList size={32} className="text-fg-subtle" />
              <div className="text-[15px] font-bold text-fg">{guruh} guruhida {semestr}-semestr uchun fan hali kiritilmagan</div>
              {curriculumPlan && curriculumPlan.semestrlar?.[String(semestr)]?.fanlar?.length ? (
                <div className="space-y-3 pt-1">
                  <div className="text-[12.5px] text-fg-muted">
                    Ushbu guruh <b className="text-fg">{curriculumPlan.yonalish} ({curriculumPlan.muddati})</b> o'quv rejasiga biriktirilgan.
                    Rejada {semestr}-semestr uchun <b className="text-sky-soft">{curriculumPlan.semestrlar[String(semestr)].fanlar.length} ta fan</b> belgilangan.
                  </div>
                  <button
                    type="button"
                    onClick={importSubjectsFromPlan}
                    disabled={importingPlan}
                    className="btn-success mx-auto h-10 px-5 text-[13.5px] font-bold shadow-lg"
                  >
                    {importingPlan ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} className="text-amber" />}
                    <span>Rejadagi {curriculumPlan.semestrlar[String(semestr)].fanlar.length} ta fanni yuklash va jadvalni ochish</span>
                  </button>
                </div>
              ) : (
                <div className="text-[12.5px] text-fg-muted">
                  Yuqoridagi formadan fan nomini yozib «Fan» tugmasini bosing yoki O'quv reja bo'limidan ushbu guruhga o'quv reja biriktiring.
                </div>
              )}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-14 text-center text-[13px] text-fg-muted">Bu guruhda talaba yo'q.</div>
          ) : (
            <div ref={tableRef} className="max-h-[62vh] sm:max-h-[72vh] overflow-auto">
              <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th rowSpan={2} className="sticky left-0 z-30 w-8 sm:w-10 border-b border-r border-line bg-ink-900 px-1.5 sm:px-2 py-2 text-center text-[11px] font-bold text-fg-subtle">№</th>
                    <th rowSpan={2} className="sticky left-8 sm:left-10 z-30 min-w-[8.5rem] sm:min-w-[13rem] max-w-[10.5rem] sm:max-w-none border-b border-r border-line bg-ink-900 px-2 sm:px-3 py-2 text-left text-[11px] font-bold tracking-wider text-fg-subtle uppercase">F.I.Sh.</th>
                    {fanlar.map((f) => (
                      <th key={f.nom} colSpan={4} className="border-b border-r border-line bg-ink-900 px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="max-w-[14rem] truncate text-[12.5px] font-bold text-fg" title={f.nom}>{f.nom}</span>
                          <button type="button" onClick={() => deleteFan(f.nom)} className="rounded p-0.5 text-fg-subtle hover:bg-rose/15 hover:text-rose" title={`"${f.nom}" fanini o'chirish`} aria-label={`${f.nom} fanini o'chirish`}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </th>
                    ))}
                    <th rowSpan={2} className="border-b border-line bg-ink-900 px-3 py-2 text-center text-[11px] font-bold tracking-wider text-fg-subtle uppercase">O'rtacha<br />R-semestr</th>
                  </tr>
                  <tr>
                    {fanlar.map((f) => BAHO_TURLARI.map((t, ti) => (
                      <th key={f.nom + t.key} className={cx('border-b border-line px-1 py-1 text-center text-[10.5px] font-bold', t.key === 'r_semestr' ? 'bg-amber/10 text-amber' : 'bg-ink-850 text-fg-muted', ti === BAHO_TURLARI.length - 1 && 'border-r')}>{t.label}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, r) => {
                    const rs = fanlar.map((f) => cellValue(calc.get(`${s.pinfl}|${f.nom}`), 'r_semestr'))
                    const m = mean(rs, birlik === 'reyting' ? 2 : 1)
                    return (
                      <tr key={s.row} className="group">
                        <td className="sticky left-0 z-10 w-8 sm:w-10 border-b border-r border-line bg-ink-900 px-1.5 sm:px-2 py-1 text-center text-[11.5px] sm:text-[12px] tabular-nums text-fg-subtle group-hover:bg-ink-800">{r + 1}</td>
                        <td className="sticky left-8 sm:left-10 z-10 min-w-[8.5rem] sm:min-w-[13rem] max-w-[10.5rem] sm:max-w-none truncate border-b border-r border-line bg-ink-900 px-2 sm:px-3 py-1 font-medium text-fg group-hover:bg-ink-800" title={fullName(s)}>{fullName(s)}</td>
                        {fanlar.map((f, fi) => BAHO_TURLARI.map((t, ti) => {
                          const last = ti === BAHO_TURLARI.length - 1
                          const c = calc.get(`${s.pinfl}|${f.nom}`)
                          if (t.key === 'r_semestr' || birlik === 'reyting') {
                            const v = cellValue(c, t.key)
                            return (
                              <td key={f.nom + t.key} className={cx('border-b border-line px-1 py-1 text-center tabular-nums', t.key === 'r_semestr' ? 'bg-amber/5 font-bold' : 'font-semibold', rangOf(v), last && 'border-r')}
                                title={t.key === 'r_semestr' ? 'Avtomatik: uchala bahoning o\'rtachasi' : 'Avtomatik hosil qilingan reyting'}>
                                {fmt(v)}
                              </td>
                            )
                          }
                          const key = t.key as Kiritiladigan
                          const v = shown(s.pinfl, f.nom, key)
                          const changed = `${s.pinfl}|${f.nom}|${key}` in edits
                          return (
                            <td key={f.nom + t.key} className="border-b border-line px-0.5 py-1 text-center">
                              <input
                                data-cell={`${r}:${fi * 4 + ti}`}
                                inputMode="numeric" autoComplete="off" maxLength={1} value={v}
                                className={cellCls(changed, parseBaho(v) === undefined)}
                                aria-label={`${fullName(s)} — ${f.nom} — ${t.label}`}
                                onChange={(e) => setCell(s.pinfl, f.nom, key, e.target.value)}
                                onKeyDown={(e) => onCellKey(e, r, fi * 4 + ti)}
                                onFocus={(e) => e.currentTarget.select()}
                              />
                            </td>
                          )
                        }))}
                        <td className={cx('border-b border-line px-3 py-1 text-center font-bold tabular-nums', rangOf(m))}>{m ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-20">
                  <tr>
                    <td className="sticky left-0 z-30 w-8 sm:w-10 border-t border-r border-line bg-ink-850" />
                    <td className="sticky left-8 sm:left-10 z-30 min-w-[8.5rem] sm:min-w-[13rem] border-t border-r border-line bg-ink-850 px-2 sm:px-3 py-1.5 text-[11.5px] sm:text-[12px] font-bold text-fg-muted">Guruh o'rtachasi</td>
                    {fanlar.map((f) => BAHO_TURLARI.map((t, ti) => {
                      const a = mean(rows.map((s) => cellValue(calc.get(`${s.pinfl}|${f.nom}`), t.key)), birlik === 'reyting' ? 1 : 2)
                      return <td key={f.nom + t.key} className={cx('border-t border-line bg-ink-850 py-1.5 text-center text-[12px] font-semibold tabular-nums text-fg-muted', ti === BAHO_TURLARI.length - 1 && 'border-r')}>{a ?? '—'}</td>
                    }))}
                    <td className="border-t border-line bg-ink-850 px-3 py-1.5 text-center text-[12px] font-bold tabular-nums text-emerald-soft">
                      {mean(rows.map((s) => mean(fanlar.map((f) => cellValue(calc.get(`${s.pinfl}|${f.nom}`), 'r_semestr')), 2)), 2) ?? '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <div className="border-t border-line px-3 py-2 text-[11.5px] leading-relaxed text-fg-subtle">
            {birlik === 'ball5'
              ? <>Baho 5 ballik: faqat 2, 3, 4 yoki 5. R-semestr avtomatik (uchala bahoning o'rtachasi). Katakdan katakka ↑ ↓ / Enter bilan yuring. Sariq katak — saqlanmagan o'zgarish.</>
              : <>Reyting (100 ball) — admin uchun: har bir baho o'z oralig'idan ball oladi (5 → 87–95, 4 → 71–85, 3 → 65–70, 2 → 45–54), R-semestr — uchala reytingning o'rtachasi. Ballar avtomatik hosil qilinadi va bazada saqlanadi; tahrirlash uchun «5 ball» ko'rinishiga o'ting.</>}
          </div>
        </div>
      )}

      {data && view === 'amaliyot' && (
        <div className="panel overflow-hidden">
          <div className="space-y-3 border-b border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[13px] font-bold text-fg">{guruh} · {semestr}-semestr</div>
              {loading && <Loader2 size={14} className="animate-spin text-sky" />}
              <div className="flex flex-wrap gap-1.5">
                {amNoms.map((n) => (
                  <button
                    key={n} type="button" onClick={() => pickAm(n)} aria-pressed={n === amNom}
                    className={cx('chip cursor-pointer', n === amNom ? 'border-sky/50 bg-sky/15 text-sky-soft' : 'border-line bg-ink-800/60 text-fg-muted hover:text-fg')}
                  >{n}</button>
                ))}
              </div>
              <form className="flex w-full gap-2 sm:ml-auto sm:w-auto" onSubmit={(e) => { e.preventDefault(); createAm() }}>
                <input className="field h-9 min-w-0 flex-1 sm:w-60" placeholder="Yangi amaliyot nomi" value={newAm} maxLength={120} onChange={(e) => setNewAm(e.target.value)} aria-label="Yangi amaliyot nomi" />
                <button type="submit" className="btn-primary h-9 shrink-0 px-3" disabled={!newAm.trim()}><Plus size={15} /> Amaliyot</button>
              </form>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto] sm:items-end">
              <div>
                <label className="label" htmlFor="bulk-joy">Hammaga: amaliyot joyi</label>
                <input id="bulk-joy" className="field h-9" placeholder="Masalan: Shahrisabz tuman tibbiyot birlashmasi" value={bulk.joy} onChange={(e) => setBulk((b) => ({ ...b, joy: e.target.value }))} />
              </div>
              <div>
                <label className="label" htmlFor="bulk-bosh">Boshlanish</label>
                <input id="bulk-bosh" type="date" className="field h-9" value={bulk.boshlanish} onChange={(e) => setBulk((b) => ({ ...b, boshlanish: e.target.value }))} />
              </div>
              <div>
                <label className="label" htmlFor="bulk-tug">Tugash</label>
                <input id="bulk-tug" type="date" className="field h-9" value={bulk.tugash} onChange={(e) => setBulk((b) => ({ ...b, tugash: e.target.value }))} />
              </div>
              <button type="button" className="btn-ghost h-9 px-3" onClick={applyBulk} disabled={!bulk.joy.trim() && !bulk.boshlanish && !bulk.tugash}>Hammaga qo'llash</button>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="px-6 py-14 text-center text-[13px] text-fg-muted">Bu guruhda talaba yo'q.</div>
          ) : (
            <div ref={tableRef} className="max-h-[60vh] sm:max-h-[68vh] overflow-auto">
              <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
                <thead className="sticky top-0 z-20">
                  <tr className="text-[11px] font-bold tracking-wider text-fg-subtle uppercase">
                    <th className="sticky left-0 z-30 w-8 sm:w-10 border-b border-r border-line bg-ink-900 px-1.5 sm:px-2 py-2">№</th>
                    <th className="sticky left-8 sm:left-10 z-30 min-w-[8.5rem] sm:min-w-[13rem] max-w-[10.5rem] sm:max-w-none border-b border-r border-line bg-ink-900 px-2 sm:px-3 py-2 text-left">F.I.Sh.</th>
                    <th className="min-w-[16rem] border-b border-line bg-ink-900 px-2 py-2 text-left">Amaliyot joyi</th>
                    <th className="border-b border-line bg-ink-900 px-2 py-2">Boshlanish</th>
                    <th className="border-b border-line bg-ink-900 px-2 py-2">Tugash</th>
                    <th className="border-b border-line bg-ink-900 px-2 py-2">Baho</th>
                    <th className="border-b border-line bg-ink-900 px-2 py-2" title="Avtomatik hosil qilinadi">Reyting</th>
                    <th className="min-w-[12rem] border-b border-line bg-ink-900 px-2 py-2 text-left">Izoh</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, r) => {
                    const ch = (f: AmField) => `${s.pinfl}|${f}` in amEdits
                    const ball = amShown(s.pinfl, 'ball')
                    const rey = amReyting(s.pinfl)
                    const txt = (f: AmField, extra = '') => cx('field h-8 py-0', extra, ch(f) && 'border-amber/60 bg-amber/10')
                    return (
                      <tr key={s.row} className="group">
                        <td className="sticky left-0 z-10 w-8 sm:w-10 border-b border-r border-line bg-ink-900 px-1.5 sm:px-2 py-1 text-center text-[11.5px] sm:text-[12px] tabular-nums text-fg-subtle group-hover:bg-ink-800">{r + 1}</td>
                        <td className="sticky left-8 sm:left-10 z-10 min-w-[8.5rem] sm:min-w-[13rem] max-w-[10.5rem] sm:max-w-none truncate border-b border-r border-line bg-ink-900 px-2 sm:px-3 py-1 font-medium text-fg group-hover:bg-ink-800" title={fullName(s)}>{fullName(s)}</td>
                        <td className="border-b border-line px-1 py-1"><input className={txt('joy')} value={amShown(s.pinfl, 'joy')} maxLength={200} onChange={(e) => setAm(s.pinfl, 'joy', e.target.value)} aria-label={`${fullName(s)} — amaliyot joyi`} /></td>
                        <td className="border-b border-line px-1 py-1"><input type="date" className={txt('boshlanish', 'w-[9.5rem]')} value={amShown(s.pinfl, 'boshlanish')} onChange={(e) => setAm(s.pinfl, 'boshlanish', e.target.value)} aria-label={`${fullName(s)} — boshlanish`} /></td>
                        <td className="border-b border-line px-1 py-1"><input type="date" className={txt('tugash', 'w-[9.5rem]')} value={amShown(s.pinfl, 'tugash')} onChange={(e) => setAm(s.pinfl, 'tugash', e.target.value)} aria-label={`${fullName(s)} — tugash`} /></td>
                        <td className="border-b border-line px-1 py-1 text-center">
                          <input
                            data-cell={`${r}:0`} inputMode="numeric" autoComplete="off" maxLength={1} value={ball}
                            className={cellCls(ch('ball'), parseBaho(ball) === undefined)}
                            aria-label={`${fullName(s)} — baho`}
                            onChange={(e) => setAm(s.pinfl, 'ball', e.target.value)}
                            onKeyDown={(e) => onCellKey(e, r, 0)}
                            onFocus={(e) => e.currentTarget.select()}
                          />
                        </td>
                        <td className={cx('border-b border-line px-2 py-1 text-center font-semibold tabular-nums', rey === null ? 'text-fg-subtle' : BAHO_RANG[bahoOf(rey)])}>{rey ?? '—'}</td>
                        <td className="border-b border-line px-1 py-1"><input className={txt('izoh')} value={amShown(s.pinfl, 'izoh')} maxLength={500} onChange={(e) => setAm(s.pinfl, 'izoh', e.target.value)} aria-label={`${fullName(s)} — izoh`} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-line px-3 py-2 text-[11.5px] text-fg-subtle">
            «{amNom}» — {rows.filter((s) => amShown(s.pinfl, 'ball')).length}/{rows.length} talabaga baho qo'yilgan (2–5). Reyting (100 ball) avtomatik hosil qilinadi. Bo'sh qoldirilgan qator bazadan o'chiriladi.
          </div>
        </div>
      )}
    </div>
  )
}
