'use client'

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { FileText, Link2, Phone, SearchX, X } from 'lucide-react'
import { formatPinfl, fullName, NAME_FLAGS, passTypeShort } from '@/lib/student'
import type { Student } from '@/lib/types'
import type { DisplayMode } from './FilterBar'
import { BazaButton, cx, GroupBadge, Mono, StatusIcon, VerifyButton } from './ui'

interface Props {
  students: Student[]
  mode: DisplayMode
  duplicateRows: Set<number>
  onOpen: (s: Student) => void
  onToggleVerify: (s: Student) => void
  onToggleBaza: (s: Student) => void
  onClearFilters?: () => void
}

/** Jadval 1440px keng — telefonda (md dan tor) o'rniga ixcham kartalar ko'rsatiladi */
function useWide() {
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const update = () => setWide(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return wide
}

/** Ro'yxat konteynerining sahifa boshidan masofasi — virtualizatsiya shu nuqtadan boshlanadi */
function useOffsetTop(ref: React.RefObject<HTMLElement | null>) {
  const [top, setTop] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setTop(el.getBoundingClientRect().top + window.scrollY)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [ref])
  return top
}

function useColumns(ref: React.RefObject<HTMLElement | null>, minWidth: number, gap: number) {
  const [cols, setCols] = useState(3)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setCols(Math.max(1, Math.floor((el.clientWidth + gap) / (minWidth + gap))))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, minWidth, gap])
  return cols
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <div className="text-[10.5px] font-bold tracking-wider text-fg-subtle uppercase">{label}</div>
    <div className="truncate text-[13px]">{children}</div>
  </div>
)

const StudentCard = memo(function StudentCard({ s, n, dup, compact, onOpen, onToggleVerify, onToggleBaza }: {
  s: Student; n: number; dup: boolean; compact?: boolean; onOpen: (s: Student) => void; onToggleVerify: (s: Student) => void; onToggleBaza: (s: Student) => void
}) {
  const ok = s.verified === 'TASDIQLANDI'
  const flag = NAME_FLAGS[s.name_flag]

  if (compact) {
    return (
      <article
        onClick={() => onOpen(s)}
        className={cx(
          'group relative flex h-full cursor-pointer flex-col justify-between gap-2 rounded-2xl border bg-ink-900/80 p-3.5 transition-colors',
          dup ? 'border-rose/55' : ok ? 'border-emerald/25 hover:border-emerald/50' : 'border-line hover:border-sky/45',
          'hover:bg-ink-850',
        )}
      >
        <span className={cx('absolute inset-y-3 left-0 w-[3px] rounded-r-full', ok ? 'bg-emerald' : 'bg-amber/70')} />
        <header className="flex flex-wrap items-center gap-1.5">
          <span className="mono text-[11px] font-bold text-fg-subtle tabular-nums">#{n}</span>
          <GroupBadge group={s.group} asl={s.asl_guruh} from={s.chiqqan_guruh} short />
          <span className="chip mono border-sky/30 bg-sky/8 text-sky-soft">№ {s.shnum || '—'}</span>
          <span className="ml-auto flex items-center gap-1">
            <StatusIcon status={s.status} />
            <BazaButton student={s} onToggle={onToggleBaza} compact />
            <VerifyButton student={s} onToggle={onToggleVerify} compact />
          </span>
        </header>
        <div>
          <h3 className="truncate text-[14px] font-bold text-fg group-hover:text-sky-soft">
            {fullName(s)}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-fg-muted">
            <span className="mono text-fg">{s.pv || '—'}</span>
            <span className="mono">{formatPinfl(s.pinfl)}</span>
            {s.dob && <span className="ml-auto tabular-nums">{s.dob}</span>}
          </div>
        </div>
      </article>
    )
  }

  return (
    <article
      onClick={() => onOpen(s)}
      className={cx(
        'group relative flex h-full cursor-pointer flex-col gap-3 rounded-2xl border bg-ink-900/80 p-3.5 transition-colors sm:p-4',
        dup ? 'border-rose/55' : ok ? 'border-emerald/25 hover:border-emerald/50' : 'border-line hover:border-sky/45',
        'hover:bg-ink-850',
      )}
    >
      <span className={cx('absolute inset-y-4 left-0 w-[3px] rounded-r-full', ok ? 'bg-emerald' : 'bg-amber/70')} />
      <header className="flex flex-wrap items-center gap-1.5">
        <span className="mono text-[11.5px] font-bold text-fg-subtle tabular-nums">#{n}</span>
        <GroupBadge group={s.group} asl={s.asl_guruh} from={s.chiqqan_guruh} />
        <span className="chip mono border-sky/30 bg-sky/8 text-sky-soft">№ {s.shnum || '—'}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <StatusIcon status={s.status} />
          <BazaButton student={s} onToggle={onToggleBaza} compact />
          <VerifyButton student={s} onToggle={onToggleVerify} compact />
        </span>
      </header>

      <div>
        <h3 className="line-clamp-2 text-[15px] leading-snug font-bold text-fg group-hover:text-sky-soft">
          {fullName(s)}
          {dup && <span className="chip ml-2 border-rose/50 bg-rose/10 align-middle text-rose">Dublikat</span>}
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-muted">
          {s.dob && <span>Tug'ilgan: <strong className="text-fg">{s.dob}</strong></span>}
          {s.tel && <span className="inline-flex items-center gap-1"><Phone size={12} /> {s.tel}</span>}
          {flag && s.name_flag !== 'ok' && (
            <span className={cx('font-semibold', flag.tone === 'bad' ? 'text-rose' : flag.tone === 'warn' ? 'text-amber' : 'text-violet')} title={flag.label}>
              ● {flag.label.split(' — ')[0]}
            </span>
          )}
        </div>
      </div>

      <div className="mt-auto grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-line bg-ink-950/50 p-3">
        <Field label={`Pasport ${passTypeShort(s)}`}><Mono value={s.pv} /></Field>
        <Field label="JSHSHIR"><Mono value={formatPinfl(s.pinfl)} className="text-[12.5px]" /></Field>
        <Field label={s.doc_tur || "Ta'lim hujjati"}>
          <span className="inline-flex items-center gap-1.5">
            <Mono value={s.sh_doc} />
            {s.sh_qr && (
              <a href={s.sh_qr} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="QR PDF" className="text-sky hover:text-sky-soft">
                <Link2 size={13} />
              </a>
            )}
          </span>
        </Field>
        <Field label="Bitirgan"><span className="font-semibold">{s.yil || '—'}</span></Field>
        <div className="col-span-2 min-w-0 truncate text-[12px] text-fg-muted" title={s.mak}>{s.mak || '—'}</div>
      </div>

      <footer className="flex items-center gap-2 text-[11.5px] text-fg-subtle">
        <FileText size={13} className={s.doc_file ? 'text-sky' : ''} />
        <span className="truncate">{s.doc_file || 'Hujjat fayli biriktirilmagan'}</span>
      </footer>
    </article>
  )
})

function CardGrid({ students, duplicateRows, compact, onOpen, onToggleVerify, onToggleBaza }: Omit<Props, 'mode' | 'onClearFilters'> & { compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const gap = compact ? 10 : 12
  const cols = useColumns(ref, compact ? 310 : 330, gap)
  const top = useOffsetTop(ref)
  const rows = Math.ceil(students.length / cols)

  const v = useWindowVirtualizer({
    count: rows,
    estimateSize: () => (compact ? 108 : 262),
    overscan: 5,
    scrollMargin: top,
    gap,
  })

  return (
    <div ref={ref} className="relative w-full" style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={v.measureElement}
          className="absolute inset-x-0 grid"
          style={{ top: row.start - v.options.scrollMargin, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}
        >
          {students.slice(row.index * cols, row.index * cols + cols).map((s, i) => (
            <StudentCard key={s.row} s={s} n={row.index * cols + i + 1} dup={duplicateRows.has(s.row)} compact={compact} onOpen={onOpen} onToggleVerify={onToggleVerify} onToggleBaza={onToggleBaza} />
          ))}
        </div>
      ))}
    </div>
  )
}

const COLS = '40px 96px 74px minmax(190px,1.5fr) 120px 144px 88px 124px minmax(110px,1fr) 44px 104px 114px 34px'

const TableRow = memo(function TableRow({ s, n, dup, onOpen, onToggleVerify, onToggleBaza }: {
  s: Student; n: number; dup: boolean; onOpen: (s: Student) => void; onToggleVerify: (s: Student) => void; onToggleBaza: (s: Student) => void
}) {
  return (
    <div
      onClick={() => onOpen(s)}
      className={cx('grid h-full cursor-pointer items-center gap-2 border-b border-line px-4 text-[13px] transition-colors hover:bg-ink-800/70', dup && 'bg-rose/5')}
      style={{ gridTemplateColumns: COLS }}
    >
      <span className="mono text-center text-[12px] font-bold text-fg-subtle tabular-nums">{n}</span>
      <span className="min-w-0 overflow-hidden"><GroupBadge group={s.group} asl={s.asl_guruh} from={s.chiqqan_guruh} short /></span>
      <span className="mono font-bold text-blue-soft truncate">#{s.shnum || '—'}</span>
      <span className="truncate font-semibold text-fg" title={fullName(s)}>{fullName(s)}</span>
      <span className="truncate"><Mono value={s.pv} />{passTypeShort(s) && <span className="ml-1.5 text-[10.5px] font-bold text-fg-subtle">{passTypeShort(s)}</span>}</span>
      <span className="truncate"><Mono value={formatPinfl(s.pinfl)} className="text-[12.5px]" /></span>
      <span className="text-[12.5px] tabular-nums">{s.dob || '—'}</span>
      <span className="truncate"><Mono value={s.sh_doc} /></span>
      <span className="truncate text-[12.5px] text-fg-muted" title={s.mak}>{s.mak || '—'}</span>
      <span className="text-center text-[12.5px] font-semibold">{s.yil || '—'}</span>
      <span><BazaButton student={s} onToggle={onToggleBaza} compact /></span>
      <span><VerifyButton student={s} onToggle={onToggleVerify} /></span>
      <span className="flex justify-center"><StatusIcon status={s.status} /></span>
    </div>
  )
})

const ROW_H = 50

function Table({ students, duplicateRows, onOpen, onToggleVerify, onToggleBaza }: Omit<Props, 'mode' | 'onClearFilters'>) {
  const ref = useRef<HTMLDivElement>(null)
  const top = useOffsetTop(ref)
  const v = useWindowVirtualizer({ count: students.length, estimateSize: () => ROW_H, overscan: 12, scrollMargin: top })

  return (
    <div className="panel overflow-x-auto">
      <div className="min-w-[1440px]">
        <div
          className="grid items-center gap-2 border-b border-line-strong bg-ink-850 px-4 py-3 text-[11px] font-bold tracking-wider text-fg-subtle uppercase"
          style={{ gridTemplateColumns: COLS }}
        >
          <span className="text-center">T/R</span><span>Guruh</span><span>Shartnoma</span><span>F.I.SH</span><span>Pasport</span>
          <span>JSHSHIR</span><span>Tug'ilgan</span><span>Hujjat №</span><span>Muassasa</span><span className="text-center">Yil</span>
          <span>Baza</span><span>Tasdiq</span><span className="text-center">Holat</span>
        </div>
        <div ref={ref} className="relative" style={{ height: v.getTotalSize() }}>
          {v.getVirtualItems().map((item) => {
            const s = students[item.index]
            return (
              <div key={s.row} className="absolute inset-x-0" style={{ top: item.start - v.options.scrollMargin, height: ROW_H }}>
                <TableRow s={s} n={item.index + 1} dup={duplicateRows.has(s.row)} onOpen={onOpen} onToggleVerify={onToggleVerify} onToggleBaza={onToggleBaza} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StudentList({ onClearFilters, ...props }: Props) {
  const wide = useWide()
  if (!props.students.length) {
    return (
      <div className="panel grid place-items-center gap-1 px-6 py-14 text-center">
        <SearchX size={30} className="mb-1 text-fg-subtle" />
        <div className="text-[15px] font-semibold text-fg">Hech narsa topilmadi</div>
        <div className="text-[13px] text-fg-muted">Qidiruv so'zini yoki filtrlarni o'zgartirib ko'ring.</div>
        {onClearFilters && (
          <button type="button" className="btn-ghost mt-3" onClick={onClearFilters}><X size={15} /> Filtrlarni tozalash</button>
        )}
      </div>
    )
  }
  if (props.mode === 'table' && wide) return <Table {...props} />
  return <CardGrid {...props} compact={props.mode !== 'cards'} />
}

export default memo(StudentList)
