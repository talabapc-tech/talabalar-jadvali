'use client'

import { memo, useMemo, useState } from 'react'
import { Check, Download, FileSpreadsheet, FileText, Loader2, Printer, Send, UserRound } from 'lucide-react'
import { ACADEMIC_LEAVE_GROUP, GROUP_LEADERS, WITHDRAWN_GROUP } from '@/lib/config'
import { exportGroup, exportQabulShablonGroup, exportQabulShablonGroups, exportRole, sendGroupsToTelegram, type TgTarget } from '@/lib/excel'
import { byName, fullName, groupTitle, isAcademicLeave, isOutside } from '@/lib/student'
import type { Student } from '@/lib/types'
import type { Notify } from './Toast'
import { cx } from './ui'

/** Maxsus guruhlar: kalit (Telegram tanlovida) va bazadagi nomi */
const SPECIAL = {
  akademik: { name: ACADEMIC_LEAVE_GROUP, label: "Akademik ta'til olganlar", tone: 'border-violet/45 bg-violet/10 text-violet', border: 'border-violet/35', text: 'text-violet' },
  safdan: { name: WITHDRAWN_GROUP, label: 'Talabalar safidan chiqarilganlar', tone: 'border-rose/45 bg-rose/10 text-rose', border: 'border-rose/35', text: 'text-rose' },
} as const
type SpecialKey = keyof typeof SPECIAL

function GroupCard({ code, title, leader, students, special, onOpen, notify }: {
  code: string; title: string; leader?: string; students: Student[]; special?: SpecialKey
  onOpen: (s: Student) => void; notify: Notify
}) {
  const [busy, setBusy] = useState(false)
  const [qabulBusy, setQabulBusy] = useState(false)
  const [tgBusy, setTgBusy] = useState(false)
  const farm = groupTitle(code).startsWith('Farmatsiya')
  const sp = special ? SPECIAL[special] : null
  const name = sp ? sp.label : `Guruh ${code}`
  const download = async () => {
    setBusy(true)
    try {
      const n = await exportGroup(students, sp ? sp.name : code)
      notify(`${name}: ${n} nafar Excelga yuklandi`)
    } catch (e) {
      notify(`Excel yaratilmadi: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const downloadQabul = async () => {
    setQabulBusy(true)
    try {
      const n = await exportQabulShablonGroup(students, code)
      notify(`Guruh ${code} Qabul shabloni (${n} nafar) yuklandi`)
    } catch (e) {
      notify(`Qabul shabloni yaratilmadi: ${(e as Error).message}`, 'error')
    } finally {
      setQabulBusy(false)
    }
  }

  const sendSingleTg = async () => {
    setTgBusy(true)
    try {
      const res = await sendGroupsToTelegram(students, [special ?? code], 'both')
      if (res.failed.length === 0) notify(`${name} 1-varoqli jurnali Telegramga yuborildi!`)
      else notify(`Qisman yuborildi (${res.sent.join(', ')}). Xato: ${res.failed.join('; ')}`, 'warning')
    } catch (e) {
      notify(`Telegramga yuborilmadi: ${(e as Error).message}`, 'error')
    } finally {
      setTgBusy(false)
    }
  }

  return (
    <article className={cx('panel overflow-hidden', sp?.border)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-line bg-ink-850/70 px-3 py-3 sm:px-4">
        <span className={cx('chip mono text-[12.5px]',
          sp ? sp.tone : farm ? 'border-emerald/45 bg-emerald/10 text-emerald-soft' : 'border-blue/45 bg-blue/10 text-blue-soft')}>
          {sp ? 'Maxsus' : `Guruh ${code}`}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold text-fg">{title}</div>
          <div className="flex items-center gap-1.5 text-[12px] text-fg-muted">
            {leader && <><UserRound size={12} /> {leader} ·</>} {students.length} nafar
          </div>
        </div>
        {/* Telefonda tugmalar alohida qatorda, teng kenglikda */}
        <div className="no-print flex w-full gap-1.5 sm:w-auto [&>*]:min-w-0 [&>*]:flex-1 [&>*]:gap-1 [&>*]:px-1.5 [&>*]:text-[11.5px] sm:[&>*]:flex-none sm:[&>*]:gap-2 sm:[&>*]:px-2.5 sm:[&>*]:text-[12px]">
          {!sp && (
            <button
              type="button"
              className="btn-ghost h-8 px-2.5 text-[12px] border-emerald/35 text-emerald-soft hover:bg-emerald/10"
              onClick={downloadQabul}
              disabled={qabulBusy || !students.length}
              title="Shu guruhni QABUL - 2026 formatida yuklab olish"
            >
              {qabulBusy ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Qabul
            </button>
          )}
          <a
            className="btn-ghost h-8 px-2.5 text-[12px]"
            href={`/api/view_group_pdf?group=${encodeURIComponent(special ?? code)}`}
            target="_blank"
            rel="noreferrer"
            title="Toza 1-varoqli A4 PDF jurnal"
          >
            <FileText size={14} /> PDF
          </a>
          <button type="button" className="btn-ghost h-8 px-2.5 text-[12px]" onClick={download} disabled={busy || !students.length} title="Guruhni Excel (.xlsx) formatda yuklab olish">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Excel
          </button>
          <button type="button" className="btn-ghost h-8 max-w-11 px-2 text-[12px] text-sky hover:text-sky-soft" onClick={sendSingleTg} disabled={tgBusy || !students.length} title="Shu guruhning 1-varoqli jurnal rasmini Telegramga yuborish" aria-label="Telegramga yuborish">
            {tgBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </header>
      {students.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-fg-subtle">Bu guruhda talaba yo'q</div>
      ) : (
        <ol className="divide-y divide-line/70">
          {students.map((s, i) => (
            <li key={s.row}>
              <button type="button" onClick={() => onOpen(s)} className="grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-ink-800/70 sm:grid-cols-[34px_minmax(0,1fr)_auto] sm:gap-3 sm:px-4 sm:py-2">
                <span className="mono text-center text-[12px] font-bold text-fg-subtle tabular-nums">{i + 1}</span>
                <span className={cx('truncate font-semibold', sp ? sp.text : 'text-fg')}>{fullName(s)}</span>
                {sp ? (
                  // Maxsus bo'limda tug'ilgan sana o'rniga: qaysi guruhdan va qachon chiqqan
                  <span className="flex items-center gap-2 text-[12px] tabular-nums">
                    <span className={cx('mono', s.chiqqan_guruh ? 'text-fg' : 'text-amber')}>{s.chiqqan_guruh ? `${s.chiqqan_guruh} dan` : 'guruh ?'}</span>
                    <span className="mono text-fg-muted">{s.buyruq_sana || '—'}</span>
                  </span>
                ) : (
                  <span className="mono text-[12px] text-fg-muted tabular-nums">{s.dob || '—'}</span>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

function GroupsJournal({ students, groups: list, onOpen, notify }: {
  students: Student[]; groups: string[]; onOpen: (s: Student) => void; notify: Notify
}) {
  const [tgOpen, setTgOpen] = useState(false)
  const [tgTarget, setTgTarget] = useState<TgTarget>('both')
  const [selectedGroups, setSelectedGroups] = useState<string[]>(() => [...list])
  const [sendingTg, setSendingTg] = useState(false)

  const groups = useMemo(() => {
    const map = new Map<string, Student[]>(list.map((g) => [g, []]))
    const special: Record<SpecialKey, Student[]> = { akademik: [], safdan: [] }
    for (const s of students) {
      if (isAcademicLeave(s.group)) special.akademik.push(s)
      else if (isOutside(s.group)) special.safdan.push(s)
      else map.get(s.group.trim())?.push(s) // boshqa kurs guruhlari bu yerda ko'rinmaydi
    }
    for (const l of map.values()) l.sort(byName)
    special.akademik.sort(byName)
    special.safdan.sort(byName)
    return { map, special }
  }, [students, list])
  const specialKeys = (Object.keys(SPECIAL) as SpecialKey[]).filter((k) => groups.special[k].length)

  const officialTotal = useMemo(() => {
    let sum = 0
    for (const list of groups.map.values()) sum += list.length
    return sum
  }, [groups])

  const toggleGroupSelection = (g: string) => {
    setSelectedGroups((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g])
  }

  const handleSendBulkTg = async () => {
    if (!selectedGroups.length) return
    setSendingTg(true)
    try {
      const res = await sendGroupsToTelegram(students, selectedGroups, tgTarget)
      if (res.failed.length === 0) {
        notify(`${selectedGroups.length} ta guruhning 1-varoqli jurnallari (${res.sent.join(' + ')}) Telegramga yuborildi!`)
        setTgOpen(false)
      } else {
        notify(`Yuborildi: ${res.sent.join(', ') || 'yo\'q'}. Xato: ${res.failed.join('; ')}`, 'warning')
      }
    } catch (e) {
      notify(`Telegramga yuborishda xatolik: ${(e as Error).message}`, 'error')
    } finally {
      setSendingTg(false)
    }
  }

  // Barcha guruhlar bitta PDF faylda — bir nechta oyna ochilsa brauzer bloklaydi
  const openAllPdfs = () => {
    window.open('/api/view_group_pdf?group=barcha', '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-4">
      <div className="no-print panel flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
          <span className="font-bold text-fg">Akademik guruhlar jurnali</span>
          <span className="chip border-sky/35 bg-sky/10 text-sky-soft">{list.length} ta rasmiy guruh · {officialTotal} nafar talaba</span>
          {groups.special.akademik.length > 0 && (
            <span className="chip border-violet/35 bg-violet/10 text-violet">Akademik ta'tilda: {groups.special.akademik.length} nafar</span>
          )}
          {groups.special.safdan.length > 0 && (
            <span className="chip border-rose/35 bg-rose/10 text-rose">Safdan chiqarilgan: {groups.special.safdan.length} nafar</span>
          )}
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <button
            type="button"
            className="btn-ghost h-9 border-emerald/40 bg-emerald/10 text-[12.5px] text-emerald-soft hover:bg-emerald/20"
            onClick={async () => {
              try {
                const n = await exportQabulShablonGroups(students, list)
                notify(`QABUL - 2026 (${list.length} ta guruh, ${n} nafar talaba) Excelga yuklandi!`)
              } catch (e) {
                notify(`Xatolik: ${(e as Error).message}`, 'error')
              }
            }}
            title="Shu ko'rinishdagi barcha guruhlarni QABUL - 2026.xlsx formatida yuklab olish"
          >
            <FileSpreadsheet size={15} /> <span>Qabul<span className="hidden sm:inline"> shabloni</span> ({list.length})</span>
          </button>
          <button type="button" className="btn-ghost h-9 text-[12.5px]" onClick={openAllPdfs} title="Barcha guruhlar PDF jurnalini (bitta fayl) yangi oynada ochish">
            <FileText size={15} className="text-sky" /> <span><span className="hidden sm:inline">Barcha </span>PDF ({list.length})</span>
          </button>
          <button type="button" className="btn-ghost hidden h-9 text-[12.5px] sm:inline-flex" onClick={() => window.print()} title="Jurnallarni chop etish (Ctrl+P)">
            <Printer size={15} /> Chop etish
          </button>
          <button
            type="button"
            className={cx('btn-primary col-span-2 h-9 text-[12.5px]', tgOpen && 'ring-2 ring-sky/40')}
            onClick={() => setTgOpen((o) => !o)}
          >
            <Send size={14} /> Telegramga yuborish
          </button>
        </div>
      </div>

      {tgOpen && (
        <div className="no-print panel animate-pop-in space-y-3 border-sky/35 bg-ink-900/90 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13.5px] font-bold text-fg">Tanlangan guruhlarning 1-varoqli PDF jurnallarini (rasm sifatida) Telegramga yuborish</div>
            <div className="flex items-center gap-1.5 text-[12px]">
              <button type="button" className="btn-ghost h-7 px-2 text-[11.5px]" onClick={() => setSelectedGroups([...list])}>Barchasi ({list.length})</button>
              <button type="button" className="btn-ghost h-7 px-2 text-[11.5px]" onClick={() => setSelectedGroups([])}>Tozalash</button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[...list, ...specialKeys].map((g) => {
              const active = selectedGroups.includes(g)
              const sp = g in SPECIAL ? SPECIAL[g as SpecialKey] : null
              const count = sp ? groups.special[g as SpecialKey].length : (groups.map.get(g)?.length ?? 0)
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleGroupSelection(g)}
                  className={cx(
                    'flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
                    active
                      ? 'border-sky/60 bg-sky/15 text-sky-soft'
                      : 'border-line bg-ink-950/60 text-fg-muted hover:text-fg',
                  )}
                >
                  <Check size={13} className={active ? 'opacity-100 text-sky' : 'opacity-0'} />
                  <span>{sp ? sp.label : `Guruh ${g}`}</span>
                  <span className="mono text-[11px] text-fg-subtle">({count})</span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="text-fg-muted">Qayerga:</span>
              {([['both', 'Kanal + Shaxsiy bot'], ['channel', 'Faqat kanalga'], ['bot', 'Faqat shaxsiy botga']] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setTgTarget(val)}
                  className={cx(
                    'rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors',
                    tgTarget === val ? 'border-emerald/50 bg-emerald/15 text-emerald-soft' : 'border-line text-fg-muted hover:text-fg',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <button type="button" className="btn-ghost h-9 text-[12.5px]" onClick={() => setTgOpen(false)}>Bekor qilish</button>
              <button
                type="button"
                className="btn-success h-9 flex-1 text-[12.5px] sm:flex-none"
                disabled={sendingTg || !selectedGroups.length}
                onClick={handleSendBulkTg}
              >
                {sendingTg ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
                {sendingTg ? 'Yuborilmoqda…' : `Yuborish (${selectedGroups.length} ta guruh)`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {list.map((g) => (
          <GroupCard key={g} code={g} title={groupTitle(g)} leader={GROUP_LEADERS[g]} students={groups.map.get(g)!} onOpen={onOpen} notify={notify} />
        ))}
      </div>
      {!list.length && (
        <div className="panel px-5 py-6 text-center text-[13px] text-fg-muted">Bu kurs guruhlari hali kiritilmagan.</div>
      )}
      {specialKeys.map((k) => (
        <GroupCard key={k} code={k} title={SPECIAL[k].label} students={groups.special[k]} special={k} onOpen={onOpen} notify={notify} />
      ))}
    </div>
  )
}

export default memo(GroupsJournal)
