'use client'

import { useMemo, useState } from 'react'
import { FileSpreadsheet, Loader2, Send } from 'lucide-react'
import { byFish, HOLAT_META, TUR_TOLIQ, TURLAR, type Majlis, type MajlisDb, type Oqituvchi, type OqituvchiTur } from '@/lib/majlis'
import { hisobotWorkbook, saveXlsx } from '@/lib/majlis-excel'
import { haptic, tgFetch } from '@/lib/telegram-webapp'
import type { Notify } from '../Toast'
import { cx } from '../ui'
import { oyNomi } from './MajlisList'

interface Qator {
  o: Oqituvchi
  chaqirilgan: number
  keldi: number
  sababli: number
  kelmadi: number
  foiz: number
}

function jadval(majlislar: Majlis[], oqituvchilar: Oqituvchi[], tur: OqituvchiTur): Qator[] {
  const rows = new Map<string, Qator>()
  const byId = new Map(oqituvchilar.map((o) => [o.id, o]))
  for (const m of majlislar) {
    for (const id of m.tarkib) {
      const o = byId.get(id)
      if (!o || o.tur !== tur) continue
      const r = rows.get(id) ?? { o, chaqirilgan: 0, keldi: 0, sababli: 0, kelmadi: 0, foiz: 0 }
      r.chaqirilgan++
      const h = m.davomat[id]
      if (h) r[h]++
      rows.set(id, r)
    }
  }
  return [...rows.values()]
    .map((r) => {
      const marked = r.keldi + r.sababli + r.kelmadi
      return { ...r, foiz: marked ? Math.round((r.keldi / marked) * 100) : 0 }
    })
    .sort((a, b) => byFish(a.o, b.o))
}

export default function MajlisHisobot({ db, notify, inTelegram }: { db: MajlisDb; notify: Notify; inTelegram: boolean }) {
  const months = useMemo(() => [...new Set(db.majlislar.map((m) => m.sana.slice(0, 7)))].sort().reverse(), [db.majlislar])
  const [davr, setDavr] = useState<string>(() => months[0] ?? 'all')
  const [busy, setBusy] = useState<'excel' | 'tg' | null>(null)

  const list = useMemo(() => db.majlislar.filter((m) => davr === 'all' || m.sana.startsWith(davr)), [db.majlislar, davr])
  const davrNomi = davr === 'all' ? 'barcha majlislar' : oyNomi(davr)

  const run = async (kind: 'excel' | 'tg') => {
    setBusy(kind)
    try {
      const file = await hisobotWorkbook(list, db.oqituvchilar, davrNomi)
      if (kind === 'excel') {
        saveXlsx(file)
        notify('Hisobot yuklab olindi')
      } else {
        const lines = [`📊 <b>Majlislar davomati — ${davrNomi}</b>`, `Majlislar soni: ${list.length}`]
        for (const tur of TURLAR) {
          const rows = jadval(list, db.oqituvchilar, tur)
          const yoq = rows.filter((r) => r.kelmadi).map((r) => `${r.o.fish} (${r.kelmadi})`)
          if (rows.length) lines.push('', `<b>${TUR_TOLIQ[tur]}</b>: ${rows.length} nafar`, yoq.length ? `❌ Kelmaganlar: ${yoq.join(', ')}` : '✅ Sababsiz kelmagan yo\'q')
        }
        const fd = new FormData()
        fd.append('text', lines.join('\n'))
        fd.append('file', new Blob([file.data as BlobPart]), file.fileName)
        const res = await tgFetch('/api/majlislar/telegram', { method: 'POST', body: fd })
        const d = await res.json().catch(() => ({}))
        if (!res.ok || !d.ok) throw new Error(d.error || `Server ${res.status}`)
        haptic('success')
        notify(`Telegramga yuborildi (${d.to})`)
      }
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-4">
        <label>
          <span className="label">Davr</span>
          <select className="field" value={davr} onChange={(e) => setDavr(e.target.value)}>
            {months.map((ym) => <option key={ym} value={ym}>{oyNomi(ym)}</option>)}
            <option value="all">Barcha majlislar</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-ghost h-11" onClick={() => run('excel')} disabled={!!busy || !list.length}>
            {busy === 'excel' ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} className="text-emerald-soft" />}
            Excel hisobot
          </button>
          <button type="button" className="btn-primary h-11" onClick={() => run('tg')} disabled={!!busy || !list.length} title={inTelegram ? 'Sizga yuboriladi' : 'Hisobot chatiga yuboriladi'}>
            {busy === 'tg' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Telegramga
          </button>
        </div>
        <p className="text-[12px] text-fg-subtle">Excel'da asosiy va o'rindosh o'qituvchilar alohida sahifada: har majlis ustuni (+, S, −) va jami.</p>
      </div>

      {!list.length ? (
        <div className="panel p-8 text-center text-[13.5px] text-fg-muted">Bu davrda majlis yo'q.</div>
      ) : (
        TURLAR.map((tur) => {
          const rows = jadval(list, db.oqituvchilar, tur)
          if (!rows.length) return null
          return (
            <section key={tur} className="panel overflow-hidden">
              <h2 className={cx('border-b border-line px-4 py-3 text-[14.5px] font-extrabold', tur === 'asosiy' ? 'bg-blue/8 text-blue-soft' : 'bg-violet/8 text-violet')}>
                {TUR_TOLIQ[tur]} <span className="font-semibold text-fg-subtle">· {list.length} majlis</span>
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="text-fg-subtle">
                    <tr className="border-b border-line">
                      <th className="px-3 py-2 text-left font-semibold">F.I.Sh.</th>
                      <th className="px-1.5 py-2 font-semibold text-emerald-soft" title={HOLAT_META.keldi.nomi}>+</th>
                      <th className="px-1.5 py-2 font-semibold text-sky-soft" title={HOLAT_META.sababli.nomi}>S</th>
                      <th className="px-1.5 py-2 font-semibold text-rose" title={HOLAT_META.kelmadi.nomi}>−</th>
                      <th className="px-3 py-2 text-right font-semibold">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => (
                      <tr key={r.o.id} className={cx(r.kelmadi > 0 && 'bg-rose/[0.05]')}>
                        <td className="px-3 py-2 font-semibold text-fg">
                          {r.o.fish}
                          {r.chaqirilgan < list.length && <span className="ml-1 font-normal text-fg-subtle">({r.chaqirilgan} ta majlisga chaqirilgan)</span>}
                        </td>
                        <td className="mono px-1.5 text-center">{r.keldi || ''}</td>
                        <td className="mono px-1.5 text-center text-sky-soft">{r.sababli || ''}</td>
                        <td className="mono px-1.5 text-center font-bold text-rose">{r.kelmadi || ''}</td>
                        <td className={cx('mono px-3 text-right font-bold', r.foiz >= 90 ? 'text-emerald-soft' : r.foiz >= 70 ? 'text-amber' : 'text-rose')}>{r.foiz}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
