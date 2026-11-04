'use client'

import { useMemo, useState } from 'react'
import { Check, Download, FileText, Loader2, X } from 'lucide-react'
import {
  BUYRUQ_TUR_LIST, BUYRUQ_TURLARI, buyruqBlocker, buyruqFileName, buyruqMatni, buyruqMove, buyruqQuery, suggestBuyruq,
  type BuyruqFields, type BuyruqHint, type BuyruqTur,
} from '@/lib/buyruq'
import { fullName } from '@/lib/student'
import type { EditFields, Student } from '@/lib/types'
import { cx } from './ui'

/** DD.MM.YYYY ↔ YYYY-MM-DD (input type="date") */
const toIso = (d: string) => (/^\d{2}\.\d{2}\.\d{4}$/.test(d) ? d.split('.').reverse().join('-') : '')
const fromIso = (d: string) => d.split('-').reverse().join('.')

function Input({ label, value, onChange, placeholder, mono = true }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className={cx('field', mono && 'mono')} value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="date" className="field mono" value={toIso(value)} onChange={(e) => { if (e.target.value) onChange(fromIso(e.target.value)) }} />
    </label>
  )
}

/**
 * Talaba uchun buyruq: turi talaba holatidan avtomatik aniqlanadi (akademik ta'til, safdan chiqarish,
 * guruh almashtirish, ta'tildan qaytish), maydonlar bazadan to'ldiriladi. Word fayl yuklab olinadi va
 * (belgi qo'yilgan bo'lsa) talaba buyruqdagi guruhiga o'zi o'tkaziladi.
 */
export default function BuyruqModal({ student: s, hint, onMove, onClose }: {
  student: Student
  hint?: BuyruqHint
  /** Talabani yangi guruhga o'tkazish (tahrir sifatida saqlanadi, guruh tarixiga yoziladi) */
  onMove: (fields: EditFields) => Promise<void>
  onClose: () => void
}) {
  const [f, setF] = useState<BuyruqFields>(() => suggestBuyruq(s, hint))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [doMove, setDoMove] = useState(true)
  const [movedTo, setMovedTo] = useState('')
  const set = <K extends keyof BuyruqFields>(k: K) => (v: BuyruqFields[K]) => setF((x) => ({ ...x, [k]: v }))

  const info = BUYRUQ_TURLARI[f.tur]
  const blocker = useMemo(() => buyruqBlocker(f), [f])
  const move = useMemo(() => (hint || movedTo ? null : buyruqMove(s, f)), [hint, movedTo, s, f])
  const has = (m: (typeof info.maydonlar)[number]) => info.maydonlar.includes(m)

  /** Tur almashganda maydonlar shu tur uchun qayta hisoblanadi; qo'lda kiritilgan raqam/sana saqlanadi */
  const onTur = (tur: BuyruqTur) => {
    const was = suggestBuyruq(s, hint, f.tur)
    const next = suggestBuyruq(s, hint, tur)
    setF({ ...next, raqam: f.raqam !== was.raqam ? f.raqam : next.raqam, sana: f.sana !== was.sana ? f.sana : next.sana })
  }

  const download = async () => {
    if (blocker) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/buyruq?${buyruqQuery(s.row, f)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Server ${res.status} qaytardi`)
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = buyruqFileName(s, f.tur)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError(`Buyruq yaratilmadi: ${(e as Error).message}`)
      setBusy(false)
      return
    }
    // Buyruq chiqdi — talaba buyruqdagi guruhiga o'tadi (faqat bir marta)
    if (move && doMove) {
      try {
        await onMove(move.fields)
        setMovedTo(move.group)
      } catch (e) {
        setError(`Buyruq yuklandi, lekin talaba o'tkazilmadi: ${(e as Error).message}`)
      }
    }
    setBusy(false)
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-[60] flex items-stretch justify-center bg-ink-950/85 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="animate-pop-in flex h-full w-full max-w-[640px] flex-col overflow-hidden border-line-strong bg-ink-900 shadow-2xl shadow-black/60 sm:h-auto sm:max-h-[94vh] sm:rounded-3xl sm:border" role="dialog" aria-modal="true" aria-label="Buyruq">
        <header className="flex items-center gap-3 border-b border-line bg-ink-850/80 px-4 py-3">
          <FileText size={18} className="shrink-0 text-amber" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-extrabold text-fg">Buyruq tayyorlash</h2>
            <div className="truncate text-[12px] text-fg-muted">{fullName(s)} · {s.group || '—'}</div>
          </div>
          <button type="button" className="grid size-9 place-items-center rounded-xl text-fg-muted hover:bg-ink-700 hover:text-fg" onClick={onClose} title="Yopish (Esc)"><X size={20} /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <label className="block">
            <span className="label">Buyruq turi</span>
            <select className="field cursor-pointer" value={f.tur} onChange={(e) => onTur(e.target.value as BuyruqTur)}>
              {BUYRUQ_TUR_LIST.map((t) => <option key={t} value={t}>{BUYRUQ_TURLARI[t].nom}</option>)}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Buyruq raqami *" value={f.raqam} onChange={set('raqam')} placeholder="T-40/2" />
            <DateInput label="Buyruq sanasi *" value={f.sana} onChange={set('sana')} />
            {has('kurs') && (
              <label className="block">
                <span className="label">Kursi (bosqichi) *</span>
                <select className="field cursor-pointer" value={f.kurs} onChange={(e) => set('kurs')(e.target.value)}>
                  <option value="">Tanlang</option>
                  {[1, 2, 3, 4].map((k) => <option key={k} value={k}>{k}-kurs</option>)}
                </select>
              </label>
            )}
            {has('avvalgiGuruh') && <Input label={`${info.avvalgiGuruhNomi} *`} value={f.avvalgiGuruh} onChange={set('avvalgiGuruh')} placeholder="25-03" />}
            {has('yangiGuruh') && <Input label={f.tur === 'qayta_tiklash' ? 'Tiklanayotgan yangi guruhi *' : 'Qaysi guruhga *'} value={f.yangiGuruh} onChange={set('yangiGuruh')} placeholder="25-04" />}
          </div>

          {has('avvalgiBuyruq') && (
            <div className="grid gap-3 rounded-xl border border-line bg-ink-950/40 p-3 sm:grid-cols-2">
              <div className="text-[12px] text-fg-muted sm:col-span-2">Akademik ta’til berilgan avvalgi buyruq</div>
              <Input label="Avvalgi buyruq raqami *" value={f.avvalgiRaqam} onChange={set('avvalgiRaqam')} placeholder="14-B" />
              <DateInput label="Avvalgi buyruq sanasi *" value={f.avvalgiSana} onChange={set('avvalgiSana')} />
            </div>
          )}

          <div className="rounded-xl border border-line bg-ink-950/40 p-3">
            <div className="mb-1 text-[11px] font-bold tracking-wider text-fg-subtle uppercase">Buyruq bandi</div>
            <p className="text-[13px] leading-relaxed text-fg">{buyruqMatni(s, f)}</p>
          </div>

          {move && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-ink-950/40 p-3 text-[13px] text-fg">
              <input type="checkbox" className="mt-0.5 size-4 accent-sky-500" checked={doMove} onChange={(e) => setDoMove(e.target.checked)} />
              <span>
                Buyruq yuklab olingach talaba <b>{move.label}</b> guruhiga avtomatik o‘tkazilsin
                <span className="block text-[12px] text-fg-muted">hozirgi guruhi: {s.group || '—'}</span>
              </span>
            </label>
          )}
          {movedTo && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald/40 bg-emerald/10 px-3 py-2 text-[12.5px] font-semibold text-emerald-soft">
              <Check size={15} /> Talaba «{movedTo}» guruhiga o‘tkazildi
            </div>
          )}
          {(blocker || error) && (
            <div className={cx('rounded-xl border px-3 py-2 text-[12.5px] font-semibold', error ? 'border-rose/40 bg-rose/10 text-rose' : 'border-amber/40 bg-amber/10 text-amber')}>{error || blocker}</div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-ink-850/80 px-4 py-3">
          <button type="button" className="btn-ghost h-10" onClick={onClose}>Yopish</button>
          <button type="button" className="btn-primary h-10" onClick={download} disabled={!!blocker || busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Word (.docx) yuklab olish
          </button>
        </footer>
      </div>
    </div>
  )
}
