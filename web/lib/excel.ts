'use client'

import { GROUPS } from './config'
import { byName, isAcademicLeave, isOutside, isWithdrawn } from './student'
import type { Student, ContractStudent } from './types'
import { ensureAiTranslations, withAiTranslation } from './qabul-ai'
import { QABUL_FILE, QABUL_SHEET } from './qabul'
import {
  C, ROLE_META, ROLES, buildQabulShablonSheet, buildRoleXlsx, buildSheet, cleanXlsxBuffer, groupOrder, loadXlsx, safeSheetName, withTimestamp, workbookBytes,
  type Role, type XLSXModule,
} from './excel-build'

// Boshqa modullar (xodimlar, baholar, majlis) shu fayldan import qilgani uchun qayta eksport
export { cleanXlsxBuffer, withTimestamp, ROLE_META }
export type { Role }

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
  downloadBlob(workbookBytes(X, wb), fileName)
}

/** Brauzerda: AI tarjimalarni oldindan yuklab (localStorage keshi), so'ng QABUL / To'liq ma'lumotlar yasash */
const browserHooks = { prepareQabul: async (list: Student[]) => { await ensureAiTranslations(list) }, translate: withAiTranslation }

/** QABUL - 2026 (barcha guruhlar, bitta sahifa) yoki To'liq ma'lumotlar ("Jami talabalar" + guruh sahifalari) */
export async function exportRole(students: Student[], role: Role) {
  const { bytes, sheets, fileName } = await buildRoleXlsx(students, role, browserHooks)
  downloadBlob(bytes, fileName)
  return sheets
}

/** Bitta guruhni QABUL - 2026 formatida yuklab olish */
export async function exportQabulShablonGroup(students: Student[], group: string) {
  const X = await loadXlsx()
  const list = students.filter((s) => (s.group || '').trim() === group.trim()).sort(byName)
  await ensureAiTranslations(list)
  const wb = X.utils.book_new()
  X.utils.book_append_sheet(wb, buildQabulShablonSheet(X, list, withAiTranslation), QABUL_SHEET)
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
  X.utils.book_append_sheet(wb, buildQabulShablonSheet(X, list, withAiTranslation), QABUL_SHEET)
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
  const { bytes, count, fileName } = await buildRoleXlsx(students, role, browserHooks)
  const blob = new Blob([bytes as any], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const meta = ROLE_META[role]

  const formData = new FormData()
  formData.append('caption', `📊 ${meta.title} (${meta.sub})\n👥 Jami talabalar: ${count} nafar`)
  formData.append('file', blob, fileName)

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


