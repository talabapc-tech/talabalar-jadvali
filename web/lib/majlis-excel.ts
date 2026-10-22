'use client'

import { cleanXlsxBuffer, downloadBlob } from './excel'
import {
  HOLAT_META, TUR_TOLIQ, TURLAR, byFish, haftaKuni, hisobla, majlisOqituvchilari, sanaUz,
  type Holat, type Majlis, type Oqituvchi, type OqituvchiTur,
} from './majlis'

/*
  Majlis davomati Excel fayllari — asosiy va o'rindosh o'qituvchilar ALOHIDA sahifada:
   - bitta majlis: №, F.I.Sh., holati, izoh, imzo + yakuniy hisob;
   - davr hisoboti: o'qituvchilar × majlislar jadvali (+, S, −) va jami ustunlar.
*/

type X = typeof import('xlsx-js-style')
const loadXlsx = () => import('xlsx-js-style') as Promise<X>

const MUASSASA = 'Shahrisabz Tibbiyot Texnikumi'
const FONT = 'Times New Roman'
const thin = { style: 'thin', color: { rgb: '94A3B8' } }
const border = { top: thin, bottom: thin, left: thin, right: thin }
const HOLAT_FILL: Record<Holat, string> = { keldi: 'D1FAE5', sababli: 'E0F2FE', kelmadi: 'FFE4E6' }

const st = (o: { bold?: boolean; sz?: number; fill?: string; h?: 'left' | 'center'; wrap?: boolean; border?: boolean } = {}) => ({
  font: { name: FONT, sz: o.sz ?? 12, bold: !!o.bold },
  alignment: { horizontal: o.h ?? 'left', vertical: 'center', wrapText: o.wrap ?? true },
  ...(o.fill ? { fill: { patternType: 'solid', fgColor: { rgb: o.fill } } } : {}),
  ...(o.border ? { border } : {}),
})

type Cell = { v: string | number; s: ReturnType<typeof st> }
const c = (v: string | number, s = st()): Cell => ({ v, s })

function sheetFrom(XL: X, rows: (Cell | null)[][], widths: number[], merges: [number, number, number, number][]) {
  const ws: Record<string, unknown> = {}
  let maxC = 0
  rows.forEach((row, r) => row.forEach((cell, ci) => {
    if (!cell) return
    maxC = Math.max(maxC, ci)
    ws[XL.utils.encode_cell({ r, c: ci })] = { t: typeof cell.v === 'number' ? 'n' : 's', v: cell.v, s: cell.s }
  }))
  ws['!ref'] = XL.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: Math.max(maxC, widths.length - 1) } })
  ws['!cols'] = widths.map((wch) => ({ wch }))
  ws['!merges'] = merges.map(([r1, c1, r2, c2]) => ({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }))
  return ws
}

function finish(XL: X, wb: unknown): Uint8Array {
  const raw = XL.write(wb as never, { bookType: 'xlsx', type: 'array', cellStyles: true, bookSST: false })
  return cleanXlsxBuffer(raw)
}

const safeFile = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()

/* ------------------------------------------------------------ bitta majlis */

function majlisSheet(XL: X, m: Majlis, list: Oqituvchi[], tur: OqituvchiTur) {
  const W = 5
  const rows: (Cell | null)[][] = [
    [c(MUASSASA, st({ bold: true, sz: 13, h: 'center' }))],
    [c(`Majlis davomati — ${TUR_TOLIQ[tur]}`, st({ bold: true, sz: 14, h: 'center' }))],
    [c(`Sana: ${sanaUz(m.sana)} (${haftaKuni(m.sana)})${m.vaqt ? `, soat ${m.vaqt}` : ''}`)],
    [c(`Mavzu: ${m.mavzu || '—'}`)],
    [],
    ['№', "O'qituvchining F.I.Sh.", 'Holati', 'Izoh / sabab', 'Imzo'].map((h) => c(h, st({ bold: true, h: 'center', fill: 'E2E8F0', border: true }))),
  ]
  list.forEach((o, i) => {
    const h = m.davomat[o.id]
    rows.push([
      c(i + 1, st({ h: 'center', border: true })),
      c(o.fish, st({ border: true })),
      c(h ? HOLAT_META[h].nomi : '', st({ h: 'center', border: true, bold: h === 'kelmadi', fill: h ? HOLAT_FILL[h] : undefined })),
      c(m.izoh[o.id] || '', st({ border: true })),
      c('', st({ border: true })),
    ])
  })
  const s = hisobla(list, m.davomat)
  rows.push([])
  rows.push([c(`Jami: ${s.jami} nafar. Keldi: ${s.keldi}, sababli: ${s.sababli}, kelmadi: ${s.kelmadi}` +
    (s.belgilanmagan ? `, belgilanmagan: ${s.belgilanmagan}` : '') + `. Kelganlar: ${s.foiz}%`, st({ bold: true }))])
  rows.push([])
  rows.push([c("Mas'ul: ____________________", st()), null, null, c('Imzo: __________', st())])
  const merges: [number, number, number, number][] = [[0, 0, 0, W - 1], [1, 0, 1, W - 1], [2, 0, 2, W - 1], [3, 0, 3, W - 1], [rows.length - 3, 0, rows.length - 3, W - 1]]
  return sheetFrom(XL, rows, [5, 38, 13, 30, 14], merges)
}

export async function majlisWorkbook(m: Majlis, oqituvchilar: Oqituvchi[]) {
  const XL = await loadXlsx()
  const wb = XL.utils.book_new()
  for (const tur of TURLAR) {
    const list = majlisOqituvchilari(m, oqituvchilar, tur)
    if (list.length) XL.utils.book_append_sheet(wb, majlisSheet(XL, m, list, tur), tur === 'asosiy' ? 'Asosiy' : 'Orindosh')
  }
  if (!wb.SheetNames.length) throw new Error("Majlisda o'qituvchi yo'q")
  return { data: finish(XL, wb), fileName: safeFile(`Majlis davomati ${sanaUz(m.sana)}${m.vaqt ? ` ${m.vaqt.replace(':', '-')}` : ''}.xlsx`) }
}

/* ------------------------------------------------------------ davr hisoboti */

function hisobotSheet(XL: X, majlislar: Majlis[], oqituvchilar: Oqituvchi[], tur: OqituvchiTur, davr: string) {
  const byId = new Map(oqituvchilar.map((o) => [o.id, o]))
  const ids = new Set(majlislar.flatMap((m) => m.tarkib))
  const list = [...ids].map((id) => byId.get(id)).filter((o): o is Oqituvchi => !!o && o.tur === tur).sort(byFish)
  if (!list.length) return null
  const ms = [...majlislar].sort((a, b) => (a.sana + a.vaqt).localeCompare(b.sana + b.vaqt))
  const totals = ['Keldi', 'Sababli', 'Kelmadi', 'Kelgan %']
  const W = 2 + ms.length + totals.length
  const head = st({ bold: true, h: 'center', fill: 'E2E8F0', border: true, sz: 11 })
  const rows: (Cell | null)[][] = [
    [c(MUASSASA, st({ bold: true, sz: 13, h: 'center' }))],
    [c(`Majlislar davomati — ${TUR_TOLIQ[tur]}`, st({ bold: true, sz: 14, h: 'center' }))],
    [c(`Davr: ${davr}. Majlislar soni: ${ms.length}`, st({ h: 'center' }))],
    [],
    [c('№', head), c("O'qituvchining F.I.Sh.", head), ...ms.map((m) => c(`${sanaUz(m.sana).slice(0, 5)}${m.vaqt ? `\n${m.vaqt}` : ''}`, head)), ...totals.map((t) => c(t, head))],
  ]
  list.forEach((o, i) => {
    const cnt = { keldi: 0, sababli: 0, kelmadi: 0 }
    const cells = ms.map((m) => {
      if (!m.tarkib.includes(o.id)) return c('', st({ border: true, fill: 'F1F5F9' }))
      const h = m.davomat[o.id]
      if (h) cnt[h]++
      return c(h ? HOLAT_META[h].belgi : '', st({ h: 'center', border: true, bold: true, fill: h ? HOLAT_FILL[h] : undefined }))
    })
    const marked = cnt.keldi + cnt.sababli + cnt.kelmadi
    rows.push([
      c(i + 1, st({ h: 'center', border: true })),
      c(o.fish + (o.faol ? '' : ' (ketgan)'), st({ border: true })),
      ...cells,
      ...[cnt.keldi, cnt.sababli, cnt.kelmadi].map((n) => c(n, st({ h: 'center', border: true }))),
      c(marked ? Math.round((cnt.keldi / marked) * 100) : 0, st({ h: 'center', border: true, bold: true })),
    ])
  })
  rows.push([])
  rows.push([c(`Belgilar: + keldi, S sababli, − kelmadi; kulrang — majlisga chaqirilmagan.`, st({ sz: 10 }))])
  const merges: [number, number, number, number][] = [[0, 0, 0, W - 1], [1, 0, 1, W - 1], [2, 0, 2, W - 1], [rows.length - 1, 0, rows.length - 1, W - 1]]
  return sheetFrom(XL, rows, [5, 36, ...ms.map(() => 7), 9, 9, 9, 10], merges)
}

function royxatSheet(XL: X, majlislar: Majlis[], oqituvchilar: Oqituvchi[]) {
  const head = st({ bold: true, h: 'center', fill: 'E2E8F0', border: true, sz: 11 })
  const rows: (Cell | null)[][] = [
    ['№', 'Sana', 'Kun', 'Soat', 'Mavzu', 'Asosiy (keldi/jami)', "O'rindosh (keldi/jami)"].map((h) => c(h, head)),
  ]
  const ms = [...majlislar].sort((a, b) => (a.sana + a.vaqt).localeCompare(b.sana + b.vaqt))
  ms.forEach((m, i) => {
    const part = (tur: OqituvchiTur) => {
      const s = hisobla(majlisOqituvchilari(m, oqituvchilar, tur), m.davomat)
      return s.jami ? `${s.keldi}/${s.jami}` : '—'
    }
    const b = st({ border: true, h: 'center' })
    rows.push([c(i + 1, b), c(sanaUz(m.sana), b), c(haftaKuni(m.sana), b), c(m.vaqt, b), c(m.mavzu, st({ border: true })), c(part('asosiy'), b), c(part('orindosh'), b)])
  })
  return sheetFrom(XL, rows, [5, 12, 12, 8, 44, 22, 24], [])
}

export async function hisobotWorkbook(majlislar: Majlis[], oqituvchilar: Oqituvchi[], davr: string) {
  if (!majlislar.length) throw new Error("Tanlangan davrda majlis yo'q")
  const XL = await loadXlsx()
  const wb = XL.utils.book_new()
  for (const tur of TURLAR) {
    const ws = hisobotSheet(XL, majlislar, oqituvchilar, tur, davr)
    if (ws) XL.utils.book_append_sheet(wb, ws, tur === 'asosiy' ? 'Asosiy' : 'Orindosh')
  }
  XL.utils.book_append_sheet(wb, royxatSheet(XL, majlislar, oqituvchilar), 'Majlislar')
  return { data: finish(XL, wb), fileName: safeFile(`Majlislar davomati ${davr}.xlsx`) }
}

export function saveXlsx(file: { data: Uint8Array; fileName: string }) {
  downloadBlob(file.data, file.fileName)
}
