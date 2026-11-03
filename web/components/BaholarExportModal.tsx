'use client'

import { useEffect, useMemo, useState } from 'react'
import { BookOpenCheck, Database, FileBarChart2, FileSpreadsheet, Loader2, X } from 'lucide-react'
import type { OquvReja } from '@/lib/curriculum'
import type { ExportTuri } from '@/lib/baholar-excel'
import { SEMESTRLAR } from '@/lib/baholar'
import { cx } from './ui'

export interface ExportTanlov {
  semestr: number
  turi: ExportTuri
  /** Qaydnoma uchun tanlangan fanlar (bo'sh — semestrning barcha fani) */
  fanlar: string[]
}

const TURLAR: { key: ExportTuri; icon: typeof Database; title: string; text: string }[] = [
  { key: 'baza', icon: Database, title: 'Baza uchun', text: '1) Reyting (100 ball) · 2) 5 ballik · 3) Malakaviy amaliyot — har bir talaba bilan' },
  { key: 'qaydnoma', icon: BookOpenCheck, title: 'Fanlar qaydnomasi', text: 'Birinchi varaq — mundarija, keyin har bir fan alohida varaqda' },
  { key: 'hisobot', icon: FileBarChart2, title: 'Hisobot (1–4-shakl)', text: 'Davomat, o‘zlashtirish, semestr natijalari va guruh natijasi' },
]

/** Eksportdan oldin so'raladi: qaysi semestr, qanday fayl, qaydnoma bo'lsa — qaysi fanlar */
export default function BaholarExportModal({ guruh, semestr, plan, joriyFanlar, faqat5, onClose, onExport }: {
  guruh: string
  /** 2 yillik guruh — faqat 5 ballik */
  faqat5?: boolean
  semestr: number
  plan: OquvReja | null
  /** Ochiq turgan semestr fanlari (o'quv reja bo'lmasa shu ishlatiladi) */
  joriyFanlar: string[]
  onClose: () => void
  onExport: (t: ExportTanlov) => Promise<void>
}) {
  const [sem, setSem] = useState(semestr)
  const [turi, setTuri] = useState<ExportTuri>('baza')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const planFanlar = (s: number) =>
    [...(plan?.semestrlar?.[String(s)]?.fanlar ?? [])].sort((a, b) => a.tartib - b.tartib).map((f) => f.nom)
  const fanlar = useMemo(() => {
    const p = planFanlar(sem)
    return p.length ? p : sem === semestr ? joriyFanlar : []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sem, plan, joriyFanlar, semestr])
  const [tanlangan, setTanlangan] = useState<Set<string>>(new Set())
  useEffect(() => setTanlangan(new Set(fanlar)), [fanlar])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const toggle = (f: string) => setTanlangan((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n })
  const qaydnomaBosh = turi === 'qaydnoma' && fanlar.length > 0 && tanlangan.size === 0

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      await onExport({ semestr: sem, turi, fanlar: turi === 'qaydnoma' ? fanlar.filter((f) => tanlangan.has(f)) : [] })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col rounded-xl border border-line bg-ink-900 shadow-2xl" role="dialog" aria-modal="true" aria-label="Excel eksport">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-emerald/15 text-emerald-soft"><FileSpreadsheet size={18} /></span>
            <div>
              <h3 className="text-[15.5px] font-extrabold text-fg">Excelga yuklab olish</h3>
              <p className="text-[11.5px] text-fg-muted">{guruh} guruh · faqat tanlangan semestr fanlari</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-ink-800 hover:text-fg" aria-label="Yopish">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <div className="label mb-1.5">Semestr</div>
            <div className="flex flex-wrap gap-1.5">
              {SEMESTRLAR.map((s) => {
                const n = planFanlar(s).length
                return (
                  <button key={s} type="button" onClick={() => setSem(s)} aria-pressed={sem === s}
                    className={cx('rounded-lg border px-3 py-1.5 text-left text-[12.5px] font-bold transition-colors',
                      sem === s ? 'border-accent bg-accent text-white' : 'border-line text-fg-muted hover:border-line-strong hover:text-fg')}>
                    {s}-semestr
                    {plan && <span className={cx('ml-1.5 text-[11px] font-semibold', sem === s ? 'text-white/80' : 'text-fg-subtle')}>{n} fan</span>}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[11.5px] text-fg-subtle">
              {plan
                ? `O‘quv reja bo‘yicha ${sem}-semestrda ${planFanlar(sem).length} ta fan — boshqa semestr fanlari faylga kirmaydi.`
                : 'Guruhga o‘quv reja biriktirilmagan — semestrdagi baholar jadvali fanlari olinadi.'}
            </p>
          </div>

          <div>
            <div className="label mb-1.5">Fayl turi</div>
            <div className="grid gap-2">
              {TURLAR.map(({ key, icon: Icon, title, text: t }) => {
                const text = faqat5 && key === 'baza' ? '1) 5 ballik · 2) Malakaviy amaliyot — har bir talaba bilan (2 yillik: 100 ballik yo‘q)' : t
                return (
                <button key={key} type="button" onClick={() => setTuri(key)} aria-pressed={turi === key}
                  className={cx('flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                    turi === key ? 'border-sky/60 bg-sky/10 ring-1 ring-sky/30' : 'border-line hover:border-line-strong hover:bg-ink-850')}>
                  <Icon size={18} className={cx('mt-0.5 shrink-0', turi === key ? 'text-sky' : 'text-fg-muted')} />
                  <span>
                    <span className="block text-[13.5px] font-bold text-fg">{title}</span>
                    <span className="block text-[12px] text-fg-muted">{text}</span>
                  </span>
                </button>
                )
              })}
            </div>
          </div>

          {turi === 'qaydnoma' && fanlar.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label">Qaydnomasi olinadigan fanlar ({tanlangan.size}/{fanlar.length})</span>
                <button type="button" className="text-[12px] font-semibold text-sky hover:underline"
                  onClick={() => setTanlangan(tanlangan.size === fanlar.length ? new Set() : new Set(fanlar))}>
                  {tanlangan.size === fanlar.length ? 'Hammasini olib tashlash' : 'Hammasini tanlash'}
                </button>
              </div>
              <div className="max-h-[30vh] space-y-1 overflow-y-auto pr-1">
                {fanlar.map((f, i) => (
                  <label key={f} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-ink-950/60 px-2.5 py-1.5 select-none hover:bg-ink-850">
                    <input type="checkbox" className="size-4 accent-sky" checked={tanlangan.has(f)} onChange={() => toggle(f)} />
                    <span className="w-5 text-[11.5px] text-fg-subtle tabular-nums">{i + 1}.</span>
                    <span className="flex-1 text-[12.5px] font-semibold text-fg">{f}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {!fanlar.length && turi !== 'hisobot' && (
            <p className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[12px] text-amber">
              {sem}-semestr uchun fanlar topilmadi — fayl faqat talabalar ro‘yxati bilan chiqadi.
            </p>
          )}
          {error && <p className="text-[12.5px] text-rose">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" className="btn-ghost h-9 px-3" onClick={onClose} disabled={busy}>Bekor qilish</button>
          <button type="button" className="btn-success h-9 px-4" onClick={() => void run()} disabled={busy || qaydnomaBosh}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
            {busy ? 'Tayyorlanmoqda…' : 'Yuklab olish'}
          </button>
        </div>
      </div>
    </div>
  )
}
