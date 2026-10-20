'use client'

import { useState } from 'react'
import { Check, Download, FileSpreadsheet, Loader2, Upload, UserPlus, X } from 'lucide-react'
import * as XLSX from 'xlsx-js-style'
import type { StaffMember } from '@/lib/staff'

interface Props {
  onClose: () => void
  onImportSuccess: (count: number) => void
}

function cleanStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

export default function StaffImportModal({ onClose, onImportSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [parsedRows, setParsedRows] = useState<Partial<StaffMember>[]>([])
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  const handleFile = async (selected: File) => {
    setFile(selected)
    setError('')
    setLoading(true)
    try {
      const buffer = await selected.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const firstSheet = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })

      if (!json || !json.length) {
        throw new Error("Excel faylida ma'lumotlar topilmadi")
      }

      // Ustun nomlarini aniqlash (aliaslar orqali)
      const mapped: Partial<StaffMember>[] = []

      for (const row of json) {
        let fish = ''
        let lavozim = "O'qituvchi"
        let bolim = "Ma'muriy"
        let tel = ''
        let ish_turi = 'Shtat'
        let maosh = ''
        let ishga_sana = ''
        let pinfl = ''
        let pv = ''

        for (const [k, v] of Object.entries(row)) {
          const keyLow = k.toLowerCase().replace(/[^a-z0-9а-яёўқғҳ]/gi, '')
          const val = cleanStr(v)
          if (!val) continue

          if (keyLow.includes('fish') || keyLow.includes('fio') || keyLow.includes('ism') || keyLow.includes('xodim')) {
            fish = val
          } else if (keyLow.includes('lavozim') || keyLow.includes('position')) {
            lavozim = val
          } else if (keyLow.includes('bolim') || keyLow.includes('kafedra') || keyLow.includes('department')) {
            bolim = val
          } else if (keyLow.includes('tel') || keyLow.includes('telefon') || keyLow.includes('phone')) {
            tel = val
          } else if (keyLow.includes('ishturi') || keyLow.includes('stavka')) {
            ish_turi = val
          } else if (keyLow.includes('maosh') || keyLow.includes('oklad') || keyLow.includes('oylik')) {
            maosh = val
          } else if (keyLow.includes('sana') || keyLow.includes('ishga')) {
            ishga_sana = val
          } else if (keyLow.includes('jshshir') || keyLow.includes('pinfl')) {
            pinfl = val.replace(/\D/g, '')
          } else if (keyLow.includes('pasport') || keyLow.includes('pv')) {
            pv = val
          }
        }

        if (fish && fish.length >= 3) {
          mapped.push({
            fish,
            lavozim,
            bolim,
            tel,
            ish_turi,
            maosh,
            ishga_sana,
            pinfl,
            pv,
            status: 'faol',
          })
        }
      }

      if (!mapped.length) {
        throw new Error("Excel faylidan xodimlar F.I.Sh ustunini aniqlab bo'lmadi")
      }

      setParsedRows(mapped)
    } catch (e) {
      setError((e as Error).message || "Faylni o'qishda xatolik yuz berdi")
      setParsedRows([])
    } finally {
      setLoading(false)
    }
  }

  const downloadTemplate = () => {
    const headers = [
      'F.I.Sh', 'Lavozimi', 'Bo\'limi', 'Telefon', 'Ish turi',
      'Oylik maosh (so\'m)', 'Ishga qabul sanasi', 'JSHSHIR', 'Pasport'
    ]
    const sample = [
      ['Amanov Normurod Toshpulatovich', 'Qorovul', 'Xo\'jalik', '+998 91 221 31 64', 'Shtat', '3 000 000', '28.08.2026', '30102935680021', 'AD1234567'],
      ['Elmurodova Holida Xudoyberdiyevna', 'Farrosh', 'Xo\'jalik', '+998 90 670 30 78', 'Shtat', '2 500 000', '28.08.2026', '41205945680045', 'AE7654321'],
      ['Qobilov Jasur Anvar o\'g\'li', 'O\'qituvchi', 'Pedagog', '+998 93 111 22 33', 'Shtat', '5 000 000', '01.09.2026', '31508955680099', 'AB9876543'],
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sample])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Xodimlar')
    XLSX.writeFile(wb, 'xodimlar_namunaviy_shablon.xlsx')
  }

  const doImport = async () => {
    if (!parsedRows.length) return
    setImporting(true)
    setError('')
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch_import', items: parsedRows }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || "Import qilishda xatolik yuz berdi")
      onImportSuccess(data.count || parsedRows.length)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-stretch justify-center bg-ink-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="animate-pop-in flex h-full w-full max-w-[800px] flex-col overflow-hidden border-line-strong bg-ink-900 shadow-2xl shadow-black/60 sm:max-h-[92vh] sm:rounded-3xl sm:border"
        role="dialog"
        aria-modal="true"
        aria-label="Xodimlarni Excel orqali yuklash"
      >
        <header className="flex items-center gap-3 border-b border-line bg-ink-850/80 px-5 py-3.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald/25 to-sky/25 text-emerald-soft">
            <FileSpreadsheet size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-extrabold text-fg">Xodimlarni Excel orqali yuklash</h2>
            <p className="text-[12px] text-fg-muted">Excel (.xlsx, .xls) yoki CSV ro'yxatini yuklab bazaga saqlash</p>
          </div>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-xl text-fg-muted hover:bg-ink-700 hover:text-fg"
            onClick={onClose}
            title="Yopish (Esc)"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="rounded-xl border border-rose/45 bg-rose/10 px-3.5 py-2.5 text-[12.5px] text-rose">
              {error}
            </div>
          )}

          {/* Fayl yuklash va shablon tugmasi */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-ink-900/60 p-4">
            <div>
              <div className="text-[13px] font-bold text-fg">Excel fayli namunasi kerakmi?</div>
              <div className="text-[12px] text-fg-muted">To'g'ri ustunlar bilan tayyorlangan shablonni yuklab oling:</div>
            </div>
            <button
              type="button"
              onClick={downloadTemplate}
              className="btn-ghost h-9 px-3 text-[12px] border border-sky/30 text-sky-soft hover:bg-sky/10"
            >
              <Download size={14} />
              <span>Namunaviy shablon (.xlsx)</span>
            </button>
          </div>

          <label className="grid place-items-center gap-3 rounded-2xl border-2 border-dashed border-line-strong bg-ink-950/40 px-6 py-10 text-center transition hover:border-sky/60 cursor-pointer">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
              }}
            />
            <div className="grid size-14 place-items-center rounded-2xl bg-sky/10 text-sky-soft">
              {loading ? <Loader2 size={26} className="animate-spin" /> : <Upload size={26} />}
            </div>
            <div>
              <div className="text-[14px] font-bold text-fg">
                {file ? file.name : "Excel faylni tanlang yoki shu yerga tashlang"}
              </div>
              <div className="mt-1 text-[12px] text-fg-muted">
                .xlsx, .xls yoki .csv formatidagi fayllar qabul qilinadi
              </div>
            </div>
          </label>

          {/* Qabul qilingan xodimlar ro'yxati prevyusi */}
          {parsedRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-1.5 font-bold text-emerald-soft">
                  <Check size={15} />
                  <span>{parsedRows.length} nafar xodim ma&apos;lumotlari aniqlandi:</span>
                </span>
              </div>
              <div className="max-h-[260px] overflow-y-auto rounded-xl border border-line bg-ink-950/50">
                <table className="w-full text-left text-[12px]">
                  <thead className="sticky top-0 bg-ink-850/90 text-fg-muted text-[11px] font-semibold border-b border-line">
                    <tr>
                      <th className="py-2 px-3">№</th>
                      <th className="py-2 px-3">F.I.Sh</th>
                      <th className="py-2 px-3">Lavozimi</th>
                      <th className="py-2 px-3">Bo'limi</th>
                      <th className="py-2 px-3">Telefon</th>
                      <th className="py-2 px-3">Maosh</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {parsedRows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="hover:bg-ink-800/40">
                        <td className="py-2 px-3 text-fg-subtle">{i + 1}</td>
                        <td className="py-2 px-3 font-semibold text-fg">{r.fish}</td>
                        <td className="py-2 px-3 text-fg-muted">{r.lavozim}</td>
                        <td className="py-2 px-3 text-fg-subtle">{r.bolim}</td>
                        <td className="py-2 px-3 mono text-fg-muted">{r.tel || '—'}</td>
                        <td className="py-2 px-3 text-emerald-soft font-medium">{r.maosh || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedRows.length > 50 && (
                <div className="text-center text-[11.5px] text-fg-subtle">
                  ... va yana {parsedRows.length - 50} ta xodim
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2.5 border-t border-line bg-ink-900/95 p-4">
          <button type="button" className="btn-ghost h-10 px-4 text-[13px]" onClick={onClose} disabled={importing}>
            Bekor qilish
          </button>
          <button
            type="button"
            className="btn-success h-10 px-5 text-[13px]"
            onClick={() => void doImport()}
            disabled={importing || !parsedRows.length}
          >
            {importing ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
            <span>{importing ? 'Saqlanmoqda…' : `Bazaga kiritish (${parsedRows.length})`}</span>
          </button>
        </footer>
      </div>
    </div>
  )
}
