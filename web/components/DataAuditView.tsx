'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCopy,
  FileWarning,
  History,
  Loader2,
  PhoneOff,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  UserMinus,
  UserPlus,
  Wrench,
} from 'lucide-react'
import { COURSES } from '@/lib/config'
import { academicGroups, fullName, isOfficialGroup, kursOf } from '@/lib/student'
import type { Student } from '@/lib/types'
import type { Notify } from './Toast'
import { GroupBadge, cx } from './ui'

interface AuditLogEntry {
  id: string
  vaqt: string
  amal: 'update_student' | 'verify_student' | 'baza_student' | 'delete_student' | 'add_student' | 'move_group'
  row: number
  fish: string
  pinfl: string
  group: string
  tafsilot: string
  fields?: Record<string, string>
}

type IssueKind = 'all' | 'no_tel' | 'no_shnum' | 'no_doc' | 'no_pass' | 'name_diff' | 'unverified'

function studentIssues(s: Student) {
  const noTel = !String(s.tel || '').trim()
  const noShnum = !String(s.shnum || '').trim()
  const noDoc = !String(s.sh_doc || '').trim()
  const cleanPin = String(s.pinfl || '').replace(/\s/g, '')
  const noPass = !String(s.pv || '').trim() || cleanPin.length !== 14 || !String(s.dob || '').trim()
  const nameDiff = !!s.name_flag && s.name_flag !== 'ok'
  const unverified = s.verified !== 'TASDIQLANDI'
  const anyCore = noTel || noShnum || noDoc || noPass || nameDiff
  return { noTel, noShnum, noDoc, noPass, nameDiff, unverified, anyCore }
}

const ACTION_META: Record<AuditLogEntry['amal'], { label: string; cls: string; icon: typeof History }> = {
  move_group: { label: "Guruh ko'chirish", cls: 'border-violet/40 bg-violet/10 text-violet', icon: ArrowRight },
  update_student: { label: 'Tahrirlash', cls: 'border-sky/40 bg-sky/10 text-sky-soft', icon: Wrench },
  add_student: { label: "Qo'shish", cls: 'border-emerald/40 bg-emerald/10 text-emerald-soft', icon: UserPlus },
  verify_student: { label: 'Tasdiqlash', cls: 'border-amber/40 bg-amber/10 text-amber', icon: UserCheck },
  baza_student: { label: 'Baza holati', cls: 'border-blue/40 bg-blue/10 text-blue-soft', icon: CheckCircle2 },
  delete_student: { label: "O'chirish", cls: 'border-rose/40 bg-rose/10 text-rose', icon: UserMinus },
}

function fmtTime(iso: string): string {
  if (!iso) return 'Vaqt noma’lum'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('uz-UZ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function DataAuditView({
  students,
  mode,
  onOpen,
  notify,
}: {
  students: Student[]
  mode: 'audit' | 'history'
  onOpen: (s: Student) => void
  notify: Notify
}) {
  /* ------------------------------- AUDIT HOLATI ------------------------------- */
  const [issue, setIssue] = useState<IssueKind>('all')
  const [kurs, setKurs] = useState('')
  const [group, setGroup] = useState('')
  const [search, setSearch] = useState('')
  const [includeLeft, setIncludeLeft] = useState(false)

  const groups = useMemo(() => academicGroups(students, kurs ? Number(kurs) : null), [students, kurs])

  const pool = useMemo(() => {
    return students.filter((s) => {
      if (!includeLeft && !isOfficialGroup(s.group)) return false
      if (kurs && kursOf(s.group) !== Number(kurs)) return false
      if (group && s.group !== group) return false
      return true
    })
  }, [students, includeLeft, kurs, group])

  const counts = useMemo(() => {
    const c = { all: 0, no_tel: 0, no_shnum: 0, no_doc: 0, no_pass: 0, name_diff: 0, unverified: 0 }
    for (const s of pool) {
      const k = studentIssues(s)
      if (k.anyCore) c.all++
      if (k.noTel) c.no_tel++
      if (k.noShnum) c.no_shnum++
      if (k.noDoc) c.no_doc++
      if (k.noPass) c.no_pass++
      if (k.nameDiff) c.name_diff++
      if (k.unverified) c.unverified++
    }
    return c
  }, [pool])

  const auditRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pool.filter((s) => {
      const k = studentIssues(s)
      const hit =
        issue === 'all'
          ? k.anyCore
          : issue === 'no_tel'
            ? k.noTel
            : issue === 'no_shnum'
              ? k.noShnum
              : issue === 'no_doc'
                ? k.noDoc
                : issue === 'no_pass'
                  ? k.noPass
                  : issue === 'name_diff'
                    ? k.nameDiff
                    : k.unverified
      if (!hit) return false
      if (!q) return true
      return [fullName(s), s.group, s.pinfl, s.pv, s.shnum, s.tel].join(' ').toLowerCase().includes(q)
    })
  }, [pool, issue, search])

  const copySurveyLink = async () => {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const url = `${origin}/sorovnoma${group ? `?guruh=${encodeURIComponent(group)}` : ''}`
      await navigator.clipboard.writeText(url)
      notify(`So'rovnoma havolasi nusxalandi: ${url}`, 'success')
    } catch {
      notify("Havolani nusxalab bo'lmadi: /sorovnoma", 'warning')
    }
  }

  /* ------------------------------- AMALLAR TARIXI ------------------------------- */
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState('')
  const [logFilter, setLogFilter] = useState<'all' | AuditLogEntry['amal']>('all')
  const [logQuery, setLogQuery] = useState('')

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    setLogsError('')
    try {
      const res = await fetch('/api/audit-log', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) throw new Error(body.error || `Server ${res.status}`)
      setLogs(Array.isArray(body.items) ? body.items : [])
    } catch (e) {
      setLogsError((e as Error).message)
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mode === 'history') void loadLogs()
  }, [mode, loadLogs])

  const filteredLogs = useMemo(() => {
    const q = logQuery.trim().toLowerCase()
    return logs.filter((l) => {
      if (logFilter !== 'all' && l.amal !== logFilter) return false
      if (!q) return true
      return [l.fish, l.group, l.pinfl, l.tafsilot].join(' ').toLowerCase().includes(q)
    })
  }, [logs, logFilter, logQuery])

  const findStudent = (row: number, pinfl: string) => {
    const clean = (pinfl || '').replace(/\s/g, '')
    return (
      (clean.length === 14 ? students.find((s) => (s.pinfl || '').replace(/\s/g, '') === clean) : undefined) ??
      students.find((s) => s.row === row)
    )
  }

  if (mode === 'history') {
    return (
      <div className="space-y-4">
        <div className="panel space-y-3 p-3.5 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History size={18} className="text-sky" />
              <div>
                <h2 className="text-[15px] font-bold text-fg">Amallar tarixi (Audit Log)</h2>
                <p className="text-[12px] text-fg-muted">
                  Tahrirlash, qo‘shish, tasdiqlash va guruh ko‘chirish yozuvlari ({filteredLogs.length} ta)
                </p>
              </div>
            </div>
            <button type="button" className="btn-ghost h-9 px-3" onClick={() => void loadLogs()} disabled={logsLoading}>
              <RefreshCw size={14} className={cx(logsLoading && 'animate-spin')} />
              <span>Yangilash</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
              <input
                type="search"
                className="field h-9 w-full pl-9"
                placeholder="F.I.Sh., guruh, buyruq yoki tafsilot bo‘yicha qidirish…"
                value={logQuery}
                onChange={(e) => setLogQuery(e.target.value)}
              />
            </div>

            <div className="seg flex-wrap">
              {(
                [
                  ['all', 'Barchasi'],
                  ['move_group', "Guruh ko'chirish"],
                  ['update_student', 'Tahrirlash'],
                  ['add_student', "Qo'shish"],
                  ['verify_student', 'Tasdiqlash'],
                  ['delete_student', "O'chirish"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={logFilter === k}
                  onClick={() => setLogFilter(k)}
                  className="seg-btn h-8 px-2.5 text-[12px]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {logsError && (
          <div className="panel border-rose/40 bg-rose/5 p-4 text-[13px] text-rose">Xato: {logsError}</div>
        )}

        {logsLoading && !logs.length ? (
          <div className="panel flex items-center justify-center gap-2 py-12 text-[13px] text-fg-muted">
            <Loader2 size={16} className="animate-spin text-sky" /> Tarix yuklanmoqda…
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="panel py-12 text-center text-[13px] text-fg-muted">Mos keluvchi amal topilmadi.</div>
        ) : (
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
                <thead className="border-b border-line bg-ink-900 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
                  <tr>
                    <th className="px-3 py-2.5">Vaqt</th>
                    <th className="px-3 py-2.5">Amal</th>
                    <th className="px-3 py-2.5">Talaba (F.I.Sh.)</th>
                    <th className="px-3 py-2.5">Guruh</th>
                    <th className="px-3 py-2.5">Tafsilot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredLogs.map((l) => {
                    const meta = ACTION_META[l.amal] ?? ACTION_META.update_student
                    const Icon = meta.icon
                    const st = findStudent(l.row, l.pinfl)
                    return (
                      <tr key={l.id} className="hover:bg-ink-850/60">
                        <td className="mono whitespace-nowrap px-3 py-2.5 text-[12px] text-fg-muted">{fmtTime(l.vaqt)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span className={cx('chip text-[11px]', meta.cls)}>
                            <Icon size={11} />
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-fg">
                          {st ? (
                            <button
                              type="button"
                              onClick={() => onOpen(st)}
                              className="text-left hover:text-sky-soft hover:underline"
                            >
                              {l.fish || fullName(st)}
                            </button>
                          ) : (
                            <span>{l.fish || `Qator #${l.row}`}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {l.group ? <GroupBadge group={l.group} short /> : <span className="text-fg-subtle">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-[12.5px] text-fg-muted">{l.tafsilot}</td>
                      </tr>
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

  /* ------------------------------- AUDIT JADVALI ------------------------------- */
  const cards: { id: IssueKind; label: string; count: number; tone: string }[] = [
    { id: 'all', label: 'Barcha kamchiliklar', count: counts.all, tone: 'border-sky/40 bg-sky/10 text-sky-soft' },
    { id: 'no_tel', label: "Telefon yo'q", count: counts.no_tel, tone: 'border-amber/40 bg-amber/10 text-amber' },
    { id: 'no_shnum', label: "Shartnoma № yo'q", count: counts.no_shnum, tone: 'border-violet/40 bg-violet/10 text-violet' },
    { id: 'no_doc', label: "Ta'lim hujjati yo'q", count: counts.no_doc, tone: 'border-rose/40 bg-rose/10 text-rose' },
    { id: 'no_pass', label: 'Pasport/JSHSHIR chala', count: counts.no_pass, tone: 'border-rose/40 bg-rose/10 text-rose' },
    { id: 'name_diff', label: 'Imlo farqi bor', count: counts.name_diff, tone: 'border-amber/40 bg-amber/10 text-amber' },
    { id: 'unverified', label: 'Tasdiqlanmagan', count: counts.unverified, tone: 'border-line bg-ink-800 text-fg-muted' },
  ]

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-amber" />
            <div>
              <h2 className="text-[15px] font-bold text-fg">Ma&apos;lumotlar auditi va kamchiliklar</h2>
              <p className="text-[12px] text-fg-muted">
                Tanlangan ro‘yxat: {pool.length} ta talaba · Ko‘rsatilmoqda: {auditRows.length} ta
              </p>
            </div>
          </div>

          <button type="button" onClick={() => void copySurveyLink()} className="btn-ghost h-9 px-3 text-sky-soft">
            <ClipboardCopy size={14} />
            <span>So&apos;rovnoma havolasini nusxalash (/sorovnoma)</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {cards.map((c) => {
            const active = issue === c.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setIssue(c.id)}
                className={cx(
                  'rounded-xl border p-2.5 text-left transition-all',
                  active ? c.tone : 'border-line bg-ink-900/70 hover:bg-ink-850',
                )}
              >
                <div className="text-[11px] font-semibold text-fg-muted">{c.label}</div>
                <div className="mt-1 text-[20px] font-extrabold tabular-nums text-fg">{c.count}</div>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
            <input
              type="search"
              className="field h-9 w-full pl-9"
              placeholder="F.I.Sh., JSHSHIR, pasport yoki guruh bo‘yicha…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="field h-9 w-32 cursor-pointer py-1"
            value={kurs}
            onChange={(e) => {
              setKurs(e.target.value)
              setGroup('')
            }}
          >
            <option value="">Barcha kurslar</option>
            {COURSES.map((c) => (
              <option key={c.kurs} value={String(c.kurs)}>
                {c.kurs}-kurs
              </option>
            ))}
          </select>

          <select className="field h-9 w-32 cursor-pointer py-1" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Barcha guruhlar</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-ink-900 px-3 py-1.5 text-[12px] text-fg-muted">
            <input
              type="checkbox"
              checked={includeLeft}
              onChange={(e) => setIncludeLeft(e.target.checked)}
              className="accent-sky"
            />
            <span>Safdan chiqqan / ta&apos;tildagilar</span>
          </label>
        </div>
      </div>

      {auditRows.length === 0 ? (
        <div className="panel grid place-items-center gap-2 py-12 text-center">
          <CheckCircle2 size={28} className="text-emerald-soft" />
          <div className="text-[14px] font-semibold text-fg">Bu turdagi kamchilik topilmadi</div>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left text-[13px]">
              <thead className="border-b border-line bg-ink-900 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
                <tr>
                  <th className="px-3 py-2.5">№</th>
                  <th className="px-3 py-2.5">F.I.Sh.</th>
                  <th className="px-3 py-2.5">Guruh</th>
                  <th className="px-3 py-2.5">Aniqlangan kamchiliklar</th>
                  <th className="px-3 py-2.5 text-right">Amal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {auditRows.map((s, idx) => {
                  const k = studentIssues(s)
                  return (
                    <tr
                      key={s.row}
                      onClick={() => onOpen(s)}
                      className="cursor-pointer transition-colors hover:bg-ink-850/70"
                    >
                      <td className="mono px-3 py-2.5 text-[12px] text-fg-subtle">{idx + 1}</td>
                      <td className="px-3 py-2.5 font-semibold text-fg">{fullName(s)}</td>
                      <td className="px-3 py-2.5">
                        <GroupBadge group={s.group} short asl={s.asl_guruh} from={s.chiqqan_guruh} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          {k.noTel && (
                            <span className="chip border-amber/40 bg-amber/10 text-[11px] text-amber">
                              <PhoneOff size={11} /> Telefon yo&apos;q
                            </span>
                          )}
                          {k.noShnum && (
                            <span className="chip border-violet/40 bg-violet/10 text-[11px] text-violet">
                              Shartnoma № yo&apos;q
                            </span>
                          )}
                          {k.noDoc && (
                            <span className="chip border-rose/40 bg-rose/10 text-[11px] text-rose">
                              <FileWarning size={11} /> Hujjat seriyasi yo&apos;q
                            </span>
                          )}
                          {k.noPass && (
                            <span className="chip border-rose/40 bg-rose/10 text-[11px] text-rose">
                              <AlertTriangle size={11} /> Pasport/JSHSHIR chala
                            </span>
                          )}
                          {k.nameDiff && (
                            <span className="chip border-amber/40 bg-amber/10 text-[11px] text-amber">
                              Imlo farqi ({s.name_flag})
                            </span>
                          )}
                          {k.unverified && (
                            <span className="chip border-line bg-ink-800 text-[11px] text-fg-muted">
                              Tasdiqlanmagan
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpen(s)
                          }}
                          className="btn-ghost h-8 px-2.5 text-[12px] text-sky-soft"
                        >
                          Tahrirlash
                        </button>
                      </td>
                    </tr>
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
