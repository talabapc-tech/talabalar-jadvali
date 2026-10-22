'use client'

import { memo, useMemo, useState } from 'react'
import { Check, CheckCheck, FileSpreadsheet, FileText, Loader2, Plus, Send, Trash2, X } from 'lucide-react'
import {
  defaultTarkib, haftaKuni, hisobla, HOLAT_META, HOLATLAR, majlisMatni, majlisOqituvchilari, QATNASHCHILAR_NOMI,
  TUR_TOLIQ, TURLAR, byFish, type Holat, type Majlis, type Oqituvchi, type OqituvchiTur, type Qatnashchilar,
} from '@/lib/majlis'
import { majlisWorkbook, saveXlsx } from '@/lib/majlis-excel'
import { haptic, tgFetch } from '@/lib/telegram-webapp'
import type { Notify } from '../Toast'
import { cx } from '../ui'

export const HOLAT_STYLE: Record<Holat, { on: string; icon: typeof Check }> = {
  keldi: { on: 'border-emerald/60 bg-emerald/20 text-emerald-soft', icon: Check },
  sababli: { on: 'border-sky/60 bg-sky/20 text-sky-soft', icon: FileText },
  kelmadi: { on: 'border-rose/60 bg-rose/20 text-rose', icon: X },
}

interface Props {
  majlis: Majlis
  oqituvchilar: Oqituvchi[]
  onChange: (m: Majlis) => void
  onDelete: (m: Majlis) => void
  notify: Notify
  inTelegram: boolean
}

export default function MajlisEditor({ majlis: m, oqituvchilar, onChange, onDelete, notify, inTelegram }: Props) {
  const [busy, setBusy] = useState<'excel' | 'tg' | null>(null)
  const patch = (p: Partial<Majlis>) => onChange({ ...m, ...p })

  const setHolat = (id: string, h: Holat) => {
    haptic()
    const davomat = { ...m.davomat }
    const izoh = { ...m.izoh }
    if (davomat[id] === h) delete davomat[id] // qayta bosilsa — belgini olib tashlash
    else davomat[id] = h
    if (davomat[id] === 'keldi' || !davomat[id]) delete izoh[id]
    patch({ davomat, izoh })
  }

  const setIzoh = (id: string, text: string) => {
    const izoh = { ...m.izoh }
    if (text) izoh[id] = text
    else delete izoh[id]
    patch({ izoh })
  }

  const restKeldi = (tur: OqituvchiTur) => {
    haptic('success')
    const davomat = { ...m.davomat }
    for (const o of majlisOqituvchilari(m, oqituvchilar, tur)) if (!davomat[o.id]) davomat[o.id] = 'keldi'
    patch({ davomat })
  }

  const setQatnashchilar = (q: Qatnashchilar) => {
    if (q === m.qatnashchilar) return
    const tarkib = defaultTarkib(oqituvchilar, q)
    const keep = new Set(tarkib)
    const lost = Object.keys(m.davomat).filter((id) => !keep.has(id)).length
    if (lost && !confirm(`${lost} ta o'qituvchining belgisi o'chadi. Davom etasizmi?`)) return
    const davomat = Object.fromEntries(Object.entries(m.davomat).filter(([id]) => keep.has(id)))
    const izoh = Object.fromEntries(Object.entries(m.izoh).filter(([id]) => keep.has(id)))
    patch({ qatnashchilar: q, tarkib, davomat, izoh })
  }

  const addToTarkib = (id: string) => { if (id && !m.tarkib.includes(id)) patch({ tarkib: [...m.tarkib, id] }) }
  const removeFromTarkib = (id: string) => {
    const davomat = { ...m.davomat }; delete davomat[id]
    const izoh = { ...m.izoh }; delete izoh[id]
    patch({ tarkib: m.tarkib.filter((x) => x !== id), davomat, izoh })
  }

  const outside = useMemo(
    () => oqituvchilar.filter((o) => o.faol && !m.tarkib.includes(o.id)).sort(byFish),
    [oqituvchilar, m.tarkib],
  )

  const downloadExcel = async () => {
    setBusy('excel')
    try {
      saveXlsx(await majlisWorkbook(m, oqituvchilar))
      notify('Excel yuklab olindi')
    } catch (e) {
      notify(`Excel yaratilmadi: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const sendTelegram = async () => {
    setBusy('tg')
    try {
      const file = await majlisWorkbook(m, oqituvchilar)
      const fd = new FormData()
      fd.append('text', majlisMatni(m, oqituvchilar))
      fd.append('file', new Blob([file.data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), file.fileName)
      const res = await tgFetch('/api/majlislar/telegram', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) throw new Error(d.error || `Server ${res.status}`)
      haptic('success')
      notify(`Telegramga yuborildi (${d.to})`)
    } catch (e) {
      notify(`Yuborilmadi: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const all = TURLAR.map((tur) => ({ tur, list: majlisOqituvchilari(m, oqituvchilar, tur) }))
  const total = hisobla(all.flatMap((x) => x.list), m.davomat)

  return (
    <div className="flex flex-col gap-4">
      {/* Majlis ma'lumotlari */}
      <section className="panel grid grid-cols-2 gap-3 p-4">
        <label className="col-span-1">
          <span className="label">Sana · {haftaKuni(m.sana)}</span>
          <input type="date" className="field" value={m.sana} onChange={(e) => e.target.value && patch({ sana: e.target.value })} />
        </label>
        <label className="col-span-1">
          <span className="label">Soat</span>
          <input type="time" className="field" value={m.vaqt} onChange={(e) => patch({ vaqt: e.target.value })} />
        </label>
        <label className="col-span-2">
          <span className="label">Mavzu / kun tartibi</span>
          <input
            type="text"
            className="field"
            placeholder="Masalan: Pedagogik kengash, 1-chorak yakunlari"
            value={m.mavzu}
            maxLength={300}
            onChange={(e) => patch({ mavzu: e.target.value })}
          />
        </label>
        <div className="col-span-2">
          <span className="label">Kimlar chaqirilgan</span>
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-ink-950/50 p-1">
            {(['hammasi', 'asosiy', 'orindosh'] as const).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQatnashchilar(q)}
                className={cx(
                  'rounded-lg px-2 py-1.5 text-[12.5px] font-semibold transition-colors',
                  m.qatnashchilar === q ? 'bg-blue/20 text-blue-soft ring-1 ring-blue/40' : 'text-fg-muted hover:text-fg',
                )}
              >
                {QATNASHCHILAR_NOMI[q]}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Umumiy natija */}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="font-semibold text-fg">Jami {total.jami}:</span>
        {HOLATLAR.map((h) => (
          <span key={h} className={cx('chip', HOLAT_STYLE[h].on)}>{HOLAT_META[h].nomi} {total[h]}</span>
        ))}
        {total.belgilanmagan > 0 && <span className="chip border-line-strong text-fg-muted">Belgilanmagan {total.belgilanmagan}</span>}
      </div>

      {all.map(({ tur, list }) => list.length > 0 && (
        <TurSection
          key={tur}
          tur={tur}
          list={list}
          majlis={m}
          onHolat={setHolat}
          onIzoh={setIzoh}
          onRest={() => restKeldi(tur)}
          onRemove={removeFromTarkib}
        />
      ))}

      {outside.length > 0 && (
        <label className="panel flex items-center gap-2 p-3">
          <Plus size={16} className="shrink-0 text-fg-subtle" />
          <select className="field" value="" onChange={(e) => addToTarkib(e.target.value)}>
            <option value="">Majlisga o'qituvchi qo'shish ({outside.length})...</option>
            {outside.map((o) => <option key={o.id} value={o.id}>{o.fish} — {o.tur === 'asosiy' ? 'asosiy' : "o'rindosh"}</option>)}
          </select>
        </label>
      )}

      {/* Amallar */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <button type="button" className="btn-ghost h-11" onClick={downloadExcel} disabled={!!busy} title="Asosiy va o'rindosh alohida sahifalarda">
          {busy === 'excel' ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} className="text-emerald-soft" />}
          Excel
        </button>
        <button type="button" className="btn-primary h-11" onClick={sendTelegram} disabled={!!busy} title={inTelegram ? "Sizga Telegramda yuboriladi" : 'Hisobot chatiga yuboriladi'}>
          {busy === 'tg' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          Telegramga
        </button>
        <button
          type="button"
          className="btn-danger col-span-2 h-11 sm:col-span-1"
          onClick={() => { if (confirm("Bu majlis butunlay o'chirilsinmi?")) onDelete(m) }}
        >
          <Trash2 size={16} /> O'chirish
        </button>
      </div>
    </div>
  )
}

interface SectionProps {
  tur: OqituvchiTur
  list: Oqituvchi[]
  majlis: Majlis
  onHolat: (id: string, h: Holat) => void
  onIzoh: (id: string, text: string) => void
  onRest: () => void
  onRemove: (id: string) => void
}

function TurSection({ tur, list, majlis, onHolat, onIzoh, onRest, onRemove }: SectionProps) {
  const s = hisobla(list, majlis.davomat)
  return (
    <section className="panel overflow-hidden">
      <div className={cx('flex flex-wrap items-center gap-2 border-b border-line px-4 py-3', tur === 'asosiy' ? 'bg-blue/8' : 'bg-violet/8')}>
        <h2 className={cx('flex-1 text-[14.5px] font-extrabold', tur === 'asosiy' ? 'text-blue-soft' : 'text-violet')}>
          {TUR_TOLIQ[tur]} <span className="font-semibold text-fg-subtle">· {s.jami}</span>
        </h2>
        <span className="mono text-[12.5px] font-semibold text-fg-muted" title="Keldi / jami">
          {s.keldi}/{s.jami}
        </span>
        {s.belgilanmagan > 0 && (
          <button type="button" className="btn-ghost h-8 px-2.5 text-[12px]" onClick={onRest} title="Belgilanmaganlarning hammasini 'Keldi' qilish">
            <CheckCheck size={14} className="text-emerald-soft" /> Qolganlari keldi
          </button>
        )}
      </div>
      <ul className="divide-y divide-line">
        {list.map((o, i) => (
          <Row
            key={o.id}
            n={i + 1}
            o={o}
            holat={majlis.davomat[o.id]}
            izoh={majlis.izoh[o.id] ?? ''}
            onHolat={onHolat}
            onIzoh={onIzoh}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </section>
  )
}

const Row = memo(function Row({ n, o, holat, izoh, onHolat, onIzoh, onRemove }: {
  n: number; o: Oqituvchi; holat?: Holat; izoh: string
  onHolat: (id: string, h: Holat) => void; onIzoh: (id: string, t: string) => void; onRemove: (id: string) => void
}) {
  return (
    <li className={cx('px-3 py-2.5 sm:px-4', !holat && 'bg-amber/[0.03]')}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="mono w-6 shrink-0 text-right text-[12px] text-fg-subtle">{n}</span>
          <span className="min-w-0 flex-1 text-[14px] leading-snug font-semibold text-fg">{o.fish}</span>
          {!o.faol && <span className="chip border-line-strong text-fg-subtle">ketgan</span>}
          <button
            type="button"
            className="shrink-0 rounded-md p-1 text-fg-subtle hover:bg-rose/10 hover:text-rose"
            onClick={() => { if (confirm(`${o.fish} shu majlis ro'yxatidan olib tashlansinmi?`)) onRemove(o.id) }}
            title="Shu majlis ro'yxatidan olib tashlash"
            aria-label="Ro'yxatdan olib tashlash"
          >
            <X size={14} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1 sm:w-[290px] sm:shrink-0">
          {HOLATLAR.map((h) => {
            const Icon = HOLAT_STYLE[h].icon
            const on = holat === h
            return (
              <button
                key={h}
                type="button"
                onClick={() => onHolat(o.id, h)}
                aria-pressed={on}
                className={cx(
                  'flex h-9 items-center justify-center gap-1 rounded-lg border text-[12px] font-semibold transition-colors',
                  on ? HOLAT_STYLE[h].on : 'border-line bg-ink-800/40 text-fg-subtle hover:border-line-strong hover:text-fg-muted',
                )}
              >
                <Icon size={14} strokeWidth={2.6} />
                <span>{HOLAT_META[h].nomi}</span>
              </button>
            )
          })}
        </div>
      </div>
      {holat && holat !== 'keldi' && (
        <input
          type="text"
          className="field mt-2 h-9 py-1 text-[13px] sm:ml-8 sm:w-[calc(100%-2rem)]"
          placeholder="Sababi (kasal, xizmat safari, ...)"
          value={izoh}
          maxLength={200}
          onChange={(e) => onIzoh(o.id, e.target.value)}
        />
      )}
    </li>
  )
})
