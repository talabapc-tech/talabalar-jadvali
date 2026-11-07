import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { GROUP_LEADERS } from './config'
import { byName, formatDate, fullName, isOfficialGroup, isSecretGroup, tugilganTuman } from './student'
import type { Student } from './types'
import ISTISNOLAR from './qabul-istisnolar.json'
import { QABUL_FILE, QABUL_HEADERS, QABUL_PINFL_COL, QABUL_SHEET, QABUL_WIDTHS, REVIEW_COL, qabulCells, qabulRow, type QabulIstisno, type QabulRow } from './qabul'

/*
 * Excel eksport qurilmalari — brauzer (lib/excel.ts) ham, Telegram bot (server) ham shu yerdan foydalanadi.
 * Bu faylda brauzerga bog'liq narsa (document, localStorage) YO'Q: server ham import qila oladi.
 */

/** Eksport menyusidagi bo'limlar (portal ham, Telegram bot ham) */
export type Role = 'qabul_shablon' | 'toliq'
/** buildSheet ishlatadigan ustunlar to'plami (guruh_rahbari — faqat bitta guruh/maxsus guruh eksporti uchun) */
export type SheetRole = 'guruh_rahbari' | 'toliq'

export const ROLE_META: Record<Role, { file: string; title: string; sub: string }> = {
  qabul_shablon: { file: `${QABUL_FILE}.xlsx`, title: QABUL_FILE, sub: "Barcha guruhlar, 16 ustun (tug'ilgan sana bilan), muassasa nomi UZ / EN / RU" },
  toliq: { file: '4_Toliq_Malumotlar_Bazasi.xlsx', title: "To'liq ma'lumotlar", sub: 'Kontingent (formulalar bilan) + barcha ustunlar jamlangan baza' },
}

export type XLSXModule = typeof import('xlsx-js-style')

/** Kutubxona faqat eksport vaqtida yuklanadi — sahifa (va bot) og'irlashmasin */
export const loadXlsx = async (): Promise<XLSXModule> => {
  const m: any = await import('xlsx-js-style')
  // Serverda (Node, CommonJS paket) eksportlar `default` ichida keladi; brauzerda to'g'ridan-to'g'ri
  return (m.utils ? m : m.default) as XLSXModule
}

/** QABUL qatoriga (AI) tarjimani qo'llovchi funksiya: brauzerda — localStorage keshi, serverda — xotira keshi */
export type QabulTranslate = (r: QabulRow) => QabulRow

/**
 * xlsx-js-style kutubxonasidagi OpenXML xatosini tozalovchi funksiya:
 * xlsx-js-style makrosiz .xlsx fayllarida workbookPr ichiga noto'g'ri codeName="ThisWorkbook" yozib qo'yadi.
 * Bu Microsoft Excel'da "Ошибка в части содержимого в книге... Выполнить попытку восстановления?"
 * xatoligini keltirib chiqaradi. codeName olib tashlangach, Excel faylni toza ochadi.
 */
export function cleanXlsxBuffer(raw: ArrayBuffer | Uint8Array, patch?: (files: Record<string, Uint8Array>) => void): Uint8Array {
  try {
    const unzipped = unzipSync(new Uint8Array(raw))
    patch?.(unzipped)
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

/** Ish kitobini Excel ochadigan toza .xlsx baytlariga aylantirish */
export function workbookBytes(X: XLSXModule, wb: any): Uint8Array {
  const raw = X.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true, bookSST: false })
  return cleanXlsxBuffer(raw, (files) => freezePanes(wb, files))
}

/**
 * xlsx-js-style qotirilgan qatorlar/ustunlarni yozmaydi — sahifada ws['!freeze'] = { cols, rows } bo'lsa,
 * tegishli sheetN.xml ga <pane> qo'shiladi (cols — chapdan qotiriladigan ustunlar, rows — tepadan qatorlar).
 */
function freezePanes(wb: any, files: Record<string, Uint8Array>) {
  ;(wb.SheetNames as string[]).forEach((name, i) => {
    const fr = wb.Sheets[name]?.['!freeze'] as { cols: number; rows: number } | undefined
    const path = `xl/worksheets/sheet${i + 1}.xml`
    if (!fr || !files[path]) return
    const topLeft = `${XLSXColName(fr.cols)}${fr.rows + 1}`
    const pane =
      `<pane xSplit="${fr.cols}" ySplit="${fr.rows}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/>` +
      `<selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/>`
    const xml = strFromU8(files[path]).replace(/<sheetView\b([^>]*?)\/>/, `<sheetView$1>${pane}</sheetView>`)
    files[path] = strToU8(xml)
  })
}

/** 0 dan boshlangan ustun indeksi → harf (0 → A, 3 → D) */
function XLSXColName(n: number): string {
  let s = ''
  for (let x = n; x >= 0; x = Math.floor(x / 26) - 1) s = String.fromCharCode(65 + (x % 26)) + s
  return s
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
 * QABUL - 2026: bitta "Лист1" sahifa. 1-qator — sarlavha, 2-qator — jami, 3-qator — ustun nomlari,
 * 4-qatordan talabalar (№ 1 dan). 16 ustun (guruhi, tug'ilgan sana, muassasa nomi UZ / EN / RU).
 * Dizayn: hamma yozuv QORA, hamma chiziq QORA (sarlavha atrofi qalin), sarlavha och kulrang fonda,
 * birinchi 3 ustun va sarlavha qatori qotirilgan, filtr bor. Qatorlar va tarjimalar lib/qabul.ts da (Python bilan umumiy).
 * Sariq katak — qoida ham, AI ham tarjima qila olmagan nom yoki hudud (qo'lda tekshirish).
 */
export function buildQabulShablonSheet(X: XLSXModule, students: Student[], translate: QabulTranslate = (r) => r) {
  const black = { rgb: '000000' }
  const thin = { style: 'thin', color: black }
  const medium = { style: 'medium', color: black }
  const thinBorder = { top: thin, bottom: thin, left: thin, right: thin }
  const headBorder = { top: medium, bottom: medium, left: medium, right: medium }
  const font = { sz: 11, name: 'Calibri', color: black }
  const boldFont = { ...font, bold: true }

  const HEAD_ROW = 2
  const lastCol = QABUL_HEADERS.length - 1
  // Qisqa qiymatli ustunlar markazda, uzun matnlar chapda (qatorga o'raladi)
  const CENTER = new Set([0, 1, 3, 4, 5, 6, 7, 13, 14, 15])
  const BOLD = new Set([0, 2])

  const rows = students.map((s) => translate(qabulRow(s, (ISTISNOLAR as Record<string, QabulIstisno>)[String(s.pinfl || '').replace(/\D/g, '')])))
  const groupCount = new Set(rows.map((r) => r.group).filter(Boolean)).size
  const aoa: (string | number)[][] = [
    ['QABUL - 2026'],
    [`Jami: ${rows.length} nafar talaba · ${groupCount} ta guruh`],
    QABUL_HEADERS,
    ...rows.map((r, i) => qabulCells(r, i)),
  ]

  const ws = X.utils.aoa_to_sheet(aoa)
  for (let r = 0; r < aoa.length; r++) {
    const reviewCols = r <= HEAD_ROW ? [] : rows[r - HEAD_ROW - 1].review.map((k) => REVIEW_COL[k]).filter((c) => c !== undefined)
    for (let c = 0; c <= lastCol; c++) {
      const addr = X.utils.encode_cell({ r, c })
      if (!ws[addr]) ws[addr] = { t: 's', v: '' }
      const ref = ws[addr]
      if (r === 0) {
        ref.s = { font: { ...boldFont, sz: 16 }, alignment: { horizontal: 'left', vertical: 'center' } }
      } else if (r === 1) {
        ref.s = { font, alignment: { horizontal: 'left', vertical: 'center' } }
      } else if (r === HEAD_ROW) {
        ref.s = {
          font: boldFont,
          fill: { fgColor: { rgb: 'D9D9D9' }, patternType: 'solid' },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: headBorder,
        }
      } else {
        if (c === QABUL_PINFL_COL) ref.t = 's'
        ref.s = {
          font: BOLD.has(c) ? boldFont : font,
          border: thinBorder,
          alignment: { horizontal: CENTER.has(c) ? 'center' : 'left', vertical: 'center', wrapText: true },
          ...(reviewCols.includes(c) ? { fill: { fgColor: { rgb: 'FFF2CC' }, patternType: 'solid' } } : {}),
        }
      }
    }
  }
  ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: lastCol } })
  ws['!cols'] = QABUL_WIDTHS.map((width) => ({ width })) // width — Excel birligida aniq (wch +0.83 qo'shadi)
  // Qator balandligi: eng uzun o'raladigan matn necha qatorga sig'ishiga qarab (hamma qator bir tekis, Excel/LibreOffice farqsiz)
  const rowHeight = (cells: (string | number)[]) => {
    const lines = cells.reduce<number>((m, v, c) => (CENTER.has(c) ? m : Math.max(m, Math.ceil(String(v ?? '').length / (QABUL_WIDTHS[c] * 0.95)))), 1)
    return Math.max(21, lines * 15 + 6)
  }
  ws['!rows'] = [{ hpt: 26 }, { hpt: 18 }, { hpt: 48 }, ...rows.map((r, i) => ({ hpt: rowHeight(qabulCells(r, i)) }))]
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
  ]
  if (rows.length) ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: HEAD_ROW, c: 0 }, e: { r: aoa.length - 1, c: lastCol } }) }
  // Sarlavha qatori va №, Guruhi, F.I.O ustunlari qotirilgan
  ;(ws as any)['!freeze'] = { cols: 3, rows: HEAD_ROW + 1 }
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

export const C = {
  tr: { header: 'T/R', wch: 6, val: (_s: Student, i: number) => i + 1, num: true } as Col,
  group: { header: 'Guruh', wch: 10, val: (s: Student) => isSecretGroup(s.group) ? `${s.group} (asl: ${s.asl_guruh || '?'})` : s.group || '', center: true } as Col,
  chiqqan: { header: 'Qaysi guruhdan chiqqan', wch: 16, val: (s: Student) => s.chiqqan_guruh || '', bold: true, center: true } as Col,
  buyruq: { header: 'Buyruq №', wch: 14, val: (s: Student) => s.buyruq || '', center: true } as Col,
  buyruqSana: { header: 'Buyruq sanasi', wch: 16, val: (s: Student) => s.buyruq_sana || '', center: true } as Col,
  leader: { header: 'Guruh rahbari', wch: 32, val: (s: Student) => GROUP_LEADERS[s.group] || '—' } as Col,
  fish: { header: 'F.I.SH (Talaba)', wch: 42, val: (s: Student) => fullName(s), bold: true } as Col,
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

export const ROLES: Record<SheetRole, { bg: string; cols: Col[] }> = {
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
    // 20 ustun — tasdiqlangan tartib (guruh rahbari jadval tepasidagi kontingent blokida)
    cols: [
      C.tr, C.group, C.fish,
      { ...C.dob, header: "Tug'ilgan sanasi (dd.mm.yyyy)", wch: 18, bold: true },
      C.pv, C.pinfl, C.ber, C.docTur, C.shDoc, C.mak, C.yil,
      C.viloyatTuman, C.mfy, C.kochaUy, C.qatnov,
      C.telTalaba, C.telOtaona, C.telKim,
      C.shnum,
      { header: 'Bazaga kiritilganligi', wch: 18, val: (s) => s.baza || 'KIRITILDI', center: true },
    ],
  },
}

/** Jadval tepasiga ajratilgan qatorlar (masalan kontingent bloki): `rows` ta bo'sh qator, `decorate` ularni to'ldiradi */
export interface SheetTop {
  rows: number
  decorate: (ws: any, helpers: { head: any; cell: (alt: boolean, bold: boolean, center: boolean, color?: string) => any; cols: Col[] }) => void
}

export function buildSheet(X: XLSXModule, students: Student[], role: SheetRole, colsOverride?: Col[], top?: SheetTop) {
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

  const offset = top?.rows ?? 0
  const aoa: (string | number)[][] = [...Array.from({ length: offset }, () => [] as (string | number)[]), cols.map((c) => c.header)]
  students.forEach((s, i) => aoa.push(cols.map((c) => c.val(s, i))))
  const ws = X.utils.aoa_to_sheet(aoa)
  const range = X.utils.decode_range(ws['!ref'] || 'A1')
  for (let r = Math.max(range.s.r, offset); r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = X.utils.encode_cell({ r, c })
      const ref = ws[addr]
      if (!ref) continue
      const alt = r % 2 === 0
      if (r === offset) ref.s = head
      else if (c === 0) { ref.t = 'n'; ref.s = cell(alt, true, true, '475569') }
      else {
        const meta = cols[c]
        if (meta.num && typeof ref.v === 'number') ref.t = 'n'
        ref.s = cell(alt, !!meta.bold, !!meta.center)
      }
    }
  }
  ws['!cols'] = cols.map((c) => ({ wch: c.wch }))
  ws['!rows'] = [...Array.from({ length: offset }, () => ({ hpt: 22 })), { hpt: 28 }, ...students.map(() => ({ hpt: 22 }))]
  // Tepadagi bo'sh qatorlar ham sahifa doirasiga kirsin (aks holda jadval 1-qatordan boshlanib, blok yo'qoladi)
  if (offset) ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: range.e })
  top?.decorate(ws, { head, cell, cols })
  return ws
}

/**
 * "Jami talabalar" sahifasi: tepada KONTINGENT (guruh, guruh rahbari, talabalar soni — jadvaldan
 * COUNTIF formulasi bilan hisoblanadi), pastida talabalar jadvali (filtr bilan).
 * Jadvalga talaba qo'shilsa/o'chirilsa, formulalar qayta hisoblanadi; keshlangan qiymatlar esa
 * formulani hisoblamaydigan ko'ruvchilar (telefon, Telegram ko'rinishi) uchun yoziladi.
 */
function buildToliqSheet(X: XLSXModule, students: Student[]) {
  const cols = ROLES.toliq.cols
  const groups = [...new Set(students.map((s) => (s.group || '').trim()).filter(Boolean))].sort(groupOrder)
  const KOUNT_HEADERS = ['№', 'Guruh', 'Guruh rahbari', 'Talabalar soni']
  // 0: sarlavha, 1: ustunlar, 2..: guruhlar, JAMI, bo'sh qator — keyin jadval sarlavhasi
  const offset = groups.length + 4
  const first = offset + 2 // jadvalning birinchi talaba qatori (Excelda 1 dan)
  const last = offset + 1 + students.length
  const groupCol = X.utils.encode_col(cols.indexOf(C.group))
  const groupRange = `$${groupCol}$${first}:$${groupCol}$${last}`

  return buildSheet(X, students, 'toliq', undefined, {
    rows: offset,
    decorate: (ws, { head, cell, cols: tcols }) => {
      const put = (r: number, c: number, cellObj: any, style: any) => { ws[X.utils.encode_cell({ r, c })] = { ...cellObj, s: style } }
      const total = (style: any) => ({ ...style, font: { ...style.font, bold: true }, fill: { fgColor: { rgb: 'E2E8F0' }, patternType: 'solid' } })

      // Sarlavha
      put(0, 0, { t: 's', v: 'KONTINGENT' }, { font: { bold: true, sz: 14, name: 'Calibri', color: { rgb: '0F172A' } }, alignment: { horizontal: 'left', vertical: 'center' } })
      KOUNT_HEADERS.forEach((h, c) => put(1, c, { t: 's', v: h }, head))

      let sumAll = 0
      groups.forEach((g, i) => {
        const r = 2 + i
        const xr = r + 1 // Excel qator raqami
        const n = students.filter((s) => (s.group || '').trim() === g).length
        sumAll += n
        const alt = r % 2 === 0
        put(r, 0, { t: 'n', v: i + 1 }, cell(alt, true, true, '475569'))
        put(r, 1, { t: 's', v: g }, cell(alt, true, true))
        put(r, 2, { t: 's', v: GROUP_LEADERS[g] || '—' }, cell(alt, false, false))
        // "26-07 (asl: ?)" kabi yozuvlar ham sanalsin deb prefiks bo'yicha
        put(r, 3, { t: 'n', f: `COUNTIF(${groupRange},B${xr}&"*")`, v: n }, cell(alt, true, true))
      })

      const jr = 2 + groups.length
      const totalStyle = total(cell(false, true, true))
      put(jr, 0, { t: 's', v: '' }, totalStyle)
      put(jr, 1, { t: 's', v: 'JAMI' }, totalStyle)
      put(jr, 2, { t: 's', v: `${groups.length} ta guruh` }, total(cell(false, true, false)))
      put(jr, 3, { t: 'n', f: `SUM(D3:D${2 + groups.length})`, v: sumAll }, totalStyle)

      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: KOUNT_HEADERS.length - 1 } }]
      ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: offset, c: 0 }, e: { r: last - 1, c: tcols.length - 1 } }) }
    },
  })
}

export const groupOrder = (a: string, b: string) => {
  const na = /^\d/.test(a), nb = /^\d/.test(b)
  if (na !== nb) return na ? -1 : 1
  return a.localeCompare(b, 'uz')
}

/**
 * Fayl nomiga sana va vaqtni kiritish (masalan: 4_Toliq_Malumotlar_Bazasi (06.10.2026 10-05).xlsx).
 * utcOffsetHours berilsa (server: Toshkent = 5) shu vaqt, aks holda qurilma vaqti.
 */
/** Bugungi sana: 07.11.2026 (utcOffsetHours berilsa shu vaqt zonasida, aks holda qurilma vaqti) */
export function todayStamp(utcOffsetHours?: number): string {
  const real = new Date()
  const useUtc = utcOffsetHours !== undefined
  const now = useUtc ? new Date(real.getTime() + utcOffsetHours * 3600 * 1000) : real
  const part = (utc: number, local: number) => String(useUtc ? utc : local).padStart(2, '0')
  return `${part(now.getUTCDate(), now.getDate())}.${part(now.getUTCMonth() + 1, now.getMonth() + 1)}.${useUtc ? now.getUTCFullYear() : now.getFullYear()}`
}

export function withTimestamp(baseName: string, ext = '.xlsx', utcOffsetHours?: number): string {
  const real = new Date()
  const useUtc = utcOffsetHours !== undefined
  const now = useUtc ? new Date(real.getTime() + utcOffsetHours * 3600 * 1000) : real
  const part = (utc: number, local: number) => String(useUtc ? utc : local).padStart(2, '0')
  const d = part(now.getUTCDate(), now.getDate())
  const m = part(now.getUTCMonth() + 1, now.getMonth() + 1)
  const y = useUtc ? now.getUTCFullYear() : now.getFullYear()
  const hh = part(now.getUTCHours(), now.getHours())
  const mm = part(now.getUTCMinutes(), now.getMinutes())
  const stamp = `(${d}.${m}.${y} ${hh}-${mm})`
  const clean = baseName.replace(/\.xlsx$/i, '').trim()
  return `${clean} ${stamp}${ext}`
}

/** Excel sahifa nomini xavfsiz qilish (apostrof, qavs, slash larni tozalash, 31 belgidan oshmaslik) */
export function safeSheetName(name: string): string {
  return name
    .replace(/[:\\/?*[\]'ʻʼ`"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
}

export interface BuildHooks {
  /** QABUL: tarjima kerak bo'lgan talabalar ro'yxati tayyor — shu yerda AI tarjimalarni oldindan yuklab olish mumkin */
  prepareQabul?: (students: Student[]) => Promise<void>
  /** QABUL: qatorga tarjimani qo'llash */
  translate?: QabulTranslate
}

/** QABUL shabloni va barcha guruhlar uchun faol kontingent: guruh tartibida, ichida alifbo bo'yicha */
export function qabulStudents(students: Student[]): Student[] {
  return students
    .filter((s) => isOfficialGroup(s.group))
    .sort((a, b) => groupOrder((a.group || '').trim(), (b.group || '').trim()) || byName(a, b))
}

/**
 * QABUL - 2026: bitta "Лист1" sahifa, BARCHA rasmiy guruhlar (1–3-kurs) — guruh tartibida,
 * ichida alifbo bo'yicha. Akademik ta'til va safdan chiqarilganlar kirmaydi.
 * To'liq ma'lumotlar: bitta "Jami talabalar" sahifa — tepada KONTINGENT (formulalar), pastda jadval.
 */
export async function buildRoleWorkbook(X: XLSXModule, students: Student[], role: Role, hooks: BuildHooks = {}) {
  const wb = X.utils.book_new()
  const active = qabulStudents(students)
  if (role === 'qabul_shablon') {
    await hooks.prepareQabul?.(active)
    X.utils.book_append_sheet(wb, buildQabulShablonSheet(X, active, hooks.translate), QABUL_SHEET)
    return { wb, count: active.length }
  }

  X.utils.book_append_sheet(wb, buildToliqSheet(X, active), 'Jami talabalar')
  return { wb, count: active.length }
}

/** Tayyor .xlsx baytlari — botda ham, brauzerda ham bir xil (utcOffsetHours: fayl nomidagi vaqt) */
export async function buildRoleXlsx(students: Student[], role: Role, hooks: BuildHooks & { utcOffsetHours?: number } = {}) {
  const X = await loadXlsx()
  const { wb, count } = await buildRoleWorkbook(X, students, role, hooks)
  return {
    bytes: workbookBytes(X, wb),
    count,
    sheets: wb.SheetNames.length,
    // To'liq ro'yxat: "07.11.2026 Talabalarning to'liq ro'yhati.xlsx"; QABUL — sana va vaqt bilan
    fileName: role === 'toliq'
      ? `${todayStamp(hooks.utcOffsetHours)} Talabalarning to'liq ro'yhati.xlsx`
      : withTimestamp(ROLE_META[role].file, '.xlsx', hooks.utcOffsetHours),
  }
}
