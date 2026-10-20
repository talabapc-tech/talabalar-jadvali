'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Briefcase,
  Building,
  Download,
  FileSpreadsheet,
  GraduationCap,
  Loader2,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react'
import * as XLSX from 'xlsx-js-style'
import {
  cleanStaffPhone,
  formatSalary,
  STAFF_DEPARTMENTS,
  STAFF_WORK_TYPES,
  type StaffMember,
} from '@/lib/staff'
import StaffImportModal from './StaffImportModal'
import StaffModal from './StaffModal'
import type { Notify } from './Toast'
import { cx } from './ui'

interface Props {
  notify: Notify
}

export default function StaffSection({ notify }: Props) {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [dept, setDept] = useState<string>('Barchasi')
  const [workType, setWorkType] = useState<string>('Barchasi')

  const [modalOpen, setModalOpen] = useState(false)
  const [editMember, setEditMember] = useState<StaffMember | null>(null)
  const [importOpen, setImportOpen] = useState(false)

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

  // Filtrlash
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return staff.filter((s) => {
      if (dept !== 'Barchasi' && s.bolim !== dept) return false
      if (workType !== 'Barchasi' && s.ish_turi !== workType) return false
      if (!q) return true
      return (
        s.fish.toLowerCase().includes(q) ||
        s.lavozim.toLowerCase().includes(q) ||
        (s.bolim && s.bolim.toLowerCase().includes(q)) ||
        (s.tel && s.tel.toLowerCase().includes(q)) ||
        (s.pinfl && s.pinfl.includes(q)) ||
        (s.id && s.id.toLowerCase().includes(q))
      )
    })
  }, [staff, query, dept, workType])

  // Statistika hisoblash
  const stats = useMemo(() => {
    const total = staff.length
    const teachers = staff.filter((s) => s.bolim === 'Pedagog' || s.lavozim.toLowerCase().includes('o\'qituvchi')).length
    const admin = staff.filter((s) => s.bolim === 'Rahbariyat' || s.bolim === "Ma'muriy" || s.bolim === "Moliya bo'limi").length
    const service = staff.filter((s) => s.bolim === "Xo'jalik").length
    const active = staff.filter((s) => s.status === 'faol' || !s.status).length
    return { total, teachers, admin, service, active }
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

  // Excelga eksport
  const handleExport = () => {
    if (!filtered.length) {
      notify("Eksport qilish uchun xodimlar mavjud emas", 'warning')
      return
    }

    const headers = [
      'ID', 'F.I.Sh', 'Lavozimi', 'Bo\'limi', 'Ish turi', 'Stavka',
      'Telefon', 'JSHSHIR', 'Pasport', 'Ishga kirgan sana', 'Oylik maosh', 'Holati', 'Izoh'
    ]

    const rows = filtered.map((s) => [
      s.id,
      s.fish,
      s.lavozim,
      s.bolim || '',
      s.ish_turi || '',
      s.stavka || '',
      cleanStaffPhone(s.tel),
      s.pinfl || '',
      s.pv || '',
      s.ishga_sana || '',
      s.maosh || '',
      s.status === 'tatilda' ? 'Ta\'tilda' : s.status === 'boshatilgan' ? 'Bo\'shatilgan' : 'Faol',
      s.izoh || ''
    ])

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])

    // Sarlavha uslubi
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '107C41' } },
          alignment: { vertical: 'center', horizontal: 'center' },
        }
      }
    }

    ws['!cols'] = [
      { wch: 10 }, { wch: 32 }, { wch: 26 }, { wch: 18 }, { wch: 12 },
      { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 15 },
      { wch: 16 }, { wch: 12 }, { wch: 25 },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Xodimlar')
    XLSX.writeFile(wb, `Shahrisabz_Texnikum_Xodimlar_${new Date().toLocaleDateString('ru-RU')}.xlsx`)
    notify(`${filtered.length} nafar xodim Excelga yuklandi`, 'success')
  }

  return (
    <div className="space-y-4">
      {/* 1. Xulosa / Statistika bloklari */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <div className="rounded-2xl border border-line bg-ink-900/80 p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-fg-subtle">
            <span className="text-[12px] font-medium">Jami xodimlar</span>
            <Users size={16} className="text-sky" />
          </div>
          <div className="mt-1 text-[22px] font-extrabold text-fg">{stats.total}</div>
          <div className="mt-0.5 text-[11px] text-emerald-soft">{stats.active} nafari faol</div>
        </div>

        <div className="rounded-2xl border border-line bg-ink-900/80 p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-fg-subtle">
            <span className="text-[12px] font-medium">O'qituvchilar</span>
            <GraduationCap size={16} className="text-emerald" />
          </div>
          <div className="mt-1 text-[22px] font-extrabold text-fg">{stats.teachers}</div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">Pedagogik tarkib</div>
        </div>

        <div className="rounded-2xl border border-line bg-ink-900/80 p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-fg-subtle">
            <span className="text-[12px] font-medium">Ma'muriyat</span>
            <Building size={16} className="text-amber" />
          </div>
          <div className="mt-1 text-[22px] font-extrabold text-fg">{stats.admin}</div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">Boshqaruv va bo'limlar</div>
        </div>

        <div className="rounded-2xl border border-line bg-ink-900/80 p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-fg-subtle">
            <span className="text-[12px] font-medium">Xo'jalik xodimlari</span>
            <Briefcase size={16} className="text-purple-400" />
          </div>
          <div className="mt-1 text-[22px] font-extrabold text-fg">{stats.service}</div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">Yordamchi tarkib</div>
        </div>

        <div className="col-span-2 sm:col-span-4 lg:col-span-1 rounded-2xl border border-line bg-ink-900/80 p-3.5 shadow-sm flex flex-col justify-between">
          <div className="text-[12px] font-medium text-fg-subtle">Tezkor amallar</div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="btn-success h-8 flex-1 text-[11.5px] justify-center"
              onClick={() => { setEditMember(null); setModalOpen(true) }}
            >
              <Plus size={14} />
              <span>Qo'shish</span>
            </button>
            <button
              type="button"
              className="btn-ghost h-8 px-2 text-[11.5px]"
              onClick={() => setImportOpen(true)}
              title="Excel import"
            >
              <FileSpreadsheet size={14} className="text-emerald" />
            </button>
            <button
              type="button"
              className="btn-ghost h-8 px-2 text-[11.5px]"
              onClick={handleExport}
              title="Excel export"
            >
              <Download size={14} className="text-sky" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Filtrlar va qidiruv paneli */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-line bg-ink-900/80 p-3">
        {/* Qidiruv */}
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Xodim F.I.Sh, lavozim, telefon yoki JSHSHIR bo'yicha qidirish…"
            className="field h-9 pl-9 text-[12.5px]"
          />
        </div>

        {/* Bo'lim filtri */}
        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          className="field h-9 w-auto min-w-[150px] py-1 text-[12px] cursor-pointer"
        >
          {STAFF_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>Bo'lim: {d}</option>
          ))}
        </select>

        {/* Ish turi filtri */}
        <select
          value={workType}
          onChange={(e) => setWorkType(e.target.value)}
          className="field h-9 w-auto min-w-[130px] py-1 text-[12px] cursor-pointer"
        >
          {STAFF_WORK_TYPES.map((t) => (
            <option key={t} value={t}>Shakli: {t}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-ghost size-9 p-0"
          title="Xodimlarni yangilash"
        >
          <RefreshCw size={14} className={cx(loading && 'animate-spin')} />
        </button>
      </div>

      {/* 3. Xodimlar ro'yxati jadvali */}
      {loading ? (
        <div className="panel grid place-items-center gap-3 py-20 text-fg-muted">
          <Loader2 size={26} className="animate-spin text-sky" />
          <span>Xodimlar ro'yxati yuklanmoqda…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel grid place-items-center gap-3 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-2xl border border-line bg-ink-850 text-fg-subtle">
            <Users size={28} />
          </div>
          <div>
            <div className="text-[15px] font-bold text-fg">
              {staff.length === 0 ? "Hozircha xodimlar kiritilmagan" : "Qidiruv bo'yicha xodim topilmadi"}
            </div>
            <div className="mt-1 text-[12.5px] text-fg-muted max-w-md">
              {staff.length === 0
                ? "Texnikum xodimlarini birma-bir qo'shishingiz yoki tayyor Excel ro'yxatini yuklashingiz mumkin."
                : "Qidiruv so'zini o'zgartirib yoki filtrlarni tozalab ko'ring."}
            </div>
          </div>
          {staff.length === 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-success h-9 px-4 text-[12.5px]"
                onClick={() => { setEditMember(null); setModalOpen(true) }}
              >
                <Plus size={14} />
                <span>Yangi xodim qo'shish</span>
              </button>
              <button
                type="button"
                className="btn-ghost h-9 px-4 text-[12.5px] border border-sky/35 text-sky-soft"
                onClick={() => setImportOpen(true)}
              >
                <FileSpreadsheet size={14} />
                <span>Excel orqali import qilish</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-ink-900 shadow-md">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="border-b border-line bg-ink-850/80 text-[11px] font-bold text-fg-muted uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3.5 w-12 text-center">№</th>
                  <th className="py-3 px-3.5">Xodim F.I.Sh</th>
                  <th className="py-3 px-3.5">Lavozimi</th>
                  <th className="py-3 px-3.5">Bo'limi</th>
                  <th className="py-3 px-3.5">Ish shakli</th>
                  <th className="py-3 px-3.5">Telefon</th>
                  <th className="py-3 px-3.5">Oylik maosh</th>
                  <th className="py-3 px-3.5">Holati</th>
                  <th className="py-3 px-3.5 w-24 text-right">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {filtered.map((s, idx) => (
                  <tr key={s.id || idx} className="hover:bg-ink-800/40 transition-colors">
                    <td className="py-3 px-3.5 text-center text-fg-subtle font-mono text-[11.5px]">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-3.5 font-bold text-fg">
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-sky/15 text-[11px] font-bold text-sky-soft">
                          {s.fish.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <div className="truncate max-w-[240px]">{s.fish}</div>
                          <div className="text-[11px] font-normal text-fg-subtle">
                            ID: {s.id} {s.pinfl ? `· PINFL: ${s.pinfl}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3.5 font-medium text-fg-muted">
                      {s.lavozim}
                    </td>
                    <td className="py-3 px-3.5">
                      <span className="chip border-line bg-ink-800/80 text-fg-muted text-[11px]">
                        {s.bolim || "Ma'muriy"}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-fg-muted text-[11.5px]">
                      {s.ish_turi || 'Shtat'} {s.stavka ? `(${s.stavka})` : ''}
                    </td>
                    <td className="py-3 px-3.5 mono text-[12px]">
                      {s.tel ? (
                        <a
                          href={`tel:${s.tel.replace(/\s/g, '')}`}
                          className="flex items-center gap-1.5 text-sky-soft hover:underline"
                        >
                          <Phone size={12} />
                          <span>{cleanStaffPhone(s.tel)}</span>
                        </a>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3.5 text-emerald-soft font-semibold text-[12px]">
                      {formatSalary(s.maosh)}
                    </td>
                    <td className="py-3 px-3.5">
                      <span
                        className={cx(
                          'chip text-[11px] px-2 py-0.5 rounded-md font-semibold',
                          s.status === 'tatilda'
                            ? 'border-amber/40 bg-amber/10 text-amber'
                            : s.status === 'boshatilgan'
                              ? 'border-rose/40 bg-rose/10 text-rose'
                              : 'border-emerald/40 bg-emerald/10 text-emerald-soft'
                        )}
                      >
                        {s.status === 'tatilda' ? "Ta'tilda" : s.status === 'boshatilgan' ? "Bo'shatilgan" : 'Faol'}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="grid size-7 place-items-center rounded-lg text-fg-muted hover:bg-ink-700 hover:text-fg"
                          onClick={() => { setEditMember(s); setModalOpen(true) }}
                          title="Tahrirlash"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="grid size-7 place-items-center rounded-lg text-rose hover:bg-rose/15"
                          onClick={() => void handleDelete(s.id, s.fish)}
                          title="O'chirish"
                        >
                          <Trash2 size={13} />
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
            {filtered.length !== staff.length && (
              <button
                type="button"
                onClick={() => { setQuery(''); setDept('Barchasi'); setWorkType('Barchasi') }}
                className="text-sky-soft hover:underline text-[11.5px]"
              >
                Filtrlarni tozalash
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modal oynalar */}
      {modalOpen && (
        <StaffModal
          member={editMember}
          onClose={() => { setModalOpen(false); setEditMember(null) }}
          onSave={handleSave}
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
    </div>
  )
}
