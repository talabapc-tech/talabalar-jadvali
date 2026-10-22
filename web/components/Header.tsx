'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Archive, CalendarCheck, ChevronDown, ClipboardList, CloudCheck, CloudUpload, FileSpreadsheet, FileText, GraduationCap, Loader2, LogOut, Moon, RefreshCw, Download, Send, Settings, Sun, UserPlus, Users } from 'lucide-react'
import { exportRole, ROLE_META, sendRoleToTelegram, type Role } from '@/lib/excel'
import type { Student } from '@/lib/types'
import type { Notify } from './Toast'
import { cx } from './ui'

interface SyncInfo { mode: 'local' | 'github'; state?: string; pending?: boolean; pending_seconds?: number; last_sync?: string }

/** Saqlash holati: brauzerdagi kutilayotgan o'zgarishlar + (lokalda) Python xizmatining GitHub navbati */
function SyncBadge({ pendingCount, notify }: { pendingCount: number; notify: Notify }) {
  const [info, setInfo] = useState<SyncInfo | null>(null)
  const [flushing, setFlushing] = useState(false)

  useEffect(() => {
    let alive = true
    // Faqat oyna ko'rinib turganda va 30 soniyada bir (trafikni tejash)
    const load = () =>
      document.visibilityState === 'visible' &&
      fetch('/api/sync', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return
          setInfo(d)
          // Internetdagi saytda holat o'zgarmaydi (GitHub navbati) — qayta so'ramaymiz
          if (d?.mode !== 'local') clearInterval(t)
        })
        .catch(() => {})
    const t = setInterval(load, 30_000)
    load()
    return () => { alive = false; clearInterval(t) }
  }, [])

  const local = info?.mode === 'local'
  const offline = local && info?.state === 'offline'
  const gitPending = local && (info?.pending || info?.state === 'pending' || info?.state === 'syncing')
  const busy = pendingCount > 0 || gitPending

  const flush = async () => {
    setFlushing(true)
    try {
      const r = await fetch('/api/sync', { method: 'POST' }).then((x) => x.json())
      notify(r.success ? (r.had_pending ? "GitHub'ga yuborilmoqda..." : "Yuboriladigan o'zgarish yo'q") : r.error || 'Xatolik', r.success ? 'success' : 'error')
    } finally {
      setFlushing(false)
    }
  }

  let text: string
  if (offline) text = 'Python xizmati o\'chiq'
  else if (pendingCount > 0) text = `${pendingCount} ta o'zgarish saqlanmoqda`
  else if (gitPending) text = info?.state === 'syncing' ? "Saqlandi • GitHub'ga yuborilmoqda" : `Saqlandi (GitHub navbatda${info?.pending_seconds ? ` ${info.pending_seconds}s` : ''})`
  else text = 'Hammasi saqlangan'

  return (
    <div className="flex items-center gap-2">
      <span
        className={cx(
          'chip h-9 rounded-xl px-3 text-[12.5px]',
          offline ? 'border-rose/45 bg-rose/10 text-rose' : busy ? 'border-sky/40 bg-sky/10 text-sky-soft' : 'border-emerald/40 bg-emerald/10 text-emerald-soft',
        )}
        title={local ? "Lokal rejim: o'zgarishlar kompyuterdagi Python xizmati orqali Excelga yoziladi" : "O'zgarishlar GitHub navbatiga yoziladi; kompyuterdagi xizmat ularni Excelga qo'llaydi"}
      >
        {pendingCount > 0 ? (
          <Loader2 size={14} className="animate-spin text-sky-soft" />
        ) : gitPending ? (
          <CloudUpload size={14} className="animate-pulse text-sky-soft" />
        ) : (
          <CloudCheck size={14} />
        )}
        {text}
      </span>
      {local && !offline && (
        <button type="button" className="btn-ghost h-9" onClick={flush} disabled={flushing} title="30 soniyani kutmasdan hisobotni qayta yaratib GitHub'ga yuborish">
          <CloudUpload size={15} />
          <span className="hidden sm:inline">Hozir yuborish</span>
        </button>
      )}
    </div>
  )
}

function ExportMenu({ students, notify }: { students: Student[]; notify: Notify }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Role | null>(null)
  const [tgBusy, setTgBusy] = useState<Role | null>(null)
  const [docBusy, setDocBusy] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const run = async (role: Role) => {
    setBusy(role)
    try {
      const sheets = await exportRole(students, role)
      notify(`${ROLE_META[role].title}: ${sheets} sahifali Excel yuklab olindi`)
      setOpen(false)
    } catch (e) {
      notify(`Excel yaratilmadi: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const runTg = async (e: React.MouseEvent, role: Role) => {
    e.stopPropagation()
    setTgBusy(role)
    try {
      await sendRoleToTelegram(students, role)
      notify(`${ROLE_META[role].title} Telegram botga yuborildi!`)
      setOpen(false)
    } catch (err) {
      notify(`Telegramga yuborishda xato: ${(err as Error).message}`, 'error')
    } finally {
      setTgBusy(null)
    }
  }

  const sendSpecialDoc = async (type: string, title: string) => {
    setDocBusy(type)
    try {
      const res = await fetch('/api/download_davomat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) {
        notify(`${title} Telegramga yuborildi!`, 'success')
      } else {
        notify(`Yuborilmadi: ${d.error || 'Server xatosi'}`, 'error')
      }
    } catch (e) {
      notify(`Telegramga yuborishda xato: ${(e as Error).message}`, 'error')
    } finally {
      setDocBusy(null)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn-primary h-9" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <FileSpreadsheet size={16} />
        <span>Excel<span className="hidden sm:inline">&nbsp;eksport</span></span>
        <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="animate-pop-in absolute right-0 z-50 mt-2 w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-ink-850 p-2 shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between px-3 pt-2 pb-2 text-[11px] font-bold tracking-wider text-fg-subtle uppercase">
            <span>4 bo'lim uchun .xlsx</span>
            <span>Yuklash / Telegram</span>
          </div>
          {(Object.keys(ROLE_META) as Role[]).map((role, i) => (
            <div
              key={role}
              className="group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-ink-700/60"
            >
              <button
                type="button"
                onClick={() => run(role)}
                disabled={!!busy || !!tgBusy}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald/20 to-sky/20 text-[13px] font-bold text-sky-soft">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-fg">{ROLE_META[role].title}</span>
                  <span className="block truncate text-[12px] text-fg-muted">{ROLE_META[role].sub}</span>
                </span>
                {busy === role ? <Loader2 size={16} className="animate-spin text-sky" /> : <Download size={16} className="text-fg-subtle group-hover:text-sky" />}
              </button>
              <button
                type="button"
                onClick={(e) => runTg(e, role)}
                disabled={!!busy || !!tgBusy}
                title={`${ROLE_META[role].title} Excel faylini Telegramga yuborish`}
                className="grid size-8 shrink-0 place-items-center rounded-lg border border-sky/30 bg-sky/10 text-sky-soft transition-colors hover:bg-sky/25"
              >
                {tgBusy === role ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          ))}

          <div className="my-1.5 border-t border-line/70" />
          <div className="flex items-center justify-between px-3 pt-1 pb-1 text-[11px] font-bold tracking-wider text-fg-subtle uppercase">
            <span>Davomat jurnali & So'rovnoma</span>
            <span>Yuklash / Telegram</span>
          </div>

          {/* Davomat Jurnali Excel */}
          <div className="group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-ink-700/60">
            <a
              href="/api/download_davomat?type=excel"
              download
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() => notify("Davomat Jurnali (.xlsx) yuklanmoqda...")}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald/15 text-emerald"><FileText size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-fg">Davomat jurnali (.xlsx)</span>
                <span className="block truncate text-[12px] text-fg-muted">Barcha guruhlar jurnali andozasi</span>
              </span>
              <Download size={16} className="text-fg-subtle group-hover:text-sky" />
            </a>
            <button
              type="button"
              onClick={() => sendSpecialDoc('excel', 'Davomat jurnali (.xlsx)')}
              disabled={!!docBusy}
              title="Davomat Jurnali (.xlsx) faylini Telegramga yuborish"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-sky/30 bg-sky/10 text-sky-soft transition-colors hover:bg-sky/25"
            >
              {docBusy === 'excel' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>

          {/* Barcha Word Jurnallar ZIP */}
          <div className="group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-ink-700/60">
            <a
              href="/api/download_davomat?type=zip"
              download
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() => notify("Barcha guruhlar Word jurnallari (.zip) yuklanmoqda...")}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber/15 text-amber"><Archive size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-fg">Barcha Word jurnallar (.zip)</span>
                <span className="block truncate text-[12px] text-fg-muted">19 ta guruh to'ldirilgan Word jurnali</span>
              </span>
              <Download size={16} className="text-fg-subtle group-hover:text-sky" />
            </a>
            <button
              type="button"
              onClick={() => sendSpecialDoc('zip', 'Barcha Word jurnallar (.zip)')}
              disabled={!!docBusy}
              title="Barcha Word jurnallar (.zip) arxivini Telegramga yuborish"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-sky/30 bg-sky/10 text-sky-soft transition-colors hover:bg-sky/25"
            >
              {docBusy === 'zip' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>

          {/* Davomat 26-02 Word */}
          <div className="group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-ink-700/60">
            <a
              href="/api/download_davomat?type=docx"
              download
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() => notify("Davomat jurnali 26-02 (.docx) yuklanmoqda...")}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue/15 text-blue-soft"><FileText size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-fg">Davomat 26-02 (.docx)</span>
                <span className="block truncate text-[12px] text-fg-muted">To'ldirilgan rasmiy Word jurnali</span>
              </span>
              <Download size={16} className="text-fg-subtle group-hover:text-sky" />
            </a>
            <button
              type="button"
              onClick={() => sendSpecialDoc('docx', 'Davomat 26-02 (.docx)')}
              disabled={!!docBusy}
              title="Davomat jurnali 26-02 (.docx) faylini Telegramga yuborish"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-sky/30 bg-sky/10 text-sky-soft transition-colors hover:bg-sky/25"
            >
              {docBusy === 'docx' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>

          {/* 1-kurs So'rovnoma */}
          <div className="group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-ink-700/60">
            <a
              href="/api/download_davomat?type=sorovnoma"
              download
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() => notify("1-kurs so'rovnoma (.xlsx) yuklanmoqda...")}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber/15 text-amber"><ClipboardList size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-fg">1-kurs So'rovnoma (.xlsx)</span>
                <span className="block truncate text-[12px] text-fg-muted">Manzillar, ota-ona va telefonlar</span>
              </span>
              <Download size={16} className="text-fg-subtle group-hover:text-sky" />
            </a>
            <button
              type="button"
              onClick={() => sendSpecialDoc('sorovnoma', "1-kurs So'rovnoma (.xlsx)")}
              disabled={!!docBusy}
              title="1-kurs So'rovnoma faylini Telegramga yuborish"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-sky/30 bg-sky/10 text-sky-soft transition-colors hover:bg-sky/25"
            >
              {docBusy === 'sorovnoma' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>

          {/* 1-kurs So'rovnoma Topshirmaganlar Excel */}
          <div className="group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-ink-700/60">
            <a
              href="/api/download_davomat?type=topshirmaganlar_xlsx"
              download
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() => notify("Topshirmaganlar hisoboti (.xlsx) yuklanmoqda...")}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-rose/15 text-rose"><FileSpreadsheet size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-fg">Topshirmaganlar (.xlsx)</span>
                <span className="block truncate text-[12px] text-fg-muted">1-kurs guruhlar kesimida ro'yxat</span>
              </span>
              <Download size={16} className="text-fg-subtle group-hover:text-sky" />
            </a>
            <button
              type="button"
              onClick={() => sendSpecialDoc('topshirmaganlar', "Topshirmaganlar hisoboti (.xlsx)")}
              disabled={!!docBusy}
              title="Topshirmaganlar (.xlsx) faylini Telegramga yuborish"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-sky/30 bg-sky/10 text-sky-soft transition-colors hover:bg-sky/25"
            >
              {docBusy === 'topshirmaganlar' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>

          {/* 1-kurs So'rovnoma Topshirmaganlar Word */}
          <div className="group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-ink-700/60">
            <a
              href="/api/download_davomat?type=topshirmaganlar_docx"
              download
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() => notify("Topshirmaganlar hisoboti (.docx) yuklanmoqda...")}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-rose/15 text-rose"><FileText size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-fg">Topshirmaganlar (.docx)</span>
                <span className="block truncate text-[12px] text-fg-muted">Chop etishga tayyor rasmiy Word hisobot</span>
              </span>
              <Download size={16} className="text-fg-subtle group-hover:text-sky" />
            </a>
            <button
              type="button"
              onClick={() => sendSpecialDoc('topshirmaganlar_docx', "Topshirmaganlar hisoboti (.docx)")}
              disabled={!!docBusy}
              title="Topshirmaganlar (.docx) faylini Telegramga yuborish"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-sky/30 bg-sky/10 text-sky-soft transition-colors hover:bg-sky/25"
            >
              {docBusy === 'topshirmaganlar_docx' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Tizimdan chiqish — sessiya cookie'si o'chiriladi va kirish sahifasiga qaytiladi */
function LogoutButton() {
  const [busy, setBusy] = useState(false)
  // Kompyuterda (localhost) login so'ralmaydi — chiqish tugmasi ham kerak emas
  const [local, setLocal] = useState(true)
  useEffect(() => { setLocal(['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) }, [])
  const logout = async () => {
    if (!confirm('Tizimdan chiqasizmi?')) return
    setBusy(true)
    try { localStorage.removeItem('portal_device_token'); } catch {}
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    window.location.replace('/login')
  }
  if (local) return null
  return (
    <button type="button" className="btn-ghost h-9 px-2.5" onClick={logout} disabled={busy} title="Tizimdan chiqish" aria-label="Tizimdan chiqish">
      {busy ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
    </button>
  )
}

function ThemeButton() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const saved = localStorage.getItem('portal_theme') === 'light' ? 'light' : 'dark'
    setTheme(saved)
    document.documentElement.dataset.theme = saved
  }, [])

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('portal_theme', next) } catch { /* bo'sh */ }
  }

  return (
    <button
      type="button"
      className="btn-ghost size-9 p-0"
      onClick={toggle}
      title={theme === 'dark' ? "Yorug' (Kun) rejimga o'tish" : "To'q (Tun) rejimga o'tish"}
    >
      {theme === 'dark' ? <Sun size={15} className="text-amber" /> : <Moon size={15} className="text-blue-soft" />}
    </button>
  )
}

export default function Header({
  students,
  pendingCount,
  onRefresh,
  refreshing,
  onAdd,
  onOpenSettings,
  notify,
  activeTab = 'students',
  onTabChange,
  onAddStaff,
  onExportStaff,
}: {
  students: Student[];
  pendingCount: number;
  onRefresh: () => void;
  refreshing: boolean;
  onAdd: () => void;
  onOpenSettings?: () => void;
  notify: Notify;
  activeTab?: 'students' | 'staff';
  onTabChange?: (tab: 'students' | 'staff') => void;
  onAddStaff?: () => void;
  onExportStaff?: () => void;
}) {
  return (
    <header className="z-40 border-b border-line bg-ink-950/85 backdrop-blur-md sm:sticky sm:top-0">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-sky/30 bg-gradient-to-br from-emerald/20 via-blue/20 to-sky/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="size-7" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-[0.14em] text-emerald-soft uppercase">Shahrisabz Tibbiyot Texnikumi</div>
            <h1 className="truncate text-[17px] font-extrabold tracking-tight text-fg">
              {activeTab === 'staff' ? 'Xodimlar boshqaruvi' : 'Talabalar portali'} <span className="font-semibold text-fg-subtle">· 2026/2027</span>
            </h1>
          </div>
        </div>

        {/* Asosiy bo'limlar almashgichi (Tab) */}
        {onTabChange && (
          <div className="flex items-center rounded-xl border border-line bg-ink-900/90 p-1 shadow-inner">
            <Link
              href="/talabalar"
              onClick={(e) => {
                if (onTabChange) {
                  e.preventDefault()
                  onTabChange('students')
                }
              }}
              className={cx(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition select-none',
                activeTab === 'students'
                  ? 'border border-sky/40 bg-sky/20 text-sky-soft shadow-sm'
                  : 'text-fg-muted hover:text-fg'
              )}
            >
              <GraduationCap size={15} />
              <span>Talabalar</span>
            </Link>
            <Link
              href="/xodimlar"
              onClick={(e) => {
                if (onTabChange) {
                  e.preventDefault()
                  onTabChange('staff')
                }
              }}
              className={cx(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition select-none',
                activeTab === 'staff'
                  ? 'border border-emerald/40 bg-emerald/20 text-emerald-soft shadow-sm'
                  : 'text-fg-muted hover:text-fg'
              )}
            >
              <Users size={15} />
              <span>Xodimlar</span>
            </Link>
          </div>
        )}

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {activeTab === 'staff' ? (
            <>
              {onAddStaff && (
                <button
                  type="button"
                  className="btn-success h-9"
                  onClick={onAddStaff}
                  title="Yangi xodim qo'shish"
                >
                  <UserPlus size={15} />
                  <span>Xodim qo'shish</span>
                </button>
              )}
              {onExportStaff && (
                <button
                  type="button"
                  className="btn-primary h-9"
                  onClick={onExportStaff}
                  title="Xodimlarni Excelga eksport qilish"
                >
                  <FileSpreadsheet size={16} />
                  <span>Xodimlarni eksport</span>
                </button>
              )}
            </>
          ) : (
            <>
              <SyncBadge pendingCount={pendingCount} notify={notify} />
              <button
                type="button"
                className="btn-success h-9"
                onClick={onAdd}
                title="Yangi talaba qo'shish"
              >
                <UserPlus size={15} />
                <span>Talaba qo'shish</span>
              </button>
              <ExportMenu students={students} notify={notify} />
            </>
          )}
          <button
            type="button"
            className="btn-ghost h-9"
            onClick={onRefresh}
            disabled={refreshing}
            title="Serverdan eng yangi ma'lumotni olish"
          >
            <RefreshCw size={15} className={cx(refreshing && 'animate-spin')} />
            <span className="hidden sm:inline">Yangilash</span>
          </button>
          <a href="/majlis" className="btn-ghost h-9" title="O'qituvchilar majlisi davomati (asosiy va o'rindosh)">
            <CalendarCheck size={15} className="text-sky-soft" />
            <span className="hidden sm:inline">Majlislar</span>
          </a>
          {onOpenSettings && (
            <button
              type="button"
              className="btn-ghost h-9 px-2.5 sm:px-3 text-fg-muted hover:text-fg"
              onClick={onOpenSettings}
              title="Sozlamalar (API kalitlar, AI modellar)"
            >
              <Settings size={15} />
              <span className="hidden sm:inline">Sozlamalar</span>
            </button>
          )}
          <ThemeButton />
          <LogoutButton />
        </div>
      </div>
    </header>
  )
}
