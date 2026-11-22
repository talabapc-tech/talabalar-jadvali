'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Copy, Database, EyeOff, XCircle } from 'lucide-react'
import { GROUP_TITLES } from '@/lib/config'
import { isAcademicLeave, isBazaEntered, isSecretGroup, isWithdrawn } from '@/lib/student'
import type { Student } from '@/lib/types'

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export async function copyToClipboard(text: string): Promise<boolean> {
  const val = String(text ?? '').trim()
  if (!val || typeof window === 'undefined') return false
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(val)
      return true
    }
  } catch {
    // HTTPS bo'lmagan yoki cheklangan muhitda zaxira usul
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = val
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function CopyBtn({
  value,
  label,
  title,
  text,
  size = 12,
  className,
  onCopied,
}: {
  value?: string | null
  label?: string
  title?: string
  text?: string
  size?: number
  className?: string
  onCopied?: (msg: string) => void
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(t)
  }, [copied])

  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const ok = await copyToClipboard(trimmed)
    if (ok) {
      setCopied(true)
      onCopied?.(label ? `${label} nusxalandi` : 'Nusxalandi')
    }
  }

  if (text) {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={title || (label ? `${label}ni nusxalash` : 'Nusxalash')}
        className={cx(
          'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors cursor-pointer',
          copied
            ? 'border-emerald/50 bg-emerald/15 text-emerald-soft'
            : 'border-sky/30 bg-sky/10 text-sky-soft hover:bg-sky/20',
          className,
        )}
      >
        {copied ? <Check size={size} strokeWidth={2.5} /> : <Copy size={size} />}
        <span>{copied ? 'Nusxalandi' : text}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title || (label ? `${label}ni nusxalash` : 'Nusxalash')}
      aria-label={title || (label ? `${label}ni nusxalash` : 'Nusxalash')}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded p-1 transition-colors cursor-pointer',
        copied ? 'bg-emerald/15 text-emerald-soft' : 'text-fg-subtle hover:bg-sky/15 hover:text-sky-soft',
        className,
      )}
    >
      {copied ? <Check size={size} strokeWidth={2.5} /> : <Copy size={size} />}
    </button>
  )
}

export function formatPassportBundle(parts: {
  fish?: string
  pv?: string
  pinfl?: string
  dob?: string
  ber?: string
  berJoy?: string
}): string {
  const lines: string[] = []
  if (parts.fish?.trim()) lines.push(`F.I.Sh.: ${parts.fish.trim()}`)
  if (parts.pv?.trim()) lines.push(`Pasport: ${parts.pv.trim()}`)
  const cleanPinfl = parts.pinfl?.replace(/\s/g, '').trim()
  if (cleanPinfl) lines.push(`JSHSHIR: ${cleanPinfl}`)
  if (parts.dob?.trim()) lines.push(`Tug'ilgan sana: ${parts.dob.trim()}`)
  if (parts.ber?.trim()) lines.push(`Berilgan sana: ${parts.ber.trim()}`)
  if (parts.berJoy?.trim()) lines.push(`Berilgan joyi: ${parts.berJoy.trim()}`)
  return lines.join('\n')
}

/** inline — maxfiy guruh belgisini bir qatorda to'liq ko'rsatish (profil); aks holda asl guruh chip ostida */
/** from — akademik ta'til / safdan chiqarilganlar uchun qaysi guruhdan chiqqani (chip yonida "26-03 dan") */
export function GroupBadge({ group, className, short, asl, inline, from }: { group: string; className?: string; short?: boolean; asl?: string; inline?: boolean; from?: string }) {
  if (!group) return <span className={cx('chip border-amber/40 bg-amber/10 text-amber', className)}>Guruhsiz</span>
  if (isSecretGroup(group)) {
    const title = `Maxfiy guruh — darslarga kelmaydi. Bazadagi asl guruhi: ${asl || "ko'rsatilmagan"}`
    const chip = (
      <span className={cx('chip mono border-dashed border-amber/55 bg-amber/10 text-amber', inline && className)} title={title}>
        <EyeOff size={11} className="shrink-0" />
        {group}
        {inline && <span className="font-normal text-fg-muted">· asl {asl || '?'}</span>}
      </span>
    )
    if (inline) return chip
    // Ro'yxatlar uchun: asl guruh chip ostida — tor ustun/sarlavhadan chiqib ketmaydi
    return (
      <span className={cx('inline-flex flex-col items-start gap-0.5 leading-none', className)} title={title}>
        {chip}
        <span className="mono pl-1 text-[10px] text-fg-muted">asl {asl || '?'}</span>
      </span>
    )
  }
  if (isWithdrawn(group) || isAcademicLeave(group)) {
    const left = isWithdrawn(group)
    const label = left ? (short ? 'Chiqarilgan' : 'Safdan chiqarilgan') : (short ? "Akad. ta'til" : "Akademik ta'til")
    const title = `${left ? 'Talabalar safidan chiqarilganlar' : "Akademik ta'til olganlar"}${from ? ` — ${from} guruhidan` : ''}`
    const chip = (
      <span className={cx('chip max-w-full truncate', left ? 'border-rose/40 bg-rose/10 text-rose' : 'border-violet/40 bg-violet/10 text-violet', inline && className)} title={title}>
        {label}
        {inline && from && <span className="mono font-normal text-fg-muted"> · {from} dan</span>}
      </span>
    )
    if (inline || !from) return chip
    return (
      <span className={cx('inline-flex flex-col items-start gap-0.5 leading-none max-w-full', className)} title={title}>
        {chip}
        <span className="mono pl-1 text-[10px] text-fg-muted truncate max-w-full">{from} dan</span>
      </span>
    )
  }
  const farm = GROUP_TITLES[group]?.startsWith('Farmatsiya')
  return (
    <span className={cx('chip mono', farm ? 'border-emerald/40 bg-emerald/10 text-emerald-soft' : 'border-blue/40 bg-blue/10 text-blue-soft', className)}>
      {group}
    </span>
  )
}

export function BazaButton({ student, onToggle, compact }: { student: Student; onToggle: (s: Student) => void; compact?: boolean }) {
  const ok = isBazaEntered(student)
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(student) }}
      title={ok ? "Bazaga kiritilgan — kiritilmagan deb belgilash uchun bosing" : "Bazaga kiritilmagan — kiritilgan deb belgilash uchun bosing"}
      className={cx(
        'chip cursor-pointer transition-colors',
        ok
          ? 'border-sky/45 bg-sky/12 text-sky-soft hover:bg-sky/20'
          : 'border-rose/50 bg-rose/15 text-rose hover:bg-rose/25',
      )}
    >
      {ok ? <Database size={12} strokeWidth={2.5} /> : <XCircle size={12} strokeWidth={2.5} />}
      {compact ? (ok ? 'Bazada' : 'Kirmagan') : ok ? 'Bazaga kiritilgan' : 'Bazaga kiritilmagan'}
    </button>
  )
}

const STATUS = {
  full: { icon: CheckCircle2, cls: 'text-emerald-soft', label: "Hujjatlar to'liq" },
  chala: { icon: AlertTriangle, cls: 'text-amber', label: 'Chala — pasport yoki shahodatnoma yetishmaydi' },
  yoq: { icon: XCircle, cls: 'text-rose', label: "Hujjat yo'q" },
} as const

export function StatusIcon({ status, size = 16 }: { status: string; size?: number }) {
  const s = STATUS[status as keyof typeof STATUS] ?? STATUS.yoq
  const Icon = s.icon
  return (
    <span title={s.label} className={cx('inline-flex', s.cls)}>
      <Icon size={size} strokeWidth={2.4} />
    </span>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <span className="text-fg-subtle">{children || '—'}</span>
}

export function Mono({ value, className }: { value: string; className?: string }) {
  if (!value) return <span className="font-semibold text-rose/80">—</span>
  return <span className={cx('mono font-semibold text-sky-soft', className)}>{value}</span>
}

export function ProgressBar({ value, tone = 'emerald' }: { value: number; tone?: 'emerald' | 'sky' }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700/70">
      <div
        className={cx('h-full rounded-full transition-[width] duration-500', tone === 'emerald' ? 'bg-gradient-to-r from-emerald to-emerald-soft' : 'bg-gradient-to-r from-blue to-sky')}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}
