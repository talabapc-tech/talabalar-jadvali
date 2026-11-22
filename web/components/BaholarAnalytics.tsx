'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Award, BarChart3, ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, Users } from 'lucide-react'
import type { BahoRow, Fan } from '@/lib/baholar'
import { GROUP_LEADERS } from '@/lib/config'
import { academicGroups, fullName, isOfficialGroup, kursOf } from '@/lib/student'
import type { Student } from '@/lib/types'
import { ProgressBar, cx } from './ui'

interface AnalyticsPayload {
  ok: boolean
  semestr: number
  fanlarByGroup: Record<string, Fan[]>
  baholarByGroup: Record<string, BahoRow[]>
  amaliyotByGroup: Record<string, { pinfl: string; nom: string; ball: number | null; ball100: number | null }[]>
  error?: string
}

interface DebtorStudent {
  pinfl: string
  fish: string
  reason: string
}

interface GroupStat {
  guruh: string
  kurs: number | null
  rahbar: string
  talabalarSoni: number
  fanlarSoni: number
  completeness: number
  ortacha5: number | null
  ortacha100: number | null
  counts: { b5: number; b4: number; b3: number; b2: number }
  debtors: DebtorStudent[]
}

export default function BaholarAnalytics({
  students,
  semestr,
  onSelectGroup,
}: {
  students: Student[]
  semestr: number
  onSelectGroup: (guruh: string) => void
}) {
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [kursFilter, setKursFilter] = useState<number | null>(null)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/baholar/analytics?semestr=${semestr}`, { cache: 'no-store' })
      const body = (await res.json().catch(() => ({}))) as AnalyticsPayload
      if (!res.ok || !body.ok) throw new Error(body.error || `Server ${res.status}`)
      setData(body)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [semestr])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo<GroupStat[]>(() => {
    if (!data) return []
    const allBaholarByPinfl = new Map<string, Map<string, BahoRow>>()
    for (const rows of Object.values(data.baholarByGroup)) {
      for (const b of rows) {
        const p = String(b.pinfl || '').replace(/\s/g, '')
        if (!p) continue
        let m = allBaholarByPinfl.get(p)
        if (!m) {
          m = new Map()
          allBaholarByPinfl.set(p, m)
        }
        m.set(b.fan, b)
      }
    }

    const groups = academicGroups(students, kursFilter)
    return groups.map((g) => {
      const members = students.filter((s) => isOfficialGroup(s.group) && s.group === g)
      const fanlar = data.fanlarByGroup[g] ?? []
      const fanNoms = fanlar.map((f) => f.nom)

      let filled = 0
      let sum5 = 0
      let cnt5 = 0
      let sum100 = 0
      let cnt100 = 0
      const counts = { b5: 0, b4: 0, b3: 0, b2: 0 }

      // Qaysi fanlarda guruhga baho qo'yish boshlanganini aniqlash (qarzdorlikni to'g'ri hisoblash uchun)
      const gradedFans = new Set<string>()
      for (const s of members) {
        const p = String(s.pinfl || '').replace(/\s/g, '')
        const map = allBaholarByPinfl.get(p)
        if (!map) continue
        for (const fn of fanNoms) {
          const b = map.get(fn)
          if (b && (b.r_semestr !== null || b.yakuniy !== null || b.joriy !== null || b.oraliq !== null)) {
            gradedFans.add(fn)
          }
        }
      }

      const debtors: DebtorStudent[] = []

      for (const s of members) {
        const p = String(s.pinfl || '').replace(/\s/g, '')
        const map = allBaholarByPinfl.get(p)
        let hasTwo = false
        let missingCnt = 0

        for (const fn of fanNoms) {
          const b = map?.get(fn)
          const hasAny = !!b && (b.r_semestr !== null || b.yakuniy !== null || b.joriy !== null || b.oraliq !== null)
          if (hasAny) {
            filled++
            const grade5 = b.r_semestr ?? b.yakuniy
            const grade100 = b.r100 ?? b.yakuniy100
            if (grade5 !== null) {
              sum5 += grade5
              cnt5++
              if (grade5 === 5) counts.b5++
              else if (grade5 === 4) counts.b4++
              else if (grade5 === 3) counts.b3++
              else if (grade5 === 2) {
                counts.b2++
                hasTwo = true
              }
            }
            if (grade100 !== null) {
              sum100 += grade100
              cnt100++
            }
          } else if (gradedFans.has(fn)) {
            missingCnt++
          }
        }

        if (hasTwo || missingCnt > 0) {
          const parts: string[] = []
          if (hasTwo) parts.push('2 baho bor')
          if (missingCnt > 0) parts.push(`${missingCnt} fandan baho yo'q`)
          debtors.push({ pinfl: p || String(s.row), fish: fullName(s), reason: parts.join(' · ') })
        }
      }

      const denom = members.length * fanNoms.length
      const completeness = denom > 0 ? Math.round((filled / denom) * 100) : 0
      const ortacha5 = cnt5 > 0 ? Math.round((sum5 / cnt5) * 100) / 100 : null
      const ortacha100 = cnt100 > 0 ? Math.round((sum100 / cnt100) * 10) / 10 : null

      return {
        guruh: g,
        kurs: kursOf(g),
        rahbar: GROUP_LEADERS[g] || '—',
        talabalarSoni: members.length,
        fanlarSoni: fanNoms.length,
        completeness,
        ortacha5,
        ortacha100,
        counts,
        debtors,
      }
    })
  }, [data, students, kursFilter])

  const summary = useMemo(() => {
    const withFans = stats.filter((s) => s.fanlarSoni > 0 && s.talabalarSoni > 0)
    const avgComp = withFans.length ? Math.round(withFans.reduce((a, b) => a + b.completeness, 0) / withFans.length) : 0
    const with5 = stats.filter((s) => s.ortacha5 !== null)
    const avg5 = with5.length ? Math.round((with5.reduce((a, b) => a + (b.ortacha5 ?? 0), 0) / with5.length) * 100) / 100 : null
    const with100 = stats.filter((s) => s.ortacha100 !== null)
    const avg100 = with100.length
      ? Math.round((with100.reduce((a, b) => a + (b.ortacha100 ?? 0), 0) / with100.length) * 10) / 10
      : null
    const totalDebtors = stats.reduce((a, b) => a + b.debtors.length, 0)
    return { groupsCount: stats.length, avgComp, avg5, avg100, totalDebtors }
  }, [stats])

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-sky" />
            <div>
              <h2 className="text-[15px] font-bold text-fg">Guruhlar kesimida o‘zlashtirish tahlili · {semestr}-semestr</h2>
              <p className="text-[12px] text-fg-muted">
                Baholar to‘liqligi, o‘rtacha reyting va qarzdor talabalar ko‘rsatkichlari
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="seg">
              {([
                [null, 'Barchasi'],
                [1, '1-kurs'],
                [2, '2-kurs'],
                [3, '3-kurs'],
              ] as const).map(([k, label]) => (
                <button
                  key={String(k ?? 'all')}
                  type="button"
                  aria-pressed={kursFilter === k}
                  onClick={() => setKursFilter(k)}
                  className="seg-btn h-8 px-2.5 text-[12px]"
                >
                  {label}
                </button>
              ))}
            </div>

            <button type="button" onClick={() => void load()} disabled={loading} className="btn-ghost h-8 px-3 text-[12px]">
              <RefreshCw size={13} className={cx(loading && 'animate-spin')} />
              <span>Yangilash</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-xl border border-line bg-ink-950/60 p-3">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-fg-muted">
              <Users size={13} className="text-sky" /> Guruhlar soni
            </div>
            <div className="mt-1 text-[22px] font-extrabold tabular-nums text-fg">{summary.groupsCount}</div>
          </div>
          <div className="rounded-xl border border-line bg-ink-950/60 p-3">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-fg-muted">
              <BarChart3 size={13} className="text-emerald-soft" /> O‘rtacha to‘liqlik
            </div>
            <div className="mt-1 text-[22px] font-extrabold tabular-nums text-emerald-soft">{summary.avgComp}%</div>
          </div>
          <div className="rounded-xl border border-line bg-ink-950/60 p-3">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-fg-muted">
              <Award size={13} className="text-sky-soft" /> O‘rtacha baho / reyting
            </div>
            <div className="mt-1 text-[22px] font-extrabold tabular-nums text-sky-soft">
              {summary.avg5 !== null ? summary.avg5.toFixed(2) : '—'}
              <span className="ml-1.5 text-[13px] font-semibold text-fg-muted">
                ({summary.avg100 !== null ? `${summary.avg100} ball` : '—'})
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-ink-950/60 p-3">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-fg-muted">
              <AlertTriangle size={13} className="text-amber" /> Qarzdor / chala talabalar
            </div>
            <div className="mt-1 text-[22px] font-extrabold tabular-nums text-amber">{summary.totalDebtors}</div>
          </div>
        </div>
      </div>

      {error && <div className="panel border-rose/40 bg-rose/5 p-4 text-[13px] text-rose">Xato: {error}</div>}

      {loading && !data ? (
        <div className="panel flex items-center justify-center gap-2 py-14 text-[13px] text-fg-muted">
          <Loader2 size={16} className="animate-spin text-sky" /> Tahlil hisoblanmoqda…
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
              <thead className="border-b border-line bg-ink-900 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
                <tr>
                  <th className="px-3 py-2.5">Guruh</th>
                  <th className="px-3 py-2.5">Rahbar</th>
                  <th className="px-3 py-2.5 text-center">Talaba</th>
                  <th className="px-3 py-2.5 text-center">Fanlar</th>
                  <th className="w-44 px-3 py-2.5">To‘liqlik</th>
                  <th className="px-3 py-2.5 text-center">O‘rtacha (5 / 100)</th>
                  <th className="w-44 px-3 py-2.5">Baholar taqsimoti (5/4/3/2)</th>
                  <th className="px-3 py-2.5">Qarzdorlar</th>
                  <th className="px-3 py-2.5 text-right">Jadval</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stats.map((st) => {
                  const totalDist = st.counts.b5 + st.counts.b4 + st.counts.b3 + st.counts.b2
                  const isOpen = expandedGroup === st.guruh
                  return (
                    <Fragment key={st.guruh}>
                      <tr className="hover:bg-ink-850/60">
                        <td className="px-3 py-2.5">
                          <span className="chip mono border-sky/40 bg-sky/10 font-bold text-sky-soft">{st.guruh}</span>
                          {st.kurs ? <span className="ml-1.5 text-[11px] text-fg-subtle">{st.kurs}-k</span> : null}
                        </td>
                        <td className="px-3 py-2.5 text-[12.5px] text-fg-muted">{st.rahbar}</td>
                        <td className="px-3 py-2.5 text-center tabular-nums font-semibold">{st.talabalarSoni}</td>
                        <td className="px-3 py-2.5 text-center tabular-nums">
                          {st.fanlarSoni > 0 ? (
                            <span className="font-semibold">{st.fanlarSoni}</span>
                          ) : (
                            <span className="text-rose/80">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <ProgressBar value={st.completeness} tone={st.completeness >= 90 ? 'emerald' : 'sky'} />
                            </div>
                            <span className="mono w-9 text-right text-[11.5px] font-bold">{st.completeness}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center tabular-nums">
                          {st.ortacha5 !== null ? (
                            <span>
                              <b className="text-fg">{st.ortacha5.toFixed(2)}</b>{' '}
                              <span className="text-[11.5px] text-fg-muted">/ {st.ortacha100 ?? '—'}</span>
                            </span>
                          ) : (
                            <span className="text-fg-subtle">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {totalDist > 0 ? (
                            <div className="space-y-1">
                              <div className="flex h-2 w-full overflow-hidden rounded-full bg-ink-800">
                                {st.counts.b5 > 0 && (
                                  <div className="bg-emerald" style={{ width: `${(st.counts.b5 / totalDist) * 100}%` }} />
                                )}
                                {st.counts.b4 > 0 && (
                                  <div className="bg-sky" style={{ width: `${(st.counts.b4 / totalDist) * 100}%` }} />
                                )}
                                {st.counts.b3 > 0 && (
                                  <div className="bg-amber" style={{ width: `${(st.counts.b3 / totalDist) * 100}%` }} />
                                )}
                                {st.counts.b2 > 0 && (
                                  <div className="bg-rose" style={{ width: `${(st.counts.b2 / totalDist) * 100}%` }} />
                                )}
                              </div>
                              <div className="mono flex gap-2 text-[10.5px] text-fg-subtle">
                                <span className="text-emerald-soft">5:{st.counts.b5}</span>
                                <span className="text-sky-soft">4:{st.counts.b4}</span>
                                <span className="text-amber">3:{st.counts.b3}</span>
                                {st.counts.b2 > 0 && <span className="text-rose">2:{st.counts.b2}</span>}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11.5px] text-fg-subtle">Baho yo‘q</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {st.debtors.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => setExpandedGroup(isOpen ? null : st.guruh)}
                              className="chip cursor-pointer border-amber/40 bg-amber/10 text-[11px] font-bold text-amber hover:bg-amber/20"
                            >
                              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              {st.debtors.length} nafar
                            </button>
                          ) : (
                            <span className="text-[11.5px] text-emerald-soft">Yo‘q</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => onSelectGroup(st.guruh)}
                            className="btn-ghost h-8 px-2.5 text-[12px] text-sky-soft"
                          >
                            <span>Ochish</span>
                            <ExternalLink size={12} />
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${st.guruh}-debtors`} className="bg-ink-950/60">
                          <td colSpan={9} className="px-4 py-3">
                            <div className="mb-1.5 text-[11.5px] font-bold text-amber">
                              {st.guruh} guruhida qarzdor / bahosi chala talabalar ({st.debtors.length} nafar):
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {st.debtors.map((d) => (
                                <span
                                  key={d.pinfl}
                                  className="chip border-line bg-ink-900 text-[11.5px] text-fg"
                                >
                                  <b>{d.fish}</b> <span className="text-fg-muted">({d.reason})</span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
