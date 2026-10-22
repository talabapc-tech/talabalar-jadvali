'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { FileDown, LayoutGrid, LayoutList, Rows3, Search, SlidersHorizontal, X } from 'lucide-react'
import { ACADEMIC_LEAVE_GROUP, WITHDRAWN_GROUP } from '@/lib/config'
import { EMPTY_FILTERS, type Filters } from '@/lib/student'
import { cx } from './ui'

export type DisplayMode = 'cards' | 'compact' | 'table'

interface Props {
  filters: Filters
  groups: string[]
  onFilter: (patch: Partial<Filters>) => void
  shown: number
  total: number
  mode: DisplayMode
  onMode: (m: DisplayMode) => void
  onExportShown: () => void
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][]
}) {
  return (
    <label className="min-w-0">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cx('field cursor-pointer pr-8', value && 'border-sky/50 text-sky-soft')}>
        <option value="">Barchasi</option>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  )
}

const MODES = [['cards', LayoutGrid, 'Karta'], ['compact', LayoutList, 'Ixcham'], ['table', Rows3, 'Jadval']] as const

function FilterBar({ filters, groups, onFilter, shown, total, mode, onMode, onExportShown }: Props) {
  const searchRef = useRef<HTMLInputElement>(null)
  // Telefonda 7 ta filtr yig'iq turadi — "Filtrlar" tugmasi bilan ochiladi (kompyuterda doim ochiq)
  const [open, setOpen] = useState(false)
  // Kurs — yuqoridagi alohida tanlagich, "tozalash" uni o'zgartirmaydi
  const activeCount = (Object.keys(EMPTY_FILTERS) as (keyof Filters)[]).filter((k) => k !== 'kurs' && k !== 'search' && filters[k]).length
  const active = activeCount > 0 || !!filters.search

  // "/" yoki Ctrl+K — qidiruvga o'tish
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '/' || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <section className="no-print panel p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-2 sm:gap-3">
        <label className="min-w-0 flex-1 basis-full sm:min-w-[240px] sm:basis-auto">
          <span className="label hidden sm:block">Qidiruv — F.I.SH, pasport, JSHSHIR, shartnoma, maktab</span>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
            <input
              ref={searchRef}
              value={filters.search}
              onChange={(e) => onFilter({ search: e.target.value })}
              placeholder="Ism, pasport, JSHSHIR, shartnoma №…"
              className="field h-11 pr-10 pl-9 sm:h-10 [&::-webkit-search-cancel-button]:hidden"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
            />
            {filters.search ? (
              <button
                type="button"
                onClick={() => { onFilter({ search: '' }); searchRef.current?.focus() }}
                className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-fg-subtle hover:bg-ink-700 hover:text-fg"
                aria-label="Qidiruvni tozalash"
              >
                <X size={15} />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-line px-1.5 text-[11px] text-fg-subtle sm:block">/</kbd>
            )}
          </div>
        </label>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cx('btn-ghost h-10 flex-1 md:hidden', (open || activeCount > 0) && 'border-sky/50 text-sky-soft')}
        >
          <SlidersHorizontal size={15} /> Filtrlar
          {activeCount > 0 && <span className="grid size-5 place-items-center rounded-full bg-sky text-[11px] font-bold text-ink-950">{activeCount}</span>}
        </button>
        <div className="flex h-10 rounded-xl border border-line bg-ink-950/60 p-0.5" role="tablist" aria-label="Ko'rinish">
          {MODES.map(([m, Icon, t]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              aria-label={t}
              title={t}
              onClick={() => onMode(m)}
              className={cx('flex items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-semibold transition-colors sm:px-3',
                m === 'table' && 'hidden md:flex',
                mode === m ? 'bg-gradient-to-r from-blue/80 to-sky/80 text-white' : 'text-fg-muted hover:text-fg')}
            >
              <Icon size={15} /> <span className="hidden sm:inline">{t}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={cx('mt-3 grid-cols-2 gap-3 md:grid md:grid-cols-4 xl:grid-cols-7', open ? 'grid' : 'hidden')}>
        <Select label="Guruh" value={filters.group} onChange={(v) => onFilter({ group: v })}
          options={[
            // Kontingent plitkalarida Ctrl bilan bir nechta guruh tanlanganda
            ...(filters.group.includes(',') ? [[filters.group, `${filters.group.split(',').length} ta guruh: ${filters.group.replaceAll(',', ', ')}`] as [string, string]] : []),
            ...groups.map((g) => [g, `Guruh ${g}`] as [string, string]), [ACADEMIC_LEAVE_GROUP, "Akademik ta'tildagilar"], [WITHDRAWN_GROUP, 'Safdan chiqarilganlar']]} />
        <Select label="Operator tasdig'i" value={filters.verified} onChange={(v) => onFilter({ verified: v })}
          options={[['TASDIQLANDI', 'Tasdiqlanganlar'], ['KUTILMOQDA', 'Kutilayotganlar']]} />
        <Select label="Baza holati" value={filters.baza} onChange={(v) => onFilter({ baza: v })}
          options={[['KIRITILDI', 'Bazaga kiritilganlar'], ['KIRITILMAGAN', 'Bazaga kiritilmaganlar']]} />
        <Select label="Hujjat holati" value={filters.status} onChange={(v) => onFilter({ status: v })}
          options={[['full', "To'liq"], ['chala', 'Chala'], ['yoq', "Bo'sh (hujjat yo'q)"]]} />
        <Select label="Pasport turi" value={filters.passType} onChange={(v) => onFilter({ passType: v })}
          options={[['ID-karta', 'ID-karta (AD / AE)'], ['Biometrik Pasport', 'Biometrik (AA / AB / AC)'], ['Mavjud emas', 'Mavjud emas']]} />
        <Select label="Ta'lim hujjati" value={filters.docType} onChange={(v) => onFilter({ docType: v })}
          options={[['Shahodatnoma', 'Shahodatnoma'], ['Diplom', 'Diplom']]} />
        <Select label="Ism mosligi" value={filters.nameFlag} onChange={(v) => onFilter({ nameFlag: v })}
          options={[['ok', "To'liq mos"], ['translit', 'Imlo farqi (q/k, x/h)'], ['farq', "Ro'yxatdan farq bor"], ['tekshir', 'Tekshirish kerak'], ['boshqa', 'Boshqa shaxs hujjati'], ['none', 'Tekshirilmagan']]} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 sm:mt-4 sm:pt-3.5">
        <span className="text-[13px] text-fg-muted">
          <span className="hidden sm:inline">Ko'rsatilmoqda: </span><strong className="text-fg tabular-nums">{shown}</strong>
          <span className="text-fg-subtle"> / {total}</span>
        </span>
        {active && (
          <button type="button" className="btn-ghost h-8 px-2.5 text-[12px]" onClick={() => onFilter({ ...EMPTY_FILTERS, kurs: filters.kurs })}>
            <X size={14} /> Tozalash
          </button>
        )}
        <button type="button" className="btn-ghost ml-auto h-8 px-2.5 text-[12px]" onClick={onExportShown} disabled={!shown} title="Ekrandagi talabalarni Excelga yuklab olish">
          <FileDown size={14} /> <span><span className="hidden min-[400px]:inline">Ko'rinayotganlarni </span>.xlsx</span>
        </button>
      </div>
    </section>
  )
}

export default memo(FilterBar)
