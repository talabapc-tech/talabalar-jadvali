'use client'

import { useMemo, useState } from 'react'
import { BookOpen, Briefcase, Check, Download, FileSpreadsheet, Globe, GraduationCap, Loader2, Send, X } from 'lucide-react'
import * as XLSX from 'xlsx-js-style'
import { cleanXlsxBuffer, downloadBlob } from '@/lib/excel'
import { cleanStaffPhone, type StaffMember } from '@/lib/staff'

interface Props {
  open: boolean
  onClose: () => void
  staff: StaffMember[]
  onSuccess?: (msg: string) => void
}

interface ColumnDef {
  id: string
  label: string
  defaultChecked?: boolean
  width: number
  align?: 'left' | 'center' | 'right'
}

const AVAILABLE_COLUMNS: ColumnDef[] = [
  { id: 'num', label: '№ (Tartib raqam)', defaultChecked: true, width: 6, align: 'center' },
  { id: 'fish', label: 'F.I.SH (Familiya, Ism, Sharif)', defaultChecked: true, width: 34, align: 'left' },
  { id: 'lavozim', label: 'Lavozimi', defaultChecked: true, width: 24, align: 'left' },
  { id: 'kategoriya', label: 'Kategoriya', defaultChecked: true, width: 22, align: 'left' },
  { id: 'ish_turi', label: 'Ish turi', defaultChecked: false, width: 14, align: 'center' },
  { id: 'bolim', label: "Bo'limi", defaultChecked: false, width: 16, align: 'left' },
  { id: 'tel', label: 'Telefon raqami', defaultChecked: true, width: 18, align: 'center' },
  { id: 'dob', label: "Tug'ilgan sanasi", defaultChecked: true, width: 15, align: 'center' },
  { id: 'tugilgan_joy', label: "Tug'ilgan joyi", defaultChecked: true, width: 30, align: 'left' },
  { id: 'pv', label: 'Pasport seriya va raqami', defaultChecked: true, width: 16, align: 'center' },
  { id: 'pinfl', label: 'JSHSHIR (PINFL)', defaultChecked: true, width: 18, align: 'center' },
  { id: 'inn', label: 'INN (STIR)', defaultChecked: true, width: 15, align: 'center' },
  { id: 'plastik_karta', label: 'Plastik karta raqami', defaultChecked: true, width: 22, align: 'center' },
  { id: 'plastik_muddati', label: 'Karta muddati', defaultChecked: false, width: 14, align: 'center' },
  { id: 'toifasi', label: 'Pedagogik toifasi', defaultChecked: true, width: 18, align: 'center' },
  { id: 'ilmiy_unvoni', label: 'Ilmiy unvoni', defaultChecked: false, width: 18, align: 'center' },
  { id: 'tamomlagan_otm', label: "Tamomlagan OTM / Muassasa", defaultChecked: true, width: 34, align: 'left' },
  { id: 'otm_tamom_yili', label: 'OTM tamomlagan yili', defaultChecked: true, width: 16, align: 'center' },
  { id: 'mutaxassislik', label: "Diplom bo'yicha mutaxassisligi", defaultChecked: true, width: 28, align: 'left' },
  { id: 'buyruq_sana', label: 'Ishga kirgan buyruq sanasi', defaultChecked: true, width: 18, align: 'center' },
  { id: 'yashash_joyi', label: 'Doimiy yashash manzili', defaultChecked: false, width: 30, align: 'left' },
  { id: 'pasport_berilgan_joy', label: 'Pasport berilgan joyi', defaultChecked: false, width: 26, align: 'left' },
  { id: 'obektivka_file', label: 'Obektivka hujjati', defaultChecked: false, width: 22, align: 'left' },
  { id: 'stavka', label: 'Stavka', defaultChecked: false, width: 10, align: 'center' },
  { id: 'maosh', label: 'Oylik maosh', defaultChecked: false, width: 16, align: 'right' },
  { id: 'status', label: 'Holati (Faol / Ta\'tilda)', defaultChecked: false, width: 14, align: 'center' },
  { id: 'izoh', label: 'Izoh', defaultChecked: false, width: 22, align: 'left' },
]

export default function StaffExportModal({ open, onClose, staff, onSuccess }: Props) {
  const [selectedCat, setSelectedCat] = useState<string>('Barchasi')
  const [tgBusy, setTgBusy] = useState(false)
  const [selectedCols, setSelectedCols] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    AVAILABLE_COLUMNS.forEach((c) => {
      init[c.id] = !!c.defaultChecked
    })
    return init
  })
  const [customName, setCustomName] = useState<string>('')

  // Saralangan xodimlar
  const filteredStaff = useMemo(() => {
    if (selectedCat === 'Barchasi') return staff
    return staff.filter((s) => {
      if (selectedCat === 'Shtat' || selectedCat === 'ShTAT - xodimlar') {
        return s.kategoriya?.includes('Shtat') || s.ish_turi === 'Shtat'
      }
      if (selectedCat === 'Asosiy' || selectedCat === "Asosiy o'qituvchilar") {
        return s.kategoriya?.includes('Asosiy') || s.ish_turi?.includes('Asosiy')
      }
      if (selectedCat === "O'rindosh" || selectedCat === "O'rindosh o'qituvchilar") {
        return s.kategoriya?.includes("O'rindosh") || s.ish_turi?.includes("O'rindosh")
      }
      return s.kategoriya === selectedCat
    })
  }, [staff, selectedCat])

  // Tanlangan ustunlar soni
  const activeColIds = useMemo(() => {
    return AVAILABLE_COLUMNS.filter((c) => selectedCols[c.id]).map((c) => c.id)
  }, [selectedCols])

  // Fayl nomini generatsiya qilish (PROBEL ISHLATILADI, HECH QACHON TAGCHIZIQ '_' EMAS)
  const defaultFileName = useMemo(() => {
    let base = 'Barcha xodimlar royxati'
    if (selectedCat.includes('Shtat')) base = 'Shtat xodimlar royxati'
    else if (selectedCat.includes('Asosiy')) base = 'Asosiy oqituvchilar royxati'
    else if (selectedCat.includes("O'rindosh")) base = 'Orindosh oqituvchilar royxati'

    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const dateStr = `${p(now.getDate())}.${p(now.getMonth() + 1)}.${now.getFullYear()}`
    return `${base} ${dateStr}`
  }, [selectedCat])

  if (!open) return null

  const toggleCol = (id: string) => {
    setSelectedCols((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const selectAll = () => {
    const all: Record<string, boolean> = {}
    AVAILABLE_COLUMNS.forEach((c) => { all[c.id] = true })
    setSelectedCols(all)
  }

  const deselectAll = () => {
    const none: Record<string, boolean> = {}
    AVAILABLE_COLUMNS.forEach((c) => { none[c.id] = false })
    setSelectedCols(none)
  }

  const applyPreset = (preset: 'standard' | 'hr' | 'contact') => {
    const next: Record<string, boolean> = {}
    AVAILABLE_COLUMNS.forEach((c) => { next[c.id] = false })

    if (preset === 'standard') {
      ;['num', 'fish', 'lavozim', 'tel', 'pv', 'pinfl'].forEach((k) => { next[k] = true })
    } else if (preset === 'hr') {
      ;['num', 'fish', 'lavozim', 'kategoriya', 'tel', 'dob', 'tugilgan_joy', 'pv', 'pinfl', 'inn', 'plastik_karta', 'toifasi', 'tamomlagan_otm', 'otm_tamom_yili', 'mutaxassislik', 'buyruq_sana'].forEach((k) => { next[k] = true })
    } else if (preset === 'contact') {
      ;['num', 'fish', 'lavozim', 'tel', 'bolim'].forEach((k) => { next[k] = true })
    }
    setSelectedCols(next)
  }

  const buildWorkbook = () => {
    const cols = AVAILABLE_COLUMNS.filter((c) => selectedCols[c.id])
    const headers = cols.map((c) => c.label)

    const rows = filteredStaff.map((s, idx) => {
      return cols.map((col) => {
        switch (col.id) {
          case 'num':
            return idx + 1
          case 'fish':
            return s.fish || ''
          case 'lavozim':
            return s.lavozim || ''
          case 'kategoriya':
            return s.kategoriya || (s.ish_turi === 'Shtat' ? 'ShTAT - xodimlar' : s.ish_turi?.includes('Asosiy') ? "Asosiy o'qituvchilar" : s.ish_turi?.includes("O'rindosh") ? "O'rindosh o'qituvchilar" : s.ish_turi || '')
          case 'ish_turi':
            return s.ish_turi || ''
          case 'bolim':
            return s.bolim || ''
          case 'tel':
            return cleanStaffPhone(s.tel)
          case 'dob':
            return s.dob || ''
          case 'tugilgan_joy':
            return s.tugilgan_joy || ''
          case 'pv':
            return s.pv || ''
          case 'pinfl':
            return s.pinfl || ''
          case 'inn':
            return s.inn || ''
          case 'plastik_karta':
            return s.plastik_karta || ''
          case 'plastik_muddati':
            return s.plastik_muddati || ''
          case 'toifasi':
            return s.toifasi || ''
          case 'ilmiy_unvoni':
            return s.ilmiy_unvoni || ''
          case 'obektivka_file':
            return s.obektivka_file || ''
          case 'tamomlagan_otm':
            return s.tamomlagan_otm || ''
          case 'otm_tamom_yili':
            return s.otm_tamom_yili || ''
          case 'mutaxassislik':
            return s.mutaxassislik || ''
          case 'buyruq_sana':
            return s.buyruq_sana || s.ishga_sana || ''
          case 'yashash_joyi':
            return s.yashash_joyi || ''
          case 'pasport_berilgan_joy':
            return s.pasport_berilgan_joy || ''
          case 'stavka':
            return s.stavka || ''
          case 'maosh':
            return s.maosh || ''
          case 'status':
            return s.status === 'tatilda' ? "Ta'tilda" : s.status === 'boshatilgan' ? "Bo'shatilgan" : 'Faol'
          case 'izoh':
            return s.izoh || ''
          default:
            return ''
        }
      })
    })

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])

    // Sarlavha stillari
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10, name: 'Calibri' },
          fill: { fgColor: { rgb: '107C41' } },
          alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
        }
      }
    }

    // Ustun kengliklari
    ws['!cols'] = cols.map((c) => ({ wch: c.width }))

    const wb = XLSX.utils.book_new()
    const sheetName = selectedCat.replace(/[\\/?*[\]]/g, ' ').slice(0, 31) || 'Xodimlar'
    XLSX.utils.book_append_sheet(wb, ws, sheetName)

    // Fayl nomida tagchiziq '_' ni bo'shliq ' ' ga almashtiramiz
    let outFileName = (customName.trim() || defaultFileName).replace(/_/g, ' ')
    outFileName = outFileName.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
    if (!outFileName.toLowerCase().endsWith('.xlsx')) {
      outFileName += '.xlsx'
    }

    return { wb, outFileName }
  }

  const handleDownload = () => {
    if (!activeColIds.length) {
      alert("Kamida bitta ustunni tanlang!")
      return
    }

    if (!filteredStaff.length) {
      alert("Tanlangan toifada xodimlar topilmadi!")
      return
    }

    try {
      const { wb, outFileName } = buildWorkbook()
      const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true, bookSST: false })
      const cleaned = cleanXlsxBuffer(raw)
      downloadBlob(cleaned, outFileName)

      if (onSuccess) {
        onSuccess(`${filteredStaff.length} nafar xodim «${outFileName}» fayliga eksport qilindi`)
      }
      onClose()
    } catch (err) {
      console.error('Excel export error:', err)
      alert(`Excel faylni yuklab olishda xatolik: ${(err as Error).message}`)
    }
  }

  const handleSendTelegram = async () => {
    if (!activeColIds.length) {
      alert("Kamida bitta ustunni tanlang!")
      return
    }
    if (!filteredStaff.length) {
      alert("Tanlangan toifada xodimlar topilmadi!")
      return
    }

    setTgBusy(true)
    try {
      const { wb, outFileName } = buildWorkbook()
      const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true, bookSST: false })
      const cleaned = cleanXlsxBuffer(raw)
      const blob = new Blob([new Uint8Array(cleaned)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const file = new File([blob], outFileName, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })

      const fd = new FormData()
      fd.append('file', file)
      fd.append(
        'caption',
        `📊 <b>${outFileName}</b>\n👥 Jami: <b>${filteredStaff.length} nafar</b> (${activeColIds.length} ta ustun)\n✅ <i>Toza probelli maxsus eksport</i>`,
      )

      const res = await fetch('/api/send_role_telegram', {
        method: 'POST',
        body: fd,
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) {
        if (onSuccess) {
          onSuccess(`«${outFileName}» Telegram botga muvaffaqiyatli yuborildi!`)
        }
        onClose()
      } else {
        alert(`Telegramga yuborilmadi: ${d.error || 'Server xatosi'}`)
      }
    } catch (err) {
      alert(`Telegramga yuborishda xatolik: ${(err as Error).message}`)
    } finally {
      setTgBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-ink-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-ink-950/70 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-fg">Xodimlarni Excelga Eksport Qilish</h2>
              <p className="text-[12px] text-fg-subtle">
                Kerakli toifa va ustunlarni belgilab, toza Excel jadvali oling (fayl nomida probel ishlatiladi)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-fg-subtle hover:bg-ink-800 hover:text-fg"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto p-5 space-y-5">
          {/* 1. Toifani tanlash */}
          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wider text-fg-subtle">
              1. Eksport Qilinadigan Toifani Tanlang
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { id: 'Barchasi', label: 'Barchasi', icon: Globe, iconColor: 'text-sky-400', count: staff.length },
                { id: 'ShTAT - xodimlar', label: 'Shtat xodimlar', icon: Briefcase, iconColor: 'text-amber-400', count: staff.filter((s) => s.kategoriya?.includes('Shtat') || s.ish_turi === 'Shtat').length },
                { id: "Asosiy o'qituvchilar", label: "Asosiy o'qituvchilar", icon: GraduationCap, iconColor: 'text-emerald-400', count: staff.filter((s) => s.kategoriya?.includes('Asosiy') || s.ish_turi?.includes('Asosiy')).length },
                { id: "O'rindosh o'qituvchilar", label: "O'rindosh o'qituvchilar", icon: BookOpen, iconColor: 'text-blue-400', count: staff.filter((s) => s.kategoriya?.includes("O'rindosh") || s.ish_turi?.includes("O'rindosh")).length },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCat(cat.id)}
                  className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-all ${
                    selectedCat === cat.id
                      ? 'border-emerald bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald'
                      : 'border-line bg-ink-950/40 text-fg hover:border-line-hover'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                    <cat.icon size={14} className={cat.iconColor} />
                    <span>{cat.label}</span>
                  </span>
                  <span className="mt-1 text-[11px] text-fg-subtle">{cat.count} nafar xodim</span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Ustunlar va Shablonlar */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="text-[12px] font-semibold uppercase tracking-wider text-fg-subtle">
                2. Kerakli Ustunlarni Belgilang ({activeColIds.length} / {AVAILABLE_COLUMNS.length})
              </label>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => applyPreset('standard')}
                  className="rounded-lg border border-line bg-ink-950/40 px-2 py-1 text-fg-subtle hover:text-fg hover:border-line-hover"
                >
                  Standart
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('hr')}
                  className="rounded-lg border border-line bg-ink-950/40 px-2 py-1 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                >
                  Kadrlar (SH.T.T)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('contact')}
                  className="rounded-lg border border-line bg-ink-950/40 px-2 py-1 text-fg-subtle hover:text-fg hover:border-line-hover"
                >
                  Aloqa uchun
                </button>
                <button
                  type="button"
                  onClick={selectAll}
                  className="rounded-lg border border-line bg-ink-950/40 px-2 py-1 text-fg-subtle hover:text-fg"
                >
                  Barchasi
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="rounded-lg border border-line bg-ink-950/40 px-2 py-1 text-fg-subtle hover:text-rose-400"
                >
                  Tozalash
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 max-h-56 overflow-y-auto rounded-xl border border-line bg-ink-950/40 p-2.5">
              {AVAILABLE_COLUMNS.map((col) => {
                const checked = !!selectedCols[col.id]
                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => toggleCol(col.id)}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-left transition-colors select-none ${
                      checked
                        ? 'bg-emerald-500/15 text-emerald-200 font-medium ring-1 ring-emerald-500/30'
                        : 'text-fg-subtle hover:bg-ink-800 hover:text-fg'
                    }`}
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line bg-ink-900'
                      }`}
                    >
                      {checked && <Check size={11} strokeWidth={3} />}
                    </div>
                    <span className="truncate">{col.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 3. Fayl nomi */}
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-fg-subtle">
              3. Fayl Nomi (Tagchiziq o'rniga faqat probel ishlatiladi)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customName}
                placeholder={defaultFileName}
                onChange={(e) => setCustomName(e.target.value.replace(/_/g, ' '))}
                className="field text-[13px] flex-1 h-9"
              />
              <span className="text-[12px] font-semibold text-fg-subtle">.xlsx</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-ink-950/70 px-5 py-3.5">
          <div className="text-[12px] text-fg-subtle">
            <span className="font-bold text-fg">{filteredStaff.length} nafar</span> xodim,{' '}
            <span className="font-bold text-emerald-400">{activeColIds.length} ta ustun</span> tanlandi
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost h-9 px-3.5 text-[12.5px]"
            >
              Bekor qilish
            </button>
            <button
              type="button"
              onClick={handleSendTelegram}
              disabled={tgBusy}
              title="Ushbu moslashtirilgan Excel faylni Telegram botga yuborish"
              className="btn-ghost h-9 px-3.5 text-[12.5px] border border-sky/30 bg-sky/10 text-sky-soft hover:bg-sky/25"
            >
              {tgBusy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              <span>Telegramga</span>
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="btn-success h-9 px-4 text-[12.5px] font-semibold"
            >
              <Download size={15} />
              <span>Yuklab olish (.xlsx)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
