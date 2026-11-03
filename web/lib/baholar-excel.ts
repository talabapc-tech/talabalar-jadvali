'use client'

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { cleanXlsxBuffer, downloadBlob } from './excel'
import { BAHO_TURLARI, bahoOf } from './baholar'

/*
  Guruh baholarining Excel fayllari (namuna: "25-23. 1-s BAHOLAR 3yillik (REYTING).xlsx"). Uch xil fayl:
  - Baza uchun: # (Reyting) — 100 ballik jadval, # — 5 ballik nusxa, Malakaviy amaliyot (har bir talaba).
  - Qaydnomalar: Mundarija + har bir fan uchun alohida qaydnoma varag'i.
  - Hisobot: 1–4-shakllar.
  Hisobotlardagi sonlar tayyor qiymat bilan yoziladi; davomat (dars soati) kataklari bo'sh va formulali.
*/

export interface ExportGrade {
  y: number | null; j: number | null; o: number | null; r: number | null
  y100: number | null; j100: number | null; o100: number | null; r100: number | null
}

export interface ExportAmaliyot {
  name: string; nom: string; joy: string; boshlanish: string; tugash: string
  ball: number | null; ball100: number | null; izoh: string
}

export interface BaholarExportData {
  guruh: string
  semestr: number
  rahbar: string
  /** "3 yillik" / "2 yillik" / "" — fayl nomi uchun */
  davomiylik: string
  talabalar: { name: string }[]
  fanlar: string[]
  grade: (i: number, fan: string) => ExportGrade
  amaliyot: ExportAmaliyot[]
}

/* ------------------------------------------------------------------ yordamchilar */

const sanaUz = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('.') : iso)
const letter = (c: number): string => { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const addr = (r: number, c: number, abs = false) => (abs ? `$${letter(c)}$${r + 1}` : `${letter(c)}${r + 1}`)
const mean = (v: (number | null)[]) => { const n = v.filter((x): x is number => x !== null); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null }

/** Guruh kodi (25-23) va semestrdan: o'quv yili va kurs. 25-23, 1-semestr → 2025-2026, 1-kurs */
function davr(guruh: string, semestr: number) {
  const m = /^(\d{2})-\d{2}$/.exec(guruh)
  const kurs = Math.floor((semestr - 1) / 2) + 1
  if (!m) return { yil: '', kurs }
  const boshi = 2000 + Number(m[1]) + Math.floor((semestr - 1) / 2)
  return { yil: `${boshi}-${boshi + 1}`, kurs }
}

export function baholarFileName(d: Pick<BaholarExportData, 'guruh' | 'semestr' | 'davomiylik'>) {
  return `${d.guruh}. ${d.semestr}-s BAHOLAR${d.davomiylik ? ` ${d.davomiylik.replace(/\s+/g, '')}` : ''} (REYTING).xlsx`
}

export type ExportTuri = 'baza' | 'qaydnoma' | 'hisobot'

const FILL5: Record<number, string> = { 5: 'BBF7D0', 4: 'BFDBFE', 3: 'FEF08A', 2: 'FECACA' }
const FAN_RANGLAR = ['1D4ED8', '0F766E', '7C3AED', 'B45309', 'BE123C', '0369A1']

type Style = Record<string, unknown>
const line = { style: 'thin', color: { rgb: '94A3B8' } }
const border = { top: line, bottom: line, left: line, right: line }

const st = (o: { bold?: boolean; sz?: number; color?: string; fill?: string; h?: 'left' | 'center' | 'right'; wrap?: boolean; border?: boolean; rot?: number; italic?: boolean } = {}): Style => ({
  font: { name: 'Calibri', sz: o.sz ?? 11, bold: !!o.bold, italic: !!o.italic, color: { rgb: o.color ?? '0F172A' } },
  alignment: { horizontal: o.h ?? 'center', vertical: 'center', wrapText: o.wrap ?? false, ...(o.rot ? { textRotation: o.rot } : {}) },
  ...(o.fill ? { fill: { patternType: 'solid', fgColor: { rgb: o.fill } } } : {}),
  ...(o.border === false ? {} : { border }),
})

interface Cell { v?: string | number; t?: 's' | 'n'; f?: string; z?: string; s?: Style; l?: { Target: string; Tooltip?: string } }

class Sheet {
  cells = new Map<string, Cell>()
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
  cols: { wch: number }[] = []
  rows: { hpt: number }[] = []
  maxR = 0
  maxC = 0

  put(r: number, c: number, v: string | number | null | undefined, s?: Style, extra: Partial<Cell> = {}) {
    this.maxR = Math.max(this.maxR, r); this.maxC = Math.max(this.maxC, c)
    const empty = v === null || v === undefined || v === ''
    const cell: Cell = { ...extra, s }
    if (!empty) { cell.v = v!; cell.t = typeof v === 'number' ? 'n' : 's' }
    else if (!extra.f) { cell.v = ''; cell.t = 's' }
    this.cells.set(`${r}:${c}`, cell)
  }
  /** Birlashtirilgan katak: barcha kataklar bir xil uslub (chegara to'liq ko'rinsin) */
  merge(r1: number, c1: number, r2: number, c2: number, v: string | number | null, s?: Style) {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) this.put(r, c, r === r1 && c === c1 ? v : '', s)
    if (r1 !== r2 || c1 !== c2) this.merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } })
  }
  height(r: number, hpt: number) { this.rows[r] = { hpt } }
  build(X: typeof import('xlsx-js-style')) {
    const ws: Record<string, unknown> = {}
    for (const [k, cell] of this.cells) {
      const [r, c] = k.split(':').map(Number)
      ws[X.utils.encode_cell({ r, c })] = cell
    }
    ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: this.maxR, c: this.maxC } })
    if (this.merges.length) ws['!merges'] = this.merges
    if (this.cols.length) ws['!cols'] = this.cols
    if (this.rows.length) ws['!rows'] = Array.from({ length: this.rows.length }, (_, i) => this.rows[i] ?? { hpt: 18 })
    ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    return ws
  }
}

function titleBlock(sh: Sheet, d: BaholarExportData, lastCol: number, mavzu: string, belgi: string) {
  const { yil } = davr(d.guruh, d.semestr)
  const text = `Shahrisabz Tibbiyot Texnikumi\n${d.guruh} guruh talabalarining ${yil} o‘quv yili ${d.semestr}-semestrida\n${mavzu}\nHISOBOTI`
  sh.merge(1, 0, 1, Math.max(lastCol - 2, 1), text, st({ bold: true, sz: 12, wrap: true, border: false }))
  sh.height(1, 78)
  sh.merge(0, Math.max(lastCol - 1, 2), 0, lastCol, belgi, st({ bold: true, sz: 10, color: '475569', h: 'right', border: false, italic: true }))
}

function imzo(sh: Sheet, r: number, d: BaholarExportData, lastCol: number) {
  sh.merge(r, 0, r, Math.max(lastCol, 3), `Guruh rahbari:  ${d.rahbar || '________'}     ____________     __________________`, st({ h: 'left', border: false, sz: 11, bold: true }))
}

const pct = (n: number, d: number) => (d ? n / d : 0)
const PCT = '0.0%'

/* ------------------------------------------------------------------ # (Reyting) va # (5 ballik) */

function jadval(d: BaholarExportData, reyting: boolean): Sheet {
  const sh = new Sheet()
  const T = BAHO_TURLARI.length
  const last = 2 + d.fanlar.length * T
  const { kurs } = davr(d.guruh, d.semestr)
  sh.merge(0, 0, 0, Math.max(last, 3), `O‘quv reja bo‘yicha belgilangan ${kurs}-kurs ${d.guruh}-guruh davomidagi fanlar bo‘yicha o‘zlashtirish ko‘rsatkichlari${reyting ? ' (REYTING, 100 ball)' : ' (5 ballik)'}`, st({ bold: true, sz: 14, color: '1E3A8A', border: false }))
  sh.height(0, 30)
  const head = st({ bold: true, color: 'FFFFFF', fill: '1E3A8A', wrap: true })
  sh.merge(2, 0, 5, 0, 'T/R', head)
  sh.merge(2, 1, 5, 1, 'Talabalarning F.I.SH', head)
  sh.merge(2, 2, 5, 2, 'O‘qigan guruhi', head)
  if (d.fanlar.length) sh.merge(2, 3, 2, last, 'Fanlar bo‘yicha baholar', st({ bold: true, color: 'FFFFFF', fill: '334155' }))
  d.fanlar.forEach((f, fi) => {
    const c0 = 3 + fi * T
    const rang = FAN_RANGLAR[fi % FAN_RANGLAR.length]
    sh.merge(3, c0, 3, c0 + T - 1, f.trim(), st({ bold: true, color: 'FFFFFF', fill: rang, wrap: true }))
    sh.merge(4, c0, 4, c0 + T - 1, `${d.semestr}-semestr`, st({ bold: true, sz: 10, color: rang, fill: 'F1F5F9' }))
    BAHO_TURLARI.forEach((t, ti) => {
      const isR = t.key === 'r_semestr'
      sh.put(5, c0 + ti, t.nazorat, st({ bold: true, sz: 9, wrap: true, color: isR ? '713F12' : '1E3A8A', fill: isR ? 'FDE68A' : 'DBEAFE' }))
    })
  })
  sh.height(3, 46); sh.height(5, 32)

  const keys5 = ['y', 'j', 'o', 'r'] as const
  const keys100 = ['y100', 'j100', 'o100', 'r100'] as const
  d.talabalar.forEach((s, i) => {
    const r = 6 + i
    const zebra = i % 2 ? 'F8FAFC' : undefined
    sh.put(r, 0, i + 1, st({ fill: zebra }))
    sh.put(r, 1, s.name, st({ h: 'left', fill: zebra }))
    sh.put(r, 2, d.guruh, st({ fill: zebra }))
    d.fanlar.forEach((f, fi) => {
      const g = d.grade(i, f)
      for (let ti = 0; ti < T; ti++) {
        const isR = ti === T - 1
        const v = reyting ? g[keys100[ti]] : g[keys5[ti]]
        const baho = v === null ? null : reyting ? bahoOf(v) : v
        sh.put(r, 3 + fi * T + ti, v, st({ bold: isR, fill: baho ? FILL5[baho] : zebra }), v !== null ? { z: reyting && isR ? '0.00' : '0' } : {})
      }
    })
    sh.height(r, 20)
  })
  // O'rtacha qator
  const fr = 6 + d.talabalar.length
  sh.merge(fr, 0, fr, 2, 'O‘rtacha', st({ bold: true, fill: 'E2E8F0', h: 'right' }))
  d.fanlar.forEach((f, fi) => {
    for (let ti = 0; ti < T; ti++) {
      const vals = d.talabalar.map((_, i) => { const g = d.grade(i, f); return reyting ? g[keys100[ti]] : g[keys5[ti]] })
      const m = mean(vals)
      sh.put(fr, 3 + fi * T + ti, m === null ? '' : Math.round(m * 100) / 100, st({ bold: true, fill: 'E2E8F0' }), m === null ? {} : { z: '0.00' })
    }
  })
  sh.height(fr, 22)
  sh.cols = [{ wch: 6 }, { wch: 38 }, { wch: 11 }, ...d.fanlar.flatMap(() => BAHO_TURLARI.map(() => ({ wch: 10.5 })))]
  return sh
}

/* ------------------------------------------------------------------ 1-shakl: qoldirilgan dars soatlari */

function shakl1(d: BaholarExportData): Sheet {
  const sh = new Sheet()
  titleBlock(sh, d, 4, 'qoldirilgan dars soatlari bo‘yicha', '1-shakl')
  const head = st({ bold: true, color: 'FFFFFF', fill: '1E3A8A', wrap: true })
  sh.merge(3, 0, 4, 0, '№', head)
  sh.merge(3, 1, 4, 1, 'Talabaning Ismi va Familiyasi', head)
  sh.merge(3, 2, 3, 4, 'Qoldirilgan dars soatlari', head)
  ;['Sababli', 'Sababsiz', 'Jami'].forEach((t, i) => sh.put(4, 2 + i, t, st({ bold: true, fill: 'DBEAFE', color: '1E3A8A' })))
  const input = (i: number) => st({ fill: 'FFFBEB' })
  d.talabalar.forEach((s, i) => {
    const r = 5 + i
    sh.put(r, 0, i + 1, st())
    sh.put(r, 1, s.name, st({ h: 'left' }))
    sh.put(r, 2, '', input(i)); sh.put(r, 3, '', input(i))
    sh.put(r, 4, '', st({ bold: true }), { f: `IF(AND(${addr(r, 2)}="",${addr(r, 3)}=""),"",N(${addr(r, 2)})+N(${addr(r, 3)}))`, t: 'n' })
  })
  const fr = 5 + d.talabalar.length
  sh.merge(fr, 0, fr, 1, 'Jami:', st({ bold: true, fill: 'E2E8F0', h: 'right' }))
  for (let c = 2; c <= 4; c++) sh.put(fr, c, '', st({ bold: true, fill: 'E2E8F0' }), { f: `SUM(${addr(5, c)}:${addr(fr - 1, c)})`, t: 'n' })
  imzo(sh, fr + 2, d, 4)
  sh.cols = [{ wch: 5.5 }, { wch: 44 }, { wch: 12 }, { wch: 12 }, { wch: 12 }]
  return sh
}

/* ------------------------------------------------------------------ 2-shakl: fanlardan o'zlashtirish */

function shakl2(d: BaholarExportData) {
  const sh = new Sheet()
  const nF = d.fanlar.length
  const last = 1 + nF + 4
  titleBlock(sh, d, last, 'fanlardan o‘zlashtirish bo‘yicha', '2-shakl')
  const head = st({ bold: true, color: 'FFFFFF', fill: '1E3A8A', wrap: true })
  sh.merge(3, 0, 4, 0, '№', head)
  sh.merge(3, 1, 4, 1, 'Talabaning Ismi va Familiyasi', head)
  if (nF) sh.merge(3, 2, 3, 1 + nF, 'Fanlar (R-semestr, 5 ballik)', head)
  d.fanlar.forEach((f, fi) => sh.put(4, 2 + fi, f.trim(), st({ bold: true, sz: 9, rot: 90, wrap: true, fill: 'DBEAFE', color: '1E3A8A' })))
  sh.merge(3, 2 + nF, 3, 5 + nF, 'Baholar soni', st({ bold: true, color: 'FFFFFF', fill: '334155' }))
  ;[5, 4, 3, 2].forEach((b, i) => sh.put(4, 2 + nF + i, b, st({ bold: true, fill: FILL5[b] })))
  sh.height(3, 24); sh.height(4, 150)
  d.talabalar.forEach((s, i) => {
    const r = 5 + i
    sh.put(r, 0, i + 1, st())
    sh.put(r, 1, s.name, st({ h: 'left' }))
    const rs = d.fanlar.map((f) => d.grade(i, f).r)
    rs.forEach((v, fi) => sh.put(r, 2 + fi, v, st({ bold: true, fill: v ? FILL5[v] : undefined })))
    ;[5, 4, 3, 2].forEach((b, bi) => sh.put(r, 2 + nF + bi, rs.filter((v) => v === b).length, st({ bold: true })))
  })
  const fr = 5 + d.talabalar.length
  ;[5, 4, 3, 2].forEach((b, bi) => {
    const r = fr + bi
    if (bi === 0) sh.merge(fr, 0, fr + 3, 0, 'Jami:', st({ bold: true, fill: 'E2E8F0' }))
    sh.put(r, 1, b, st({ bold: true, fill: FILL5[b] }))
    d.fanlar.forEach((f, fi) => sh.put(r, 2 + fi, d.talabalar.filter((_, i) => d.grade(i, f).r === b).length, st({ bold: true, fill: 'F1F5F9' })))
  })
  imzo(sh, fr + 5, d, last)
  sh.cols = [{ wch: 5 }, { wch: 40 }, ...d.fanlar.map(() => ({ wch: 6.5 })), { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }]
  return sh
}

/* ------------------------------------------------------------------ fan bo'yicha statistika (3-shakl va fan hisoboti uchun) */

function stat(d: BaholarExportData, fan: string) {
  const r = d.talabalar.map((_, i) => d.grade(i, fan).r).filter((v): v is number => v !== null)
  const n = r.length
  const c = (b: number) => r.filter((v) => v === b).length
  return { n, c5: c(5), c4: c(4), c3: c(3), c2: c(2), oz: pct(c(5) + c(4) + c(3), n), sifat: pct(c(5) + c(4), n) }
}

/* ------------------------------------------------------------------ 3-shakl: semestr natijalari (fanlar kesimida) */

function shakl3(d: BaholarExportData) {
  const sh = new Sheet()
  titleBlock(sh, d, 15, 'semestr natijalari', '3-shakl')
  const head = st({ bold: true, color: 'FFFFFF', fill: '1E3A8A', wrap: true })
  const sub = st({ bold: true, fill: 'DBEAFE', color: '1E3A8A' })
  sh.merge(3, 0, 4, 0, '№', head)
  sh.merge(3, 1, 4, 1, 'Fanlar nomi', head)
  sh.merge(3, 2, 4, 2, 'O‘quvchi soni', head)
  ;[5, 4, 3, 2].forEach((b, i) => {
    sh.merge(3, 3 + i * 2, 3, 4 + i * 2, `“${b}”`, st({ bold: true, fill: FILL5[b] }))
    sh.put(4, 3 + i * 2, 'Soni', sub); sh.put(4, 4 + i * 2, '%', sub)
  })
  sh.merge(3, 11, 4, 11, 'O‘zlashtirish %', head)
  sh.merge(3, 12, 4, 12, 'Sifatli o‘zlashtirish %', head)
  sh.merge(3, 13, 3, 15, 'Davomat', head)
  sh.put(4, 13, 'Qoldirgan dars soati', st({ bold: true, fill: 'DBEAFE', color: '1E3A8A', wrap: true, sz: 9 }))
  sh.put(4, 14, 'Fan dars soati', st({ bold: true, fill: 'DBEAFE', color: '1E3A8A', wrap: true, sz: 9 }))
  sh.put(4, 15, '%', sub)
  sh.height(3, 30); sh.height(4, 34)
  const input = st({ fill: 'FFFBEB' })
  d.fanlar.forEach((f, i) => {
    const r = 5 + i
    const s = stat(d, f)
    sh.put(r, 0, i + 1, st())
    sh.put(r, 1, f.trim(), st({ h: 'left', wrap: true }))
    sh.put(r, 2, s.n, st({ bold: true }))
    ;[s.c5, s.c4, s.c3, s.c2].forEach((cnt, bi) => {
      sh.put(r, 3 + bi * 2, cnt, st())
      sh.put(r, 4 + bi * 2, pct(cnt, s.n), st({ color: '475569' }), { z: PCT })
    })
    sh.put(r, 11, s.oz, st({ bold: true, fill: 'DCFCE7' }), { z: PCT })
    sh.put(r, 12, s.sifat, st({ bold: true, fill: 'DBEAFE' }), { z: PCT })
    sh.put(r, 13, '', input); sh.put(r, 14, '', input)
    sh.put(r, 15, '', st(), { f: `IF(OR(${addr(r, 13)}="",${addr(r, 14)}=""),"",(${addr(r, 14)}*${addr(r, 2)}-${addr(r, 13)})/(${addr(r, 14)}*${addr(r, 2)}))`, t: 'n', z: PCT })
  })
  const fr = 5 + d.fanlar.length
  const first = 5, lastR = fr - 1
  sh.merge(fr, 0, fr, 1, 'O‘rtacha / jami', st({ bold: true, fill: 'E2E8F0', h: 'right' }))
  for (let c = 2; c <= 15; c++) sh.put(fr, c, '', st({ bold: true, fill: 'E2E8F0' }))
  if (d.fanlar.length) {
    const stats = d.fanlar.map((f) => stat(d, f))
    sh.put(fr, 11, mean(stats.map((s) => s.oz)) ?? 0, st({ bold: true, fill: 'E2E8F0' }), { z: PCT })
    sh.put(fr, 12, mean(stats.map((s) => s.sifat)) ?? 0, st({ bold: true, fill: 'E2E8F0' }), { z: PCT })
    sh.put(fr, 13, '', st({ bold: true, fill: 'E2E8F0' }), { f: `IF(COUNT(${addr(first, 13)}:${addr(lastR, 13)})=0,"",SUM(${addr(first, 13)}:${addr(lastR, 13)}))`, t: 'n' })
    sh.put(fr, 14, '', st({ bold: true, fill: 'E2E8F0' }), { f: `IF(COUNT(${addr(first, 14)}:${addr(lastR, 14)})=0,"",SUM(${addr(first, 14)}:${addr(lastR, 14)}))`, t: 'n' })
    sh.put(fr, 15, '', st({ bold: true, fill: 'E2E8F0' }), { f: `IF(OR(${addr(fr, 13)}="",${addr(fr, 14)}=""),"",1-${addr(fr, 13)}/(${addr(fr, 14)}*${d.talabalar.length}))`, t: 'n', z: PCT })
  }
  imzo(sh, fr + 2, d, 15)
  sh.cols = [{ wch: 5 }, { wch: 44 }, { wch: 9 }, ...[0, 1, 2, 3].flatMap(() => [{ wch: 7 }, { wch: 8 }]), { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 9 }]
  return { sh, footerRow: fr }
}

/* ------------------------------------------------------------------ 4-shakl: guruh bo'yicha natija */

const KATEGORIYALAR = ['5', '5-4', '4', '5-4-3', '4-3', '3', '2'] as const

function kategoriya(r: number[]): (typeof KATEGORIYALAR)[number] | null {
  if (!r.length) return null
  if (r.includes(2)) return '2'
  const s = new Set(r)
  if (s.size === 1) return String([...s][0]) as '5' | '4' | '3'
  if (s.has(5) && !s.has(3)) return '5-4'
  if (!s.has(5)) return '4-3'
  return '5-4-3'
}

function shakl4(d: BaholarExportData, fr3: number) {
  const sh = new Sheet()
  titleBlock(sh, d, 20, 'semestr natijalari', '4-shakl')
  const head = st({ bold: true, color: 'FFFFFF', fill: '1E3A8A', wrap: true })
  const sub = st({ bold: true, fill: 'DBEAFE', color: '1E3A8A' })
  sh.merge(3, 0, 4, 0, '№', head)
  sh.merge(3, 1, 4, 1, 'Guruh raqami', head)
  sh.merge(3, 2, 4, 2, 'O‘quvchi soni', head)
  KATEGORIYALAR.forEach((k, i) => {
    sh.merge(3, 3 + i * 2, 3, 4 + i * 2, `“${k}”`, st({ bold: true, fill: k === '2' ? FILL5[2] : k === '3' ? FILL5[3] : k.startsWith('5') ? FILL5[5] : FILL5[4] }))
    sh.put(4, 3 + i * 2, 'Soni', sub); sh.put(4, 4 + i * 2, '%', sub)
  })
  sh.merge(3, 17, 4, 17, 'O‘zlashtirish %', head)
  sh.merge(3, 18, 4, 18, 'Sifatli o‘zlashtirish %', head)
  sh.merge(3, 19, 3, 20, 'Davomat', head)
  sh.put(4, 19, 'Qoldirgan dars soati', st({ bold: true, fill: 'DBEAFE', color: '1E3A8A', wrap: true, sz: 9 }))
  sh.put(4, 20, '%', sub)
  sh.height(3, 28); sh.height(4, 34)
  const cnt: Record<string, number> = Object.fromEntries(KATEGORIYALAR.map((k) => [k, 0]))
  let jami = 0
  d.talabalar.forEach((_, i) => {
    const k = kategoriya(d.fanlar.map((f) => d.grade(i, f).r).filter((v): v is number => v !== null))
    if (k) { cnt[k]++; jami++ }
  })
  const n = jami // foizlar faqat bahosi bor talabalar bo'yicha
  const r = 5
  sh.put(r, 0, 1, st({ bold: true }))
  sh.put(r, 1, d.guruh, st({ bold: true }))
  sh.put(r, 2, n, st({ bold: true }))
  KATEGORIYALAR.forEach((k, i) => {
    sh.put(r, 3 + i * 2, cnt[k], st({ bold: true }))
    sh.put(r, 4 + i * 2, pct(cnt[k], n), st({ color: '475569' }), { z: PCT })
  })
  sh.put(r, 17, pct(jami - cnt['2'], n), st({ bold: true, fill: 'DCFCE7' }), { z: PCT })
  sh.put(r, 18, pct(cnt['5'] + cnt['5-4'] + cnt['4'], n), st({ bold: true, fill: 'DBEAFE' }), { z: PCT })
  sh.put(r, 19, '', st(), { f: `IF('3-shakl'!${addr(fr3, 13)}="","",'3-shakl'!${addr(fr3, 13)})`, t: 'n' })
  sh.put(r, 20, '', st(), { f: `IF('3-shakl'!${addr(fr3, 15)}="","",'3-shakl'!${addr(fr3, 15)})`, t: 'n', z: PCT })
  sh.height(r, 26)
  sh.merge(7, 0, 7, 12, `Izoh: talaba toifasi uning barcha fanlardagi R-semestr baholariga qarab aniqlanadi. Hisobga olingan talabalar: ${jami}/${d.talabalar.length} (bahosi yo‘qlar hisobga olinmaydi).`, st({ h: 'left', border: false, italic: true, sz: 10, color: '475569' }))
  imzo(sh, 9, d, 12)
  sh.cols = [{ wch: 5 }, { wch: 12 }, { wch: 10 }, ...KATEGORIYALAR.flatMap(() => [{ wch: 7 }, { wch: 8 }]), { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 9 }]
  return sh
}

/* ------------------------------------------------------------------ har bir fan bo'yicha hisobot */

function fanHisobot(d: BaholarExportData, fan: string): Sheet {
  const sh = new Sheet()
  const { yil } = davr(d.guruh, d.semestr)
  sh.merge(0, 0, 0, 9, `${fan.trim()} — ${d.guruh} guruh, ${yil} o‘quv yili, ${d.semestr}-semestr qaydnomasi`, st({ bold: true, sz: 14, color: '1E3A8A', border: false }))
  sh.height(0, 30)
  sh.merge(1, 0, 1, 1, '← Mundarija', st({ h: 'left', border: false, sz: 10, color: '2563EB', bold: true }))
  sh.cells.get('1:0')!.l = { Target: "#'Mundarija'!A1", Tooltip: 'Fanlar ro‘yxatiga qaytish' }
  const head = st({ bold: true, color: 'FFFFFF', fill: '1E3A8A', wrap: true })
  sh.merge(2, 0, 3, 0, '№', head)
  sh.merge(2, 1, 3, 1, 'Talabaning F.I.SH', head)
  sh.merge(2, 2, 2, 5, '5 ballik baholar', st({ bold: true, color: 'FFFFFF', fill: '0F766E' }))
  sh.merge(2, 6, 2, 9, 'Reyting (100 ball)', st({ bold: true, color: 'FFFFFF', fill: '7C3AED' }))
  ;[0, 1].forEach((blk) => BAHO_TURLARI.forEach((t, ti) => {
    const isR = t.key === 'r_semestr'
    sh.put(3, 2 + blk * 4 + ti, t.nazorat, st({ bold: true, sz: 9, wrap: true, fill: isR ? 'FDE68A' : 'DBEAFE', color: isR ? '713F12' : '1E3A8A' }))
  }))
  sh.height(3, 30)
  const k5 = ['y', 'j', 'o', 'r'] as const
  const k100 = ['y100', 'j100', 'o100', 'r100'] as const
  d.talabalar.forEach((s, i) => {
    const r = 4 + i
    const g = d.grade(i, fan)
    sh.put(r, 0, i + 1, st())
    sh.put(r, 1, s.name, st({ h: 'left' }))
    k5.forEach((k, ti) => sh.put(r, 2 + ti, g[k], st({ bold: ti === 3, fill: g[k] ? FILL5[g[k]!] : undefined })))
    k100.forEach((k, ti) => sh.put(r, 6 + ti, g[k], st({ bold: ti === 3, fill: g[k] ? FILL5[bahoOf(g[k]!)] : undefined }), g[k] !== null ? { z: ti === 3 ? '0.00' : '0' } : {}))
  })
  // Xulosa
  const s = stat(d, fan)
  const fr = 5 + d.talabalar.length
  sh.merge(fr, 1, fr, 4, 'Xulosa (R-semestr bo‘yicha)', st({ bold: true, fill: '334155', color: 'FFFFFF' }))
  sh.put(fr, 5, 'Soni', st({ bold: true, fill: 'DBEAFE', color: '1E3A8A' })); sh.put(fr, 6, '%', st({ bold: true, fill: 'DBEAFE', color: '1E3A8A' }))
  ;([[5, s.c5], [4, s.c4], [3, s.c3], [2, s.c2]] as const).forEach(([b, c], i) => {
    const r = fr + 1 + i
    sh.merge(r, 1, r, 4, `“${b}” baho`, st({ bold: true, fill: FILL5[b], h: 'left' }))
    sh.put(r, 5, c, st({ bold: true })); sh.put(r, 6, pct(c, s.n), st(), { z: PCT })
  })
  const extra: [string, number | string, string?][] = [
    ['O‘zlashtirish %', s.oz, PCT], ['Sifatli o‘zlashtirish %', s.sifat, PCT],
    ['O‘rtacha baho (R-semestr)', mean(d.talabalar.map((_, i) => d.grade(i, fan).r)) ?? '', '0.00'],
    ['O‘rtacha reyting (R-semestr)', mean(d.talabalar.map((_, i) => d.grade(i, fan).r100)) ?? '', '0.00'],
  ]
  extra.forEach(([t, v, z], i) => {
    const r = fr + 5 + i
    sh.merge(r, 1, r, 4, t, st({ bold: true, fill: 'F1F5F9', h: 'left' }))
    sh.put(r, 5, v, st({ bold: true, fill: 'DCFCE7' }), v === '' ? {} : { z })
    sh.put(r, 6, '', st())
  })
  imzo(sh, fr + 11, d, 9)
  sh.cols = [{ wch: 5 }, { wch: 38 }, ...Array(8).fill({ wch: 10 })]
  return sh
}

/* ------------------------------------------------------------------ malakaviy amaliyot */

function amaliyotSheet(d: BaholarExportData): Sheet {
  const sh = new Sheet()
  const { yil } = davr(d.guruh, d.semestr)
  sh.merge(0, 0, 0, 8, `Malakaviy amaliyot — ${d.guruh} guruh, ${yil} o‘quv yili, ${d.semestr}-semestr`, st({ bold: true, sz: 14, color: '1E3A8A', border: false }))
  sh.height(0, 30)
  const head = st({ bold: true, color: 'FFFFFF', fill: '1E3A8A', wrap: true })
  ;['№', 'Talabaning F.I.SH', 'Amaliyot', 'Amaliyot joyi', 'Boshlanish', 'Tugash', 'Baho (5 ballik)', 'Reyting (100 ball)', 'Izoh'].forEach((t, c) => sh.put(2, c, t, head))
  sh.height(2, 32)
  d.amaliyot.forEach((a, i) => {
    const r = 3 + i
    const z = i % 2 ? 'F8FAFC' : undefined
    sh.put(r, 0, i + 1, st({ fill: z }))
    sh.put(r, 1, a.name, st({ h: 'left', fill: z }))
    sh.put(r, 2, a.nom, st({ h: 'left', fill: z, wrap: true }))
    sh.put(r, 3, a.joy, st({ h: 'left', fill: z, wrap: true }))
    sh.put(r, 4, sanaUz(a.boshlanish), st({ fill: z }))
    sh.put(r, 5, sanaUz(a.tugash), st({ fill: z }))
    sh.put(r, 6, a.ball, st({ bold: true, fill: a.ball ? FILL5[a.ball] : z }))
    sh.put(r, 7, a.ball100, st({ bold: true, fill: a.ball100 ? FILL5[bahoOf(a.ball100)] : z }), a.ball100 !== null ? { z: '0' } : {})
    sh.put(r, 8, a.izoh, st({ h: 'left', fill: z, wrap: true }))
    sh.height(r, 20)
  })
  sh.cols = [{ wch: 5 }, { wch: 38 }, { wch: 24 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 30 }]
  return sh
}

/* ------------------------------------------------------------------ mundarija (qaydnomalar fayli) */

function mundarija(d: BaholarExportData, varaqlar: string[]): Sheet {
  const sh = new Sheet()
  const { yil, kurs } = davr(d.guruh, d.semestr)
  sh.merge(0, 0, 0, 6, `${d.guruh} guruh · ${kurs}-kurs · ${yil} o‘quv yili · ${d.semestr}-semestr\nFANLAR BO‘YICHA QAYDNOMALAR — MUNDARIJA`, st({ bold: true, sz: 13, color: '1E3A8A', border: false, wrap: true }))
  sh.height(0, 44)
  const head = st({ bold: true, color: 'FFFFFF', fill: '1E3A8A', wrap: true })
  ;['№', 'Fan nomi (bosing — qaydnomaga o‘tadi)', 'Talabalar', 'Baholangan', 'O‘zlashtirish %', 'Sifatli o‘zlashtirish %', 'O‘rtacha baho'].forEach((t, c) => sh.put(2, c, t, head))
  sh.height(2, 32)
  d.fanlar.forEach((f, i) => {
    const r = 3 + i
    const s = stat(d, f)
    const z = i % 2 ? 'F8FAFC' : undefined
    sh.put(r, 0, i + 1, st({ fill: z }))
    sh.put(r, 1, f.trim(), st({ h: 'left', fill: z, color: '2563EB', bold: true, wrap: true }), { l: { Target: `#'${varaqlar[i].replace(/'/g, "''")}'!A1`, Tooltip: `${f.trim()} qaydnomasi` } })
    sh.put(r, 2, d.talabalar.length, st({ fill: z }))
    sh.put(r, 3, s.n, st({ fill: z }))
    sh.put(r, 4, s.n ? s.oz : '', st({ fill: z }), s.n ? { z: PCT } : {})
    sh.put(r, 5, s.n ? s.sifat : '', st({ fill: z }), s.n ? { z: PCT } : {})
    const m = mean(d.talabalar.map((_, ti) => d.grade(ti, f).r))
    sh.put(r, 6, m === null ? '' : Math.round(m * 100) / 100, st({ bold: true, fill: z }), m === null ? {} : { z: '0.00' })
    sh.height(r, 22)
  })
  sh.merge(4 + d.fanlar.length, 0, 4 + d.fanlar.length, 6, `Jami: ${d.fanlar.length} ta fan. Har bir fan alohida varaqda; varaq yuqorisidagi “← Mundarija” shu sahifaga qaytaradi.`, st({ h: 'left', border: false, italic: true, sz: 10, color: '475569' }))
  sh.cols = [{ wch: 5 }, { wch: 54 }, { wch: 11 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 13 }]
  return sh
}

/* ------------------------------------------------------------------ asosiy */

/** Excel varaq nomi: 31 belgigacha, [ ] : * ? / \ siz, takrorlanmas */
function varaqNomi(nom: string, band: Set<string>): string {
  const base = nom.replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Fan'
  let t = base, k = 2
  while (band.has(t.toLowerCase())) { const suf = ` (${k++})`; t = base.slice(0, 31 - suf.length) + suf }
  band.add(t.toLowerCase())
  return t
}

async function yozish(d: BaholarExportData, fileName: string, fill: (add: (sh: Sheet, name: string, tab?: string) => string) => [number, number, number][]) {
  const X = await import('xlsx-js-style')
  const wb = X.utils.book_new()
  const used = new Set<string>()
  const add = (sh: Sheet, name: string, tab?: string) => {
    const ws = sh.build(X) as Record<string, unknown>
    if (tab) ws['!tabColor'] = { rgb: tab }
    const nom = varaqNomi(name, used)
    X.utils.book_append_sheet(wb, ws as never, nom)
    return nom
  }
  const freezes = fill(add)
  const raw = X.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true, bookSST: false })
  downloadBlob(cleanXlsxBuffer(patchXlsx(raw as ArrayBuffer, freezes)), fileName)
}

const fileStem = (d: BaholarExportData) => `${d.guruh}. ${d.semestr}-s`

/** Baza uchun: 1) reyting (100 ball), 2) 5 ballik, 3) malakaviy amaliyot */
export function exportBaza(d: BaholarExportData) {
  return yozish(d, baholarFileName(d), (add) => {
    add(jadval(d, true), '# (Reyting)', '7C3AED')
    add(jadval(d, false), '#', '0F766E')
    add(amaliyotSheet(d), 'Malakaviy amaliyot', 'BE123C')
    return [[1, 3, 6], [2, 3, 6], [3, 2, 3]]
  })
}

/** Har bir fan qaydnomasi alohida varaqda, birinchi varaq — mundarija */
export function exportQaydnomalar(d: BaholarExportData) {
  const nomi = d.fanlar.length === 1 ? `${fileStem(d)} ${d.fanlar[0].trim().slice(0, 60)} QAYDNOMA.xlsx` : `${fileStem(d)} QAYDNOMALAR.xlsx`
  return yozish(d, nomi.replace(/[\\/:*?"<>|]/g, ' '), (add) => {
    // Varaq nomlari oldindan aniqlanadi — mundarijadagi havolalar ularga ishora qiladi
    const band = new Set<string>(['mundarija'])
    const varaqlar = d.fanlar.map((f, i) => varaqNomi(`${i + 1}. ${f.trim()}`, band))
    add(mundarija(d, varaqlar), 'Mundarija', '1E3A8A')
    d.fanlar.forEach((f, i) => add(fanHisobot(d, f), varaqlar[i], 'B45309'))
    return d.fanlar.map((_, i): [number, number, number] => [i + 2, 2, 4])
  })
}

/** 1–4-shakl hisobotlari */
export function exportHisobot(d: BaholarExportData) {
  return yozish(d, `${fileStem(d)} HISOBOT (1-4 shakl).xlsx`, (add) => {
    add(shakl1(d), '1-SHAKL', '1D4ED8')
    add(shakl2(d), '2-SHAKL', '1D4ED8')
    const s3 = shakl3(d)
    add(s3.sh, '3-shakl', '1D4ED8')
    add(shakl4(d, s3.footerRow), '4-shakl', '1D4ED8')
    return [[2, 2, 5]]
  })
}

/**
 * xlsx-js-style ikkita narsani yozmaydi: ustun/qator qotirish va "ochilganda qayta hisoblash".
 * Shuning uchun tayyor fayl ichidagi XML ga qo'lda qo'shiladi.
 */
function patchXlsx(raw: ArrayBuffer | Uint8Array, freezes: [number, number, number][]): Uint8Array {
  const z = unzipSync(new Uint8Array(raw))
  const edit = (path: string, fn: (xml: string) => string) => { if (z[path]) z[path] = strToU8(fn(strFromU8(z[path]))) }
  const freeze = (idx: number, x: number, y: number) => edit(`xl/worksheets/sheet${idx}.xml`, (xml) =>
    xml.replace('<sheetView workbookViewId="0"/>',
      `<sheetView workbookViewId="0"><pane xSplit="${x}" ySplit="${y}" topLeftCell="${letter(x)}${y + 1}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight"/></sheetView>`))
  for (const [idx, x, y] of freezes) freeze(idx, x, y)
  edit('xl/workbook.xml', (xml) => (xml.includes('<calcPr') ? xml : xml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>')))
  return zipSync(z)
}
