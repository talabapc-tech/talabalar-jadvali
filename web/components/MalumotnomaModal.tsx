'use client'

import { useState } from 'react'
import { Download, FileText, Loader2, Send, X } from 'lucide-react'
import { malumotnomaBlocker, malumotnomaFileName, todayTashkent } from '@/lib/malumotnoma'
import { fullName } from '@/lib/student'
import type { Student } from '@/lib/types'
import { cx } from './ui'

/** DD.MM.YYYY ↔ YYYY-MM-DD (input type="date") */
const toIso = (d: string) => d.split('.').reverse().join('-')
const fromIso = (d: string) => d.split('-').reverse().join('.')

export default function MalumotnomaModal({ student: s, onClose }: { student: Student; onClose: () => void }) {
  const [sana, setSana] = useState(todayTashkent)
  const [loaded, setLoaded] = useState(false)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const blocker = malumotnomaBlocker(s)
  const src = `/api/malumotnoma?row=${s.row}&sana=${encodeURIComponent(sana)}`

  const send = async () => {
    setSending(true)
    setMsg(null)
    try {
      const res = await fetch('/api/malumotnoma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row: s.row, sana }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Server ${res.status} qaytardi`)
      setMsg({ ok: true, text: 'Telegram botga yuborildi' })
    } catch (e) {
      setMsg({ ok: false, text: `Yuborilmadi: ${(e as Error).message}` })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-[60] flex items-stretch justify-center bg-ink-950/85 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="animate-pop-in flex h-full w-full max-w-[720px] flex-col overflow-hidden border-line-strong bg-ink-900 shadow-2xl shadow-black/60 sm:h-[94vh] sm:rounded-3xl sm:border" role="dialog" aria-modal="true" aria-label="Ma'lumotnoma">
        <header className="flex items-center gap-3 border-b border-line bg-ink-850/80 px-4 py-3">
          <FileText size={18} className="shrink-0 text-sky" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-extrabold text-fg">O‘qiyotganligi haqida ma’lumotnoma</h2>
            <div className="truncate text-[12px] text-fg-muted">{fullName(s)} · {s.group || '—'}</div>
          </div>
          <button type="button" className="grid size-9 place-items-center rounded-xl text-fg-muted hover:bg-ink-700 hover:text-fg" onClick={onClose} title="Yopish (Esc)"><X size={20} /></button>
        </header>

        {blocker ? (
          <div className="m-4 rounded-xl border border-rose/45 bg-rose/10 p-4 text-[13px] text-rose">{blocker}</div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2 border-b border-line px-3 py-3 sm:px-4">
              <label className="block flex-1 sm:flex-none">
                <span className="label">Sana</span>
                <input
                  type="date"
                  className="field mono w-full sm:w-[170px]"
                  value={toIso(sana)}
                  onChange={(e) => { if (e.target.value) { setSana(fromIso(e.target.value)); setLoaded(false) } }}
                />
              </label>
              <div className="grid w-full grid-cols-[auto_1fr_1fr] items-center gap-2 sm:ml-auto sm:flex sm:w-auto">
                <a className="text-[12px] font-semibold text-fg-muted underline-offset-2 hover:text-fg hover:underline" href={`${src}&format=docx`} download={malumotnomaFileName(s, 'docx')} title="Tahrirlash uchun Word fayl">
                  Word (.docx)
                </a>
                <a className={cx('btn-primary h-10 sm:h-[38px]', !loaded && 'pointer-events-none opacity-50')} href={`${src}&download=1`} download={malumotnomaFileName(s)}>
                  <Download size={15} /> <span className="sm:hidden">Rasm</span><span className="hidden sm:inline">Yuklab olish (.jpg)</span>
                </a>
                <button type="button" className="btn-ghost h-10 text-sky hover:text-sky-soft sm:h-[38px]" onClick={send} disabled={sending || !loaded}>
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} <span className="sm:hidden">Botga</span><span className="hidden sm:inline">Botga yuborish</span>
                </button>
              </div>
            </div>
            {msg && (
              <div className={cx('border-b px-4 py-2 text-[12.5px] font-semibold', msg.ok ? 'border-emerald/30 bg-emerald/10 text-emerald-soft' : 'border-rose/30 bg-rose/10 text-rose')}>{msg.text}</div>
            )}
            <div className="relative min-h-0 flex-1 overflow-y-auto bg-ink-950/60 p-3 sm:p-4">
              {!loaded && (
                <div className="absolute inset-0 grid place-items-center text-fg-muted"><Loader2 size={24} className="animate-spin" /></div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={src}
                src={src}
                alt={`${fullName(s)} ma'lumotnomasi`}
                className={cx('mx-auto w-full max-w-[640px] rounded-md bg-white shadow-xl shadow-black/40', !loaded && 'invisible')}
                onLoad={() => setLoaded(true)}
                onError={() => { setLoaded(false); setMsg({ ok: false, text: "Ma'lumotnoma yaratilmadi (server xatosi)" }) }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
