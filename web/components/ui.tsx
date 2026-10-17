'use client'

import { Check, Clock, AlertTriangle, XCircle, CheckCircle2, Database, EyeOff } from 'lucide-react'
import { GROUP_TITLES } from '@/lib/config'
import { isAcademicLeave, isBazaEntered, isSecretGroup, isWithdrawn } from '@/lib/student'
import type { Student } from '@/lib/types'

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
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

export function VerifyButton({ student, onToggle, compact }: { student: Student; onToggle: (s: Student) => void; compact?: boolean }) {
  const ok = student.verified === 'TASDIQLANDI'
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(student) }}
      title={ok ? "Operator tasdig'i: Tasdiqlangan — bekor qilish uchun bosing" : "Operator tasdig'i: Tasdiqlash uchun bosing"}
      className={cx(
        'chip cursor-pointer transition-colors',
        ok
          ? 'border-emerald/45 bg-emerald/12 text-emerald-soft hover:bg-emerald/20'
          : 'border-amber/40 bg-amber/10 text-amber hover:bg-amber/20',
      )}
    >
      {ok ? <Check size={12} strokeWidth={3} /> : <Clock size={12} strokeWidth={2.5} />}
      {compact ? (ok ? 'OK' : 'Kutilmoqda') : ok ? 'Tasdiqlangan' : 'Kutilmoqda'}
    </button>
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
      {compact ? (ok ? 'Bazada ✓' : 'Kirmagan') : ok ? 'Bazaga kiritilgan' : 'Bazaga kiritilmagan'}
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
