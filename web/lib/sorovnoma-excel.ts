'use client'

import { downloadBlob } from './excel'
import { groupOrder, loadXlsx, safeSheetName, workbookBytes, type XLSXModule } from './excel-build'
import { AUDIENCE_META, formatAnswerDisplay, type QuestionType, type Survey, type SurveyResponseRow } from './sorovnoma'

const FORCE_TEXT_TYPES = new Set<QuestionType>(['phone', 'pinfl', 'passport', 'card', 'date', 'group'])

function thinBorder(rgb = 'CBD5E1') {
  const s = { style: 'thin' as const, color: { rgb } }
  return { top: s, bottom: s, left: s, right: s }
}

function fmtDateTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function estimateRowHeight(values: string[], widths: number[]): number {
  let maxLines = 1
  values.forEach((v, i) => {
    const s = String(v ?? '')
    if (!s) return
    const w = Math.max(8, widths[i] ?? 18)
    let lines = 0
    for (const part of s.split('\n')) {
      lines += Math.max(1, Math.ceil(part.length / (w - 2)))
    }
    if (lines > maxLines) maxLines = lines
  })
  return Math.max(20, Math.min(110, maxLines * 15 + 6))
}

function styleSimpleSheet(
  X: XLSXModule,
  rows: (string | number)[][],
  opts: {
    title: string
    subtitle: string
    headers: string[]
    colWidths: number[]
    centerCols?: Set<number>
    forceTextCols?: Set<number>
    freezeCols?: number
    hasTotalRow?: boolean
  },
) {
  const aoa: (string | number)[][] = [
    [opts.title],
    [opts.subtitle],
    opts.headers,
    ...rows,
  ]
  const ws = X.utils.aoa_to_sheet(aoa)
  const lastCol = Math.max(0, opts.headers.length - 1)
  const lastRow = aoa.length - 1

  ws['!cols'] = opts.colWidths.map((wch) => ({ wch }))
  ws['!rows'] = aoa.map((row, r) => {
    if (r === 0) return { hpt: 28 }
    if (r === 1) return { hpt: 22 }
    if (r === 2) return { hpt: 30 }
    return { hpt: estimateRowHeight(row.map(String), opts.colWidths) }
  })

  const headerBorder = thinBorder('1E3A8A')
  const cellBorder = thinBorder('CBD5E1')

  for (let r = 0; r <= lastRow; r++) {
    const isTotal = opts.hasTotalRow && r === lastRow && rows.length > 0
    for (let c = 0; c <= lastCol; c++) {
      const addr = X.utils.encode_cell({ r, c })
      if (!ws[addr]) ws[addr] = { t: 's', v: '' }
      const cell = ws[addr]

      if (r === 0) {
        cell.s = {
          font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 13, name: 'Calibri' },
          fill: { fgColor: { rgb: '0F172A' }, patternType: 'solid' },
          alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
        }
      } else if (r === 1) {
        cell.s = {
          font: { italic: true, color: { rgb: '1E3A8A' }, sz: 10.5, name: 'Calibri' },
          fill: { fgColor: { rgb: 'EBF3FA' }, patternType: 'solid' },
          alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
          border: { bottom: { style: 'thin', color: { rgb: '93C5FD' } } },
        }
      } else if (r === 2) {
        cell.s = {
          font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10.5, name: 'Calibri' },
          fill: { fgColor: { rgb: '1E3A8A' }, patternType: 'solid' },
          alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
          border: headerBorder,
        }
      } else if (isTotal) {
        cell.s = {
          font: { bold: true, color: { rgb: '0F172A' }, sz: 11, name: 'Calibri' },
          fill: { fgColor: { rgb: 'E2E8F0' }, patternType: 'solid' },
          alignment: { vertical: 'center', horizontal: opts.centerCols?.has(c) ? 'center' : 'left' },
          border: thinBorder('64748B'),
        }
      } else {
        const isAlt = (r - 3) % 2 === 1
        if (opts.forceTextCols?.has(c)) {
          cell.t = 's'
          cell.v = String(cell.v ?? '')
          cell.z = '@'
        } else if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
          cell.t = 'n'
        }
        cell.s = {
          font: {
            sz: 10.5,
            name: 'Calibri',
            bold: c === 1,
            color: { rgb: c === 0 ? '475569' : '0F172A' },
          },
          fill: { fgColor: { rgb: isAlt ? 'F8FAFC' : 'FFFFFF' }, patternType: 'solid' },
          alignment: {
            vertical: 'center',
            horizontal: opts.centerCols?.has(c) ? 'center' : 'left',
            wrapText: true,
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
  ws['!freeze'] = { cols: opts.freezeCols ?? Math.min(2, opts.headers.length), rows: 3 }
  ws['!autofilter'] = {
    ref: X.utils.encode_range({
      s: { r: 2, c: 0 },
      e: { r: Math.max(2, opts.hasTotalRow ? lastRow - 1 : lastRow), c: lastCol },
    }),
  }
  ws['!pageSetup'] = { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 }
  return ws
}

export interface ExpectedStudentInfo {
  key: string
  fish: string
  group: string
}

export async function exportSurveyResponsesExcel(
  survey: Survey,
  responses: SurveyResponseRow[],
  expectedStudents?: ExpectedStudentInfo[],
): Promise<string> {
  const X = await loadXlsx()
  const wb = X.utils.book_new()

  const showGroup = survey.audience !== 'ochiq' || responses.some((r) => Boolean(r.respondent_group))
  const sorted = [...responses].sort((a, b) => {
    if (survey.audience === 'talabalar') {
      const go = groupOrder(a.respondent_group || '', b.respondent_group || '')
      if (go !== 0) return go
      return (a.respondent_name || '').localeCompare(b.respondent_name || '', 'uz')
    }
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })

  const headers: string[] = [
    '№',
    survey.audience === 'talabalar' ? 'Talabaning F.I.Sh.' : survey.audience === 'xodimlar' ? 'Xodimning F.I.Sh.' : 'F.I.Sh.',
    ...(showGroup ? [survey.audience === 'xodimlar' ? 'Toifa' : 'Guruh'] : []),
    'Topshirilgan vaqt',
    ...survey.questions.map((q) => q.label),
  ]

  const fixedCols = showGroup ? 4 : 3
  const forceTextCols = new Set<number>([...(showGroup ? [2] : []), fixedCols - 1]) // Guruh/Toifa va Vaqt matn bo'lsin
  const centerCols = new Set<number>([0, ...(showGroup ? [2] : []), fixedCols - 1])

  survey.questions.forEach((q, qi) => {
    const colIdx = fixedCols + qi
    if (FORCE_TEXT_TYPES.has(q.type)) {
      forceTextCols.add(colIdx)
      centerCols.add(colIdx)
    } else if (q.type === 'yes_no' || q.type === 'rating' || q.type === 'number') {
      centerCols.add(colIdx)
    }
  })

  const dataRows: (string | number)[][] = sorted.map((r, idx) => {
    const base: (string | number)[] = [
      idx + 1,
      r.respondent_name || '—',
      ...(showGroup ? [r.respondent_group || '—'] : []),
      fmtDateTime(r.updated_at || r.created_at),
    ]
    for (const q of survey.questions) {
      const rawVal = r.answers?.[q.id]
      if (q.type === 'number' && typeof rawVal === 'number' && Number.isFinite(rawVal)) {
        base.push(rawVal)
      } else {
        base.push(formatAnswerDisplay(q, rawVal))
      }
    }
    return base
  })

  const colWidths = headers.map((h, c) => {
    if (c === 0) return 6
    if (c === 1) return 32
    if (showGroup && c === 2) return survey.audience === 'talabalar' ? 12 : 22
    if (c === fixedCols - 1) return 18
    let maxLen = h.length
    for (const row of dataRows) {
      const len = String(row[c] ?? '').length
      if (len > maxLen) maxLen = len
    }
    return Math.max(12, Math.min(48, maxLen + 4))
  })

  const today = new Date()
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const subtitle = `Auditoriya: ${AUDIENCE_META[survey.audience].label} · Jami javoblar: ${sorted.length} ta · Yuklangan: ${fmtDateTime(today.toISOString())}`

  const wsMain = styleSimpleSheet(X, dataRows, {
    title: survey.title,
    subtitle,
    headers,
    colWidths,
    centerCols,
    forceTextCols,
    freezeCols: showGroup ? 3 : 2,
  })
  X.utils.book_append_sheet(wb, wsMain, safeSheetName('Javoblar'))

  // Agar talabalar so'rovnomasi bo'lsa — guruhlar kesimi va topshirmaganlar varaqlari
  if (survey.audience === 'talabalar' && expectedStudents && expectedStudents.length > 0) {
    const submittedKeys = new Set(responses.map((r) => r.respondent_key))
    const byGroup = new Map<string, { total: number; done: number; missing: ExpectedStudentInfo[] }>()

    for (const st of expectedStudents) {
      const g = st.group || 'Guruhsiz'
      const cur = byGroup.get(g) ?? { total: 0, done: 0, missing: [] }
      cur.total += 1
      if (submittedKeys.has(st.key)) cur.done += 1
      else cur.missing.push(st)
      byGroup.set(g, cur)
    }

    const groupNames = [...byGroup.keys()].sort(groupOrder)
    let sumTotal = 0
    let sumDone = 0
    const statRows: (string | number)[][] = groupNames.map((g, i) => {
      const info = byGroup.get(g)!
      sumTotal += info.total
      sumDone += info.done
      const qolgan = info.total - info.done
      const pct = info.total > 0 ? Math.round((info.done / info.total) * 100) : 0
      return [i + 1, g, info.total, info.done, qolgan, `${pct}%`]
    })
    const totalPct = sumTotal > 0 ? Math.round((sumDone / sumTotal) * 100) : 0
    statRows.push(['', 'JAMI', sumTotal, sumDone, sumTotal - sumDone, `${totalPct}%`])

    const wsStat = styleSimpleSheet(X, statRows, {
      title: `${survey.title} — Guruhlar statistikasi`,
      subtitle: `Jami: ${sumTotal} talaba · Topshirgan: ${sumDone} · Topshirmagan: ${sumTotal - sumDone}`,
      headers: ['№', 'Guruh', 'Jami talaba', 'Topshirgan', 'Topshirmagan', 'Qamrov %'],
      colWidths: [6, 14, 15, 15, 16, 13],
      centerCols: new Set([0, 1, 2, 3, 4, 5]),
      forceTextCols: new Set([1]),
      freezeCols: 2,
      hasTotalRow: true,
    })
    X.utils.book_append_sheet(wb, wsStat, safeSheetName('Guruhlar statistikasi'))

    const missingAll: ExpectedStudentInfo[] = []
    for (const g of groupNames) {
      const m = byGroup.get(g)!.missing.sort((a, b) => a.fish.localeCompare(b.fish, 'uz'))
      missingAll.push(...m)
    }
    const missingRows: (string | number)[][] = missingAll.map((m, i) => [i + 1, m.group, m.fish])
    const wsMissing = styleSimpleSheet(X, missingRows, {
      title: `${survey.title} — Hali topshirmagan talabalar`,
      subtitle: `Jami topshirmagan: ${missingAll.length} nafar`,
      headers: ['№', 'Guruh', 'Talabaning F.I.Sh.'],
      colWidths: [6, 14, 38],
      centerCols: new Set([0, 1]),
      forceTextCols: new Set([1]),
      freezeCols: 2,
    })
    X.utils.book_append_sheet(wb, wsMissing, safeSheetName('Topshirmaganlar'))
  }

  const fileName = `Sorovnoma_${survey.slug}_${stamp}.xlsx`
  downloadBlob(workbookBytes(X, wb), fileName)
  return fileName
}
