'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, EyeOff, Settings2, X } from 'lucide-react'
import { GROUP_LEADERS } from '@/lib/config'
import { groupTitle, isSecretGroup, kursOf, selectedGroups } from '@/lib/student'
import { cx, ProgressBar } from './ui'

/*
  Kontingent: kurslar ustunlarda (I · II · III), ichida guruh plitkalari.
  Plitka rangi — kurs, to'qligi — tasdiqlanish foizi.
  Bosish — faqat shu guruh (qayta bosish — filtrni olib tashlash);
  Ctrl/⌘ + bosish — bir nechta guruhni belgilash; kurs sarlavhasi — shu kursning hamma guruhi.
*/

export interface GroupStat { g: string; total: number; ver: number }

interface Props {
  groups: GroupStat[]
  /** filters.group — bitta guruh yoki "24-11,24-12" */
  active: string
  onPick: (group: string) => void
  onSettings: () => void
}

const ROMAN: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III' }
// Tailwind ranglari (globals.css @theme) — CSS o'zgaruvchi orqali foizga qarab aralashtiriladi
const TONE: Record<number, { v: string; text: string; ring: string }> = {
  1: { v: '--color-sky', text: 'text-sky-soft', ring: 'border-sky/45' },
  2: { v: '--color-violet', text: 'text-violet', ring: 'border-violet/45' },
  3: { v: '--color-amber', text: 'text-amber', ring: 'border-amber/45' },
}

const COLLAPSE_KEY = 'portal_groups_collapsed'

/** Plitkalarni yig'ish/yoyish — tanlov eslab qolinadi; telefonda birinchi marta yig'iq holda ochiladi */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY)
      setCollapsed(saved === null ? window.matchMedia('(max-width: 639px)').matches : saved === '1')
    } catch { /* bo'sh */ }
  }, [])
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch { /* bo'sh */ }
    return !c
  })
  return [collapsed, toggle] as const
}

export default function GroupCards({ groups, active, onPick, onSettings }: Props) {
  const [collapsed, toggleCollapsed] = useCollapsed()
  const chosen = selectedGroups(active).filter((g) => groups.some((x) => x.g === g))
  const anyActive = chosen.length > 0

  const chosenStats = groups.filter((x) => chosen.includes(x.g))
  const chosenTotalStudents = chosenStats.reduce((a, x) => a + x.total, 0)
  const chosenVerStudents = chosenStats.reduce((a, x) => a + x.ver, 0)

  const pick = (g: string, multi: boolean) => {
    if (!multi) return onPick(chosen.length === 1 && chosen[0] === g ? '' : g)
    const next = chosen.includes(g) ? chosen.filter((x) => x !== g) : [...chosen, g]
    onPick(next.sort().join(','))
  }
  const pickKurs = (list: string[]) => {
    const all = list.length > 0 && list.every((g) => chosen.includes(g)) && chosen.length === list.length
    onPick(all ? '' : [...list].sort().join(','))
  }

  const columns = [1, 2, 3]
    .map((k) => {
      const list = groups.filter((x) => kursOf(x.g) === k)
      const chosenInKurs = list.filter((x) => chosen.includes(x.g))
      const chosenKursTotal = chosenInKurs.reduce((a, x) => a + x.total, 0)
      const chosenKursVer = chosenInKurs.reduce((a, x) => a + x.ver, 0)
      return {
        k,
        list,
        total: list.reduce((a, x) => a + x.total, 0),
        ver: list.reduce((a, x) => a + x.ver, 0),
        chosenCount: chosenInKurs.length,
        chosenTotal: chosenKursTotal,
        chosenVer: chosenKursVer,
      }
    })
    .filter((c) => c.list.length)

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggleCollapsed} aria-expanded={!collapsed} className="flex items-center gap-1.5 rounded-lg py-1 pr-1.5 text-[13px] font-bold text-fg hover:text-sky-soft">
            <ChevronDown size={16} className={cx('transition-transform', collapsed && '-rotate-90')} />
            Kontingent — guruhlar
            {collapsed && <span className="font-medium text-fg-subtle">({groups.length})</span>}
          </button>
          <span className="hidden text-[12px] text-fg-subtle lg:inline">
            Bosing — bitta guruh · <kbd className="rounded border border-line bg-ink-800 px-1 font-mono text-[11px]">Ctrl</kbd> + bosing — bir nechta · kurs sarlavhasi — butun kurs
          </span>
          {chosen.length > 0 && (
            <div className="animate-fade-in inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-sky/40 bg-sky/15 px-3 py-1 text-[13px] font-semibold text-sky-soft shadow-sm">
              <span className="flex items-center gap-1.5 font-bold text-sky">
                <span className="grid size-5 place-items-center rounded-full bg-sky text-ink-950 text-[11px] font-black">
                  {chosen.length}
                </span>
                {chosen.length} ta guruh tanlandi
              </span>
              <span className="text-sky/40">·</span>
              <span className="font-extrabold text-fg tabular-nums">
                {chosenTotalStudents} nafar talaba
              </span>
              {chosenVerStudents > 0 && (
                <span className="text-[11.5px] font-medium text-emerald-soft tabular-nums">
                  ({chosenVerStudents} tasdiqlangan)
                </span>
              )}
              <button
                type="button"
                className="ml-1 inline-flex items-center gap-0.5 rounded-md bg-sky/20 px-1.5 py-0.5 text-[11.5px] font-bold text-sky-soft transition-colors hover:bg-rose/25 hover:text-rose"
                onClick={() => onPick('')}
                title="Tanlovni tozalash"
              >
                <X size={13} /> Tozalash
              </button>
            </div>
          )}
        </div>
        <button type="button" className="btn-ghost ml-auto h-8 px-2.5 text-[12px]" onClick={onSettings} title="Kurs, guruh rahbari va yo'nalishni o'zgartirish">
          <Settings2 size={14} className="text-sky" /> <span className="sm:hidden">Sozlamalar</span><span className="hidden sm:inline">Guruh sozlamalari</span>
        </button>
      </div>

      {/* Ustun kengligi guruhlar soniga mos — ko'p guruhli kurs kengroq, ustunlar balandligi teng */}
      <div
        className="grid gap-3 lg:grid-cols-[var(--cols)]"
        style={{ '--cols': columns.map((c) => `minmax(0,${Math.max(2, Math.ceil(c.list.length / 2))}fr)`).join(' ') } as React.CSSProperties}
      >
        {columns.map((c) => {
          const tone = TONE[c.k]
          const cp = c.total ? Math.round((c.ver / c.total) * 100) : 0
          return (
            <section key={c.k} className={cx('panel overflow-hidden', collapsed && 'lg:self-start')} style={{ borderTop: `3px solid var(${tone.v})` }}>
              <button
                type="button"
                onClick={() => pickKurs(c.list.map((x) => x.g))}
                title={`${ROMAN[c.k]}-kursning hamma guruhini tanlash`}
                className={cx('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-850', !collapsed && 'border-b border-line')}
              >
                <span className={cx('mono text-[24px] leading-none font-extrabold', tone.text)}>{ROMAN[c.k]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold text-fg">{c.k}-kurs</span>
                  <span className="block text-[12px] text-fg-muted">{c.list.length} ta guruh</span>
                </span>
                <span className="text-right">
                  {c.chosenCount > 0 ? (
                    <div>
                      <span className="inline-flex items-center gap-1 rounded-md border border-sky/40 bg-sky/20 px-2 py-0.5 text-[12px] font-bold text-sky tabular-nums">
                        {c.chosenCount} guruh · {c.chosenTotal} talaba
                      </span>
                      <span className="block text-[11px] text-fg-subtle tabular-nums mt-0.5">
                        jami: {c.total} ({c.ver} tasdiqlangan)
                      </span>
                    </div>
                  ) : (
                    <>
                      <span className="block text-[22px] leading-none font-extrabold text-fg tabular-nums">{c.total}</span>
                      <span className={cx('text-[11.5px] font-bold tabular-nums', cp === 100 ? 'text-emerald-soft' : 'text-fg-muted')}>{c.ver} tasdiqlangan</span>
                    </>
                  )}
                </span>
              </button>

              {!collapsed && <div className="grid grid-cols-3 gap-2 p-2.5 sm:gap-2.5 sm:p-3 xl:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
                {c.list.map(({ g, total, ver }) => {
                  const p = total ? Math.round((ver / total) * 100) : 0
                  const on = chosen.includes(g)
                  return (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={on}
                      title={`${g} · ${GROUP_LEADERS[g] || '—'} · ${groupTitle(g)}\nCtrl + bosish — bir nechtasini tanlash`}
                      onClick={(e) => pick(g, e.ctrlKey || e.metaKey)}
                      className={cx(
                        'relative min-w-0 rounded-xl border p-2.5 text-left transition-all duration-150 select-none sm:p-3',
                        tone.ring,
                        on ? 'ring-2 ring-sky shadow-[0_10px_28px_-12px_rgb(56_189_248/0.7)]' : 'hover:-translate-y-px hover:brightness-125',
                        anyActive && !on && 'opacity-45 saturate-50 hover:opacity-100 hover:saturate-100',
                      )}
                      style={{ background: `color-mix(in srgb, var(${tone.v}) ${8 + p / 7}%, transparent)` }}
                    >
                      {on && (
                        <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-sky text-ink-950 sm:top-2 sm:right-2">
                          <Check size={13} strokeWidth={3.5} />
                        </span>
                      )}
                      <span className={cx('mono flex items-center gap-1.5 text-[14px] font-bold sm:text-[17px]', tone.text)}>
                        {g}
                        {isSecretGroup(g) && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-amber/55 bg-amber/10 px-1 py-px font-sans text-[10.5px] font-bold text-amber sm:px-1.5" title="Maxfiy guruh: darslarga kelmaydiganlar — kontraktlarga kirmaydi">
                            <EyeOff size={10} /> <span className="hidden sm:inline">maxfiy</span>
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[22px] leading-tight font-extrabold text-fg tabular-nums sm:text-[28px]">
                        {total}<span className="ml-1 hidden text-[12px] font-semibold text-fg-muted sm:inline">nafar</span>
                      </span>
                      <span className="block truncate text-[11.5px] font-semibold text-fg sm:text-[13px]">{GROUP_LEADERS[g] || '—'}</span>
                      <span className="hidden truncate text-[11.5px] text-fg-muted sm:block">{groupTitle(g)}</span>
                      <span className="mt-1.5 flex items-center gap-1.5 sm:mt-2 sm:gap-2">
                        <ProgressBar value={p} />
                        <span className={cx('text-[10.5px] font-bold tabular-nums sm:text-[11.5px]', p === 100 ? 'text-emerald-soft' : 'text-fg-muted')}>{ver}/{total}</span>
                      </span>
                    </button>
                  )
                })}
              </div>}
            </section>
          )
        })}
      </div>
    </div>
  )
}
