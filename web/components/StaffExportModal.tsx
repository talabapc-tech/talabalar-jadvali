'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Briefcase,
  Check,
  Download,
  FileSpreadsheet,
  Filter,
  Globe,
  GraduationCap,
  Layers,
  Loader2,
  Send,
  X,
} from 'lucide-react'
import { downloadBlob } from '@/lib/excel'
import { loadXlsx, safeSheetName, workbookBytes, type XLSXModule } from '@/lib/excel-build'
import {
  cleanStaffPhone,
  cleanStaffPinfl,
  formatStaffCard,
  matchesStaffCategory,
  type StaffMember,
} from '@/lib/staff'

interface Props {
  open: boolean
  onClose: () => void
  staff: StaffMember[]
  initialCategory?: string
  filteredFromPage?: StaffMember[]
  onSuccess?: (msg: string) => void
}

interface ColumnDef {
  id: string
  label: string
  defaultChecked?: boolean
  minW: number
  maxW: number
  align?: 'left' | 'center' | 'right'
  wrap?: boolean
  forceText?: boolean
  extract: (s: StaffMember, idx: number) => string | number
}

function resolveCategory(s: StaffMember): string {
  if (s.kategoriya?.trim()) return s.kategoriya.trim()
  if (s.ish_turi === 'Shtat') return 'ShTAT - xodimlar'
  if (s.ish_turi?.toLowerCase().includes('asosiy')) return "Asosiy o'qituvchilar"
  if (s.ish_turi?.toLowerCase().includes("o'rindosh") || s.ish_turi?.toLowerCase().includes('orindosh')) {
    return "O'rindosh o'qituvchilar"
  }
  return s.ish_turi || ''
}

function categoryRank(s: StaffMember): number {
  if (matchesStaffCategory(s, 'Shtat')) return 0
  if (matchesStaffCategory(s, 'Asosiy')) return 1
  if (matchesStaffCategory(s, "O'rindosh")) return 2
  return 3
}

function parseSalaryNumber(val: string | number | undefined): number | null {
  if (val === undefined || val === null || val === '') return null
  if (typeof val === 'number') return Number.isFinite(val) && val > 0 ? val : null
  const digits = String(val).replace(/\D/g, '')
  if (!digits) return null
  const n = Number(digits)
  return Number.isFinite(n) && n > 0 ? n : null
}

const AVAILABLE_COLUMNS: ColumnDef[] = [
  { id: 'num', label: '№', defaultChecked: true, minW: 5, maxW: 7, align: 'center', extract: (_s, i) => i + 1 },
  { id: 'fish', label: 'F.I.SH (Familiya, Ism, Sharif)', defaultChecked: true, minW: 26, maxW: 38, align: 'left', wrap: true, extract: (s) => (s.fish || '').trim() },
  { id: 'lavozim', label: 'Lavozimi', defaultChecked: true, minW: 18, maxW: 28, align: 'left', wrap: true, extract: (s) => (s.lavozim || '').trim() },
  { id: 'kategoriya', label: 'Kategoriya', defaultChecked: true, minW: 18, maxW: 24, align: 'left', extract: resolveCategory },
  { id: 'ish_turi', label: 'Ish turi', defaultChecked: false, minW: 12, maxW: 16, align: 'center', extract: (s) => (s.ish_turi || '').trim() },
  { id: 'bolim', label: "Bo'limi", defaultChecked: false, minW: 14, maxW: 20, align: 'left', extract: (s) => (s.bolim || '').trim() },
  { id: 'tel', label: 'Telefon raqami', defaultChecked: true, minW: 18, maxW: 20, align: 'center', forceText: true, extract: (s) => cleanStaffPhone(s.tel) },
  { id: 'dob', label: "Tug'ilgan sanasi", defaultChecked: true, minW: 14, maxW: 16, align: 'center', forceText: true, extract: (s) => (s.dob || '').trim() },
  { id: 'tugilgan_joy', label: "Tug'ilgan joyi", defaultChecked: true, minW: 24, maxW: 36, align: 'left', wrap: true, extract: (s) => (s.tugilgan_joy || '').trim() },
  { id: 'pv', label: 'Pasport seriya va №', defaultChecked: true, minW: 14, maxW: 16, align: 'center', forceText: true, extract: (s) => (s.pv || '').trim().toUpperCase() },
  { id: 'pinfl', label: 'JSHSHIR (PINFL)', defaultChecked: true, minW: 17, maxW: 19, align: 'center', forceText: true, extract: (s) => cleanStaffPinfl(s.pinfl) },
  { id: 'pasport_berilgan_joy', label: 'Pasport berilgan joyi', defaultChecked: true, minW: 24, maxW: 34, align: 'left', wrap: true, extract: (s) => (s.pasport_berilgan_joy || '').trim() },
  { id: 'yashash_joyi', label: 'Doimiy yashash manzili', defaultChecked: true, minW: 24, maxW: 36, align: 'left', wrap: true, extract: (s) => (s.yashash_joyi || '').trim() },
  { id: 'inn', label: 'INN (STIR)', defaultChecked: false, minW: 13, maxW: 16, align: 'center', forceText: true, extract: (s) => (s.inn || '').trim() },
  { id: 'plastik_karta', label: 'Plastik karta raqami', defaultChecked: true, minW: 21, maxW: 23, align: 'center', forceText: true, extract: (s) => formatStaffCard(s.plastik_karta) },
  { id: 'plastik_muddati', label: 'Karta muddati', defaultChecked: true, minW: 12, maxW: 15, align: 'center', forceText: true, extract: (s) => (s.plastik_muddati || '').trim() },
  { id: 'toifasi', label: 'Pedagogik toifasi', defaultChecked: false, minW: 16, maxW: 20, align: 'center', extract: (s) => (s.toifasi || '').trim() },
  { id: 'ilmiy_unvoni', label: 'Ilmiy unvoni', defaultChecked: false, minW: 16, maxW: 20, align: 'center', extract: (s) => (s.ilmiy_unvoni || '').trim() },
  { id: 'tamomlagan_otm', label: 'Tamomlagan OTM / Muassasa', defaultChecked: true, minW: 26, maxW: 38, align: 'left', wrap: true, extract: (s) => (s.tamomlagan_otm || '').trim() },
  { id: 'otm_tamom_yili', label: 'OTM tamomlagan yili', defaultChecked: true, minW: 14, maxW: 17, align: 'center', forceText: true, extract: (s) => (s.otm_tamom_yili || '').trim() },
  { id: 'mutaxassislik', label: "Diplom bo'yicha mutaxassisligi", defaultChecked: true, minW: 24, maxW: 36, align: 'left', wrap: true, extract: (s) => (s.mutaxassislik || '').trim() },
  { id: 'buyruq_sana', label: 'Ishga kirgan buyruq sanasi', defaultChecked: true, minW: 15, maxW: 18, align: 'center', forceText: true, extract: (s) => (s.buyruq_sana || s.ishga_sana || '').trim() },
  { id: 'obektivka_file', label: 'Obektivka hujjati', defaultChecked: false, minW: 20, maxW: 30, align: 'left', wrap: true, extract: (s) => (s.obektivka_file || '').trim() },
  { id: 'stavka', label: 'Stavka', defaultChecked: false, minW: 9, maxW: 12, align: 'center', forceText: true, extract: (s) => (s.stavka || '').trim() },
  {
    id: 'maosh',
    label: 'Oylik maosh',
    defaultChecked: false,
    minW: 15,
    maxW: 18,
    align: 'right',
    extract: (s) => {
      const n = parseSalaryNumber(s.maosh)
      return n !== null ? n : (s.maosh ? String(s.maosh).trim() : '')
    },
  },
  {
    id: 'status',
    label: "Holati (Faol / Ta'tilda)",
    defaultChecked: false,
    minW: 13,
    maxW: 16,
    align: 'center',
    extract: (s) => (s.status === 'tatilda' ? "Ta'tilda" : s.status === 'boshatilgan' ? "Bo'shatilgan" : 'Faol'),
  },
  { id: 'izoh', label: 'Izoh', defaultChecked: false, minW: 18, maxW: 30, align: 'left', wrap: true, extract: (s) => (s.izoh || '').trim() },
]

function todayStr(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(now.getDate())}.${p(now.getMonth() + 1)}.${now.getFullYear()}`
}

function buildStaffSheet(
  X: XLSXModule,
  sheetTitle: string,
  list: StaffMember[],
  cols: ColumnDef[],
  dateStr: string,
) {
  const lastCol = Math.max(0, cols.length - 1)
  const bannerRow: (string | number)[] = ['SHAHRISABZ TIBBIYOT TEXNIKUMI — XODIMLAR RO\'YXATI', ...Array(lastCol).fill('')]
  const subRow: (string | number)[] = [
    `Toifa: ${sheetTitle}  ·  Jami: ${list.length} nafar xodim  ·  Sana: ${dateStr}`,
    ...Array(lastCol).fill(''),
  ]
  const headerRow = cols.map((c) => c.label)
  const dataRows = list.map((s, idx) => cols.map((col) => col.extract(s, idx)))

  // Jami qatori (pastda)
  let totalMaosh = 0
  let hasMaoshNum = false
  if (cols.some((c) => c.id === 'maosh')) {
    for (const s of list) {
      const n = parseSalaryNumber(s.maosh)
      if (n !== null) {
        totalMaosh += n
        hasMaoshNum = true
      }
    }
  }
  const summaryRow = cols.map((c, ci) => {
    if (c.id === 'num') return ''
    if (c.id === 'maosh' && hasMaoshNum) return totalMaosh
    if (ci === (cols[0]?.id === 'num' && cols.length > 1 ? 1 : 0)) {
      return `JAMI: ${list.length} nafar xodim`
    }
    return ''
  })

  const aoa = [bannerRow, subRow, headerRow, ...dataRows, summaryRow]
  const ws = X.utils.aoa_to_sheet(aoa)

  // Dinamik ustun kengliklari (ma'lumotlar uzunligiga qarab [minW, maxW])
  const colWidths = cols.map((col, ci) => {
    const headerMax = col.label.length + 3
    let longest = Math.min(headerMax, col.maxW)
    for (let ri = 0; ri < dataRows.length; ri++) {
      const val = String(dataRows[ri][ci] ?? '')
      if (val.length + 3 > longest) longest = val.length + 3
    }
    return Math.max(col.minW, Math.min(col.maxW, longest))
  })
  ws['!cols'] = colWidths.map((wch) => ({ wch }))

  // Qator balandliklari (wrapText qatorlarga qarab avtomatik balandlik)
  const rowHeights: { hpt: number }[] = [
    { hpt: 30 }, // Banner
    { hpt: 22 }, // Subtitle
    { hpt: 32 }, // Headers
  ]
  for (let ri = 0; ri < dataRows.length; ri++) {
    let maxLines = 1
    for (let ci = 0; ci < cols.length; ci++) {
      if (!cols[ci].wrap) continue
      const len = String(dataRows[ri][ci] ?? '').length
      if (!len) continue
      const cap = Math.max(12, colWidths[ci] - 3)
      const lines = Math.ceil(len / cap)
      if (lines > maxLines) maxLines = lines
    }
    rowHeights.push({ hpt: Math.max(22, maxLines * 15 + 7) })
  }
  rowHeights.push({ hpt: 24 }) // Jami qatori
  ws['!rows'] = rowHeights

  // Stilar
  const headerBorder = {
    top: { style: 'medium', color: { rgb: '0F172A' } },
    bottom: { style: 'medium', color: { rgb: '0F172A' } },
    left: { style: 'thin', color: { rgb: '93C5FD' } },
    right: { style: 'thin', color: { rgb: '93C5FD' } },
  }
  const cellBorder = {
    top: { style: 'thin', color: { rgb: 'CBD5E1' } },
    bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
    left: { style: 'thin', color: { rgb: 'CBD5E1' } },
    right: { style: 'thin', color: { rgb: 'CBD5E1' } },
  }
  const summaryBorder = {
    top: { style: 'medium', color: { rgb: '1E3A8A' } },
    bottom: { style: 'medium', color: { rgb: '1E3A8A' } },
    left: { style: 'thin', color: { rgb: '94A3B8' } },
    right: { style: 'thin', color: { rgb: '94A3B8' } },
  }

  const summaryRowIdx = 3 + dataRows.length

  for (let r = 0; r <= summaryRowIdx; r++) {
    for (let c = 0; c < cols.length; c++) {
      const addr = X.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (!cell) continue

      const col = cols[c]
      if (r === 0) {
        cell.s = {
          font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 14, name: 'Calibri' },
          fill: { fgColor: { rgb: '0F172A' }, patternType: 'solid' },
          alignment: { vertical: 'center', horizontal: 'center' },
        }
      } else if (r === 1) {
        cell.s = {
          font: { bold: true, color: { rgb: '1E3A8A' }, sz: 10.5, name: 'Calibri' },
          fill: { fgColor: { rgb: 'EBF3FA' }, patternType: 'solid' },
          alignment: { vertical: 'center', horizontal: 'center' },
          border: { bottom: { style: 'thin', color: { rgb: '93C5FD' } } },
        }
      } else if (r === 2) {
        cell.s = {
          font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Calibri' },
          fill: { fgColor: { rgb: '1E3A8A' }, patternType: 'solid' },
          alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
          border: headerBorder,
        }
      } else if (r === summaryRowIdx) {
        if (col.id === 'maosh' && typeof cell.v === 'number') {
          cell.t = 'n'
          cell.z = '#,##0'
        }
        cell.s = {
          font: { bold: true, color: { rgb: '0F172A' }, sz: 11, name: 'Calibri' },
          fill: { fgColor: { rgb: 'E2E8F0' }, patternType: 'solid' },
          alignment: { vertical: 'center', horizontal: col.align || 'left' },
          border: summaryBorder,
        }
      } else {
        const isAlt = (r - 3) % 2 === 1
        if (col.forceText) {
          cell.t = 's'
          cell.v = String(cell.v ?? '')
          cell.z = '@'
        } else if (col.id === 'num' && typeof cell.v === 'number') {
          cell.t = 'n'
        } else if (col.id === 'maosh' && typeof cell.v === 'number') {
          cell.t = 'n'
          cell.z = '#,##0'
        }

        cell.s = {
          font: {
            sz: 10.5,
            name: 'Calibri',
            bold: col.id === 'fish' || col.id === 'num',
            color: { rgb: col.id === 'num' ? '475569' : '0F172A' },
          },
          fill: { fgColor: { rgb: isAlt ? 'F8FAFC' : 'FFFFFF' }, patternType: 'solid' },
          alignment: {
            vertical: 'center',
            horizontal: col.align || 'left',
            wrapText: Boolean(col.wrap),
          },
          border: cellBorder,
        }
      }
    }
  }

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
  ]
  ws['!freeze'] = { cols: Math.min(2, cols.length), rows: 3 }
  ws['!autofilter'] = {
    ref: X.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: Math.max(2, 2 + dataRows.length), c: lastCol } }),
  }
  ws['!pageSetup'] = { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 }

  return ws
}

export default function StaffExportModal({
  open,
  onClose,
  staff,
  initialCategory = 'Barchasi',
  filteredFromPage,
  onSuccess,
}: Props) {
  const hasPageFilter = Boolean(filteredFromPage && filteredFromPage.length > 0 && filteredFromPage.length < staff.length)
  const [selectedCat, setSelectedCat] = useState<string>('Barchasi')
  const [splitByCategory, setSplitByCategory] = useState<boolean>(true)
  const [sortMode, setSortMode] = useState<'category' | 'alpha'>('category')
  const [tgBusy, setTgBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [selectedCols, setSelectedCols] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    AVAILABLE_COLUMNS.forEach((c) => {
      init[c.id] = !!c.defaultChecked
    })
    return init
  })
  const [customName, setCustomName] = useState<string>('')

  // Modal ochilganda sahifadagi joriy toifa/filtr holatini moslash
  useEffect(() => {
    if (!open) return
    if (hasPageFilter) {
      const catCount = staff.filter((s) => matchesStaffCategory(s, initialCategory)).length
      if (initialCategory !== 'Barchasi' && filteredFromPage && filteredFromPage.length === catCount) {
        setSelectedCat(initialCategory)
      } else {
        setSelectedCat('Joriy filtr')
      }
    } else {
      setSelectedCat(initialCategory || 'Barchasi')
    }
  }, [open, initialCategory, hasPageFilter, filteredFromPage, staff])

  // Har bir ustunda nechta xodimda ma'lumot borligini hisoblash
  const filledCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const col of AVAILABLE_COLUMNS) {
      if (col.id === 'num') {
        counts[col.id] = staff.length
        continue
      }
      let n = 0
      for (let i = 0; i < staff.length; i++) {
        const val = col.extract(staff[i], i)
        if (String(val ?? '').trim() !== '') n++
      }
      counts[col.id] = n
    }
    return counts
  }, [staff])

  // Tanlangan va saralangan xodimlar
  const filteredStaff = useMemo(() => {
    const base =
      selectedCat === 'Joriy filtr' && filteredFromPage
        ? [...filteredFromPage]
        : selectedCat === 'Barchasi'
          ? [...staff]
          : staff.filter((s) => matchesStaffCategory(s, selectedCat))

    base.sort((a, b) => {
      if (sortMode === 'category') {
        const diff = categoryRank(a) - categoryRank(b)
        if (diff !== 0) return diff
      }
      return (a.fish || '').localeCompare(b.fish || '', 'uz')
    })
    return base
  }, [staff, selectedCat, filteredFromPage, sortMode])

  const activeColIds = useMemo(
    () => AVAILABLE_COLUMNS.filter((c) => selectedCols[c.id]).map((c) => c.id),
    [selectedCols],
  )

  // Fayl nomini generatsiya qilish (PROBEL ISHLATILADI, TAGCHIZIQ '_' EMAS)
  const defaultFileName = useMemo(() => {
    const low = selectedCat.toLowerCase()
    let base = 'Barcha xodimlar royxati'
    if (selectedCat === 'Joriy filtr') base = 'Tanlangan xodimlar royxati'
    else if (low.includes('shtat')) base = 'Shtat xodimlar royxati'
    else if (low.includes('asosiy')) base = 'Asosiy oqituvchilar royxati'
    else if (low.includes("o'rindosh") || low.includes('orindosh')) base = 'Orindosh oqituvchilar royxati'
    return `${base} ${todayStr()}`
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

  const applyPreset = (preset: 'standard' | 'hr' | 'passport' | 'finance' | 'contact') => {
    const next: Record<string, boolean> = {}
    AVAILABLE_COLUMNS.forEach((c) => { next[c.id] = false })

    const keys =
      preset === 'standard'
        ? ['num', 'fish', 'lavozim', 'kategoriya', 'tel', 'pv', 'pinfl']
        : preset === 'hr'
          ? ['num', 'fish', 'lavozim', 'kategoriya', 'tel', 'dob', 'tugilgan_joy', 'pv', 'pinfl', 'pasport_berilgan_joy', 'yashash_joyi', 'tamomlagan_otm', 'otm_tamom_yili', 'mutaxassislik', 'buyruq_sana']
          : preset === 'passport'
            ? ['num', 'fish', 'lavozim', 'pv', 'pinfl', 'dob', 'tugilgan_joy', 'pasport_berilgan_joy', 'yashash_joyi']
            : preset === 'finance'
              ? ['num', 'fish', 'lavozim', 'kategoriya', 'stavka', 'maosh', 'pinfl', 'inn', 'plastik_karta', 'plastik_muddati']
              : ['num', 'fish', 'lavozim', 'bolim', 'tel', 'yashash_joyi']

    keys.forEach((k) => { next[k] = true })
    setSelectedCols(next)
  }

  const buildWorkbookBytes = async (): Promise<{ bytes: Uint8Array; outFileName: string; sheetCount: number }> => {
    const X = await loadXlsx()
    const cols = AVAILABLE_COLUMNS.filter((c) => selectedCols[c.id])
    const dateStr = todayStr()
    const wb = X.utils.book_new()

    const canSplit = selectedCat === 'Barchasi' && splitByCategory
    let sheetCount = 0

    if (canSplit) {
      const sheets: { title: string; filter?: string }[] = [
        { title: 'Barcha xodimlar' },
        { title: 'Shtat xodimlar', filter: 'Shtat' },
        { title: 'Asosiy oqituvchilar', filter: 'Asosiy' },
        { title: 'Orindosh oqituvchilar', filter: "O'rindosh" },
      ]
      for (const sh of sheets) {
        const sub = sh.filter ? filteredStaff.filter((s) => matchesStaffCategory(s, sh.filter!)) : filteredStaff
        if (!sub.length) continue
        const ws = buildStaffSheet(X, sh.title, sub, cols, dateStr)
        X.utils.book_append_sheet(wb, ws, safeSheetName(sh.title))
        sheetCount++
      }
    } else {
      const title =
        selectedCat === 'Joriy filtr'
          ? 'Tanlangan filtr'
          : selectedCat === 'Barchasi'
            ? 'Barcha xodimlar'
            : selectedCat
      const ws = buildStaffSheet(X, title, filteredStaff, cols, dateStr)
      X.utils.book_append_sheet(wb, ws, safeSheetName(title))
      sheetCount = 1
    }

    const bytes = workbookBytes(X, wb)

    // Fayl nomida tagchiziq '_' ni bo'shliq ' ' ga almashtiramiz
    let outFileName = (customName.trim() || defaultFileName).replace(/_/g, ' ')
    outFileName = outFileName.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
    if (!outFileName.toLowerCase().endsWith('.xlsx')) {
      outFileName += '.xlsx'
    }

    return { bytes, outFileName, sheetCount }
  }

  const handleDownload = async () => {
    if (!activeColIds.length) {
      alert("Kamida bitta ustunni tanlang!")
      return
    }
    if (!filteredStaff.length) {
      alert("Tanlangan toifada xodimlar topilmadi!")
      return
    }

    setExportBusy(true)
    try {
      const { bytes, outFileName, sheetCount } = await buildWorkbookBytes()
      downloadBlob(bytes, outFileName)
      onSuccess?.(`${filteredStaff.length} nafar xodim (${sheetCount} ta varaq) «${outFileName}» fayliga eksport qilindi`)
      onClose()
    } catch (err) {
      console.error('Excel export error:', err)
      alert(`Excel faylni yuklab olishda xatolik: ${(err as Error).message}`)
    } finally {
      setExportBusy(false)
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
      const { bytes, outFileName, sheetCount } = await buildWorkbookBytes()
      const blob = new Blob([new Uint8Array(bytes)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const file = new File([blob], outFileName, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })

      const fd = new FormData()
      fd.append('file', file)
      fd.append(
        'caption',
        `📊 <b>${outFileName}</b>\n👥 Jami: <b>${filteredStaff.length} nafar</b> · <b>${activeColIds.length} ta ustun</b> · <b>${sheetCount} ta varaq</b>\n🏛 Shahrisabz Tibbiyot Texnikumi`,
      )

      const res = await fetch('/api/send_role_telegram', {
        method: 'POST',
        body: fd,
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) {
        onSuccess?.(`«${outFileName}» Telegram botga muvaffaqiyatli yuborildi!`)
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

  const catOptions = [
    ...(hasPageFilter
      ? [{ id: 'Joriy filtr', label: 'Joriy filtr', icon: Filter, iconColor: 'text-violet-400', count: filteredFromPage?.length || 0 }]
      : []),
    { id: 'Barchasi', label: 'Barchasi', icon: Globe, iconColor: 'text-sky-400', count: staff.length },
    { id: 'ShTAT - xodimlar', label: 'Shtat xodimlar', icon: Briefcase, iconColor: 'text-amber-400', count: staff.filter((s) => matchesStaffCategory(s, 'Shtat')).length },
    { id: "Asosiy o'qituvchilar", label: "Asosiy o'qituvchilar", icon: GraduationCap, iconColor: 'text-emerald-400', count: staff.filter((s) => matchesStaffCategory(s, 'Asosiy')).length },
    { id: "O'rindosh o'qituvchilar", label: "O'rindosh o'qituvchilar", icon: BookOpen, iconColor: 'text-blue-400', count: staff.filter((s) => matchesStaffCategory(s, "O'rindosh")).length },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-line bg-ink-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-ink-950/70 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-fg">Xodimlarni Excelga Eksport Qilish</h2>
              <p className="text-[12px] text-fg-subtle">
                Sarlavha, muzlatilgan ustunlar, avtomatik kenglik va toza formatlangan jadval (.xlsx)
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
        <div className="max-h-[72vh] overflow-y-auto p-5 space-y-5">
          {/* 1. Toifani tanlash */}
          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wider text-fg-subtle">
              1. Eksport Qilinadigan Toifani Tanlang
            </label>
            <div className={`grid grid-cols-2 gap-2 ${catOptions.length > 4 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
              {catOptions.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCat(cat.id)}
                  className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-all cursor-pointer ${
                    selectedCat === cat.id
                      ? 'border-emerald bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald'
                      : 'border-line bg-ink-950/40 text-fg hover:border-line-hover'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[12px] font-medium">
                    <cat.icon size={14} className={cat.iconColor} />
                    <span>{cat.label}</span>
                  </span>
                  <span className="mt-1 text-[11px] text-fg-subtle">{cat.count} nafar xodim</span>
                </button>
              ))}
            </div>

            {/* Qo'shimcha Excel sozlamalari: Varaqlar va Tartib */}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ink-950/40 px-3 py-2 text-[12px]">
              {selectedCat === 'Barchasi' ? (
                <label className="flex cursor-pointer items-center gap-2 text-fg select-none">
                  <input
                    type="checkbox"
                    checked={splitByCategory}
                    onChange={(e) => setSplitByCategory(e.target.checked)}
                    className="size-4 accent-emerald-500 cursor-pointer"
                  />
                  <Layers size={14} className="text-sky-400" />
                  <span>Toifalar bo&apos;yicha alohida varaqlarga ajratish (Barchasi + Shtat + Asosiy + O&apos;rindosh)</span>
                </label>
              ) : (
                <span className="text-fg-subtle">Bitta alohida varaqda eksport qilinadi</span>
              )}

              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-fg-subtle">Tartib:</span>
                <button
                  type="button"
                  onClick={() => setSortMode('category')}
                  className={`rounded-lg border px-2 py-0.5 text-[11.5px] cursor-pointer ${
                    sortMode === 'category' ? 'border-sky/50 bg-sky/15 text-sky-soft font-semibold' : 'border-line text-fg-subtle hover:text-fg'
                  }`}
                >
                  Toifa bo&apos;yicha
                </button>
                <button
                  type="button"
                  onClick={() => setSortMode('alpha')}
                  className={`rounded-lg border px-2 py-0.5 text-[11.5px] cursor-pointer ${
                    sortMode === 'alpha' ? 'border-sky/50 bg-sky/15 text-sky-soft font-semibold' : 'border-line text-fg-subtle hover:text-fg'
                  }`}
                >
                  Alifbo (A–Z)
                </button>
              </div>
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
                  className="rounded-lg border border-line bg-ink-950/40 px-2 py-1 text-fg-subtle hover:text-fg cursor-pointer"
                >
                  Standart
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('hr')}
                  className="rounded-lg border border-emerald-500/30 bg-ink-950/40 px-2 py-1 text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                >
                  Kadrlar (SH.T.T)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('passport')}
                  className="rounded-lg border border-sky/30 bg-ink-950/40 px-2 py-1 text-sky-soft hover:bg-sky/10 cursor-pointer"
                >
                  Pasport / JSHSHIR
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('finance')}
                  className="rounded-lg border border-amber/30 bg-ink-950/40 px-2 py-1 text-amber hover:bg-amber/10 cursor-pointer"
                >
                  Moliya / Plastik
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('contact')}
                  className="rounded-lg border border-line bg-ink-950/40 px-2 py-1 text-fg-subtle hover:text-fg cursor-pointer"
                >
                  Aloqa uchun
                </button>
                <button
                  type="button"
                  onClick={selectAll}
                  className="rounded-lg border border-line bg-ink-950/40 px-2 py-1 text-fg-subtle hover:text-fg cursor-pointer"
                >
                  Barchasi
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="rounded-lg border border-line bg-ink-950/40 px-2 py-1 text-fg-subtle hover:text-rose-400 cursor-pointer"
                >
                  Tozalash
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 max-h-56 overflow-y-auto rounded-xl border border-line bg-ink-950/40 p-2.5">
              {AVAILABLE_COLUMNS.map((col) => {
                const checked = !!selectedCols[col.id]
                const filled = filledCounts[col.id] ?? 0
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
                    <span className="min-w-0 flex-1 truncate">{col.label}</span>
                    {col.id !== 'num' && (
                      <span className={`shrink-0 text-[10px] tabular-nums ${filled === 0 ? 'text-fg-subtle/50' : 'text-fg-subtle'}`}>
                        {filled}/{staff.length}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 3. Fayl nomi */}
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-fg-subtle">
              3. Fayl Nomi (Tagchiziq o&apos;rniga faqat probel ishlatiladi)
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-ink-950/70 px-5 py-3.5">
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
              onClick={() => void handleSendTelegram()}
              disabled={tgBusy || exportBusy}
              title="Ushbu moslashtirilgan Excel faylni Telegram botga yuborish"
              className="btn-ghost h-9 px-3.5 text-[12.5px] border border-sky/30 bg-sky/10 text-sky-soft hover:bg-sky/25"
            >
              {tgBusy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              <span>Telegramga</span>
            </button>
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={exportBusy || tgBusy}
              className="btn-success h-9 px-4 text-[12.5px] font-semibold"
            >
              {exportBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              <span>Yuklab olish (.xlsx)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
