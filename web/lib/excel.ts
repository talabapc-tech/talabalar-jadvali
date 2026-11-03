'use client'

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { GROUPS, GROUP_LEADERS } from './config'
import { byName, formatDate, fullName, isAcademicLeave, isOfficialGroup, isOutside, isSecretGroup, isWithdrawn, kursOf, tugilganTuman } from './student'
import type { Student, ContractStudent } from './types'
import ISTISNOLAR from './qabul-istisnolar.json'
import { ensureAiTranslations, withAiTranslation } from './qabul-ai'
import { QABUL_FILE, QABUL_HEADERS, QABUL_PINFL_COL, QABUL_SHEET, QABUL_WIDTHS, REVIEW_COL, qabulCells, qabulRow, type QabulIstisno } from './qabul'

/**
 * xlsx-js-style kutubxonasidagi OpenXML xatosini tozalovchi funksiya:
 * xlsx-js-style makrosiz .xlsx fayllarida workbookPr ichiga noto'g'ri codeName="ThisWorkbook" yozib qo'yadi.
 * Bu Microsoft Excel'da "Ошибка в части содержимого в книге... Выполнить попытку восстановления?"
 * xatoligini keltirib chiqaradi. codeName olib tashlangach, Excel faylni toza ochadi.
 */
export function cleanXlsxBuffer(raw: ArrayBuffer | Uint8Array): Uint8Array {
  try {
    const unzipped = unzipSync(new Uint8Array(raw))
    if (unzipped['xl/workbook.xml']) {
      let wbXml = strFromU8(unzipped['xl/workbook.xml'])
      wbXml = wbXml.replace(/\s+codeName=(["']).*?\1/g, '')
      unzipped['xl/workbook.xml'] = strToU8(wbXml)
    }
    return zipSync(unzipped)
  } catch (err) {
    console.warn('XLSX fflate tozalashda xatolik:', err)
    return new Uint8Array(raw)
  }
}

export function downloadBlob(data: Uint8Array | ArrayBuffer | Blob, fileName: string, mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  if (typeof window === 'undefined') return
  const blob = data instanceof Blob ? data : new Blob([data as any], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function writeXlsxClean(X: XLSXModule, wb: any, fileName: string) {
  const raw = X.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true, bookSST: false })
  const cleaned = cleanXlsxBuffer(raw)
  downloadBlob(cleaned, fileName)
}

/* Eski app.js dagi 4 bo'limli Excel eksportning aynan o'zi (ustunlar, ranglar, formatlar) */

export type Role = 'qabul_shablon' | 'buxgalteriya' | 'guruh_rahbari' | 'toliq'

export const ROLE_META: Record<Role, { file: string; title: string; sub: string }> = {
  qabul_shablon: { file: `${QABUL_FILE}.xlsx`, title: QABUL_FILE, sub: "Admin shabloni: 14 ustun (guruhi bilan), rasmiy UZ / EN tarjima" },
  buxgalteriya: { file: '1_Buxgalteriya_Shartnoma_va_Pasport.xlsx', title: 'Buxgalteriya', sub: "Shartnoma № va pasport ma'lumotlari" },
  guruh_rahbari: { file: '3_Guruh_Rahbarlari_Talabalar_Malumotlari.xlsx', title: 'Guruh rahbarlari', sub: "Tug'ilgan sana, pasport, shahodatnoma" },
  toliq: { file: '4_Toliq_Malumotlar_Bazasi.xlsx', title: "To'liq ma'lumotlar", sub: 'Barcha ustunlar jamlangan baza' },
}

interface Col {
  header: string
  wch: number
  val: (s: Student, i: number) => string | number
  bold?: boolean
  num?: boolean
  center?: boolean
}

const numIf = (v: string) => {
  const s = String(v ?? '').trim()
  return /^\d{1,10}$/.test(s) ? Number(s) : s
}

/*
 * QABUL - 2026 / Baza administratori — administratorning qabul jadvali formati:
 * bitta "Лист1" sahifa, 1–2-qatorlar bo'sh, 3-qatorda sarlavha, 4-qatordan talabalar (№ 1 dan),
 * 14 ustun (guruhi bilan), Times New Roman 12, ingichka chegara. Qatorlar va tarjimalar lib/qabul.ts da (Python bilan umumiy).
 * Sariq katak — qoida ham, AI ham tarjima qila olmagan nom (qo'lda tekshirish).
 */
function buildQabulShablonSheet(X: XLSXModule, students: Student[]) {
  const thin = { style: 'thin', color: { rgb: '000000' } }
  const border = { top: thin, bottom: thin, left: thin, right: thin }
  const font = { sz: 12, name: 'Times New Roman', color: { rgb: '000000' } }
  const headStyle = { font, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border }
  const cellStyle = (review: boolean) => ({
    font,
    border,
    ...(review ? { fill: { fgColor: { rgb: 'FFF2CC' }, patternType: 'solid' } } : {}),
  })

  const rows = students.map((s) => withAiTranslation(qabulRow(s, (ISTISNOLAR as Record<string, QabulIstisno>)[String(s.pinfl || '').replace(/\D/g, '')])))
  const aoa: (string | number)[][] = [[], [], QABUL_HEADERS, ...rows.map((r, i) => qabulCells(r, i))]

  const ws = X.utils.aoa_to_sheet(aoa)
  for (let r = 2; r < aoa.length; r++) {
    const reviewCols = r === 2 ? [] : rows[r - 3].review.map((k) => REVIEW_COL[k]).filter((c) => c !== undefined)
    for (let c = 0; c < QABUL_HEADERS.length; c++) {
      const addr = X.utils.encode_cell({ r, c })
      if (!ws[addr]) ws[addr] = { t: 's', v: '' }
      const ref = ws[addr]
      if (r === 2) {
        ref.s = headStyle
      } else {
        if (c === QABUL_PINFL_COL) ref.t = 's'
        ref.s = cellStyle(reviewCols.includes(c))
      }
    }
  }
  ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: QABUL_HEADERS.length - 1 } })
  ws['!cols'] = QABUL_WIDTHS.map((width) => ({ width })) // width — Excel birligida aniq (wch +0.83 qo'shadi)
  ws['!rows'] = [{ hpt: 15 }, { hpt: 15 }, { hpt: 47.25 }, ...rows.map(() => ({ hpt: 15.75 }))]
  return ws
}

const formatCleanPhone = (p: string) => {
  let s = String(p || '').trim()
  if (s.endsWith('.0')) s = s.slice(0, -2)
  if (s === '000' || s === '00' || s === '0' || s === '-' || s === '—') return ''
  const digits = s.replace(/\D/g, '')
  let d9 = digits
  if (digits.startsWith('998') && digits.length >= 12) {
    d9 = digits.slice(3, 12)
  } else if (digits.startsWith('8') && digits.length === 10) {
    d9 = digits.slice(1, 10)
  } else if (digits.length === 9) {
    d9 = digits
  } else if (digits.length > 9) {
    d9 = digits.slice(0, 9)
  }
  if (d9.length === 9) {
    return `+998 ${d9.slice(0, 2)} ${d9.slice(2, 5)}-${d9.slice(5, 7)}-${d9.slice(7, 9)}`
  }
  return s === '000' ? '' : s
}

function parseStudentPhones(s: Student): { telShaxsiy: string; telOtaona: string; telKim: string } {
  let t1 = s.tel_shaxsiy ? formatCleanPhone(s.tel_shaxsiy) : ''
  let t2 = s.tel_otaona ? formatCleanPhone(s.tel_otaona) : ''
  let kim = s.tel_otaona_kim || ''

  // Agar tel maydonida 2 ta raqam bo'lsa (masalan 973350582 / 978635082):
  if ((!t1 || !t2) && s.tel) {
    const raw = String(s.tel).trim()
    if (raw && raw !== '000' && raw !== '00') {
      const mKim = raw.match(/\(([^)]+)\)/)
      if (mKim && !kim) kim = mKim[1].trim()

      const cleaned = raw.replace(/\([^)]*\)/g, '').trim()
      const parts = cleaned.split(/[/,;]|\s{2,}/).map((p) => p.trim()).filter(Boolean)
      if (!t1 && parts[0]) t1 = formatCleanPhone(parts[0])
      if (!t2 && parts[1]) {
        t2 = formatCleanPhone(parts[1])
        if (!kim) kim = 'Otasi / Onasi'
      }
    }
  }

  if (t2 && !kim) {
    kim = 'Otasi / Onasi'
  }

  return {
    telShaxsiy: t1,
    telOtaona: t2,
    telKim: kim,
  }
}

const C = {
  tr: { header: 'T/R', wch: 6, val: (_s: Student, i: number) => i + 1, num: true } as Col,
  group: { header: 'Guruh', wch: 10, val: (s: Student) => isSecretGroup(s.group) ? `${s.group} (asl: ${s.asl_guruh || '?'})` : s.group || '', center: true } as Col,
  chiqqan: { header: 'Qaysi guruhdan chiqqan', wch: 16, val: (s: Student) => s.chiqqan_guruh || '', bold: true, center: true } as Col,
  buyruq: { header: 'Buyruq №', wch: 14, val: (s: Student) => s.buyruq || '', center: true } as Col,
  buyruqSana: { header: 'Buyruq sanasi', wch: 16, val: (s: Student) => s.buyruq_sana || '', center: true } as Col,
  leader: { header: 'Guruh rahbari', wch: 32, val: (s: Student) => GROUP_LEADERS[s.group] || '—' } as Col,
  fish: { header: 'F.I.SH (Talaba)', wch: 34, val: (s: Student) => fullName(s), bold: true } as Col,
  shnum: { header: 'Shartnoma №', wch: 14, val: (s: Student) => numIf(s.shnum), bold: true, num: true, center: true } as Col,
  pv: { header: 'Pasport seriya va raqami', wch: 18, val: (s: Student) => s.pv || '', bold: true, center: true } as Col,
  pinfl: { header: 'JSHSHIR (PINFL)', wch: 18, val: (s: Student) => s.pinfl || '', center: true } as Col,
  ber: { header: 'Pasport berilgan sanasi', wch: 16, val: (s: Student) => formatDate(s.ber), center: true } as Col,
  dob: { header: "Tug'ilgan sanasi", wch: 16, val: (s: Student) => formatDate(s.dob), center: true } as Col,
  tuman: { header: "Tug'ilgan tumani", wch: 20, val: (s: Student) => tugilganTuman(s.pinfl) } as Col,
  docTur: { header: 'Hujjat turi (Shahodatnoma/Diplom)', wch: 20, val: (s: Student) => s.doc_tur || '', center: true } as Col,
  shDoc: { header: 'Shahodatnoma / Diplom seriya №', wch: 22, val: (s: Student) => s.sh_doc || '', bold: true, center: true } as Col,
  mak: { header: "Tugatgan ta'lim muassasasi", wch: 38, val: (s: Student) => s.mak || '' } as Col,
  yil: { header: 'Bitirgan yili', wch: 14, val: (s: Student) => numIf(s.yil), num: true, center: true } as Col,
  viloyatTuman: {
    header: 'Viloyat / Tuman',
    wch: 22,
    val: (s: Student) => s.manzil_tuman || tugilganTuman(s.pinfl) || '',
  } as Col,
  mfy: {
    header: 'MFY / Mahalla',
    wch: 22,
    val: (s: Student) => s.manzil_mfy || '',
  } as Col,
  kochaUy: {
    header: 'Ko‘cha va uy',
    wch: 26,
    val: (s: Student) => {
      const parts = [
        s.manzil_kocha,
        s.manzil_uy ? (s.manzil_uy.toLowerCase().includes('uy') ? s.manzil_uy : `${s.manzil_uy}-uy`) : '',
      ].filter(Boolean)
      return parts.join(', ')
    },
  } as Col,
  manzilToliq: {
    header: 'To‘liq yashash manzili',
    wch: 42,
    val: (s: Student) => {
      if (s.manzil_toliq) return s.manzil_toliq
      const parts = [s.manzil_tuman || tugilganTuman(s.pinfl), s.manzil_mfy, s.manzil_kocha, s.manzil_uy]
      return parts.filter(Boolean).join(', ')
    },
  } as Col,
  qatnov: {
    header: 'Qatnov holati',
    wch: 16,
    val: (s: Student) => s.qatnov || '',
    center: true,
  } as Col,
  telTalaba: {
    header: 'Talaba telefoni',
    wch: 20,
    val: (s: Student) => parseStudentPhones(s).telShaxsiy,
    center: true,
  } as Col,
  telOtaona: {
    header: 'Ota-onasi telefoni',
    wch: 20,
    val: (s: Student) => parseStudentPhones(s).telOtaona,
    center: true,
  } as Col,
  telKim: {
    header: 'Qarindoshligi',
    wch: 16,
    val: (s: Student) => parseStudentPhones(s).telKim,
    center: true,
  } as Col,
}

const ROLES: Record<Exclude<Role, 'qabul_shablon'>, { bg: string; cols: Col[] }> = {
  buxgalteriya: { bg: '065F46', cols: [C.tr, C.group, C.fish, C.shnum, C.pv, C.pinfl, C.ber, C.dob] },
  guruh_rahbari: {
    bg: '4C1D95',
    cols: [
      C.tr, C.group, C.leader, C.shnum, C.fish,
      { ...C.dob, header: "Tug'ilgan sanasi (dd.mm.yyyy)", wch: 20, bold: true },
      C.viloyatTuman, C.mfy, C.kochaUy, C.manzilToliq, C.qatnov,
      C.telTalaba, C.telOtaona, C.telKim,
      C.pv, C.pinfl, C.ber, C.docTur, C.shDoc, C.mak, C.yil,
    ],
  },
  toliq: {
    bg: '0F172A',
    cols: [
      C.tr, C.group, C.leader, C.shnum, C.fish,
      { ...C.dob, header: "Tug'ilgan sanasi (dd.mm.yyyy)", wch: 18, bold: true },
      C.viloyatTuman, C.mfy, C.kochaUy, C.manzilToliq, C.qatnov,
      C.telTalaba, C.telOtaona, C.telKim,
      C.pv, C.pinfl, C.ber, C.docTur, C.shDoc, C.mak, C.yil,
      { header: 'Bazaga kiritilganligi', wch: 18, val: (s) => s.baza || 'KIRITILDI', center: true },
    ],
  },
}

type XLSXModule = typeof import('xlsx-js-style')

/** Kutubxona faqat eksport bosilganda yuklanadi — sahifa og'irlashmasin */
const loadXlsx = () => import('xlsx-js-style') as Promise<XLSXModule>

function buildSheet(X: XLSXModule, students: Student[], role: Exclude<Role, 'qabul_shablon'>, colsOverride?: Col[]) {
  const { bg } = ROLES[role]
  const cols = colsOverride ?? ROLES[role].cols
  const grid = { style: 'thin', color: { rgb: '94A3B8' } }
  const border = { top: grid, bottom: grid, left: grid, right: grid }
  const head = {
    font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' }, name: 'Calibri' },
    fill: { fgColor: { rgb: bg }, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'medium', color: { rgb: '1E293B' } },
      bottom: { style: 'medium', color: { rgb: '1E293B' } },
      left: { style: 'thin', color: { rgb: '334155' } },
      right: { style: 'thin', color: { rgb: '334155' } },
    },
  }
  const cell = (alt: boolean, bold: boolean, center: boolean, color = '0F172A') => ({
    font: { sz: 12, name: 'Calibri', bold, color: { rgb: color } },
    fill: { fgColor: { rgb: alt ? 'F8FAFC' : 'FFFFFF' }, patternType: 'solid' },
    alignment: { horizontal: center ? 'center' : 'left', vertical: 'center' },
    border,
  })

  const aoa: (string | number)[][] = [cols.map((c) => c.header)]
  students.forEach((s, i) => aoa.push(cols.map((c) => c.val(s, i))))
  const ws = X.utils.aoa_to_sheet(aoa)
  const range = X.utils.decode_range(ws['!ref'] || 'A1')
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = X.utils.encode_cell({ r, c })
      const ref = ws[addr]
      if (!ref) continue
      const alt = r % 2 === 0
      if (r === 0) ref.s = head
      else if (c === 0) { ref.t = 'n'; ref.s = cell(alt, true, true, '475569') }
      else {
        const meta = cols[c]
        if (meta.num && typeof ref.v === 'number') ref.t = 'n'
        ref.s = cell(alt, !!meta.bold, !!meta.center)
      }
    }
  }
  ws['!cols'] = cols.map((c) => ({ wch: c.wch }))
  ws['!rows'] = [{ hpt: 28 }, ...students.map(() => ({ hpt: 22 }))]
  return ws
}

const groupOrder = (a: string, b: string) => {
  const na = /^\d/.test(a), nb = /^\d/.test(b)
  if (na !== nb) return na ? -1 : 1
  return a.localeCompare(b, 'uz')
}

/** Fayl nomiga bugungi sana va vaqtni kiritish (masalan: 3_Guruh_Rahbarlari_Talabalar_Malumotlari (06.10.2026 10-05).xlsx) */
export function withTimestamp(baseName: string, ext = '.xlsx'): string {
  const now = new Date()
  const d = String(now.getDate()).padStart(2, '0')
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const y = now.getFullYear()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const stamp = `(${d}.${m}.${y} ${hh}-${mm})`
  const clean = baseName.replace(/\.xlsx$/i, '').trim()
  return `${clean} ${stamp}${ext}`
}

/** Excel sahifa nomini xavfsiz qilish (apostrof, qavs, slash larni tozalash, 31 belgidan oshmaslik) */
function safeSheetName(name: string): string {
  return name
    .replace(/[:\\/?*[\]'ʻʼ`"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
}

/**
 * Qabul shabloni: bitta "Лист1" sahifa, 1-kurs (joriy qabul) guruhlari — Python
 * (generate_qabul_shablon.py) bilan bir xil; guruh tartibida, ichida alifbo bo'yicha.
 */
async function buildRoleWorkbook(X: XLSXModule, students: Student[], role: Role) {
  const wb = X.utils.book_new()
  if (role === 'qabul_shablon') {
    const official = students
      .filter((s) => isOfficialGroup(s.group) && kursOf(s.group) === 1)
      .sort((a, b) => groupOrder((a.group || '').trim(), (b.group || '').trim()) || byName(a, b))
    await ensureAiTranslations(official)
    X.utils.book_append_sheet(wb, buildQabulShablonSheet(X, official), QABUL_SHEET)
    return { wb, count: official.length }
  }

  // EXCPORTDA t.s.cH VA AKADEMIK OLGAN GURUHLAR OLINMASIN:
  const activeStudents = students
    .filter((s) => isOfficialGroup(s.group) && !isAcademicLeave(s.group) && !isOutside(s.group))
    .sort((a, b) => groupOrder((a.group || '').trim(), (b.group || '').trim()) || byName(a, b))

  X.utils.book_append_sheet(wb, buildSheet(X, activeStudents, role), 'Jami talabalar')
  const groups = [...new Set(activeStudents.map((s) => (s.group || '').trim()).filter(Boolean))].sort(groupOrder)
  for (const g of groups) {
    const list = activeStudents.filter((s) => (s.group || '').trim() === g).sort(byName)
    const name = safeSheetName(/^\d/.test(g) ? `Guruh ${g}` : g)
    X.utils.book_append_sheet(wb, buildSheet(X, list, role), name)
  }
  return { wb, count: activeStudents.length }
}

/** 1-sahifa "Jami talabalar" (barcha guruhlar sahifalari bilan) */
export async function exportRole(students: Student[], role: Role) {
  const X = await loadXlsx()
  const { wb } = await buildRoleWorkbook(X, students, role)
  const fileName = withTimestamp(ROLE_META[role].file)
  writeXlsxClean(X, wb, fileName)
  return wb.SheetNames.length
}

/** Bitta guruhni QABUL - 2026 formatida yuklab olish */
export async function exportQabulShablonGroup(students: Student[], group: string) {
  const X = await loadXlsx()
  const list = students.filter((s) => (s.group || '').trim() === group.trim()).sort(byName)
  await ensureAiTranslations(list)
  const wb = X.utils.book_new()
  X.utils.book_append_sheet(wb, buildQabulShablonSheet(X, list), QABUL_SHEET)
  const fileName = withTimestamp(`${QABUL_FILE} (${group})`)
  writeXlsxClean(X, wb, fileName)
  return list.length
}

/** Tanlangan guruh(lar)ni QABUL - 2026 formatida yuklab olish */
export async function exportQabulShablonGroups(students: Student[], groups: string[]) {
  const cleanGroups = groups.map((g) => g.trim())
  const X = await loadXlsx()
  const list = students
    .filter((s) => cleanGroups.includes((s.group || '').trim()))
    .sort((a, b) => groupOrder((a.group || '').trim(), (b.group || '').trim()) || byName(a, b))
  await ensureAiTranslations(list)
  const wb = X.utils.book_new()
  X.utils.book_append_sheet(wb, buildQabulShablonSheet(X, list), QABUL_SHEET)
  const suffix = cleanGroups.length === 1 ? ` (${cleanGroups[0]})` : cleanGroups.length < GROUPS.length ? ` (${cleanGroups.length} guruh)` : ''
  const fileName = withTimestamp(`${QABUL_FILE}${suffix}`)
  writeXlsxClean(X, wb, fileName)
  return list.length
}

/** Guruh tanlovi: guruh kodi yoki maxsus kalit — 'safdan' (safdan chiqarilgan / guruhsiz), 'akademik' */
function inSelection(s: Student, key: string) {
  if (key === 'safdan') return isOutside(s.group)
  if (key === 'akademik') return isAcademicLeave(s.group)
  return (s.group || '').trim() === key
}

function sheetName(key: string) {
  const name = key === 'safdan' ? 'Safdan chiqarilganlar' : key === 'akademik' ? "Akademik tatil" : /^\d/.test(key) ? `Guruh ${key}` : key
  return safeSheetName(name)
}

/** Bitta guruh (yoki maxsus guruh) — guruh rahbari ustunlari bilan */
export async function exportGroup(students: Student[], group: string) {
  const X = await loadXlsx()
  const key = isWithdrawn(group) ? 'safdan' : isAcademicLeave(group) ? 'akademik' : group
  const list = students.filter((s) => inSelection(s, key)).sort(byName)
  const wb = X.utils.book_new()
  // Akademik ta'til / safdan chiqarilganlar: F.I.SH dan keyin qaysi guruhdan, buyruq va sanasi
  const cols = key === 'safdan' || key === 'akademik'
    ? ROLES.guruh_rahbari.cols.flatMap((c) => c === C.leader ? [] : c === C.fish ? [c, C.chiqqan, C.buyruq, C.buyruqSana] : [c])
    : undefined
  X.utils.book_append_sheet(wb, buildSheet(X, list, 'guruh_rahbari', cols), sheetName(key))
  const file = key === 'safdan' ? 'Talabalar_Safidan_Chiqarilganlar' : key === 'akademik' ? 'Akademik_Tatil_Olganlar' : `Guruh_${group}_Talabalar_Royxati`
  const fileName = withTimestamp(file)
  writeXlsxClean(X, wb, fileName)
  return list.length
}

/** Ekranda ko'rinib turgan (filtrlangan) talabalar — bitta sahifada */
export async function exportFiltered(students: Student[]) {
  const X = await loadXlsx()
  const wb = X.utils.book_new()
  X.utils.book_append_sheet(wb, buildSheet(X, students, 'toliq'), 'Talabalar')
  const fileName = withTimestamp('Talabalar_Tanlangan_Royxat')
  writeXlsxClean(X, wb, fileName)
}

/** Excel faylni server orqali Telegram botga yuborish */
export async function sendRoleToTelegram(students: Student[], role: Role) {
  const X = await loadXlsx()
  const { wb, count } = await buildRoleWorkbook(X, students, role)

  const wbout = X.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  const cleaned = cleanXlsxBuffer(wbout)
  const blob = new Blob([cleaned as any], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const meta = ROLE_META[role]

  const formData = new FormData()
  formData.append('caption', `📊 ${meta.title} (${meta.sub})\n👥 Jami talabalar: ${count} nafar`)
  formData.append('file', blob, withTimestamp(meta.file))

  const res = await fetch('/api/send_role_telegram', {
    method: 'POST',
    body: formData,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Telegramga yuborilmadi')
  }
}

export type TgTarget = 'channel' | 'bot' | 'both'

/** Guruh(lar) 1-varoqli A4 PDF rasm jurnalini Telegramga yuborish */
export async function sendGroupsToTelegram(
  _students: Student[],
  groupFilter: string | string[],
  target: TgTarget = 'both',
): Promise<{ sent: string[]; failed: string[] }> {
  const selected = Array.isArray(groupFilter)
    ? groupFilter
    : (!groupFilter || groupFilter === 'ALL' ? [] : [groupFilter])

  const res = await fetch('/api/send_group_telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups: selected, target }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || 'Telegramga yuborishda server xatosi yuz berdi')
  }
  return { sent: data.sent || [], failed: data.failed || [] }
}

/** Kontraktlar va qarzdorlik jadvalini Excel formatida eksport qilish */
export async function exportContractsExcel(
  contracts: ContractStudent[],
  filename = '02.10.2026_GACHA_KONTRAKTLAR.xlsx'
) {
  const X = await loadXlsx()
  const wb = X.utils.book_new()

  const headers = [
    'GURUHI', '№', 'Familiiyasi Ismi va Sharfi',
    "Shu vaqtgacha bo'lishi kerak bo'lgan to'lov", 'Jami', 'Shu vaqtgacha qarzi',
    "To'lov %", 'Holati'
  ]

  const rows: any[][] = [headers]
  let totalReq = 0
  let totalPaid = 0
  let totalDebt = 0

  contracts.forEach((c, idx) => {
    totalReq += c.shartnoma_summa || 0
    totalPaid += c.tolangan_summa || 0
    if (c.qarzdorlik > 0) totalDebt += c.qarzdorlik

    const holatText = c.is_hidden
      ? (c.hidden_reason ? `Yashirilgan (${c.hidden_reason})` : 'Yashirilgan / Imtiyoz')
      : (c.qarzdorlik > 0 ? 'Qarzdor' : "To'liq to'langan")

    rows.push([
      c.group || c.contract_group || '—',
      c.file_tr || idx + 1,
      c.fish,
      c.shartnoma_summa,
      c.tolangan_summa,
      c.qarzdorlik,
      `${c.tolov_foiz}%`,
      holatText
    ])
  })

  // Jami qator
  rows.push([
    'JAMI', '', `Jami: ${contracts.length} nafar`,
    totalReq, totalPaid, totalDebt,
    totalReq > 0 ? `${((totalPaid / totalReq) * 100).toFixed(1)}%` : '0%',
    ''
  ])

  const ws = X.utils.aoa_to_sheet(rows)
  const range = X.utils.decode_range(ws['!ref'] || 'A1:H1')

  // Header styling
  for (let col = range.s.c; col <= range.e.c; col++) {
    const addr = X.utils.encode_cell({ r: 0, c: col })
    if (ws[addr]) {
      ws[addr].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' }, name: 'Calibri' },
        fill: { fgColor: { rgb: '1E3A8A' } },
        alignment: { horizontal: 'center', vertical: 'center' }
      }
    }
  }

  // Data styling
  for (let r = 1; r < rows.length - 1; r++) {
    const debtVal = rows[r][5]
    const debtAddr = X.utils.encode_cell({ r, c: 5 })
    if (ws[debtAddr]) {
      if (debtVal > 0) {
        ws[debtAddr].s = { font: { bold: true, color: { rgb: 'B91C1C' } }, alignment: { horizontal: 'right' } }
      } else if (debtVal < 0) {
        ws[debtAddr].s = { font: { bold: true, color: { rgb: '1D4ED8' } }, alignment: { horizontal: 'right' } }
      } else {
        ws[debtAddr].s = { font: { color: { rgb: '047857' } }, alignment: { horizontal: 'right' } }
      }
      ws[debtAddr].z = '#,##0'
    }

    for (const c of [3, 4]) {
      const addr = X.utils.encode_cell({ r, c })
      if (ws[addr]) {
        ws[addr].z = '#,##0'
        ws[addr].s = { alignment: { horizontal: 'right' } }
      }
    }
  }

  // Total summary row styling
  const lastRowIdx = rows.length - 1
  for (let col = range.s.c; col <= range.e.c; col++) {
    const addr = X.utils.encode_cell({ r: lastRowIdx, c: col })
    if (ws[addr]) {
      ws[addr].s = {
        font: { bold: true, color: { rgb: '0F172A' }, name: 'Calibri' },
        fill: { fgColor: { rgb: 'E2E8F0' } },
        alignment: { horizontal: col >= 3 && col <= 5 ? 'right' : 'center' }
      }
      if (col === 3 || col === 4 || col === 5) {
        ws[addr].z = '#,##0'
      }
    }
  }

  // Ustunlar kengligi
  ws['!cols'] = [
    { wch: 12 }, // GURUHI
    { wch: 6 },  // №
    { wch: 34 }, // F.I.Sh
    { wch: 22 }, // Reja to'lov
    { wch: 20 }, // Jami
    { wch: 20 }, // Qarzdorlik
    { wch: 12 }, // To'lov %
    { wch: 18 }, // Holati
  ]

  X.utils.book_append_sheet(wb, ws, "KONTRAKTLAR")
  writeXlsxClean(X, wb, filename)
}


