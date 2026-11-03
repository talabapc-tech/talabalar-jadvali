'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, EyeOff, Settings2, X } from 'lucide-react'
import { GROUP_LEADERS, GROUP_SETTINGS, shortFio } from '@/lib/config'
import { groupTitle, isSecretGroup, kursOf, selectedGroups } from '@/lib/student'
import { cx } from './ui'

/*
  Kontingent: kurslar ustunlarda (I · II · III), ichida har guruh — ixcham qator:
  guruh · rahbar · joriy semestr · bazaga kiritilmaganlar · talaba soni.
  Bosish — faqat shu guruh (qayta bosish — filtrni olib tashlash);
  Ctrl/⌘ + bosish — bir nechta guruhni belgilash; kurs sarlavhasi — shu kursning hamma guruhi.
*/

export interface GroupStat { g: string; total: number; /** bazaga kiritilmaganlar */ out: number }

interface Props {
  groups: GroupStat[]
  /** filters.group — bitta guruh yoki "24-11,24-12" */
  active: string
  onPick: (group: string) => void
  onSettings: () => void
}

const ROMAN: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III' }
const TONE: Record<number, { v: string; text: string; bg: string }> = {
  1: { v: '--color-sky', text: 'text-sky-soft', bg: 'bg-sky/10' },
  2: { v: '--color-violet', text: 'text-violet', bg: 'bg-violet/10' },
  3: { v: '--color-amber', text: 'text-amber', bg: 'bg-amber/10' },
}

const COLLAPSE_KEY = 'portal_groups_collapsed'

/** Ro'yxatni yig'ish/yoyish — tanlov eslab qolinadi; telefonda birinchi marta yig'iq holda ochiladi */
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
  const chosenTotalStudents = groups.filter((x) => chosen.includes(x.g)).reduce((a, x) => a + x.total, 0)

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
      return {
        k,
        list,
        total: list.reduce((a, x) => a + x.total, 0),
        chosenCount: chosenInKurs.length,
        chosenTotal: chosenInKurs.reduce((a, x) => a + x.total, 0),
      }
    })
    .filter((c) => c.list.length)

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggleCollapsed} aria-expanded={!collapsed} className="flex items-center gap-1.5 rounded-md py-1 pr-1.5 text-[13.5px] font-bold text-fg hover:text-sky-soft">
            <ChevronDown size={16} className={cx('transition-transform', collapsed && '-rotate-90')} />
            Kontingent — guruhlar
            {collapsed && <span className="font-medium text-fg-subtle">({groups.length})</span>}
          </button>
          <span className="hidden text-[12px] text-fg-subtle xl:inline">
            Bosing — bitta guruh · <kbd className="rounded border border-line bg-ink-800 px-1 font-mono text-[11px]">Ctrl</kbd> + bosing — bir nechta · kurs sarlavhasi — butun kurs
          </span>
          {chosen.length > 0 && (
            <div className="animate-fade-in inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-sky/35 bg-sky/10 px-2.5 py-1 text-[12.5px] font-semibold text-sky-soft">
              <span className="flex items-center gap-1.5 font-bold text-sky">
                <span className="grid size-5 place-items-center rounded-full bg-sky text-[11px] font-black text-ink-950">{chosen.length}</span>
                {chosen.length} ta guruh tanlandi
              </span>
              <span className="text-sky/40">·</span>
              <span className="font-extrabold text-fg tabular-nums">{chosenTotalStudents} nafar talaba</span>
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
        <button type="button" className="btn-ghost ml-auto h-8 px-2.5 text-[12px]" onClick={onSettings} title="Kurs, joriy semestr, guruh rahbari va yo'nalishni o'zgartirish">
          <Settings2 size={14} className="text-sky" /> <span className="sm:hidden">Sozlamalar</span><span className="hidden sm:inline">Guruh sozlamalari</span>
        </button>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-3">
        {columns.map((c) => {
          const tone = TONE[c.k]
          return (
            <section key={c.k} className="panel overflow-hidden">
              <button
                type="button"
                onClick={() => pickKurs(c.list.map((x) => x.g))}
                title={`${ROMAN[c.k]}-kursning hamma guruhini tanlash`}
                className={cx('flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:brightness-125', tone.bg)}
              >
                <span className={cx('text-[14px] font-bold whitespace-nowrap', tone.text)}>{ROMAN[c.k]} · {c.k}-kurs</span>
                {c.chosenCount > 0 ? (
                  <span className="rounded-md border border-sky/40 bg-sky/20 px-2 py-0.5 text-[12px] font-bold text-sky tabular-nums">
                    {c.chosenCount} guruh · {c.chosenTotal} talaba
                  </span>
                ) : (
                  <span className="text-[13px] font-bold text-fg tabular-nums">
                    {c.total} <span className="font-medium text-fg-subtle">nafar · {c.list.length} guruh</span>
                  </span>
                )}
              </button>

              {!collapsed && (
                <ul className="divide-y divide-line/70 border-t border-line">
                  {c.list.map(({ g, total, out }) => {
                    const on = chosen.includes(g)
                    const leader = GROUP_LEADERS[g] || ''
                    const sem = GROUP_SETTINGS[g]?.semestr
                    return (
                      <li key={g}>
                        <button
                          type="button"
                          aria-pressed={on}
                          title={`${g} · ${groupTitle(g)}\nGuruh rahbari: ${leader || '—'}${sem ? `\nJoriy semestr: ${sem}-semestr` : ''}\nCtrl + bosish — bir nechtasini tanlash`}
                          onClick={(e) => pick(g, e.ctrlKey || e.metaKey)}
                          className={cx(
                            'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors select-none sm:gap-3',
                            on ? 'bg-sky/12' : 'hover:bg-ink-850',
                            anyActive && !on && 'opacity-55 hover:opacity-100',
                          )}
                        >
                          <span className={cx('mono flex w-[4.25rem] shrink-0 items-center gap-1 text-[13.5px] font-bold whitespace-nowrap', tone.text)}>
                            {g}
                            {isSecretGroup(g) && <EyeOff size={11} className="shrink-0 text-amber" aria-label="Maxfiy guruh" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-semibold text-fg">{leader ? shortFio(leader) : <span className="font-normal text-fg-subtle">rahbar tanlanmagan</span>}</span>
                            <span className="block truncate text-[11px] text-fg-subtle">{groupTitle(g)}</span>
                          </span>
                          {sem && (
                            <span className="chip mono shrink-0 border-emerald/35 bg-emerald/8 px-1.5 text-[11px] text-emerald-soft">{sem}-sem</span>
                          )}
                          {out > 0 && (
                            <span className="shrink-0 text-[11px] font-bold text-rose tabular-nums" title={`${out} nafar talaba bazaga kiritilmagan`}>−{out}</span>
                          )}
                          <span className="w-8 shrink-0 text-right text-[15px] font-extrabold text-fg tabular-nums">{total}</span>
                          {on && (
                            <span className="grid size-4 shrink-0 place-items-center rounded-full bg-sky text-ink-950"><Check size={11} strokeWidth={3.5} /></span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
