'use client'

import { useState } from 'react'
import { ArrowLeftRight, Check, Loader2, Pencil, Trash2, UserPlus, UserX, UserCheck, X } from 'lucide-react'
import { byFish, newId, TUR_NOMI, TUR_TOLIQ, TURLAR, type Oqituvchi, type OqituvchiTur } from '@/lib/majlis'
import type { Notify } from '../Toast'
import { cx } from '../ui'

export default function OqituvchilarTab({ oqituvchilar, onSave, notify }: {
  oqituvchilar: Oqituvchi[]
  onSave: (list: Oqituvchi[]) => Promise<void>
  notify: Notify
}) {
  const [fish, setFish] = useState('')
  const [tur, setTur] = useState<OqituvchiTur>('asosiy')
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<{ id: string; fish: string } | null>(null)

  const save = async (list: Oqituvchi[], msg: string) => {
    setBusy(true)
    try {
      await onSave(list)
      notify(msg)
    } catch (e) {
      notify(`Saqlanmadi: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = fish.replace(/\s+/g, ' ').trim()
    if (!name) return
    if (oqituvchilar.some((o) => o.fish.toLowerCase() === name.toLowerCase())) {
      notify("Bu o'qituvchi ro'yxatda bor", 'warning')
      return
    }
    await save([...oqituvchilar, { id: newId('o'), fish: name, tur, faol: true }], `${name} qo'shildi (${TUR_NOMI[tur].toLowerCase()})`)
    setFish('')
  }

  const update = (id: string, p: Partial<Oqituvchi>, msg: string) =>
    save(oqituvchilar.map((o) => (o.id === id ? { ...o, ...p } : o)), msg)

  const remove = (o: Oqituvchi) => {
    if (!confirm(`${o.fish} ro'yxatdan o'chirilsinmi?\n(Oldingi majlislarda qatnashgan bo'lsa — "ketgan" deb saqlanadi)`)) return
    void save(oqituvchilar.filter((x) => x.id !== o.id), `${o.fish} o'chirildi`)
  }

  const saveName = async () => {
    if (!edit) return
    const name = edit.fish.replace(/\s+/g, ' ').trim()
    if (name) await update(edit.id, { fish: name }, 'Ism saqlandi')
    setEdit(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={add} className="panel flex flex-col gap-3 p-4">
        <span className="label mb-0">Yangi o'qituvchi</span>
        <input className="field" placeholder="Familiya Ism Sharif" value={fish} onChange={(e) => setFish(e.target.value)} maxLength={120} />
        <div className="flex gap-2">
          <div className="grid flex-1 grid-cols-2 gap-1 rounded-xl border border-line bg-ink-950/50 p-1">
            {TURLAR.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTur(t)}
                className={cx('rounded-lg px-2 py-1.5 text-[12.5px] font-semibold', tur === t ? 'bg-blue/20 text-blue-soft ring-1 ring-blue/40' : 'text-fg-muted')}
              >
                {TUR_NOMI[t]}
              </button>
            ))}
          </div>
          <button type="submit" className="btn-success" disabled={busy || !fish.trim()}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Qo'shish
          </button>
        </div>
      </form>

      {TURLAR.map((t) => {
        const list = oqituvchilar.filter((o) => o.tur === t).sort((a, b) => Number(b.faol) - Number(a.faol) || byFish(a, b))
        return (
          <section key={t} className="panel overflow-hidden">
            <h2 className={cx('border-b border-line px-4 py-3 text-[14.5px] font-extrabold', t === 'asosiy' ? 'bg-blue/8 text-blue-soft' : 'bg-violet/8 text-violet')}>
              {TUR_TOLIQ[t]} <span className="font-semibold text-fg-subtle">· {list.filter((o) => o.faol).length}</span>
            </h2>
            {!list.length && <div className="px-4 py-5 text-[13px] text-fg-subtle">Ro'yxat bo'sh</div>}
            <ul className="divide-y divide-line">
              {list.map((o, i) => (
                <li key={o.id} className={cx('flex items-center gap-2 px-3 py-2', !o.faol && 'opacity-55')}>
                  <span className="mono w-6 shrink-0 text-right text-[12px] text-fg-subtle">{i + 1}</span>
                  {edit?.id === o.id ? (
                    <>
                      <input
                        className="field h-9 flex-1 py-1"
                        value={edit.fish}
                        autoFocus
                        onChange={(e) => setEdit({ ...edit, fish: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') setEdit(null) }}
                      />
                      <IconBtn title="Saqlash" onClick={saveName} disabled={busy}><Check size={15} className="text-emerald-soft" /></IconBtn>
                      <IconBtn title="Bekor qilish" onClick={() => setEdit(null)}><X size={15} /></IconBtn>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-fg">
                        {o.fish}
                        {!o.faol && <span className="chip ml-2 border-line-strong text-fg-subtle">ketgan</span>}
                      </span>
                      <IconBtn title="Ismni tahrirlash" onClick={() => setEdit({ id: o.id, fish: o.fish })} disabled={busy}><Pencil size={14} /></IconBtn>
                      <IconBtn
                        title={`${t === 'asosiy' ? "O'rindosh" : 'Asosiy'}ga o'tkazish`}
                        onClick={() => update(o.id, { tur: t === 'asosiy' ? 'orindosh' : 'asosiy' }, `${o.fish} — ${t === 'asosiy' ? "o'rindosh" : 'asosiy'}`)}
                        disabled={busy}
                      >
                        <ArrowLeftRight size={14} />
                      </IconBtn>
                      <IconBtn
                        title={o.faol ? "Ishdan ketgan (yangi majlislarga qo'shilmaydi)" : 'Qayta faol qilish'}
                        onClick={() => update(o.id, { faol: !o.faol }, o.faol ? `${o.fish} — ketgan` : `${o.fish} — faol`)}
                        disabled={busy}
                      >
                        {o.faol ? <UserX size={14} /> : <UserCheck size={14} className="text-emerald-soft" />}
                      </IconBtn>
                      <IconBtn title="O'chirish" onClick={() => remove(o)} disabled={busy} danger><Trash2 size={14} /></IconBtn>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function IconBtn({ children, title, onClick, disabled, danger }: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-ink-800/50 text-fg-muted transition-colors disabled:opacity-40',
        danger ? 'hover:border-rose/40 hover:bg-rose/10 hover:text-rose' : 'hover:border-line-strong hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}
