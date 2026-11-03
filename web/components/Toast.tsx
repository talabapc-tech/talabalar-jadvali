'use client'

import { useCallback, useRef, useState } from 'react'
import { CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react'
import { cx } from './ui'

export type ToastTone = 'success' | 'info' | 'warning' | 'error'
interface Toast { id: number; tone: ToastTone; text: string }

export type Notify = (text: string, tone?: ToastTone) => void

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const notify = useCallback<Notify>((text, tone = 'success') => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-3), { id, tone, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500)
  }, [])
  return { toasts, notify }
}

const TONES = {
  success: { icon: CheckCircle2, cls: 'border-emerald/40 text-emerald-soft' },
  info: { icon: Info, cls: 'border-sky/40 text-sky-soft' },
  warning: { icon: TriangleAlert, cls: 'border-amber/40 text-amber' },
  error: { icon: XCircle, cls: 'border-rose/45 text-rose' },
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[80] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const { icon: Icon, cls } = TONES[t.tone]
        return (
          <div key={t.id} className={cx('animate-slide-up flex items-start gap-2.5 rounded-xl border bg-ink-850/95 px-4 py-3 text-[13px] font-semibold shadow-(--shadow-pop)', cls)}>
            <Icon size={17} className="mt-px shrink-0" />
            <span className="text-fg">{t.text}</span>
          </div>
        )
      })}
    </div>
  )
}
