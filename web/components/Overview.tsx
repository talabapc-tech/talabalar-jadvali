'use client'

import { memo, useMemo } from 'react'
import { CalendarOff, Database, FileWarning, UserMinus, Users } from 'lucide-react'
import { ACADEMIC_LEAVE_GROUP, WITHDRAWN_GROUP } from '@/lib/config'
import { isAcademicLeave, isBazaEntered, isOfficialGroup, type Filters } from '@/lib/student'
import type { Student } from '@/lib/types'
import GroupCards from './GroupCards'
import { cx, ProgressBar } from './ui'

interface Props {
  students: Student[]
  /** Tanlangan kursdagi akademik guruhlar */
  groups: string[]
  filters: Filters
  onFilter: (patch: Partial<Filters>) => void
  onGroupSettings: () => void
}

function Tile({
  icon: Icon, label, value, sub, tone, active, onClick, className,
}: {
  icon: typeof Users; label: string; value: React.ReactNode; sub?: React.ReactNode
  tone: 'blue' | 'emerald' | 'amber' | 'sky' | 'rose' | 'violet'; active?: boolean; onClick?: () => void; className?: string
}) {
  const tones = {
    blue: 'bg-blue/12 text-blue-soft',
    emerald: 'bg-emerald/12 text-emerald-soft',
    amber: 'bg-amber/12 text-amber',
    sky: 'bg-sky/12 text-sky-soft',
    rose: 'bg-rose/12 text-rose',
    violet: 'bg-violet/12 text-violet',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      className={cx(
        'panel group min-w-0 px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-ink-850 sm:px-3.5 sm:py-3',
        active && 'border-sky/50 bg-ink-850 ring-1 ring-sky/25',
        className,
      )}
    >
      <span className="block truncate text-[12px] font-semibold text-fg-muted" title={label}>{label}</span>
      <span className="mt-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[21px] leading-tight font-extrabold tracking-tight text-fg tabular-nums sm:text-[22px]">{value}</span>
        <span className={cx('grid size-7 shrink-0 place-items-center rounded-md', tones[tone])}>
          <Icon size={15} strokeWidth={2.2} />
        </span>
      </span>
      {sub && <span className="mt-0.5 block truncate text-[11.5px] text-fg-subtle">{sub}</span>}
    </button>
  )
}

function Overview({ students, groups, filters, onFilter, onGroupSettings }: Props) {
  const stats = useMemo(() => {
    const byGroup: Record<string, { total: number; out: number }> = {}
    for (const g of groups) byGroup[g] = { total: 0, out: 0 }
    let official = 0, bazaIn = 0, leave = 0, withdrawn = 0, chala = 0, yoq = 0
    for (const s of students) {
      const inDb = isBazaEntered(s)
      if (isOfficialGroup(s.group)) {
        const g = byGroup[s.group.trim()]
        if (!g) continue // boshqa kurs
        official++
        g.total++
        if (inDb) bazaIn++
        else g.out++
        if (s.status === 'chala') chala++
        if (s.status === 'yoq') yoq++
      } else if (isAcademicLeave(s.group)) leave++
      else withdrawn++
    }
    return { byGroup, official, bazaIn, bazaOut: official - bazaIn, leave, withdrawn, chala, yoq }
  }, [students, groups])

  const bazaPct = stats.official ? Math.round((stats.bazaIn / stats.official) * 100) : 0
  const toggleBazaFilter = () => {
    // 1-bosish: kiritilmaganlar (agar bor bo'lsa), keyin kiritilganlar, keyin barchasi
    if (!filters.baza) onFilter({ baza: stats.bazaOut > 0 ? 'KIRITILMAGAN' : 'KIRITILDI' })
    else if (filters.baza === 'KIRITILMAGAN') onFilter({ baza: 'KIRITILDI' })
    else onFilter({ baza: '' })
  }
  const toggleGroup = (g: string) => onFilter({ group: filters.group === g ? '' : g })

  return (
    <section className="space-y-3.5">
      {/* 5 ta plitka: kompyuterda bir qatorda, telefonda birinchisi ikki ustunni egallaydi — bo'sh joy qolmaydi */}
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5 md:grid-cols-5">
        <Tile icon={Users} tone="blue" label={filters.kurs ? `${filters.kurs}-kurs kontingenti` : 'Rasmiy kontingent'} value={stats.official} sub={`${groups.length} ta guruh`}
          className="col-span-2 md:col-span-1"
          active={!filters.group && !filters.baza && !filters.status} onClick={() => onFilter({ group: '', baza: '', status: '' })} />
        <Tile icon={Database} tone="sky" label="Bazaga kiritilgan"
          value={<>{stats.bazaIn}<span className="text-[14px] font-bold text-fg-subtle"> / {stats.official}</span></>}
          sub={stats.bazaOut > 0 ? <span className="font-semibold text-rose">{stats.bazaOut} ta kiritilmagan</span> : <span className="flex items-center gap-2"><span className="w-12"><ProgressBar value={bazaPct} tone="sky" /></span>{bazaPct}%</span>}
          active={!!filters.baza} onClick={toggleBazaFilter} />
        <Tile icon={FileWarning} tone="sky" label="Hujjati chala" value={stats.chala + stats.yoq} sub={`${stats.chala} chala · ${stats.yoq} bo'sh`}
          active={filters.status === 'chala'} onClick={() => onFilter({ status: filters.status === 'chala' ? '' : 'chala' })} />
        <Tile icon={CalendarOff} tone="violet" label="Akademik ta'til" value={stats.leave} sub="Hisobdan tashqari"
          active={filters.group === ACADEMIC_LEAVE_GROUP} onClick={() => toggleGroup(ACADEMIC_LEAVE_GROUP)} />
        <Tile icon={UserMinus} tone="rose" label="Safdan chiqarilgan" value={stats.withdrawn} sub="Hisobdan tashqari"
          active={filters.group === WITHDRAWN_GROUP} onClick={() => toggleGroup(WITHDRAWN_GROUP)} />
      </div>

      {groups.length ? (
        <GroupCards groups={groups.map((g) => ({ g, ...stats.byGroup[g] }))} active={filters.group} onPick={(group) => onFilter({ group })} onSettings={onGroupSettings} />
      ) : (
        <div className="panel px-5 py-6 text-center text-[13px] text-fg-muted">
          {filters.kurs}-kurs guruhlari va talabalari hali kiritilmagan.
        </div>
      )}
    </section>
  )
}

export default memo(Overview)
