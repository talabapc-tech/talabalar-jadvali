'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Briefcase,
  Building,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  GraduationCap,
  Loader2,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react'
import {
  cleanStaffPhone,
  formatSalary,
  STAFF_CATEGORIES,
  STAFF_DEPARTMENTS,
  STAFF_WORK_TYPES,
  type StaffMember,
} from '@/lib/staff'
import StaffExportModal from './StaffExportModal'
import StaffImportModal from './StaffImportModal'
import StaffModal from './StaffModal'
import type { Notify } from './Toast'
import { cx } from './ui'

interface Props {
  notify: Notify
  addOpen?: boolean
  onCloseAdd?: () => void
  exportOpen?: boolean
  onCloseExport?: () => void
}

export default function StaffSection({ notify, addOpen, onCloseAdd, exportOpen: propExportOpen, onCloseExport }: Props) {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('Barchasi')
  const [dept, setDept] = useState<string>('Barchasi')
  const [workType, setWorkType] = useState<string>('Barchasi')

  const [modalOpen, setModalOpen] = useState(false)
  const [editMember, setEditMember] = useState<StaffMember | null>(null)
  const [initialEdit, setInitialEdit] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const isModalOpen = modalOpen || Boolean(addOpen)
  const isExportOpen = exportOpen || Boolean(propExportOpen)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/staff')
      const data = await res.json()
      if (res.ok && data.ok) {
        setStaff(data.staff || [])
      } else {
        notify(data.error || "Xodimlarni yuklashda xatolik", 'error')
      }
    } catch {
      notify("Server bilan aloqa yo'q", 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  // HR papkadan sinxronlash (D:\Ozodbek HR\ASOSIY XUJJATLAR\Shahrisabz\1.Barcha xodimlar\SH.T.T)
  const handleSyncHr = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_hr' }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setStaff(data.staff || [])
        notify(`HR Bazasidan ${data.count || data.staff?.length || 0} nafar xodim muvaffaqiyatli sinxronlandi!`, 'success')
      } else {
        notify(data.error || "HR bazasini sinxronlashda xatolik", 'error')
      }
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSyncing(false)
    }
  }

  // Filtrlash
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return staff.filter((s) => {
      if (category !== 'Barchasi') {
        if (category === 'ShTAT - xodimlar' && !(s.kategoriya?.includes('Shtat') || s.ish_turi === 'Shtat')) return false
        if (category === "Asosiy o'qituvchilar" && !(s.kategoriya?.includes('Asosiy') || s.ish_turi?.includes('Asosiy'))) return false
        if (category === "O'rindosh o'qituvchilar" && !(s.kategoriya?.includes("O'rindosh") || s.ish_turi?.includes("O'rindosh"))) return false
      }
      if (dept !== 'Barchasi' && s.bolim !== dept) return false
      if (workType !== 'Barchasi' && s.ish_turi !== workType) return false
      if (!q) return true
      return (
        s.fish.toLowerCase().includes(q) ||
        s.lavozim.toLowerCase().includes(q) ||
        (s.kategoriya && s.kategoriya.toLowerCase().includes(q)) ||
        (s.bolim && s.bolim.toLowerCase().includes(q)) ||
        (s.tel && s.tel.toLowerCase().includes(q)) ||
        (s.pinfl && s.pinfl.includes(q)) ||
        (s.pv && s.pv.toLowerCase().includes(q)) ||
        (s.mutaxassislik && s.mutaxassislik.toLowerCase().includes(q)) ||
        (s.tamomlagan_otm && s.tamomlagan_otm.toLowerCase().includes(q)) ||
        (s.id && s.id.toLowerCase().includes(q))
      )
    })
  }, [staff, query, category, dept, workType])

  const currentStaffIndex = useMemo(() => {
    if (!editMember) return -1
    return filtered.findIndex((s) => s.id === editMember.id)
  }, [editMember, filtered])

  // Statistika
  const stats = useMemo(() => {
    const total = staff.length
    const shtat = staff.filter((s) => s.kategoriya?.includes('Shtat') || s.ish_turi === 'Shtat').length
    const asosiy = staff.filter((s) => s.kategoriya?.includes('Asosiy') || s.ish_turi?.includes('Asosiy')).length
    const orindosh = staff.filter((s) => s.kategoriya?.includes("O'rindosh") || s.ish_turi?.includes("O'rindosh")).length
    const teachers = asosiy + orindosh
    const active = staff.filter((s) => s.status === 'faol' || !s.status).length
    return { total, shtat, asosiy, orindosh, teachers, active }
  }, [staff])

  // Saqlash (yangi yoki tahrir)
  const handleSave = async (data: Partial<StaffMember>) => {
    const isEdit = Boolean(data.id)
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: isEdit ? 'update' : 'add',
        data,
      }),
    })
    const resData = await res.json()
    if (!res.ok || !resData.ok) {
      throw new Error(resData.error || "Saqlashda xatolik yuz berdi")
    }
    notify(isEdit ? "Xodim ma'lumotlari yangilandi" : `${data.fish} muvaffaqiyatli qo'shildi`, 'success')
    setStaff(resData.staff || [])
  }

  // O'chirish
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Haqiqatan ham «${name}» xodimini ro'yxatdan o'chirmoqchimisiz?`)) return
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || "O'chirishda xatolik")
      notify("Xodim ro'yxatdan o'chirildi", 'warning')
      setStaff(data.staff || [])
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  return (
    <div className="space-y-4">
      {/* 1. Xulosa — plitkani bosish shu toifani filtrlaydi (qayta bosish — barchasi).
          "Qo'shish" va "Eksport" yuqori paneldagi tugmalarda — bu yerda takrorlanmaydi */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
        {([
          ['Barchasi', 'Jami xodimlar', stats.total, `${stats.active} nafari faol`, Users, 'bg-sky/12 text-sky-soft'],
          ['ShTAT - xodimlar', 'ShTAT xodimlar', stats.shtat, "Ma'muriy va xo'jalik", Briefcase, 'bg-amber/12 text-amber'],
          ["Asosiy o'qituvchilar", "Asosiy o'qituvchilar", stats.asosiy, "Tarifikatsiya bo'yicha", GraduationCap, 'bg-emerald/12 text-emerald-soft'],
          ["O'rindosh o'qituvchilar", "O'rindosh o'qituvchilar", stats.orindosh, 'Ichki va tashqi', Building, 'bg-violet/12 text-violet'],
        ] as const).map(([cat, label, value, sub, Icon, tone]) => {
          const on = category === cat
          return (
            <button
              key={cat}
              type="button"
              aria-pressed={on}
              onClick={() => setCategory(on && cat !== 'Barchasi' ? 'Barchasi' : cat)}
              className={cx(
                'panel min-w-0 px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-ink-850 sm:px-3.5 sm:py-3',
                on && 'border-sky/50 bg-ink-850 ring-1 ring-sky/25',
              )}
            >
              <span className="block truncate text-[12px] font-semibold text-fg-muted">{label}</span>
              <span className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[22px] leading-tight font-extrabold text-fg tabular-nums">{value}</span>
                <span className={cx('grid size-7 shrink-0 place-items-center rounded-md', tone)}>
                  <Icon size={15} />
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[11.5px] text-fg-subtle">{sub}</span>
            </button>
          )
        })}
      </div>

      {/* 2. Filtrlar va qidiruv paneli */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <div className="relative w-full min-w-[220px] flex-1 sm:w-auto">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Qidirish: F.I.Sh, lavozim, mutaxassislik, telefon, JSHSHIR…"
            className="field h-9 pl-9"
          />
        </div>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Toifa"
          className={cx('field h-9 w-full min-w-[170px] flex-1 cursor-pointer py-1 sm:w-auto sm:flex-none', category !== 'Barchasi' && 'border-sky/50 bg-sky/5 text-sky-soft')}
        >
          {STAFF_CATEGORIES.map((c) => (
            <option key={c} value={c} className="bg-ink-900 text-fg">
              {c === 'Barchasi' ? 'Toifa: barchasi' : c}
            </option>
          ))}
        </select>

        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          aria-label="Bo'lim"
          className={cx('field h-9 w-full min-w-[150px] flex-1 cursor-pointer py-1 sm:w-auto sm:flex-none', dept !== 'Barchasi' && 'border-sky/50 bg-sky/5 text-sky-soft')}
        >
          {STAFF_DEPARTMENTS.map((d) => (
            <option key={d} value={d} className="bg-ink-900 text-fg">Bo'lim: {d}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleSyncHr}
            disabled={syncing}
            className="btn-ghost h-9 px-3 text-[12.5px]"
            title="D:\Ozodbek HR manzilidan avtomatik yangilash"
          >
            <RefreshCw size={14} className={cx('text-amber', syncing && 'animate-spin')} />
            <span className="hidden md:inline">HR dan olish</span>
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="btn-ghost h-9 px-2.5"
            title="Xodimlar ro'yxatini qayta yuklash"
            aria-label="Xodimlar ro'yxatini qayta yuklash"
          >
            <RefreshCw size={14} className={cx(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* 3. Xodimlar ro'yxati jadvali */}
      {loading ? (
        <div className="panel grid place-items-center gap-3 py-20 text-fg-muted">
          <Loader2 size={26} className="animate-spin text-sky" />
          <span>Xodimlar ro'yxati yuklanmoqda…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel grid place-items-center gap-3 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-xl border border-line bg-ink-850 text-fg-subtle">
            <Users size={28} />
          </div>
          <div>
            <div className="text-[15px] font-bold text-fg">
              {staff.length === 0 ? "Hozircha xodimlar kiritilmagan" : "Qidiruv bo'yicha xodim topilmadi"}
            </div>
            <div className="mt-1 text-[12.5px] text-fg-muted max-w-md">
              {staff.length === 0
                ? "D:\\Ozodbek HR papkasidan avtomatik sinxronlashingiz yoki yangi xodim qo'shishingiz mumkin."
                : "Qidiruv so'zini o'zgartirib yoki toifani tozalab ko'ring."}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-success h-9 px-4 text-[12.5px]"
              onClick={handleSyncHr}
              disabled={syncing}
            >
              <RefreshCw size={14} className={cx(syncing && 'animate-spin')} />
              <span>HR Bazasidan sinxronlash (29 ta)</span>
            </button>
            <button
              type="button"
              className="btn-ghost h-9 px-4 text-[12.5px]"
              onClick={() => { setEditMember(null); setInitialEdit(true); setModalOpen(true) }}
            >
              <Plus size={14} />
              <span>Yangi xodim qo'shish</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-ink-900 shadow-md">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px] min-w-[560px] sm:min-w-full">
              <thead className="border-b border-line bg-ink-850/80 text-[11px] font-bold text-fg-muted uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4 w-12 text-center">№</th>
                  <th className="py-3.5 px-4">Xodim F.I.Sh</th>
                  <th className="py-3.5 px-4">Lavozimi</th>
                  <th className="py-3.5 px-4">Telefon raqami</th>
                  <th className="py-3.5 px-4 w-20 text-right">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {filtered.map((s, idx) => (
                  <tr
                    key={s.id || idx}
                    onClick={() => { setEditMember(s); setInitialEdit(false); setModalOpen(true) }}
                    className="cursor-pointer hover:bg-ink-800/60 transition-colors group select-none"
                    title="Xodim haqida to'liq ma'lumotni ko'rish uchun bosing"
                  >
                    <td className="py-3.5 px-4 text-center text-fg-subtle font-mono text-[12px] tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-fg">
                      <div className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-line bg-ink-800 text-[11.5px] font-bold text-emerald-soft group-hover:border-emerald/30 transition-colors">
                          {s.fish.split(' ').filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-bold text-[13.5px] text-fg group-hover:text-emerald-300 transition-colors">
                            {s.fish}
                          </div>
                          <div className="text-[11px] font-normal text-fg-subtle truncate max-w-[280px]">
                            {s.kategoriya || s.ish_turi || 'Texnikum xodimi'}
                            {s.bolim ? ` · ${s.bolim}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-fg-muted text-[13px]">{s.lavozim || '—'}</div>
                    </td>
                    <td className="py-3.5 px-4 mono text-[12.5px]">
                      {s.tel ? (
                        <a
                          href={`tel:${s.tel.replace(/\s/g, '')}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 text-sky-soft hover:underline font-mono"
                          title="Qo'ng'iroq qilish"
                        >
                          <Phone size={13} className="text-sky-400 shrink-0" />
                          <span>{cleanStaffPhone(s.tel)}</span>
                        </a>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-ink-700 hover:text-fg transition-colors"
                          onClick={() => { setEditMember(s); setInitialEdit(true); setModalOpen(true) }}
                          title="Ma'lumotlarni tahrirlash"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="grid size-8 place-items-center rounded-lg text-rose hover:bg-rose/15 transition-colors"
                          onClick={() => void handleDelete(s.id, s.fish)}
                          title="O'chirish"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line bg-ink-850/60 px-4 py-2.5 text-[12px] text-fg-muted flex items-center justify-between">
            <span>Ko'rsatilmoqda: <b>{filtered.length}</b> ta xodim (jami {staff.length} tadan)</span>
            <div className="flex items-center gap-3">
              {filtered.length !== staff.length && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setCategory('Barchasi'); setDept('Barchasi'); setWorkType('Barchasi') }}
                  className="text-sky-soft hover:underline text-[11.5px]"
                >
                  Filtrlarni tozalash
                </button>
              )}
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                className="text-emerald-400 hover:underline text-[11.5px] font-semibold flex items-center gap-1"
              >
                <Download size={12} />
                <span>Tanlanganlarni Excelga olish</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal oynalar */}
      {isModalOpen && (
        <StaffModal
          member={editMember}
          initialEdit={initialEdit}
          onClose={() => {
            setModalOpen(false)
            setEditMember(null)
            onCloseAdd?.()
          }}
          onSave={handleSave}
          onDelete={handleDelete}
          hasPrev={currentStaffIndex > 0}
          hasNext={currentStaffIndex >= 0 && currentStaffIndex < filtered.length - 1}
          onNav={(dir) => {
            const nextIdx = currentStaffIndex + dir
            if (nextIdx >= 0 && nextIdx < filtered.length) {
              setEditMember(filtered[nextIdx])
              setInitialEdit(false)
            }
          }}
        />
      )}

      {importOpen && (
        <StaffImportModal
          onClose={() => setImportOpen(false)}
          onImportSuccess={(cnt) => {
            notify(`${cnt} nafar xodim muvaffaqiyatli import qilindi!`, 'success')
            void load()
          }}
        />
      )}

      {/* Maxsus Ustun Tanlanadigan Excel Eksport Modali */}
      <StaffExportModal
        open={isExportOpen}
        onClose={() => {
          setExportOpen(false)
          onCloseExport?.()
        }}
        staff={staff}
        onSuccess={(msg) => notify(msg, 'success')}
      />
    </div>
  )
}
