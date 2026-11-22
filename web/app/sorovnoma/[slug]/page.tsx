'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { AlertCircle, CheckCircle2, Lock, Loader2, Send, UserCheck } from 'lucide-react'
import SurveyFieldInput from '@/components/SurveyFieldInput'
import { cx } from '@/components/ui'
import { AUDIENCE_META, officialGroupOptions, validateAndNormalizeAnswers, type OfficialGroupOption, type Survey } from '@/lib/sorovnoma'

interface PublicStudent {
  row: number
  fish: string
  group: string
  kurs: number
  topshirgan: boolean
}

interface PublicStaff {
  id: string
  fish: string
  kategoriya: string
  lavozim: string
  topshirgan: boolean
}

function PublicSurveyInner() {
  const params = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const slug = String(params?.slug || '').trim()
  const initialGroup = searchParams.get('guruh')?.trim() || ''

  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [closed, setClosed] = useState(false)
  const [students, setStudents] = useState<PublicStudent[]>([])
  const [staff, setStaff] = useState<PublicStaff[]>([])
  const [officialGroups, setOfficialGroups] = useState<OfficialGroupOption[]>(() => officialGroupOptions())

  // Respondent tanlovi
  const [kurs, setKurs] = useState('')
  const [group, setGroup] = useState(initialGroup)
  const [studentRow, setStudentRow] = useState('')
  const [staffCat, setStaffCat] = useState('')
  const [staffId, setStaffId] = useState('')
  const [openName, setOpenName] = useState('')
  const [openGroup, setOpenGroup] = useState(initialGroup)
  const [searchFish, setSearchFish] = useState('')

  // Javoblar va xatoliklar
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [respondentError, setRespondentError] = useState(false)
  const [shaking, setShaking] = useState(false)
  const [submitErr, setSubmitErr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [done, setDone] = useState<{ name: string; group: string; updated?: boolean } | null>(null)

  const triggerShake = () => {
    setShaking(false)
    requestAnimationFrame(() => {
      setShaking(true)
      setTimeout(() => setShaking(false), 400)
    })
  }

  useEffect(() => {
    if (!slug) {
      setLoadErr("So'rovnoma manzili noto'g'ri")
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/api/sorovnomalar/public?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((b: {
        ok?: boolean
        error?: string
        survey?: Survey
        closed?: boolean
        students?: PublicStudent[]
        staff?: PublicStaff[]
        groups?: OfficialGroupOption[]
      }) => {
        if (!b.ok || !b.survey) throw new Error(b.error || "So'rovnoma topilmadi")
        setSurvey(b.survey)
        setClosed(Boolean(b.closed))
        const stList = b.students ?? []
        setStudents(stList)
        setStaff(b.staff ?? [])
        if (Array.isArray(b.groups) && b.groups.length > 0) {
          setOfficialGroups(b.groups)
        }

        if (b.survey.audience === 'talabalar') {
          const distinctCourses = [...new Set(stList.map((s) => s.kurs).filter(Boolean))]
          const distinctGroups = [...new Set(stList.map((s) => s.group).filter(Boolean))]
          if (initialGroup) {
            const match = stList.find((s) => s.group === initialGroup)
            if (match?.kurs) setKurs(String(match.kurs))
            if (match) setGroup(match.group)
          } else {
            if (distinctCourses.length === 1) {
              setKurs(String(distinctCourses[0]))
            }
            if (distinctGroups.length === 1) {
              setGroup(distinctGroups[0])
            }
          }
        }
      })
      .catch((e: Error) => setLoadErr(e.message))
      .finally(() => setLoading(false))
  }, [slug, initialGroup])

  const availableCourses = useMemo(() => {
    const set = new Set<number>()
    for (const s of students) if (s.kurs) set.add(s.kurs)
    return [...set].sort((a, b) => a - b)
  }, [students])

  const groups = useMemo(() => {
    const set = new Set<string>()
    for (const s of students) {
      if (kurs && s.kurs !== Number(kurs)) continue
      set.add(s.group)
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [students, kurs])

  const groupStudents = useMemo(() => {
    const q = searchFish.trim().toLowerCase()
    return students
      .filter((s) => (group ? s.group === group : false))
      .filter((s) => (!q ? true : s.fish.toLowerCase().includes(q)))
      .sort((a, b) => a.fish.localeCompare(b.fish, 'uz'))
  }, [students, group, searchFish])

  const selectedStudent = useMemo(
    () => students.find((s) => String(s.row) === studentRow && s.group === group) ?? null,
    [students, studentRow, group],
  )

  const staffCategories = useMemo(() => {
    const set = new Set<string>()
    for (const m of staff) if (m.kategoriya) set.add(m.kategoriya)
    return [...set].sort((a, b) => a.localeCompare(b, 'uz'))
  }, [staff])

  const filteredStaff = useMemo(() => {
    const q = searchFish.trim().toLowerCase()
    return staff
      .filter((m) => (!staffCat ? true : m.kategoriya === staffCat))
      .filter((m) => (!q ? true : m.fish.toLowerCase().includes(q)))
      .sort((a, b) => a.fish.localeCompare(b.fish, 'uz'))
  }, [staff, staffCat, searchFish])

  const selectedStaff = useMemo(
    () => staff.find((m) => m.id === staffId) ?? null,
    [staff, staffId],
  )

  const blockedAlreadySubmitted = Boolean(
    survey &&
      survey.allow_update === false &&
      ((survey.audience === 'talabalar' && selectedStudent?.topshirgan) ||
        (survey.audience === 'xodimlar' && selectedStaff?.topshirgan)),
  )

  const progress = useMemo(() => {
    if (!survey) return { done: 0, total: 0, pct: 0 }
    const reqQs = survey.questions.filter((q) => q.required)
    let filled = 0
    for (const q of reqQs) {
      const v = answers[q.id]
      if (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '') filled++
    }
    const idDone =
      survey.audience === 'talabalar'
        ? Boolean(selectedStudent)
        : survey.audience === 'xodimlar'
          ? Boolean(selectedStaff)
          : openName.trim().length >= 3 && openGroup.trim() !== ''
    const total = reqQs.length + 1
    const doneCount = filled + (idDone ? 1 : 0)
    return { done: doneCount, total, pct: total > 0 ? Math.round((doneCount / total) * 100) : 100 }
  }, [survey, answers, selectedStudent, selectedStaff, openName, openGroup])

  const setAnswer = (qid: string, val: unknown) => {
    setAnswers((prev) => ({ ...prev, [qid]: val }))
    if (fieldErrors[qid]) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next[qid]
        return next
      })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!survey) return
    setSubmitErr('')
    setFieldErrors({})
    setRespondentError(false)

    if (survey.audience === 'talabalar' && !selectedStudent) {
      setRespondentError(true)
      setSubmitErr('Iltimos, guruh va talaba (F.I.Sh.) ni tanlang')
      triggerShake()
      document.getElementById('respondent-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (survey.audience === 'xodimlar' && !selectedStaff) {
      setRespondentError(true)
      setSubmitErr("Iltimos, ro'yxatdan o'zingizni (F.I.Sh.) tanlang")
      triggerShake()
      document.getElementById('respondent-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (survey.audience === 'ochiq') {
      if (openName.trim().length < 3) {
        setRespondentError(true)
        setSubmitErr("Iltimos, ism-familiyangizni to'liq kiriting")
        triggerShake()
        document.getElementById('respondent-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      if (!openGroup.trim()) {
        setRespondentError(true)
        setSubmitErr('Iltimos, guruhingizni tanlang')
        triggerShake()
        document.getElementById('respondent-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }
    if (blockedAlreadySubmitted) {
      setSubmitErr("Siz bu so'rovnomani allaqachon topshirgansiz")
      return
    }

    const v = validateAndNormalizeAnswers(survey.questions, answers)
    if (!v.ok) {
      setFieldErrors(v.errors)
      setSubmitErr(v.firstError)
      triggerShake()
      const firstId = Object.keys(v.errors)[0]
      if (firstId) {
        document.getElementById(`q-card-${firstId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/sorovnomalar/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: survey.slug,
          studentRow: selectedStudent?.row,
          studentGroup: selectedStudent?.group,
          staffId: selectedStaff?.id,
          respondentName: openName.trim(),
          respondentGroup: openGroup.trim(),
          answers: v.answers,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        fieldErrors?: Record<string, string>
        updated?: boolean
        respondentName?: string
        respondentGroup?: string
      }
      if (!res.ok || !body.ok) {
        if (body.fieldErrors) setFieldErrors(body.fieldErrors)
        throw new Error(body.error || `Server xatosi (${res.status})`)
      }

      if (survey.audience === 'talabalar' && selectedStudent) {
        setStudents((prev) => prev.map((s) => (s.row === selectedStudent.row ? { ...s, topshirgan: true } : s)))
      } else if (survey.audience === 'xodimlar' && selectedStaff) {
        setStaff((prev) => prev.map((m) => (m.id === selectedStaff.id ? { ...m, topshirgan: true } : m)))
      }

      setDone({
        name: body.respondentName || selectedStudent?.fish || selectedStaff?.fish || openName.trim(),
        group: body.respondentGroup || selectedStudent?.group || selectedStaff?.kategoriya || '',
        updated: body.updated,
      })
    } catch (err) {
      setSubmitErr((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const resetForAnother = () => {
    setDone(null)
    setStudentRow('')
    setStaffId('')
    setOpenName('')
    setOpenGroup(initialGroup)
    setSearchFish('')
    setAnswers({})
    setFieldErrors({})
    setRespondentError(false)
    setSubmitErr('')
    setResetKey((k) => k + 1)
  }

  return (
    <div className="min-h-screen bg-ink-950 px-3 py-6 text-fg sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {/* Sarlavha */}
        <header className="panel overflow-hidden border-t-4 border-t-sky">
          <div className="flex items-start gap-3.5 p-4 sm:p-6">
            <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border border-sky/40 bg-ink-900 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png?v=2" alt="ShTT" className="size-12 object-contain" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-sky-soft">
                Shahrisabz Tibbiyot Texnikumi · Rasmiy so&apos;rovnoma
              </div>
              <h1 className="mt-0.5 text-[18px] font-extrabold tracking-tight text-fg sm:text-[21px]">
                {survey ? survey.title : "So'rovnoma"}
              </h1>
              {survey?.description && (
                <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-fg-muted">
                  {survey.description}
                </p>
              )}
              {survey && !closed && !done && !loadErr && (
                <div className="mt-3 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-fg-subtle">
                    <span>{AUDIENCE_META[survey.audience].label}</span>
                    <span className="tabular-nums">
                      Majburiy maydonlar: {progress.done} / {progress.total} ({progress.pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue to-emerald transition-[width] duration-300"
                      style={{ width: `${progress.pct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {loading ? (
          <div className="panel flex items-center justify-center gap-2 py-16 text-[13.5px] text-fg-muted">
            <Loader2 size={18} className="animate-spin text-sky" /> So&apos;rovnoma yuklanmoqda…
          </div>
        ) : loadErr || !survey ? (
          <div className="panel space-y-2 border-rose/40 bg-rose/5 p-6 text-center">
            <AlertCircle size={30} className="mx-auto text-rose" />
            <div className="text-[15px] font-bold text-fg">So&apos;rovnoma topilmadi</div>
            <p className="text-[13px] text-fg-muted">{loadErr || "Havola noto'g'ri yoki o'chirilgan."}</p>
          </div>
        ) : closed ? (
          <div className="panel space-y-2 border-amber/40 bg-amber/5 p-6 text-center">
            <Lock size={30} className="mx-auto text-amber" />
            <div className="text-[15px] font-bold text-fg">So&apos;rovnoma yopilgan</div>
            <p className="text-[13px] text-fg-muted">
              Ushbu so&apos;rovnomaga javob qabul qilish to&apos;xtatilgan yoki belgilangan muddat tugagan.
            </p>
          </div>
        ) : done ? (
          <div className="panel animate-pop-in space-y-4 p-6 text-center sm:p-8">
            <div className="animate-pop-check mx-auto grid size-14 place-items-center rounded-full border border-emerald/40 bg-emerald/15 text-emerald-soft">
              <CheckCircle2 size={30} />
            </div>
            <div>
              <h2 className="text-[18px] font-extrabold text-fg">
                {done.updated ? "Javobingiz yangilandi!" : "Javobingiz qabul qilindi!"}
              </h2>
              <p className="mt-1.5 text-[13.5px] text-fg-muted">
                <b className="text-fg">{done.name}</b>
                {done.group ? ` (${done.group})` : ''} — ma&apos;lumotlaringiz muvaffaqiyatli saqlandi.
              </p>
            </div>
            <button type="button" onClick={resetForAnother} className="btn-primary mx-auto h-10 px-5">
              Yana bir javob yuborish
            </button>
          </div>
        ) : (
          <form key={resetKey} onSubmit={handleSubmit} className="space-y-3.5" noValidate>
            {/* Kim to'ldiryapti */}
            <section
              id="respondent-card"
              className={cx(
                'panel animate-fade-slide-up space-y-3.5 p-4 transition-colors sm:p-5',
                respondentError && 'border-rose/60 bg-rose/[0.03]',
                respondentError && shaking && 'animate-shake',
              )}
            >
              <div className="flex items-center gap-2 text-[13px] font-bold text-sky-soft">
                <UserCheck size={16} />
                <span>
                  {survey.audience === 'talabalar'
                    ? 'Talabani tanlang *'
                    : survey.audience === 'xodimlar'
                      ? 'Xodim / O‘qituvchini tanlang *'
                      : "Ma'lumot beruvchi (F.I.Sh. va guruh) *"}
                </span>
              </div>

              {survey.audience === 'talabalar' && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="sf-kurs">
                        Kurs
                      </label>
                      <select
                        id="sf-kurs"
                        className="field h-10"
                        value={kurs}
                        onChange={(e) => {
                          setKurs(e.target.value)
                          setGroup('')
                          setStudentRow('')
                        }}
                      >
                        {availableCourses.length > 1 && <option value="">Barcha kurslar</option>}
                        {availableCourses.map((k) => (
                          <option key={k} value={String(k)}>
                            {k}-kurs
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor="sf-group">
                        Guruh *
                      </label>
                      <select
                        id="sf-group"
                        className="field h-10 font-semibold"
                        value={group}
                        onChange={(e) => {
                          setGroup(e.target.value)
                          setStudentRow('')
                          setSearchFish('')
                        }}
                      >
                        <option value="">Guruhni tanlang…</option>
                        {groups.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="label" htmlFor="sf-fish">
                      Talaba (F.I.Sh.) *
                    </label>
                    {group && (
                      <input
                        type="search"
                        className="field mb-2 h-9"
                        placeholder="Ismingizni tez topish uchun yozing…"
                        value={searchFish}
                        onChange={(e) => setSearchFish(e.target.value)}
                      />
                    )}
                    <select
                      id="sf-fish"
                      className="field h-11"
                      value={studentRow}
                      disabled={!group}
                      onChange={(e) => {
                        setStudentRow(e.target.value)
                        if (respondentError) setRespondentError(false)
                      }}
                    >
                      <option value="">
                        {group ? `Talabani tanlang (${groupStudents.length} ta)…` : 'Avval guruhni tanlang'}
                      </option>
                      {groupStudents.map((s) => (
                        <option key={s.row} value={String(s.row)}>
                          {s.fish} {s.topshirgan ? '✓ (topshirgan)' : ''}
                        </option>
                      ))}
                    </select>
                    {selectedStudent?.topshirgan && (
                      <p className={cx('mt-1.5 text-[12px] font-medium', survey.allow_update ? 'text-amber' : 'text-rose')}>
                        {survey.allow_update
                          ? "Bu talaba avval topshirgan — qayta yuborsangiz ma'lumotlar yangilanadi."
                          : "Bu talaba allaqachon topshirgan (qayta yuborish o'chirilgan)."}
                      </p>
                    )}
                  </div>
                </>
              )}

              {survey.audience === 'xodimlar' && (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="sf-cat">
                        Toifa (ixtiyoriy filtr)
                      </label>
                      <select
                        id="sf-cat"
                        className="field h-10"
                        value={staffCat}
                        onChange={(e) => {
                          setStaffCat(e.target.value)
                          setStaffId('')
                        }}
                      >
                        <option value="">Barcha toifalar</option>
                        {staffCategories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor="sf-staff-search">
                        Ism bo&apos;yicha qidirish
                      </label>
                      <input
                        id="sf-staff-search"
                        type="search"
                        className="field h-10"
                        placeholder="Familiya yoki ism yozing…"
                        value={searchFish}
                        onChange={(e) => setSearchFish(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="sf-staff">
                      Xodim (F.I.Sh.) *
                    </label>
                    <select
                      id="sf-staff"
                      className="field h-11"
                      value={staffId}
                      onChange={(e) => {
                        setStaffId(e.target.value)
                        if (respondentError) setRespondentError(false)
                      }}
                    >
                      <option value="">Ro&apos;yxatdan tanlang ({filteredStaff.length} ta)…</option>
                      {filteredStaff.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fish} {m.lavozim ? `— ${m.lavozim}` : ''} {m.topshirgan ? '✓' : ''}
                        </option>
                      ))}
                    </select>
                    {selectedStaff?.topshirgan && (
                      <p className={cx('mt-1.5 text-[12px] font-medium', survey.allow_update ? 'text-amber' : 'text-rose')}>
                        {survey.allow_update
                          ? "Siz avval topshirgansiz — qayta yuborsangiz ma'lumotlar yangilanadi."
                          : "Siz allaqachon topshirgansiz (qayta yuborish o'chirilgan)."}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {survey.audience === 'ochiq' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="sf-open-name">
                      Familiya, Ism, Sharif (F.I.Sh.) *
                    </label>
                    <input
                      id="sf-open-name"
                      type="text"
                      className="field h-11"
                      placeholder="Masalan: Karimov Sardor Alisher o'g'li"
                      value={openName}
                      onChange={(e) => {
                        setOpenName(e.target.value)
                        if (respondentError) setRespondentError(false)
                      }}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="sf-open-group">
                      Guruh *
                    </label>
                    <select
                      id="sf-open-group"
                      className="field h-11 font-semibold"
                      value={openGroup}
                      onChange={(e) => {
                        setOpenGroup(e.target.value)
                        if (respondentError) setRespondentError(false)
                      }}
                    >
                      <option value="">Guruhni tanlang…</option>
                      {[1, 2, 3].map((k) => {
                        const items = officialGroups.filter((g) => g.kurs === k)
                        if (!items.length) return null
                        return (
                          <optgroup key={k} label={`${k}-kurs`}>
                            {items.map((g) => (
                              <option key={g.code} value={g.code}>
                                {g.code} — {g.title}
                              </option>
                            ))}
                          </optgroup>
                        )
                      })}
                      <option value="Boshqa / Guruhsiz">Boshqa / Guruhsiz</option>
                    </select>
                  </div>
                </div>
              )}
            </section>

            {/* Savollar kartalari */}
            {survey.questions.map((q, idx) => (
              <section
                key={q.id}
                id={`q-card-${q.id}`}
                style={{ animationDelay: `${Math.min(idx + 1, 8) * 35}ms` }}
                className={cx(
                  'panel animate-fade-slide-up space-y-2.5 p-4 transition-colors sm:p-5',
                  fieldErrors[q.id] && 'border-rose/60 bg-rose/[0.03]',
                  fieldErrors[q.id] && shaking && 'animate-shake',
                )}
              >
                <div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-ink-800 px-1.5 font-mono text-[11px] font-bold text-fg-muted">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1 text-[14.5px] font-bold leading-snug text-fg">
                      {q.label}
                      {q.required && <span className="ml-1 text-rose" title="Majburiy">*</span>}
                    </div>
                  </div>
                  {q.hint && <p className="mt-1 pl-7 text-[12px] text-fg-subtle">{q.hint}</p>}
                </div>

                <SurveyFieldInput
                  question={q}
                  value={answers[q.id]}
                  onChange={(val) => setAnswer(q.id, val)}
                  error={fieldErrors[q.id]}
                  disabled={submitting}
                  groupOptions={officialGroups}
                />
              </section>
            ))}

            {submitErr && (
              <div className="rounded-xl border border-rose/45 bg-rose/10 px-4 py-3 text-[13px] font-medium text-rose">
                {submitErr}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || blockedAlreadySubmitted}
              className="btn-primary h-12 w-full justify-center text-[15px] font-bold shadow-md"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={16} />}
              <span>{submitting ? 'Yuborilmoqda…' : 'Javobni yuborish'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function DynamicSorovnomaPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-ink-950 text-[13px] text-fg-muted">
          Yuklanmoqda…
        </div>
      }
    >
      <PublicSurveyInner />
    </Suspense>
  )
}
