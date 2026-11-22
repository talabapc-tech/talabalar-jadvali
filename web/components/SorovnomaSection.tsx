'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Copy,
  Database,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  Unlock,
  Users,
} from 'lucide-react'
import { COURSES } from '@/lib/config'
import { groupOrder } from '@/lib/excel-build'
import {
  AUDIENCE_META,
  formatAnswerDisplay,
  makeDefaultQuestion,
  makeQuestionId,
  QUESTION_TYPE_META,
  SOROVNOMA_SETUP_SQL,
  studentRespondentKey,
  SURVEY_TEMPLATES,
  type QuestionType,
  type Survey,
  type SurveyAudience,
  type SurveyQuestion,
  type SurveyResponseRow,
} from '@/lib/sorovnoma'
import { exportSurveyResponsesExcel, type ExpectedStudentInfo } from '@/lib/sorovnoma-excel'
import { academicGroups, fullName, isOfficialGroup, kursOf } from '@/lib/student'
import type { Student } from '@/lib/types'
import SurveyFieldInput from './SurveyFieldInput'
import type { Notify } from './Toast'
import { CopyBtn, copyToClipboard, cx } from './ui'

interface Props {
  students: Student[]
  notify: Notify
  createOpen?: boolean
  onCloseCreate?: () => void
}

const COPYABLE_TYPES = new Set<QuestionType>(['phone', 'pinfl', 'passport', 'card'])
const STATS_TYPES = new Set<QuestionType>(['yes_no', 'radio', 'select', 'checkbox', 'tuman', 'rating'])

const QUICK_ADD_TYPES: { type: QuestionType; label: string }[] = [
  { type: 'phone', label: '+ Telefon (+998)' },
  { type: 'short_text', label: '+ Qisqa matn' },
  { type: 'radio', label: '+ Bitta tanlov' },
  { type: 'select', label: "+ Ro'yxat" },
  { type: 'checkbox', label: "+ Ko'p tanlov" },
  { type: 'yes_no', label: "+ Ha / Yo'q" },
  { type: 'date', label: '+ Sana' },
  { type: 'pinfl', label: '+ JSHSHIR' },
  { type: 'passport', label: '+ Pasport' },
  { type: 'card', label: '+ Karta' },
  { type: 'tuman', label: '+ Tuman' },
  { type: 'number', label: '+ Raqam' },
  { type: 'rating', label: '+ Baho (1–5)' },
  { type: 'long_text', label: '+ Batafsil matn' },
]

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function normalizeSurveyRow(s: Partial<Survey> & { id: string; slug: string; title: string }): Survey {
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    description: s.description || '',
    audience: (s.audience as SurveyAudience) || 'talabalar',
    target_courses: Array.isArray(s.target_courses) ? s.target_courses.map(Number) : [],
    target_groups: Array.isArray(s.target_groups) ? s.target_groups.map(String) : [],
    questions: Array.isArray(s.questions) ? s.questions : [],
    active: s.active !== false,
    allow_update: s.allow_update !== false,
    expires_at: s.expires_at ?? null,
    created_at: s.created_at || '',
    updated_at: s.updated_at || '',
    response_count: typeof s.response_count === 'number' ? s.response_count : 0,
  }
}

export default function SorovnomaSection({ students, notify, createOpen, onCloseCreate }: Props) {
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [loadErr, setLoadErr] = useState('')

  // Faol tanlangan so'rovnoma ishchi maydoni
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [workspaceTab, setWorkspaceTab] = useState<'constructor' | 'responses'>('constructor')
  const [draft, setDraft] = useState<Survey | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, unknown>>({})
  const [showPreviewId, setShowPreviewId] = useState<string | null>(null)

  // Javoblar va tahlil
  const [responses, setResponses] = useState<SurveyResponseRow[]>([])
  const [loadingResponses, setLoadingResponses] = useState(false)
  const [respSearch, setRespSearch] = useState('')
  const [respGroupFilter, setRespGroupFilter] = useState('')
  const [showMissing, setShowMissing] = useState(false)
  const [showStats, setShowStats] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Yangi so'rovnoma yaratish modal
  const [localCreateOpen, setLocalCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newAudience, setNewAudience] = useState<SurveyAudience>('talabalar')
  const [newTemplateId, setNewTemplateId] = useState('address_phone')
  const [creating, setCreating] = useState(false)

  const isCreateVisible = Boolean(localCreateOpen || createOpen)
  const closeCreateModal = useCallback(() => {
    setLocalCreateOpen(false)
    onCloseCreate?.()
  }, [onCloseCreate])

  const loadSurveys = useCallback(async () => {
    setLoadingList(true)
    setLoadErr('')
    try {
      const res = await fetch('/api/sorovnomalar', { cache: 'no-store' })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        surveys?: Survey[]
        setup?: boolean
        error?: string
      }
      if (body.setup) {
        setSetupNeeded(true)
        setSurveys([])
        return
      }
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Server xatosi (${res.status})`)
      }
      setSetupNeeded(false)
      setSurveys((body.surveys ?? []).map(normalizeSurveyRow))
    } catch (e) {
      setLoadErr((e as Error).message)
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    loadSurveys()
  }, [loadSurveys])

  const openWorkspace = useCallback(
    async (surveyId: string, initialTab: 'constructor' | 'responses' = 'constructor') => {
      setSelectedId(surveyId)
      setWorkspaceTab(initialTab)
      setRespSearch('')
      setRespGroupFilter('')
      setShowMissing(false)
      setDirty(false)
      setLoadingResponses(true)

      try {
        const res = await fetch(`/api/sorovnomalar?id=${encodeURIComponent(surveyId)}`, { cache: 'no-store' })
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          survey?: Survey
          responses?: SurveyResponseRow[]
          error?: string
        }
        if (!res.ok || !body.ok || !body.survey) {
          throw new Error(body.error || "So'rovnomani yuklab bo'lmadi")
        }
        setDraft(normalizeSurveyRow({ ...body.survey, response_count: (body.responses ?? []).length }))
        setResponses(body.responses ?? [])
      } catch (e) {
        notify((e as Error).message, 'error')
      } finally {
        setLoadingResponses(false)
      }
    },
    [notify],
  )

  const refreshResponsesOnly = useCallback(async () => {
    if (!selectedId) return
    setLoadingResponses(true)
    try {
      const res = await fetch(`/api/sorovnomalar?id=${encodeURIComponent(selectedId)}`, { cache: 'no-store' })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; responses?: SurveyResponseRow[]; error?: string }
      if (!res.ok || !body.ok) throw new Error(body.error || "Javoblarni yuklab bo'lmadi")
      const rows = body.responses ?? []
      setResponses(rows)
      setSurveys((prev) => prev.map((s) => (s.id === selectedId ? { ...s, response_count: rows.length } : s)))
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setLoadingResponses(false)
    }
  }, [selectedId, notify])

  const surveyUrl = useCallback((slug: string) => {
    if (typeof window === 'undefined') return `/sorovnoma/${slug}`
    return `${window.location.origin}/sorovnoma/${slug}`
  }, [])

  const copySurveyLink = useCallback(
    async (slug: string) => {
      const ok = await copyToClipboard(surveyUrl(slug))
      if (ok) notify("So'rovnoma havolasi nusxalandi")
    },
    [surveyUrl, notify],
  )

  const copyTelegramInvite = useCallback(
    async (s: Survey) => {
      const url = surveyUrl(s.slug)
      const lines = [
        `📋 ${s.title}`,
        s.description ? `\n${s.description}` : '',
        `\n👉 To'ldirish havolasi:\n${url}`,
      ].filter(Boolean)
      const ok = await copyToClipboard(lines.join('\n'))
      if (ok) notify('Telegram uchun tayyor xabar nusxalandi')
    },
    [surveyUrl, notify],
  )

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const tpl = SURVEY_TEMPLATES.find((t) => t.id === newTemplateId) ?? SURVEY_TEMPLATES[0]
    const finalTitle = newTitle.trim() || tpl.defaultTitle
    setCreating(true)
    try {
      const questions: SurveyQuestion[] = tpl.questions.map((q) => ({ ...q, id: makeQuestionId() }))
      const res = await fetch('/api/sorovnomalar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          title: finalTitle,
          description: tpl.defaultDescription,
          audience: newAudience,
          questions,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; survey?: Survey; error?: string }
      if (!res.ok || !body.ok || !body.survey) throw new Error(body.error || 'Yaratishda xatolik')
      const created = normalizeSurveyRow(body.survey)
      setSurveys((prev) => [created, ...prev])
      setNewTitle('')
      closeCreateModal()
      notify(`"${created.title}" yaratildi! Savollarni moslashingiz mumkin.`)
      openWorkspace(created.id, 'constructor')
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleSaveDraft = async () => {
    if (!draft) return
    if (!draft.title.trim()) {
      notify("So'rovnoma sarlavhasi bo'sh bo'lmasin", 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/sorovnomalar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          id: draft.id,
          title: draft.title,
          description: draft.description,
          audience: draft.audience,
          target_courses: draft.target_courses,
          target_groups: draft.target_groups,
          questions: draft.questions,
          active: draft.active,
          allow_update: draft.allow_update,
          expires_at: draft.expires_at,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; survey?: Survey; error?: string }
      if (!res.ok || !body.ok || !body.survey) throw new Error(body.error || 'Saqlashda xatolik')
      const updated = normalizeSurveyRow({ ...body.survey, response_count: responses.length })
      setDraft(updated)
      setSurveys((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      setDirty(false)
      notify("So'rovnoma saqlandi")
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (s: Survey) => {
    const nextActive = !s.active
    try {
      const res = await fetch('/api/sorovnomalar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggleActive', id: s.id, active: nextActive }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) throw new Error(body.error || 'Xatolik')
      setSurveys((prev) => prev.map((x) => (x.id === s.id ? { ...x, active: nextActive } : x)))
      if (draft?.id === s.id) setDraft((prev) => (prev ? { ...prev, active: nextActive } : prev))
      notify(nextActive ? "So'rovnoma faollashtirildi" : "So'rovnoma yopildi", nextActive ? 'success' : 'warning')
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const handleDuplicate = async (s: Survey) => {
    try {
      const res = await fetch('/api/sorovnomalar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'duplicate', id: s.id }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; survey?: Survey; error?: string }
      if (!res.ok || !body.ok || !body.survey) throw new Error(body.error || 'Nusxalashda xatolik')
      const copy = normalizeSurveyRow(body.survey)
      setSurveys((prev) => [copy, ...prev])
      notify(`"${copy.title}" nusxalandi`)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const handleDeleteSurvey = async (s: Survey) => {
    if (!confirm(`"${s.title}" so'rovnomasi va uning barcha (${s.response_count ?? 0} ta) javoblari o'chirilsinmi?`)) return
    try {
      const res = await fetch('/api/sorovnomalar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: s.id }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) throw new Error(body.error || "O'chirishda xatolik")
      setSurveys((prev) => prev.filter((x) => x.id !== s.id))
      if (selectedId === s.id) {
        setSelectedId(null)
        setDraft(null)
      }
      notify("So'rovnoma o'chirildi", 'warning')
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const handleDeleteResponse = async (resp: SurveyResponseRow) => {
    if (!draft) return
    if (!confirm(`${resp.respondent_name || 'Bu'} javobi o'chirilsinmi?`)) return
    try {
      const res = await fetch('/api/sorovnomalar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteResponse', surveyId: draft.id, responseId: resp.id }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) throw new Error(body.error || "O'chirishda xatolik")
      setResponses((prev) => prev.filter((r) => r.id !== resp.id))
      setSurveys((prev) =>
        prev.map((x) => (x.id === draft.id ? { ...x, response_count: Math.max(0, (x.response_count ?? 1) - 1) } : x)),
      )
      notify("Javob o'chirildi", 'warning')
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  // Konstruktor helperlari
  const patchDraft = (patch: Partial<Survey>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
    setDirty(true)
  }

  const updateQuestion = (qid: string, patch: Partial<SurveyQuestion>) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        questions: prev.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)),
      }
    })
    setDirty(true)
  }

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    setDraft((prev) => {
      if (!prev) return prev
      const target = idx + dir
      if (target < 0 || target >= prev.questions.length) return prev
      const copy = [...prev.questions]
      const [item] = copy.splice(idx, 1)
      copy.splice(target, 0, item)
      return { ...prev, questions: copy }
    })
    setDirty(true)
  }

  const duplicateQuestion = (idx: number) => {
    setDraft((prev) => {
      if (!prev) return prev
      const src = prev.questions[idx]
      const copy: SurveyQuestion = {
        ...src,
        id: makeQuestionId(),
        label: `${src.label} (nusxa)`,
        options: src.options ? [...src.options] : undefined,
      }
      const next = [...prev.questions]
      next.splice(idx + 1, 0, copy)
      return { ...prev, questions: next }
    })
    setDirty(true)
  }

  const deleteQuestion = (idx: number) => {
    setDraft((prev) => {
      if (!prev) return prev
      return { ...prev, questions: prev.questions.filter((_, i) => i !== idx) }
    })
    setDirty(true)
  }

  const addQuestion = (type: QuestionType) => {
    const q = makeDefaultQuestion(type)
    setDraft((prev) => (prev ? { ...prev, questions: [...prev.questions, q] } : prev))
    setDirty(true)
  }

  // Mavjud akademik guruhlar (kurs bo'yicha)
  const allOfficialGroups = useMemo(() => academicGroups(students), [students])
  const selectableGroups = useMemo(() => {
    if (!draft) return allOfficialGroups
    if (!draft.target_courses.length) return allOfficialGroups
    return allOfficialGroups.filter((g) => {
      const k = kursOf(g)
      return k ? draft.target_courses.includes(k) : false
    })
  }, [allOfficialGroups, draft])

  // Kutilayotgan talabalar (talaba so'rovnomasi uchun qamrov va topshirmaganlar)
  const expectedStudents = useMemo<ExpectedStudentInfo[]>(() => {
    if (!draft || draft.audience !== 'talabalar') return []
    const courses = draft.target_courses
    const groups = draft.target_groups
    return students
      .filter((s) => isOfficialGroup(s.group))
      .filter((s) => {
        const g = (s.group || '').trim()
        const k = kursOf(g) ?? 0
        if (courses.length > 0 && !courses.includes(k)) return false
        if (groups.length > 0 && !groups.includes(g)) return false
        return true
      })
      .map((s) => ({
        key: studentRespondentKey(s.pinfl, s.row),
        fish: fullName(s),
        group: (s.group || '').trim(),
      }))
  }, [draft, students])

  const groupCompletion = useMemo(() => {
    if (!draft || draft.audience !== 'talabalar') return []
    const submittedKeys = new Set(responses.map((r) => r.respondent_key))
    const map = new Map<string, { total: number; done: number; missing: ExpectedStudentInfo[] }>()
    for (const st of expectedStudents) {
      const cur = map.get(st.group) ?? { total: 0, done: 0, missing: [] }
      cur.total += 1
      if (submittedKeys.has(st.key)) cur.done += 1
      else cur.missing.push(st)
      map.set(st.group, cur)
    }
    return [...map.entries()]
      .sort(([a], [b]) => groupOrder(a, b))
      .map(([group, info]) => ({
        group,
        total: info.total,
        done: info.done,
        missing: info.missing.sort((a, b) => a.fish.localeCompare(b.fish, 'uz')),
      }))
  }, [draft, responses, expectedStudents])

  const missingStudentsFlat = useMemo(() => {
    if (!respGroupFilter) return groupCompletion.flatMap((g) => g.missing)
    return groupCompletion.find((g) => g.group === respGroupFilter)?.missing ?? []
  }, [groupCompletion, respGroupFilter])

  const responseGroups = useMemo(() => {
    const set = new Set<string>()
    for (const r of responses) if (r.respondent_group) set.add(r.respondent_group)
    return [...set].sort(groupOrder)
  }, [responses])

  const filteredResponses = useMemo(() => {
    const q = respSearch.trim().toLowerCase()
    return responses.filter((r) => {
      if (respGroupFilter && r.respondent_group !== respGroupFilter) return false
      if (!q) return true
      if (r.respondent_name.toLowerCase().includes(q)) return true
      if (r.respondent_group.toLowerCase().includes(q)) return true
      for (const val of Object.values(r.answers ?? {})) {
        if (String(val ?? '').toLowerCase().includes(q)) return true
      }
      return false
    })
  }, [responses, respSearch, respGroupFilter])

  // Tanlov va baho savollari statistikasi
  const choiceStats = useMemo(() => {
    if (!draft) return []
    return draft.questions
      .filter((q) => STATS_TYPES.has(q.type))
      .map((q) => {
        const counts = new Map<string, number>()
        let answered = 0
        let ratingSum = 0
        for (const r of responses) {
          const val = r.answers?.[q.id]
          if (val === undefined || val === null || val === '') continue
          if (Array.isArray(val)) {
            if (!val.length) continue
            answered++
            for (const item of val) counts.set(String(item), (counts.get(String(item)) ?? 0) + 1)
          } else {
            answered++
            const key = String(val)
            counts.set(key, (counts.get(key) ?? 0) + 1)
            if (q.type === 'rating') ratingSum += Number(val) || 0
          }
        }
        const entries = [...counts.entries()].sort((a, b) => b[1] - a[1])
        const avg = q.type === 'rating' && answered > 0 ? (ratingSum / answered).toFixed(1) : null
        return { question: q, answered, entries, avg }
      })
  }, [draft, responses])

  const handleExportExcel = async () => {
    if (!draft) return
    setExporting(true)
    try {
      const fileName = await exportSurveyResponsesExcel(draft, responses, expectedStudents)
      notify(`${fileName} yuklandi (${responses.length} ta javob)`)
    } catch (e) {
      notify(`Excel yaratilmadi: ${(e as Error).message}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  const copyMissingList = async () => {
    if (!draft || !missingStudentsFlat.length) return
    const byGrp = new Map<string, string[]>()
    for (const m of missingStudentsFlat) {
      const arr = byGrp.get(m.group) ?? []
      arr.push(m.fish)
      byGrp.set(m.group, arr)
    }
    const lines: string[] = [`⏳ "${draft.title}" — hali topshirmagan talabalar (${missingStudentsFlat.length} nafar):`]
    for (const [g, list] of byGrp.entries()) {
      lines.push(`\n📌 ${g}-guruh (${list.length} ta):`)
      list.forEach((fish, i) => lines.push(`${i + 1}. ${fish}`))
    }
    const ok = await copyToClipboard(lines.join('\n'))
    if (ok) notify("Topshirmaganlar ro'yxati nusxalandi")
  }

  const totalStats = useMemo(() => {
    const active = surveys.filter((s) => s.active).length
    const totalResps = surveys.reduce((a, s) => a + (s.response_count ?? 0), 0)
    return { total: surveys.length, active, totalResps }
  }, [surveys])

  /* ---------------------------- Setup SQL holati ---------------------------- */

  if (setupNeeded) {
    return (
      <div className="panel space-y-4 border-amber/40 bg-amber/[0.04] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-amber/40 bg-amber/15 text-amber">
            <Database size={20} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-[16px] font-bold text-fg">Supabase so&apos;rovnoma jadvallari hali yaratilmagan</h2>
            <p className="text-[13px] text-fg-muted">
              Barcha so&apos;rovnomalar va javoblar Supabase bazasida saqlanishi uchun quyidagi SQL kodini bir marta{' '}
              <b className="text-fg">Supabase Dashboard → SQL Editor</b> ga qo&apos;yib <b className="text-fg">Run</b> bosing.
              Fayl joylashuvi: <code className="mono text-sky-soft">web/supabase/sorovnomalar.sql</code>
            </p>
          </div>
        </div>

        <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-ink-950 p-3.5 font-mono text-[11.5px] leading-relaxed text-fg-muted">
          {SOROVNOMA_SETUP_SQL}
        </pre>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary h-9 px-4"
            onClick={async () => {
              const ok = await copyToClipboard(SOROVNOMA_SETUP_SQL)
              if (ok) notify('SQL kodi nusxalandi — Supabase SQL Editor ga qo‘yib Run bosing')
            }}
          >
            <Copy size={14} /> SQL kodini nusxalash
          </button>
          <button type="button" className="btn-ghost h-9 px-4" onClick={loadSurveys}>
            <RefreshCw size={14} /> Qayta tekshirish
          </button>
        </div>
      </div>
    )
  }

  /* ---------------------------- Ishchi maydon (tanlangan so'rovnoma) ---------------------------- */

  if (selectedId && draft) {
    const coverPct = expectedStudents.length > 0 ? Math.round((responses.length / expectedStudents.length) * 100) : null

    return (
      <div className="space-y-4">
        {/* Yuqori boshqaruv paneli */}
        <div className="panel flex flex-wrap items-center justify-between gap-2.5 p-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              className="btn-ghost h-9 px-3"
              onClick={() => {
                if (dirty && !confirm("Saqlanmagan o'zgarishlar bor. Chiqasizmi?")) return
                setSelectedId(null)
                setDraft(null)
                setDirty(false)
              }}
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Ro&apos;yxat</span>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[15px] font-extrabold text-fg sm:text-[16px]">{draft.title}</h2>
                <span
                  className={cx(
                    'chip shrink-0',
                    draft.active ? 'border-emerald/40 bg-emerald/12 text-emerald-soft' : 'border-rose/40 bg-rose/12 text-rose',
                  )}
                >
                  {draft.active ? 'Faol' : 'Yopiq'}
                </span>
              </div>
              <div className="truncate text-[11.5px] text-fg-subtle">
                {AUDIENCE_META[draft.audience].label} ·{' '}
                <span className="mono text-sky-soft">/sorovnoma/{draft.slug}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              className="btn-ghost h-9 px-2.5 text-[12.5px]"
              onClick={() => handleToggleActive(draft)}
              title={draft.active ? "So'rovnomani yopish" : "So'rovnomani yoqish"}
            >
              {draft.active ? <Lock size={14} className="text-amber" /> : <Unlock size={14} className="text-emerald-soft" />}
              <span className="hidden md:inline">{draft.active ? 'Yopish' : 'Ochish'}</span>
            </button>

            <button
              type="button"
              className="btn-ghost h-9 px-2.5 text-[12.5px]"
              onClick={() => copySurveyLink(draft.slug)}
              title="To'ldirish havolasini nusxalash"
            >
              <Copy size={14} className="text-sky-soft" />
              <span>Havola</span>
            </button>

            <button
              type="button"
              className="btn-ghost h-9 px-2.5 text-[12.5px]"
              onClick={() => copyTelegramInvite(draft)}
              title="Telegram guruhlarga tayyor taklif matnini nusxalash"
            >
              <Send size={14} className="text-emerald-soft" />
              <span className="hidden sm:inline">Telegramga matn</span>
            </button>

            <a
              href={`/sorovnoma/${draft.slug}`}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost h-9 px-2.5 text-[12.5px]"
              title="Talaba ko'radigan sahifani ochish"
            >
              <ExternalLink size={14} />
              <span className="hidden md:inline">Ochish</span>
            </a>

            <button
              type="button"
              disabled={saving}
              onClick={handleSaveDraft}
              className={cx('h-9 px-3.5 text-[13px]', dirty ? 'btn-success' : 'btn-primary')}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>{saving ? 'Saqlanmoqda…' : dirty ? 'Saqlash *' : 'Saqlangan'}</span>
            </button>
          </div>
        </div>

        {/* Sub-tablar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="seg">
            <button
              type="button"
              aria-pressed={workspaceTab === 'constructor'}
              onClick={() => setWorkspaceTab('constructor')}
              className="seg-btn h-8.5 px-3.5"
            >
              <Sparkles size={14} className={workspaceTab === 'constructor' ? 'text-sky' : ''} />
              <span>Savollar konstruktori</span>
              <span className="count">{draft.questions.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={workspaceTab === 'responses'}
              onClick={() => {
                setWorkspaceTab('responses')
                refreshResponsesOnly()
              }}
              className="seg-btn h-8.5 px-3.5"
            >
              <BarChart3 size={14} className={workspaceTab === 'responses' ? 'text-emerald' : ''} />
              <span>Javoblar va statistika</span>
              <span className="count">{responses.length}</span>
            </button>
          </div>

          {dirty && (
            <span className="text-[12px] font-medium text-amber">
              O&apos;zgarishlar saqlanmagan — yuqoridagi &quot;Saqlash *&quot; tugmasini bosing
            </span>
          )}
        </div>

        {/* KONSTRUKTOR TABI */}
        {workspaceTab === 'constructor' ? (
          <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
            {/* Sozlamalar chap ustun */}
            <aside className="panel h-fit space-y-4 p-4 sm:p-5">
              <div className="text-[13px] font-extrabold uppercase tracking-wider text-fg-muted">
                So&apos;rovnoma sozlamalari
              </div>

              <div>
                <label className="label">Sarlavha *</label>
                <input
                  type="text"
                  className="field h-10 font-semibold"
                  value={draft.title}
                  onChange={(e) => patchDraft({ title: e.target.value })}
                  placeholder="Masalan: Talabalar amaliyot joyi"
                />
              </div>

              <div>
                <label className="label">Izoh / ko&apos;rsatma</label>
                <textarea
                  rows={3}
                  className="field min-h-[78px] resize-y py-2"
                  value={draft.description}
                  onChange={(e) => patchDraft({ description: e.target.value })}
                  placeholder="So'rovnoma maqsadi haqida qisqacha yozing…"
                />
              </div>

              <div>
                <label className="label">Kimlar to&apos;ldiradi?</label>
                <div className="grid gap-1.5">
                  {(['talabalar', 'xodimlar', 'ochiq'] as SurveyAudience[]).map((aud) => (
                    <button
                      key={aud}
                      type="button"
                      onClick={() => patchDraft({ audience: aud })}
                      className={cx(
                        'rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer',
                        draft.audience === aud
                          ? 'border-sky/60 bg-sky/12 text-fg'
                          : 'border-line bg-ink-950/40 text-fg-muted hover:text-fg',
                      )}
                    >
                      <div className="text-[12.5px] font-bold">{AUDIENCE_META[aud].label}</div>
                      <div className="text-[11px] text-fg-subtle">{AUDIENCE_META[aud].sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {draft.audience === 'talabalar' && (
                <>
                  <div>
                    <label className="label">Qaysi kurslar? (bo&apos;sh = barchasi)</label>
                    <div className="flex flex-wrap gap-1.5">
                      {COURSES.map((c) => {
                        const on = draft.target_courses.includes(c.kurs)
                        return (
                          <button
                            key={c.kurs}
                            type="button"
                            onClick={() => {
                              const next = on
                                ? draft.target_courses.filter((x) => x !== c.kurs)
                                : [...draft.target_courses, c.kurs].sort((a, b) => a - b)
                              patchDraft({ target_courses: next })
                            }}
                            className={cx(
                              'chip h-7 cursor-pointer px-2.5',
                              on ? 'border-sky/60 bg-sky/15 text-sky-soft' : 'border-line bg-ink-950/50 text-fg-muted',
                            )}
                          >
                            {c.kurs}-kurs
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="label">
                      Aniq guruhlar ({draft.target_groups.length ? `${draft.target_groups.length} ta tanlangan` : 'barchasi'})
                    </label>
                    <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line bg-ink-950/50 p-2">
                      {selectableGroups.map((g) => {
                        const on = draft.target_groups.includes(g)
                        return (
                          <button
                            key={g}
                            type="button"
                            onClick={() => {
                              const next = on
                                ? draft.target_groups.filter((x) => x !== g)
                                : [...draft.target_groups, g]
                              patchDraft({ target_groups: next })
                            }}
                            className={cx(
                              'chip mono h-6 cursor-pointer px-2 text-[11px]',
                              on ? 'border-emerald/60 bg-emerald/15 text-emerald-soft' : 'border-line bg-ink-900 text-fg-muted',
                            )}
                          >
                            {g}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2.5 border-t border-line pt-3">
                <label className="flex cursor-pointer items-center justify-between gap-2 text-[12.5px] font-medium text-fg">
                  <span>Qayta yuborib tahrirlash mumkin</span>
                  <input
                    type="checkbox"
                    className="size-4 accent-sky"
                    checked={draft.allow_update}
                    onChange={(e) => patchDraft({ allow_update: e.target.checked })}
                  />
                </label>

                <div>
                  <label className="label">Yopilish muddati (ixtiyoriy)</label>
                  <input
                    type="datetime-local"
                    className="field h-9 text-[12.5px]"
                    value={isoToLocalInput(draft.expires_at)}
                    onChange={(e) =>
                      patchDraft({
                        expires_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                      })
                    }
                  />
                </div>
              </div>
            </aside>

            {/* Savollar o'ng ustun */}
            <div className="space-y-3">
              {draft.questions.length === 0 ? (
                <div className="panel grid place-items-center gap-2 py-14 text-center text-fg-muted">
                  <ClipboardList size={30} className="text-sky/60" />
                  <div className="text-[14px] font-semibold text-fg">Hali birorta savol qo&apos;shilmagan</div>
                  <p className="text-[12.5px]">Pastdagi tugmalardan kerakli maydon turini tanlab qo&apos;shing.</p>
                </div>
              ) : (
                draft.questions.map((q, idx) => {
                  const hasOpts = q.type === 'select' || q.type === 'radio' || q.type === 'checkbox'
                  const previewOpen = showPreviewId === q.id
                  return (
                    <div key={q.id} className="panel space-y-3 border-l-4 border-l-sky/60 p-4 sm:p-5">
                      {/* Savol header */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-sky/15 px-1.5 font-mono text-[12px] font-bold text-sky-soft">
                            #{idx + 1}
                          </span>
                          <span className="chip border-line bg-ink-850 text-fg-muted">
                            {QUESTION_TYPE_META[q.type].label}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="btn-ghost h-7.5 px-2 text-[11.5px]"
                            onClick={() => setShowPreviewId(previewOpen ? null : q.id)}
                          >
                            {previewOpen ? "Ko'rinishni yopish" : "Sinab ko'rish"}
                          </button>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveQuestion(idx, -1)}
                            className="btn-ghost h-7.5 w-7.5 px-0"
                            title="Yuqoriga ko'tarish"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            disabled={idx === draft.questions.length - 1}
                            onClick={() => moveQuestion(idx, 1)}
                            className="btn-ghost h-7.5 w-7.5 px-0"
                            title="Pastga tushirish"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => duplicateQuestion(idx)}
                            className="btn-ghost h-7.5 w-7.5 px-0"
                            title="Nusxalash"
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteQuestion(idx)}
                            className="btn-danger h-7.5 w-7.5 px-0"
                            title="Savolni o'chirish"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Savol nomi + Turi */}
                      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
                        <div>
                          <label className="label">Savol matni *</label>
                          <input
                            type="text"
                            className="field h-10 font-semibold"
                            value={q.label}
                            onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="label">Ma&apos;lumot turi (avto-tekshiruv)</label>
                          <select
                            className="field h-10"
                            value={q.type}
                            onChange={(e) => {
                              const nextType = e.target.value as QuestionType
                              const needsOpts = nextType === 'select' || nextType === 'radio' || nextType === 'checkbox'
                              updateQuestion(q.id, {
                                type: nextType,
                                options: needsOpts && !q.options?.length ? ['Variant 1', 'Variant 2'] : q.options,
                              })
                            }}
                          >
                            {(Object.keys(QUESTION_TYPE_META) as QuestionType[]).map((t) => (
                              <option key={t} value={t}>
                                {QUESTION_TYPE_META[t].label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Yordamchi izoh va Majburiy */}
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          type="text"
                          className="field h-9 min-w-[200px] flex-1 text-[12.5px]"
                          placeholder="Yordamchi izoh (ixtiyoriy, masalan: faqat 9 ta raqam yozing)"
                          value={q.hint || ''}
                          onChange={(e) => updateQuestion(q.id, { hint: e.target.value })}
                        />
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-ink-950/60 px-3 py-1.5 text-[12.5px] font-semibold text-fg">
                          <input
                            type="checkbox"
                            className="size-4 accent-rose"
                            checked={q.required}
                            onChange={(e) => updateQuestion(q.id, { required: e.target.checked })}
                          />
                          <span>Majburiy *</span>
                        </label>
                      </div>

                      {/* Variantlar muharriri */}
                      {hasOpts && (
                        <div className="space-y-2 rounded-lg border border-line bg-ink-950/50 p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11.5px] font-bold uppercase tracking-wider text-fg-subtle">
                              Variantlar ({q.options?.length ?? 0} ta)
                            </span>
                            {(q.type === 'radio' || q.type === 'checkbox') && (
                              <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-fg-muted">
                                <input
                                  type="checkbox"
                                  className="size-3.5 accent-sky"
                                  checked={Boolean(q.allowOther)}
                                  onChange={(e) => updateQuestion(q.id, { allowOther: e.target.checked })}
                                />
                                <span>&quot;Boshqa…&quot; maydoni qo&apos;shish</span>
                              </label>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            {(q.options ?? []).map((opt, oi) => (
                              <div key={oi} className="flex items-center gap-2">
                                <span className="w-5 text-center font-mono text-[11px] text-fg-subtle">{oi + 1}.</span>
                                <input
                                  type="text"
                                  className="field h-8.5 flex-1 text-[13px]"
                                  value={opt}
                                  onChange={(e) => {
                                    const nextOpts = [...(q.options ?? [])]
                                    nextOpts[oi] = e.target.value
                                    updateQuestion(q.id, { options: nextOpts })
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={(q.options?.length ?? 0) <= 1}
                                  onClick={() => {
                                    const nextOpts = (q.options ?? []).filter((_, i) => i !== oi)
                                    updateQuestion(q.id, { options: nextOpts })
                                  }}
                                  className="btn-ghost h-8.5 w-8.5 px-0 text-rose"
                                  title="Variantni o'chirish"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              updateQuestion(q.id, {
                                options: [...(q.options ?? []), `Variant ${(q.options?.length ?? 0) + 1}`],
                              })
                            }
                            className="btn-ghost h-8 px-3 text-[12px]"
                          >
                            <Plus size={13} /> Variant qo&apos;shish
                          </button>
                        </div>
                      )}

                      {/* Raqam sozlamalari */}
                      {q.type === 'number' && (
                        <div className="grid gap-2.5 rounded-lg border border-line bg-ink-950/50 p-3 sm:grid-cols-3">
                          <div>
                            <label className="label">Eng kichik (min)</label>
                            <input
                              type="number"
                              className="field h-8.5 text-[13px]"
                              placeholder="Ixtiyoriy"
                              value={q.min ?? ''}
                              onChange={(e) =>
                                updateQuestion(q.id, { min: e.target.value === '' ? null : Number(e.target.value) })
                              }
                            />
                          </div>
                          <div>
                            <label className="label">Eng katta (max)</label>
                            <input
                              type="number"
                              className="field h-8.5 text-[13px]"
                              placeholder="Ixtiyoriy"
                              value={q.max ?? ''}
                              onChange={(e) =>
                                updateQuestion(q.id, { max: e.target.value === '' ? null : Number(e.target.value) })
                              }
                            />
                          </div>
                          <div>
                            <label className="label">O&apos;lchov birligi</label>
                            <input
                              type="text"
                              className="field h-8.5 text-[13px]"
                              placeholder="Masalan: km, so'm, yil"
                              value={q.unit || ''}
                              onChange={(e) => updateQuestion(q.id, { unit: e.target.value })}
                            />
                          </div>
                        </div>
                      )}

                      {/* Jonli sinov ko'rinishi */}
                      {previewOpen && (
                        <div className="space-y-1.5 rounded-lg border border-sky/30 bg-ink-950/80 p-3.5">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-sky-soft">
                            To&apos;ldiruvchiga ko&apos;rinadigan shakl (sinov):
                          </div>
                          <SurveyFieldInput
                            question={q}
                            value={previewAnswers[q.id]}
                            onChange={(val) => setPreviewAnswers((prev) => ({ ...prev, [q.id]: val }))}
                          />
                        </div>
                      )}
                    </div>
                  )
                })
              )}

              {/* Tez savol qo'shish paneli */}
              <div className="panel space-y-2.5 p-4">
                <div className="text-[12px] font-bold uppercase tracking-wider text-fg-muted">
                  + Savol qo&apos;shish (aqlli tekshiruvli maydonlar)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_ADD_TYPES.map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => addQuestion(item.type)}
                      className="btn-ghost h-8 px-2.5 text-[12px] hover:border-sky/50 hover:text-sky-soft"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* JAVOBLAR VA STATISTIKA TABI */
          <div className="space-y-4">
            {/* Statistika va Eksport paneli */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="panel p-4">
                <div className="text-[11px] font-bold uppercase text-fg-subtle">Jami javoblar</div>
                <div className="mt-1 text-2xl font-extrabold tabular-nums text-fg">{responses.length}</div>
              </div>

              {draft.audience === 'talabalar' && (
                <>
                  <div className="panel p-4">
                    <div className="text-[11px] font-bold uppercase text-fg-subtle">Qamrov</div>
                    <div className="mt-1 text-2xl font-extrabold tabular-nums text-emerald-soft">
                      {coverPct !== null ? `${coverPct}%` : '—'}
                      <span className="ml-1.5 text-[12.5px] font-semibold text-fg-muted">
                        ({responses.length} / {expectedStudents.length})
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowMissing((v) => !v)}
                    className={cx(
                      'panel cursor-pointer p-4 text-left transition-colors',
                      showMissing ? 'border-amber/60 bg-amber/[0.06]' : 'hover:border-line-strong',
                    )}
                  >
                    <div className="text-[11px] font-bold uppercase text-fg-subtle">Hali topshirmaganlar</div>
                    <div className="mt-1 text-2xl font-extrabold tabular-nums text-amber">
                      {Math.max(0, expectedStudents.length - responses.length)}
                      <span className="ml-2 text-[11.5px] font-semibold text-sky-soft underline">
                        {showMissing ? 'Yashirish' : "Ro'yxatni ko'rish"}
                      </span>
                    </div>
                  </button>
                </>
              )}

              <div className="panel flex items-center justify-between gap-2 p-4 sm:col-span-2 lg:col-span-1">
                <button
                  type="button"
                  disabled={exporting || responses.length === 0}
                  onClick={handleExportExcel}
                  className="btn-success h-10 flex-1 justify-center"
                >
                  {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
                  <span>Excel (.xlsx)</span>
                </button>
                <button
                  type="button"
                  disabled={loadingResponses}
                  onClick={refreshResponsesOnly}
                  className="btn-ghost h-10 w-10 shrink-0 px-0"
                  title="Javoblarni yangilash"
                >
                  <RefreshCw size={15} className={loadingResponses ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Guruhlar bo'yicha to'ldirish holati */}
            {draft.audience === 'talabalar' && groupCompletion.length > 0 && (
              <div className="panel space-y-2.5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-bold uppercase tracking-wider text-fg-muted">
                    Guruhlar kesimida (filtrlash uchun bosing)
                  </span>
                  {respGroupFilter && (
                    <button
                      type="button"
                      onClick={() => setRespGroupFilter('')}
                      className="text-[12px] font-semibold text-sky-soft hover:underline"
                    >
                      Barcha guruhlarni ko&apos;rsatish
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {groupCompletion.map((g) => {
                    const active = respGroupFilter === g.group
                    const complete = g.done >= g.total && g.total > 0
                    return (
                      <button
                        key={g.group}
                        type="button"
                        onClick={() => setRespGroupFilter(active ? '' : g.group)}
                        className={cx(
                          'chip h-7 cursor-pointer px-2.5 tabular-nums',
                          active
                            ? 'border-sky bg-sky/20 text-sky-soft'
                            : complete
                              ? 'border-emerald/40 bg-emerald/12 text-emerald-soft'
                              : 'border-line bg-ink-850 text-fg-muted hover:text-fg',
                        )}
                      >
                        <span className="mono font-bold">{g.group}</span>
                        <span>
                          {g.done}/{g.total}
                        </span>
                        {complete && <CheckCircle2 size={12} />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Topshirmaganlar ro'yxati */}
            {showMissing && draft.audience === 'talabalar' && (
              <div className="panel space-y-3 border-amber/40 bg-amber/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[13.5px] font-bold text-amber">
                    <AlertTriangle size={16} />
                    <span>
                      Topshirmagan talabalar ({missingStudentsFlat.length} nafar
                      {respGroupFilter ? ` · ${respGroupFilter}` : ''})
                    </span>
                  </div>
                  {missingStudentsFlat.length > 0 && (
                    <button type="button" onClick={copyMissingList} className="btn-ghost h-8 px-3 text-[12px]">
                      <Copy size={13} /> Telegram uchun nusxalash
                    </button>
                  )}
                </div>
                {missingStudentsFlat.length === 0 ? (
                  <p className="text-[13px] font-medium text-emerald-soft">Barcha talabalar topshirib bo&apos;lgan!</p>
                ) : (
                  <div className="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                    {missingStudentsFlat.map((m, i) => (
                      <div key={m.key} className="flex items-center gap-2 rounded-lg border border-line bg-ink-950/60 px-2.5 py-1.5 text-[12.5px]">
                        <span className="mono text-[11px] text-fg-subtle">{i + 1}.</span>
                        <span className="chip mono border-line bg-ink-900 px-1.5 text-[10.5px] text-sky-soft">{m.group}</span>
                        <span className="truncate font-medium text-fg">{m.fish}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Grafik tahlil (Tanlov / Ha-Yo'q / Baho / Tuman savollari) */}
            {choiceStats.length > 0 && responses.length > 0 && (
              <div className="panel space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[13px] font-bold text-fg">
                    <BarChart3 size={15} className="text-sky" /> Javoblar tahlili
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowStats((v) => !v)}
                    className="text-[12px] font-semibold text-sky-soft hover:underline"
                  >
                    {showStats ? 'Yashirish' : "Ko'rsatish"}
                  </button>
                </div>

                {showStats && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {choiceStats.map(({ question: q, answered, entries, avg }) => (
                      <div key={q.id} className="space-y-2 rounded-lg border border-line bg-ink-950/50 p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-[13px] font-bold text-fg">{q.label}</div>
                          <span className="shrink-0 text-[11px] font-semibold text-fg-subtle">
                            {answered} javob {avg ? `· ★ ${avg}` : ''}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {entries.slice(0, 8).map(([opt, count]) => {
                            const pct = answered > 0 ? Math.round((count / answered) * 100) : 0
                            return (
                              <div key={opt} className="space-y-0.5 text-[12px]">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-fg-muted">{opt}</span>
                                  <span className="shrink-0 font-mono text-[11px] font-bold text-fg tabular-nums">
                                    {count} ({pct}%)
                                  </span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                                  <div className="h-full rounded-full bg-sky" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Qidiruv va javoblar jadvali */}
            <div className="panel space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
                  <input
                    type="search"
                    className="field h-9.5 pl-9 text-[13px]"
                    placeholder="F.I.Sh., telefon yoki javob bo'yicha qidirish…"
                    value={respSearch}
                    onChange={(e) => setRespSearch(e.target.value)}
                  />
                </div>
                {responseGroups.length > 0 && (
                  <select
                    className="field h-9.5 w-auto min-w-[150px] text-[13px]"
                    value={respGroupFilter}
                    onChange={(e) => setRespGroupFilter(e.target.value)}
                  >
                    <option value="">Barcha guruh/toifalar</option>
                    {responseGroups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                )}
                <span className="text-[12px] font-semibold text-fg-subtle">
                  Ko&apos;rsatilmoqda: {filteredResponses.length} / {responses.length}
                </span>
              </div>

              {loadingResponses ? (
                <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-fg-muted">
                  <Loader2 size={16} className="animate-spin text-sky" /> Javoblar yuklanmoqda…
                </div>
              ) : filteredResponses.length === 0 ? (
                <div className="py-12 text-center text-[13px] text-fg-muted">
                  {responses.length === 0
                    ? "Hali hech kim bu so'rovnomani to'ldirmagan."
                    : "Qidiruv bo'yicha javob topilmadi."}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-max min-w-full border-collapse text-left text-[12.5px]">
                    <thead className="border-b border-line bg-ink-850 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
                      <tr>
                        <th className="px-3 py-2.5 text-center">№</th>
                        <th className="px-3 py-2.5">F.I.Sh.</th>
                        {draft.audience !== 'ochiq' && (
                          <th className="px-3 py-2.5">{draft.audience === 'talabalar' ? 'Guruh' : 'Toifa'}</th>
                        )}
                        <th className="px-3 py-2.5">Vaqt</th>
                        {draft.questions.map((q) => (
                          <th key={q.id} className="max-w-[240px] px-3 py-2.5">
                            {q.label}
                          </th>
                        ))}
                        <th className="px-2.5 py-2.5 text-center">Amal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {filteredResponses.map((r, i) => (
                        <tr key={r.id} className="hover:bg-ink-850/60">
                          <td className="px-3 py-2 text-center font-mono text-[11px] text-fg-subtle">{i + 1}</td>
                          <td className="px-3 py-2 font-semibold whitespace-nowrap text-fg">
                            <div className="flex items-center gap-1.5">
                              <span>{r.respondent_name || '—'}</span>
                              <CopyBtn value={r.respondent_name} label="F.I.Sh." onCopied={notify} />
                            </div>
                          </td>
                          {draft.audience !== 'ochiq' && (
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className="chip mono border-line bg-ink-850 text-sky-soft">{r.respondent_group || '—'}</span>
                            </td>
                          )}
                          <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap text-fg-subtle">
                            {fmtDateShort(r.updated_at || r.created_at)}
                          </td>
                          {draft.questions.map((q) => {
                            const disp = formatAnswerDisplay(q, r.answers?.[q.id])
                            const isMonoCopy = COPYABLE_TYPES.has(q.type) && Boolean(disp)
                            return (
                              <td key={q.id} className="max-w-[260px] px-3 py-2 text-fg-muted">
                                {disp ? (
                                  <div className="flex items-center gap-1">
                                    <span className={cx(isMonoCopy && 'mono font-semibold whitespace-nowrap text-fg')}>
                                      {disp}
                                    </span>
                                    {isMonoCopy && <CopyBtn value={disp} label={q.label} onCopied={notify} />}
                                  </div>
                                ) : (
                                  <span className="text-fg-subtle">—</span>
                                )}
                              </td>
                            )
                          })}
                          <td className="px-2.5 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteResponse(r)}
                              className="inline-flex size-7 items-center justify-center rounded text-fg-subtle hover:bg-rose/15 hover:text-rose cursor-pointer"
                              title="Javobni o'chirish"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ---------------------------- SO'ROVNOMALAR RO'YXATI ---------------------------- */

  return (
    <div className="space-y-4">
      {/* Yuqori KPI va amallar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="panel p-4">
          <div className="text-[11px] font-bold uppercase text-fg-subtle">Jami so&apos;rovnomalar</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-fg">{totalStats.total}</div>
        </div>
        <div className="panel p-4">
          <div className="text-[11px] font-bold uppercase text-fg-subtle">Faol (ochiq)</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-emerald-soft">{totalStats.active}</div>
        </div>
        <div className="panel p-4">
          <div className="text-[11px] font-bold uppercase text-fg-subtle">Yig&apos;ilgan javoblar</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-sky-soft">{totalStats.totalResps}</div>
        </div>
        <div className="panel flex flex-col justify-center gap-2 p-4">
          <button type="button" onClick={() => setLocalCreateOpen(true)} className="btn-success h-9.5 w-full justify-center">
            <Plus size={15} /> Yangi so&apos;rovnoma
          </button>
          <a
            href="/sorovnoma"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1 text-[11.5px] font-semibold text-fg-muted hover:text-sky-soft"
          >
            <span>1–3-kurs eski so&apos;rovnomasi</span>
            <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {loadingList ? (
        <div className="panel flex items-center justify-center gap-2 py-16 text-[13.5px] text-fg-muted">
          <Loader2 size={18} className="animate-spin text-sky" /> So&apos;rovnomalar yuklanmoqda…
        </div>
      ) : loadErr ? (
        <div className="panel space-y-3 border-rose/40 bg-rose/5 p-6 text-center">
          <div className="text-[14px] font-bold text-rose">{loadErr}</div>
          <button type="button" onClick={loadSurveys} className="btn-primary mx-auto h-9 px-4">
            Qayta urinish
          </button>
        </div>
      ) : surveys.length === 0 ? (
        <div className="panel grid place-items-center gap-3 px-6 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-full border border-sky/35 bg-sky/10 text-sky-soft">
            <ClipboardList size={26} />
          </div>
          <div>
            <h2 className="text-[16px] font-extrabold text-fg">Hozircha birorta so&apos;rovnoma yaratilmagan</h2>
            <p className="mt-1 max-w-md text-[13px] text-fg-muted">
              O&apos;zingiz xohlagan savollar bilan (+998 telefon, JSHSHIR, pasport, tuman, tanlov va h.k.) bir necha soniyada
              Google Forms kabi so&apos;rovnoma tuzing.
            </p>
          </div>
          <button type="button" onClick={() => setLocalCreateOpen(true)} className="btn-primary mt-1 h-10 px-5">
            <Plus size={16} /> Birinchi so&apos;rovnomani yaratish
          </button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {surveys.map((s) => (
            <article key={s.id} className="panel flex flex-col justify-between gap-3.5 p-4 sm:p-5">
              <div className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[15.5px] font-extrabold text-fg">{s.title}</h3>
                    {s.description && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-fg-muted">{s.description}</p>}
                  </div>
                  <span
                    className={cx(
                      'chip shrink-0',
                      s.active ? 'border-emerald/40 bg-emerald/12 text-emerald-soft' : 'border-rose/40 bg-rose/12 text-rose',
                    )}
                  >
                    {s.active ? 'Faol' : 'Yopiq'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                  <span className="chip border-sky/30 bg-sky/10 text-sky-soft">
                    <Users size={11} /> {AUDIENCE_META[s.audience].label}
                  </span>
                  {s.audience === 'talabalar' && s.target_courses.length > 0 && (
                    <span className="chip border-line bg-ink-850 text-fg-muted">
                      {s.target_courses.map((c) => `${c}-kurs`).join(', ')}
                    </span>
                  )}
                  <span className="chip border-line bg-ink-850 text-fg-muted">
                    {s.questions.length} savol
                  </span>
                  <span className="chip border-emerald/30 bg-emerald/10 text-emerald-soft tabular-nums">
                    {s.response_count ?? 0} ta javob
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-ink-950/60 px-2.5 py-1.5 text-[11.5px]">
                  <span className="mono truncate text-fg-muted">/sorovnoma/{s.slug}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => copySurveyLink(s.slug)}
                      className="rounded px-2 py-0.5 font-semibold text-sky-soft hover:bg-sky/15 cursor-pointer"
                    >
                      Nusxalash
                    </button>
                    <a
                      href={`/sorovnoma/${s.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded p-1 text-fg-subtle hover:bg-ink-800 hover:text-fg"
                      title="Sahifani ochish"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openWorkspace(s.id, 'constructor')}
                    className="btn-primary h-8.5 px-3 text-[12px]"
                  >
                    Savollarni tahrirlash
                  </button>
                  <button
                    type="button"
                    onClick={() => openWorkspace(s.id, 'responses')}
                    className="btn-ghost h-8.5 px-3 text-[12px]"
                  >
                    Javoblar ({s.response_count ?? 0})
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(s)}
                    className="btn-ghost h-8.5 w-8.5 px-0"
                    title={s.active ? 'Yopish' : 'Yoqish'}
                  >
                    {s.active ? <Lock size={13} className="text-amber" /> : <Unlock size={13} className="text-emerald-soft" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicate(s)}
                    className="btn-ghost h-8.5 w-8.5 px-0"
                    title="Nusxa ko'chirish"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSurvey(s)}
                    className="btn-danger h-8.5 w-8.5 px-0"
                    title="O'chirish"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* YANGI SO'ROVNOMA MODALI */}
      {isCreateVisible && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
          onClick={closeCreateModal}
        >
          <form
            onSubmit={handleCreate}
            onClick={(e) => e.stopPropagation()}
            className="panel animate-scale-up w-full max-w-lg space-y-4 p-5 sm:p-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-extrabold text-fg">Yangi so&apos;rovnoma yaratish</h2>
              <button type="button" onClick={closeCreateModal} className="btn-ghost h-8 px-2.5 text-[12px]">
                Yopish
              </button>
            </div>

            <div>
              <label className="label">So&apos;rovnoma nomi *</label>
              <input
                type="text"
                autoFocus
                className="field h-10.5 font-semibold"
                placeholder="Masalan: Talabalarning bank kartasi va telefon raqamlari"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Kimlar to&apos;ldiradi?</label>
              <div className="grid grid-cols-3 gap-2">
                {(['talabalar', 'xodimlar', 'ochiq'] as SurveyAudience[]).map((aud) => (
                  <button
                    key={aud}
                    type="button"
                    onClick={() => setNewAudience(aud)}
                    className={cx(
                      'rounded-lg border px-2.5 py-2 text-center text-[12.5px] font-bold transition-colors cursor-pointer',
                      newAudience === aud
                        ? 'border-sky/60 bg-sky/15 text-sky-soft'
                        : 'border-line bg-ink-950/50 text-fg-muted hover:text-fg',
                    )}
                  >
                    {aud === 'talabalar' ? 'Talabalar' : aud === 'xodimlar' ? 'Xodimlar' : 'Ochiq'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Boshlang&apos;ich shablon (keyin hohlagancha o&apos;zgartirasiz)</label>
              <div className="grid gap-2 sm:grid-cols-2">
                {SURVEY_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => setNewTemplateId(tpl.id)}
                    className={cx(
                      'rounded-lg border p-2.5 text-left transition-colors cursor-pointer',
                      newTemplateId === tpl.id
                        ? 'border-emerald/60 bg-emerald/12 text-fg'
                        : 'border-line bg-ink-950/50 text-fg-muted hover:text-fg',
                    )}
                  >
                    <div className="text-[12.5px] font-bold">{tpl.name}</div>
                    <div className="mt-0.5 text-[11px] text-fg-subtle">{tpl.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeCreateModal} className="btn-ghost h-10 px-4">
                Bekor qilish
              </button>
              <button type="submit" disabled={creating} className="btn-success h-10 px-5">
                {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                <span>Yaratish va savollarni tuzish</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
