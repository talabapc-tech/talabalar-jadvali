'use client'

import { useMemo } from 'react'
import { CalendarPlus, ChevronRight, CircleAlert } from 'lucide-react'
import { haftaKuni, hisobla, majlisOqituvchilari, sanaUz, TUR_NOMI, TURLAR, type MajlisDb } from '@/lib/majlis'
import { cx } from '../ui'

const OYLAR = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']
export const oyNomi = (ym: string) => `${OYLAR[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`

export default function MajlisList({ db, onOpen, onCreate }: { db: MajlisDb; onOpen: (id: string) => void; onCreate: () => void }) {
  const byMonth = useMemo(() => {
    const map = new Map<string, MajlisDb['majlislar']>()
    for (const m of db.majlislar) {
      const k = m.sana.slice(0, 7)
      map.set(k, [...(map.get(k) ?? []), m])
    }
    return [...map.entries()]
  }, [db.majlislar])

  const faol = db.oqituvchilar.filter((o) => o.faol)

  return (
    <div className="flex flex-col gap-4">
      <button type="button" className="btn-success h-12 text-[14.5px]" onClick={onCreate} disabled={!faol.length}>
        <CalendarPlus size={18} /> Yangi majlis — davomat olish
      </button>
      <p className="-mt-2 text-center text-[12px] text-fg-subtle">
        {TURLAR.map((t) => `${TUR_NOMI[t]}: ${faol.filter((o) => o.tur === t).length}`).join(' · ')} o'qituvchi
      </p>

      {!db.majlislar.length && (
        <div className="panel p-8 text-center text-[13.5px] text-fg-muted">
          Hali majlis yo'q. Majlis boshlanganda <b className="text-fg">"Yangi majlis"</b> tugmasini bosing va har bir o'qituvchini belgilang.
        </div>
      )}

      {byMonth.map(([ym, list]) => (
        <section key={ym} className="flex flex-col gap-2">
          <h3 className="px-1 text-[11.5px] font-bold tracking-wider text-fg-subtle uppercase">{oyNomi(ym)} · {list.length} ta majlis</h3>
          {list.map((m) => {
            const parts = TURLAR.map((tur) => ({ tur, h: hisobla(majlisOqituvchilari(m, db.oqituvchilar, tur), m.davomat) })).filter((x) => x.h.jami)
            const unmarked = parts.reduce((s, x) => s + x.h.belgilanmagan, 0)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onOpen(m.id)}
                className="panel flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:border-line-strong hover:bg-ink-800/60"
              >
                <div className="grid w-12 shrink-0 place-items-center rounded-xl border border-line bg-ink-950/60 py-1.5 leading-tight">
                  <span className="text-[18px] font-extrabold text-fg">{m.sana.slice(8, 10)}</span>
                  <span className="text-[10px] font-semibold text-fg-subtle uppercase">{OYLAR[Number(m.sana.slice(5, 7)) - 1]?.slice(0, 3)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-fg">{m.mavzu || 'Mavzusiz majlis'}</div>
                  <div className="text-[12px] text-fg-muted">{haftaKuni(m.sana)}{m.vaqt ? `, ${m.vaqt}` : ''} · {sanaUz(m.sana)}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {parts.map(({ tur, h }) => (
                      <span
                        key={tur}
                        className={cx('chip', h.kelmadi ? 'border-rose/40 bg-rose/10 text-rose' : tur === 'asosiy' ? 'border-blue/40 bg-blue/10 text-blue-soft' : 'border-violet/40 bg-violet/10 text-violet')}
                        title={`Keldi ${h.keldi}, sababli ${h.sababli}, kelmadi ${h.kelmadi}`}
                      >
                        {TUR_NOMI[tur]} {h.keldi}/{h.jami}
                        {h.kelmadi > 0 && <span className="font-normal">· {h.kelmadi} kelmadi</span>}
                      </span>
                    ))}
                    {unmarked > 0 && (
                      <span className="chip border-amber/40 bg-amber/10 text-amber"><CircleAlert size={11} /> {unmarked} belgilanmagan</span>
                    )}
                  </div>
                </div>
                <ChevronRight size={18} className="shrink-0 text-fg-subtle" />
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}
