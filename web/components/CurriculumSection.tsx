'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Award,
  BookOpen,
  Calendar,
  Check,
  Edit2,
  Layers,
  Link as LinkIcon,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import {
  type FanReja,
  type OquvReja,
  STANDART_MUDDATLAR,
  STANDART_OQUV_YILLARI,
  STANDART_YONALISHLAR,
  genId,
} from '@/lib/curriculum'
import type { Student } from '@/lib/types'
import { academicGroups } from '@/lib/student'
import type { Notify } from './Toast'
import { cx } from './ui'

interface CurriculumSectionProps {
  students: Student[]
  notify: Notify
  addOpen?: boolean
  onCloseAdd?: () => void
}

export default function CurriculumSection({
  students,
  notify,
  addOpen,
  onCloseAdd,
}: CurriculumSectionProps) {
  const allGroups = useMemo(() => academicGroups(students), [students])
  const [plans, setPlans] = useState<OquvReja[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Tanlangan filtrlar va holatlar
  const [selectedYear, setSelectedYear] = useState<string>('2026/2027')
  const [activePlanId, setActivePlanId] = useState<string>('')
  const [activeSemestr, setActiveSemestr] = useState<number>(1)

  // Yangi/tahrirlanadigan reja modal holati
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<Partial<OquvReja> | null>(null)
  const [isCustomYonalish, setIsCustomYonalish] = useState(false)

  // Yangi o'quv yili kiritish modal holati
  const [newYearModalOpen, setNewYearModalOpen] = useState(false)
  const [customYearInput, setCustomYearInput] = useState('')

  // Yangi fan qo'shish nomi
  const [newSubjectName, setNewSubjectName] = useState('')

  // Guruhlarni biriktirish modal holati
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [assignedGroupsDraft, setAssignedGroupsDraft] = useState<string[]>([])

  /* ---------------------------- Ma'lumotlarni yuklash ---------------------------- */

  const loadPlans = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/curriculum', { cache: 'no-store' })
      const data = await res.json()
      if (data.ok && Array.isArray(data.plans)) {
        setPlans(data.plans)
      } else {
        notify(data.error || "O'quv rejalarni yuklab bo'lmadi", 'error')
      }
    } catch (err) {
      notify(`Server bilan aloqa xatosi: ${(err as Error).message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  // Mavjud o'quv yillari ro'yxati
  const availableYears = useMemo(() => {
    const set = new Set<string>(STANDART_OQUV_YILLARI)
    for (const p of plans) {
      if (p.oquvYili) set.add(p.oquvYili)
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [plans])

  // Joriy o'quv yilidagi rejalar
  const yearPlans = useMemo(() => {
    return plans.filter((p) => p.oquvYili === selectedYear)
  }, [plans, selectedYear])

  // Tanlangan reja
  const activePlan = useMemo(() => {
    if (!yearPlans.length) return null
    return yearPlans.find((p) => p.id === activePlanId) || yearPlans[0]
  }, [yearPlans, activePlanId])

  // Tanlangan reja o'zgarganda activePlanId ni yangilash
  useEffect(() => {
    if (activePlan && activePlan.id !== activePlanId) {
      setActivePlanId(activePlan.id)
    }
  }, [activePlan, activePlanId])

  // Tashqi chaqiriq orqali yangi reja qo'shish modalini ochish
  useEffect(() => {
    if (addOpen) {
      openNewPlanModal()
      if (onCloseAdd) onCloseAdd()
    }
  }, [addOpen, onCloseAdd])

  /* ---------------------------- Reja bilan amallar ---------------------------- */

  const openNewPlanModal = () => {
    setIsCustomYonalish(false)
    setEditingPlan({
      id: genId('plan'),
      oquvYili: selectedYear,
      yonalish: 'Hamshiralik ishi',
      muddati: '3 yillik',
      daraja: "O'rta maxsus professional",
      kod: '5510101',
      tavsif: '',
      groups: [],
      semestrlar: {
        '1': { semestr: 1, fanlar: [] },
        '2': { semestr: 2, fanlar: [] },
        '3': { semestr: 3, fanlar: [] },
        '4': { semestr: 4, fanlar: [] },
        '5': { semestr: 5, fanlar: [] },
        '6': { semestr: 6, fanlar: [] },
      },
    })
    setPlanModalOpen(true)
  }

  const openEditPlanModal = (p: OquvReja) => {
    const isStd = (STANDART_YONALISHLAR as readonly string[]).includes(p.yonalish)
    setIsCustomYonalish(!isStd)
    setEditingPlan(JSON.parse(JSON.stringify(p)))
    setPlanModalOpen(true)
  }

  const handleSavePlanModal = async () => {
    if (!editingPlan || !editingPlan.yonalish || !editingPlan.oquvYili) {
      notify("Yo'nalish va o'quv yili kiritilishi shart", 'error')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'savePlan', plan: editingPlan }),
      })
      const data = await res.json()
      if (data.ok) {
        setPlans(data.plans)
        setActivePlanId(editingPlan.id!)
        setPlanModalOpen(false)
        notify("O'quv reja muvaffaqiyatli saqlandi!", 'success')
      } else {
        notify(data.error || 'Saqlashda xatolik', 'error')
      }
    } catch (e) {
      notify(`Xatolik: ${(e as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDeletePlan = async (plan: OquvReja) => {
    if (!confirm(`Haqiqatan ham "${plan.yonalish} (${plan.muddati})" o'quv rejasini o'chirmoqchimisiz?`)) {
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deletePlan', id: plan.id }),
      })
      const data = await res.json()
      if (data.ok) {
        setPlans(data.plans)
        notify("O'quv reja o'chirildi", 'info')
      } else {
        notify(data.error || "O'chirishda xatolik", 'error')
      }
    } catch (e) {
      notify(`Xatolik: ${(e as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  /* ---------------------------- Fanlar bilan amallar ---------------------------- */

  const currentSubjects: FanReja[] = useMemo(() => {
    if (!activePlan || !activePlan.semestrlar) return []
    const s = activePlan.semestrlar[String(activeSemestr)]
    return s?.fanlar ? [...s.fanlar].sort((a, b) => a.tartib - b.tartib) : []
  }, [activePlan, activeSemestr])

  const saveUpdatedPlanSubjects = async (updatedSubjects: FanReja[]) => {
    if (!activePlan) return
    const nextPlan: OquvReja = JSON.parse(JSON.stringify(activePlan))
    if (!nextPlan.semestrlar) nextPlan.semestrlar = {}
    nextPlan.semestrlar[String(activeSemestr)] = {
      semestr: activeSemestr,
      fanlar: updatedSubjects,
    }

    setSaving(true)
    try {
      const res = await fetch('/api/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'savePlan', plan: nextPlan }),
      })
      const data = await res.json()
      if (data.ok) {
        setPlans(data.plans)
        notify("Fanlar ro'yxati yangilandi", 'success')
      } else {
        notify(data.error || 'Xatolik yuz berdi', 'error')
      }
    } catch (e) {
      notify(`Xatolik: ${(e as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleAddSubject = async () => {
    if (!newSubjectName.trim()) {
      notify('Fan nomini kiriting', 'error')
      return
    }

    const nextItem: FanReja = {
      id: genId('fan'),
      nom: newSubjectName.trim(),
      soat: 0,
      nazorat: 'Sinov',
      tartib: currentSubjects.length + 1,
    }

    const updated = [...currentSubjects, nextItem]
    await saveUpdatedPlanSubjects(updated)
    setNewSubjectName('')
  }

  const handleDeleteSubject = async (subjectId: string) => {
    const updated = currentSubjects
      .filter((s) => s.id !== subjectId)
      .map((s, idx) => ({ ...s, tartib: idx + 1 }))
    await saveUpdatedPlanSubjects(updated)
  }

  const handleMoveSubject = async (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return
    if (direction === 'down' && index === currentSubjects.length - 1) return

    const targetIdx = direction === 'up' ? index - 1 : index + 1
    const copy = [...currentSubjects]
    const temp = copy[index]
    copy[index] = copy[targetIdx]
    copy[targetIdx] = temp

    const reordered = copy.map((s, idx) => ({ ...s, tartib: idx + 1 }))
    await saveUpdatedPlanSubjects(reordered)
  }

  /* ---------------------------- Guruhlarni biriktirish ---------------------------- */

  const openAssignModal = () => {
    if (!activePlan) return
    setAssignedGroupsDraft([...(activePlan.groups || [])])
    setAssignModalOpen(true)
  }

  const handleSaveAssignedGroups = async () => {
    if (!activePlan) return
    setSaving(true)
    try {
      const res = await fetch('/api/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assignGroups',
          planId: activePlan.id,
          groups: assignedGroupsDraft,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        setPlans(data.plans)
        setAssignModalOpen(false)
        notify(
          `${assignedGroupsDraft.length} ta guruh "${activePlan.yonalish}" o'quv rejasiga biriktirildi!`,
          'success',
        )
      } else {
        notify(data.error || 'Biriktirishda xatolik', 'error')
      }
    } catch (e) {
      notify(`Xatolik: ${(e as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 animate-fade-in pb-12">
      {/* 1-qator: O'quv yili tanlagich va Yangilash */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-fg-muted font-bold text-[13px] mr-1">
            <Calendar size={16} className="text-sky" />
            <span>O'quv yili:</span>
          </div>

          <div className="seg flex-wrap">
            {availableYears.map((yr) => (
              <button
                key={yr}
                type="button"
                onClick={() => setSelectedYear(yr)}
                aria-pressed={selectedYear === yr}
                className="seg-btn mono px-3"
              >
                {yr}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setNewYearModalOpen(true)}
            className="btn-ghost h-8 px-2.5 text-[12px] text-sky-soft hover:text-sky font-semibold"
            title="Yangi o'quv yili qo'shish"
          >
            <Plus size={14} />
            <span>Yangi yil</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-[12px] text-fg-muted hidden sm:inline">
            Jami: <b className="text-fg">{yearPlans.length} ta</b> yo'nalish rejasi
          </span>
          <button
            type="button"
            onClick={loadPlans}
            disabled={loading}
            className="btn-ghost size-8 p-0 text-fg-muted hover:text-fg rounded-lg"
            title="Yangilash"
          >
            <RefreshCw size={14} className={cx(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="panel flex items-center justify-center gap-2.5 py-24 text-[13.5px] text-fg-muted">
          <Loader2 size={18} className="animate-spin text-sky" />
          <span>O'quv rejalari yuklanmoqda…</span>
        </div>
      ) : yearPlans.length === 0 ? (
        <div className="panel p-12 text-center space-y-3 bg-ink-900/40">
          <BookOpen size={36} className="mx-auto text-fg-subtle opacity-60" />
          <div className="text-[16px] font-bold text-fg">
            {selectedYear} o'quv yili uchun o'quv reja topilmadi
          </div>
          <p className="text-[13px] text-fg-muted max-w-md mx-auto">
            Ushbu o'quv yili uchun yangi yo'nalish o'quv rejasi va fanlarini kiritishingiz mumkin.
          </p>
          <button
            type="button"
            onClick={openNewPlanModal}
            className="btn-primary mx-auto mt-2"
          >
            <Plus size={15} />
            <span>O'quv reja yaratish</span>
          </button>
        </div>
      ) : (
        /* Asosiy 2 ustunli tuzilma: Chapda Rejalar kartochkalari, O'ngda Semestr va Fanlar jadvali */
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)]">
          {/* Chap ustun (4 ustun): O'quv rejalari ro'yxati */}
          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between px-1 text-[12px] font-bold text-fg-subtle uppercase tracking-wider">
              <span>Yo'nalishlar ({yearPlans.length})</span>
              <button
                type="button"
                onClick={openNewPlanModal}
                className="btn-ghost h-6 px-2 text-[11px] text-sky-soft hover:text-sky font-bold flex items-center gap-1"
                title="Yangi o'quv reja qo'shish"
              >
                <Plus size={13} />
                <span>Qo'shish</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {yearPlans.map((p) => {
                const isSelected = p.id === activePlan?.id
                const totalSubjects = Object.values(p.semestrlar || {}).reduce(
                  (sum, s) => sum + (s.fanlar ? s.fanlar.length : 0),
                  0,
                )
                const groupCount = p.groups ? p.groups.length : 0

                return (
                  <div
                    key={p.id}
                    onClick={() => setActivePlanId(p.id)}
                    className={cx(
                      'panel p-3.5 transition-all cursor-pointer border text-left relative group',
                      isSelected
                        ? 'border-sky/60 bg-sky/8 ring-1 ring-sky/30 shadow-md border-l-4 border-l-sky'
                        : 'border-line hover:border-line-strong hover:bg-ink-850/80',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[14.5px] font-extrabold text-fg truncate">
                            {p.yonalish}
                          </span>
                          <span className="chip border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-[10.5px] px-1.5 py-0.5">
                            {p.muddati}
                          </span>
                        </div>

                        {p.kod && (
                          <div className="text-[11px] text-fg-subtle font-mono mt-0.5">
                            Kodi: {p.kod}
                          </div>
                        )}
                      </div>

                      {/* Tahrirlash va o'chirish tezkor tugmalari */}
                      <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openEditPlanModal(p)
                          }}
                          className="size-7 grid place-items-center rounded-lg text-fg-subtle hover:text-fg hover:bg-ink-700/60 transition-colors"
                          title="Tahrirlash"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeletePlan(p)
                          }}
                          className="size-7 grid place-items-center rounded-lg text-rose/70 hover:text-rose hover:bg-rose/10 transition-colors"
                          title="O'chirish"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Biriktirilgan guruhlar va fanlar statistikasi */}
                    <div className="mt-3 pt-2.5 border-t border-line/60 flex items-center justify-between text-[11.5px] text-fg-muted">
                      <div className="flex items-center gap-1.5">
                        <Layers size={13} className="text-sky-soft" />
                        <span>
                          Guruhlar:{' '}
                          <b className="text-fg tabular-nums">{groupCount} ta</b>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <BookOpen size={13} className="text-amber" />
                        <span>
                          Fanlar:{' '}
                          <b className="text-fg tabular-nums">{totalSubjects} ta</b>
                        </span>
                      </div>
                    </div>

                    {/* Guruhlar yorliqlari */}
                    {groupCount > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.groups.map((g) => (
                          <span
                            key={g}
                            className="rounded bg-ink-800/80 px-1.5 py-0.5 text-[10.5px] font-mono font-bold text-fg-muted"
                          >
                            {g}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Guruhlarni biriktirish paneli kartochkasi */}
            {activePlan && (
              <div className="panel p-3.5 bg-ink-900/40 border-line space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-bold text-fg flex items-center gap-1.5">
                    <LinkIcon size={14} className="text-emerald" />
                    <span>Guruhlarga biriktirish</span>
                  </div>
                  <button
                    type="button"
                    onClick={openAssignModal}
                    className="btn-ghost h-6 px-2 text-[11px] text-sky-soft hover:text-sky font-bold"
                  >
                    O'zgartirish
                  </button>
                </div>
                <p className="text-[11.5px] text-fg-muted leading-relaxed">
                  Ushbu rejaga biriktirilgan guruhlar Baholar bo'limida barcha semestr fanlarini avtomatik
                  oladi va baholar jadvali shakllanadi.
                </p>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {activePlan.groups?.length ? (
                    activePlan.groups.map((g) => (
                      <span
                        key={g}
                        className="rounded-lg border border-emerald/40 bg-emerald/10 px-2 py-0.5 text-[11px] font-mono font-bold text-emerald-soft"
                      >
                        {g}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-amber italic">
                      Hali hech qaysi guruh biriktirilmagan
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* O'ng ustun (8 ustun): Semestrlar va Fanlar ro'yxati */}
          <div className="min-w-0 space-y-4">
            {activePlan && (
              <>
                {/* Yuqori qism: Reja tafsilotlari va Semestr switch */}
                <div className="panel p-4 space-y-3.5 bg-ink-900/60 border-line">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-[17px] font-black text-fg tracking-tight">
                          {activePlan.yonalish}
                        </h2>
                        <span className="chip border-sky/40 bg-sky/10 text-sky-soft text-[11px] font-bold">
                          {activePlan.muddati}
                        </span>
                        {activePlan.kod && (
                          <span className="chip border-line bg-ink-950 text-fg-subtle text-[11px] font-mono">
                            Kodi: {activePlan.kod}
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] text-fg-muted mt-1 flex items-center gap-2 flex-wrap">
                        <span>O'quv yili: <b className="text-fg">{activePlan.oquvYili}</b></span>
                        <span>·</span>
                        <span>
                          Biriktirilgan: <b className="text-fg">{activePlan.groups?.length || 0} ta guruh</b>
                        </span>
                        {activePlan.groups && activePlan.groups.length > 0 && (
                          <span className="text-fg-subtle font-mono text-[11px]">
                            ({activePlan.groups.join(', ')})
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Guruhlarni biriktirish tugmasi */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={openAssignModal}
                        className="btn-ghost h-8 px-3 text-[12px] border border-line bg-ink-950 font-bold text-fg-muted hover:text-fg hover:border-emerald/40 hover:bg-emerald/5 transition-all"
                        title="Ushbu reja asosida o'qiydigan guruhlarni tanlash"
                      >
                        <LinkIcon size={13} className="text-emerald" />
                        <span>Guruhlarni biriktirish ({activePlan.groups?.length || 0})</span>
                      </button>
                    </div>
                  </div>

                  {/* Semestrlar tugmalari (1-dan 6-semestrgacha) - 1366 va mobile ga moslashuvchan grid */}
                  <div className="seg grid grid-cols-3 sm:grid-cols-6">
                    {[1, 2, 3, 4, 5, 6].map((sem) => {
                      const count = activePlan.semestrlar?.[String(sem)]?.fanlar?.length || 0
                      const isActive = activeSemestr === sem
                      return (
                        <button
                          key={sem}
                          type="button"
                          onClick={() => setActiveSemestr(sem)}
                          aria-pressed={isActive}
                          className="seg-btn h-8 gap-1.5 px-1.5"
                        >
                          <span>{sem}-semestr</span>
                          <span className={cx('count', isActive && 'bg-sky/20 text-sky-soft')}>
                            {count}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Fanlar ro'yxati va yangi fan qo'shish */}
                <div className="panel overflow-hidden">
                  <div className="p-3.5 border-b border-line flex items-center justify-between gap-3 bg-ink-950/40">
                    <div className="flex items-center gap-2">
                      <Award size={16} className="text-amber" />
                      <span className="text-[14px] font-bold text-fg">
                        {activeSemestr}-semestr fanlari
                      </span>
                      <span className="chip border-line bg-ink-950 text-fg-muted text-[11px] font-bold px-2 py-0.5">
                        {currentSubjects.length} ta fan
                      </span>
                    </div>
                  </div>

                  {/* Fanlar jadvali: Faqat Tartib, Fan nomi va Amallar */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[13px] border-collapse">
                      <thead>
                        <tr className="border-b border-line bg-ink-950/70 text-[11px] font-bold text-fg-subtle uppercase tracking-wider">
                          <th className="py-2.5 px-4 w-12 text-center">#</th>
                          <th className="py-2.5 px-4 min-w-[200px]">Fan nomi</th>
                          <th className="py-2.5 px-4 w-28 text-right">Amallar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/40">
                        {currentSubjects.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-12 text-center text-fg-subtle text-[13px]">
                              <div className="max-w-xs mx-auto space-y-1.5">
                                <BookOpen size={28} className="mx-auto text-fg-subtle/50 mb-2" />
                                <div className="font-semibold text-fg">Hali fanlar kiritilmagan</div>
                                <div className="text-[12px] text-fg-muted">
                                  Ushbu {activeSemestr}-semestr uchun pastdagi maydondan yangi fan qo'shishingiz mumkin.
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          currentSubjects.map((sub, index) => (
                            <tr
                              key={sub.id}
                              className="hover:bg-ink-850/60 transition-colors group"
                            >
                              <td className="py-3 px-4 text-center">
                                <span className="inline-flex size-6 items-center justify-center rounded-md bg-ink-950 border border-line/80 text-[11.5px] font-mono font-bold text-fg-muted group-hover:border-sky/50 group-hover:text-sky">
                                  {sub.tartib}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-semibold text-fg text-[13.5px]">
                                <div className="flex items-center gap-2.5">
                                  <span className="size-1.5 rounded-full bg-sky/70 shrink-0" />
                                  <span className="group-hover:text-sky-soft transition-colors">{sub.nom}</span>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleMoveSubject(index, 'up')}
                                    disabled={index === 0}
                                    className="size-7 grid place-items-center rounded-lg text-fg-subtle hover:text-fg hover:bg-ink-800 disabled:opacity-20 transition-all"
                                    title="Yuqoriga ko'chirish"
                                  >
                                    <ArrowUp size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMoveSubject(index, 'down')}
                                    disabled={index === currentSubjects.length - 1}
                                    className="size-7 grid place-items-center rounded-lg text-fg-subtle hover:text-fg hover:bg-ink-800 disabled:opacity-20 transition-all"
                                    title="Pastga ko'chirish"
                                  >
                                    <ArrowDown size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSubject(sub.id)}
                                    className="size-7 grid place-items-center rounded-lg text-rose/60 hover:text-rose hover:bg-rose/10 transition-all"
                                    title="O'chirish"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Yangi fan qo'shish qatori: Toza, sodda input va Qo'shish tugmasi */}
                  <div className="p-3 bg-ink-950/90 border-t border-line flex items-center gap-2.5">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        placeholder={`${activeSemestr}-semestr uchun yangi fan nomini kiriting (masalan: Xorijiy til)...`}
                        value={newSubjectName}
                        onChange={(e) => setNewSubjectName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddSubject()
                          }
                        }}
                        className="field h-10 w-full pl-3.5 pr-10 text-[13px] font-medium"
                        autoComplete="off"
                      />
                      {newSubjectName && (
                        <button
                          type="button"
                          onClick={() => setNewSubjectName('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg p-1"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleAddSubject}
                      disabled={saving || !newSubjectName.trim()}
                      className="btn-success h-10 px-4 text-[13px] font-bold shrink-0 flex items-center gap-1.5"
                    >
                      <Plus size={15} />
                      <span>Qo'shish</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ----------------- MODAL: Yangi yoki Tahrirlash Rejasi ----------------- */}
      {planModalOpen && editingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-ink-950/80 backdrop-blur-md"
            onClick={() => setPlanModalOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-xl border border-line bg-ink-900 p-6 shadow-2xl space-y-5 animate-scale-up">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-[16px] font-extrabold text-fg">
                  {editingPlan.id && yearPlans.some((p) => p.id === editingPlan.id)
                    ? "O'quv rejasini tahrirlash"
                    : "Yangi o'quv reja yaratish"}
                </h3>
                <p className="text-[12px] text-fg-muted mt-0.5">
                  Yo'nalish va ta'lim muddati bo'yicha namunaviy reja
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlanModalOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">
                  O'quv yili
                </label>
                <select
                  value={editingPlan.oquvYili || selectedYear}
                  onChange={(e) => setEditingPlan({ ...editingPlan, oquvYili: e.target.value })}
                  className="field h-10 cursor-pointer font-bold w-full"
                >
                  {availableYears.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr} o'quv yili
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">
                  Yo'nalish / Mutaxassislik nomi
                </label>
                <select
                  value={isCustomYonalish ? '__custom__' : editingPlan.yonalish || 'Hamshiralik ishi'}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '__custom__') {
                      setIsCustomYonalish(true)
                      setEditingPlan({ ...editingPlan, yonalish: '' })
                    } else {
                      setIsCustomYonalish(false)
                      setEditingPlan({ ...editingPlan, yonalish: val })
                    }
                  }}
                  className="field h-10 cursor-pointer font-semibold w-full"
                  autoComplete="off"
                >
                  {STANDART_YONALISHLAR.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                  <option value="__custom__">Boshqa yo'nalish (qo'lda kiritish)...</option>
                </select>

                {isCustomYonalish && (
                  <div className="mt-2 animate-fade-in">
                    <input
                      type="text"
                      value={editingPlan.yonalish || ''}
                      onChange={(e) => setEditingPlan({ ...editingPlan, yonalish: e.target.value })}
                      placeholder="Yo'nalish nomini aniq kiriting (masalan: Stomatologiya ishi)…"
                      className="field h-10 font-semibold w-full"
                      autoFocus
                      autoComplete="off"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">
                    Ta'lim muddati
                  </label>
                  <select
                    value={editingPlan.muddati || '3 yillik'}
                    onChange={(e) => setEditingPlan({ ...editingPlan, muddati: e.target.value })}
                    className="field h-10 cursor-pointer font-semibold w-full"
                  >
                    {STANDART_MUDDATLAR.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">
                    Mutaxassislik kodi
                  </label>
                  <input
                    type="text"
                    value={editingPlan.kod || ''}
                    onChange={(e) => setEditingPlan({ ...editingPlan, kod: e.target.value })}
                    placeholder="Masalan: 5510101"
                    className="field h-10 mono w-full"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div>
                <label className="label">
                  Tavsif / Qo'shimcha izoh (ixtiyoriy)
                </label>
                <textarea
                  value={editingPlan.tavsif || ''}
                  onChange={(e) => setEditingPlan({ ...editingPlan, tavsif: e.target.value })}
                  placeholder="O'quv rejasi bo'yicha qo'shimcha ma'lumotlar…"
                  rows={2}
                  className="field resize-none w-full"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
              <button
                type="button"
                onClick={() => setPlanModalOpen(false)}
                className="btn-ghost h-9 px-4 text-[13px]"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleSavePlanModal}
                disabled={saving || !editingPlan.yonalish}
                className="btn-primary h-9 px-5 text-[13px] font-bold"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                <span>Saqlash</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- MODAL: Yangi O'quv Yili ----------------- */}
      {newYearModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-ink-950/80 backdrop-blur-md"
            onClick={() => setNewYearModalOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-xl border border-line bg-ink-900 p-5 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <h3 className="text-[15px] font-bold text-fg">Yangi o'quv yili kiritish</h3>
              <button
                type="button"
                onClick={() => setNewYearModalOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="label">
                O'quv yili (YYYY/YYYY)
              </label>
              <input
                type="text"
                placeholder="Masalan: 2027/2028"
                value={customYearInput}
                onChange={(e) => setCustomYearInput(e.target.value)}
                className="field h-10 mono text-[14px] w-full"
                autoFocus
                autoComplete="off"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setNewYearModalOpen(false)}
                className="btn-ghost h-8 px-3 text-[12.5px]"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={() => {
                  if (/^\d{4}\/\d{4}$/.test(customYearInput.trim())) {
                    setSelectedYear(customYearInput.trim())
                    setNewYearModalOpen(false)
                    setCustomYearInput('')
                  } else {
                    notify("Format noto'g'ri. Masalan: 2027/2028 bo'lishi kerak", 'error')
                  }
                }}
                className="btn-primary h-8 px-3 text-[12.5px] font-bold"
              >
                Tanlash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- MODAL: Guruhlarga Biriktirish ----------------- */}
      {assignModalOpen && activePlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-ink-950/80 backdrop-blur-md"
            onClick={() => setAssignModalOpen(false)}
          />
          <div className="relative w-full max-w-xl rounded-xl border border-line bg-ink-900 p-5 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-[16px] font-extrabold text-fg">
                  "{activePlan.yonalish}" o'quv rejasini guruhlarga biriktirish
                </h3>
                <p className="text-[12px] text-fg-muted mt-0.5">
                  Qaysi guruhlar ushbu reja asosida o'qishini tanlang ({activePlan.oquvYili})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-fg-muted hover:text-fg hover:bg-ink-800"
              >
                <X size={16} />
              </button>
            </div>

            {/* Guruhlar ro'yxati (kataklar) */}
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {allGroups.map((grp) => {
                  const isChecked = assignedGroupsDraft.includes(grp)
                  // Boshqa rejada bormi?
                  const otherPlan = plans.find(
                    (p) => p.id !== activePlan.id && p.groups && p.groups.includes(grp),
                  )

                  return (
                    <label
                      key={grp}
                      className={cx(
                        'flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer select-none transition-colors',
                        isChecked
                          ? 'border-emerald/50 bg-emerald/10 text-fg'
                          : otherPlan
                            ? 'border-line/40 bg-ink-950/40 opacity-70'
                            : 'border-line bg-ink-950/70 hover:bg-ink-850',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setAssignedGroupsDraft([...assignedGroupsDraft, grp])
                          } else {
                            setAssignedGroupsDraft(assignedGroupsDraft.filter((g) => g !== grp))
                          }
                        }}
                        className="size-4 rounded accent-emerald"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-bold text-fg">{grp}</div>
                        {otherPlan && !isChecked && (
                          <div className="text-[10px] text-amber truncate" title={otherPlan.yonalish}>
                            {otherPlan.yonalish}
                          </div>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-line">
              <div className="text-[12px] text-fg-muted">
                Tanlandi: <b className="text-emerald-soft">{assignedGroupsDraft.length} ta guruh</b>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="btn-ghost h-9 px-3 text-[12.5px]"
                >
                  Bekor qilish
                </button>
                <button
                  type="button"
                  onClick={handleSaveAssignedGroups}
                  disabled={saving}
                  className="btn-success h-9 px-4 text-[13px] font-bold flex items-center gap-1.5"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  <span>Biriktirishni saqlash</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
