'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, ChevronDown, Copy } from 'lucide-react'

/**
 * Baho ustuni sarlavhasi: bosilganda shu ustundagi baholarni (masalan Yakuniy) boshqa ustun(lar)ga
 * — Oraliq, R-semestr — bir bosishda ko'chirish menyusi. Ko'chirish bitta qadam: Ctrl+Z bilan qaytadi.
 * Menyu body'ga chiqariladi — jadvalning gorizontal scroll bloki uni kesib qo'ymaydi.
 */
export default function CopyColMenu<K extends string>({ from, cols, onCopy, title, className, children }: {
  from: K
  cols: readonly { key: K; label: string }[]
  onCopy: (to: K[], onlyEmpty: boolean) => void
  /** Menyu sarlavhasidagi qo'shimcha (masalan fan nomi) */
  title?: string
  className?: string
  children: React.ReactNode
}) {
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const [onlyEmpty, setOnlyEmpty] = useState(false)
  const fromLabel = cols.find((c) => c.key === from)?.label ?? from
  const targets = cols.filter((c) => c.key !== from)

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const w = menu.current?.offsetWidth ?? 260
    const h = menu.current?.offsetHeight ?? 220
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)
    const top = r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6
    setPos({ left, top })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return
      if (e.type === 'mousedown' && (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return
      if (e.type === 'scroll' && menu.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    window.addEventListener('scroll', close, { capture: true, passive: true })
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
      window.removeEventListener('scroll', close, { capture: true })
      window.removeEventListener('resize', close)
    }
  }, [open])

  const run = (to: K[]) => {
    onCopy(to, onlyEmpty)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${fromLabel} baholarini boshqa ustunga ko‘chirish`}
        className={className ?? 'inline-flex items-center gap-0.5 rounded px-1 hover:bg-ink-800 hover:text-fg'}
      >
        {children}
        <ChevronDown size={10} className="shrink-0 opacity-60" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ left: pos.left, top: pos.top }}
            className="animate-pop-in fixed z-[70] w-[260px] rounded-xl border border-line-strong bg-ink-900 p-2 text-left normal-case tracking-normal shadow-(--shadow-pop)"
          >
            <div className="flex items-center gap-1.5 px-1.5 pb-1.5 text-[12px] font-bold text-fg">
              <Copy size={13} className="shrink-0 text-sky" />
              <span className="min-w-0 truncate">«{fromLabel}» baholarini ko‘chirish</span>
            </div>
            {title && <div className="truncate px-1.5 pb-1.5 text-[11px] font-medium text-fg-subtle">{title}</div>}
            <div className="space-y-1">
              {targets.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="menuitem"
                  onClick={() => run([t.key])}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-line bg-ink-950/60 px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-fg hover:border-sky/50 hover:bg-sky/10"
                >
                  <span className="text-fg-muted">{fromLabel}</span>
                  <ArrowRight size={12} className="text-sky" />
                  <span>{t.label}</span>
                </button>
              ))}
              {targets.length > 1 && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => run(targets.map((t) => t.key))}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-line bg-ink-950/60 px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-fg hover:border-sky/50 hover:bg-sky/10"
                >
                  <span className="text-fg-muted">{fromLabel}</span>
                  <ArrowRight size={12} className="text-sky" />
                  <span>Qolgan barcha ustunlarga</span>
                </button>
              )}
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 px-1.5 text-[11.5px] font-medium text-fg-muted select-none">
              <input type="checkbox" className="size-3.5 accent-sky" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
              Faqat bo‘sh kataklarga (borini o‘zgartirmaslik)
            </label>
            <p className="mt-1.5 px-1.5 text-[10.5px] text-fg-subtle">Bo‘sh baholar ko‘chirilmaydi. Ctrl+Z — bekor qilish.</p>
          </div>,
          document.body,
        )}
    </>
  )
}
