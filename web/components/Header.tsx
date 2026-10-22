'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Archive, CalendarCheck, ChevronDown, ClipboardList, CloudCheck, CloudOff, CloudUpload, FileSpreadsheet, FileText,
  GraduationCap, Loader2, LogOut, Moon, RefreshCw, Download, Send, Settings, Sun, UserPlus, Users, X, type LucideIcon,
} from 'lucide-react'
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
  if (offline) text = "Python xizmati o'chiq"
  else if (pendingCount > 0) text = `${pendingCount} ta o'zgarish saqlanmoqda`
  else if (gitPending) text = info?.state === 'syncing' ? "Saqlandi • GitHub'ga yuborilmoqda" : `Saqlandi (GitHub navbatda${info?.pending_seconds ? ` ${info.pending_seconds}s` : ''})`
  else text = 'Hammasi saqlangan'

  return (
    <>
      {/* Tor ekranda faqat rangli belgi — bosilsa holat matni chiqadi */}
      <button
        type="button"
        onClick={() => notify(text, offline ? 'error' : busy ? 'info' : 'success')}
        className={cx(
          'chip size-9 shrink-0 justify-center rounded-xl px-0 text-[12.5px] lg:w-auto lg:cursor-default lg:px-3',
          offline ? 'border-rose/45 bg-rose/10 text-rose' : busy ? 'border-sky/40 bg-sky/10 text-sky-soft' : 'border-emerald/40 bg-emerald/10 text-emerald-soft',
        )}
        title={offline
          ? "Kompyuterdagi Python xizmati ishlamayapti — o'zgarishlar Excelga yozilmaydi. ISHGA_TUSHIRISH.bat ni ishga tushiring"
          : local ? "Lokal rejim: o'zgarishlar kompyuterdagi Python xizmati orqali Excelga yoziladi" : "O'zgarishlar GitHub navbatiga yoziladi; kompyuterdagi xizmat ularni Excelga qo'llaydi"}
      >
        {offline ? <CloudOff size={14} className="shrink-0" />
          : pendingCount > 0 ? <Loader2 size={14} className="shrink-0 animate-spin" />
          : gitPending ? <CloudUpload size={14} className="shrink-0 animate-pulse" />
          : <CloudCheck size={14} className="shrink-0" />}
        <span className="hidden lg:inline">{text}</span>
      </button>
      {local && !offline && (
        <button type="button" className="btn-ghost h-9 shrink-0 px-2.5" onClick={flush} disabled={flushing} title="30 soniyani kutmasdan hisobotni qayta yaratib GitHub'ga yuborish">
          <CloudUpload size={15} />
          <span className="hidden xl:inline">Hozir yuborish</span>
        </button>
      )}
    </>
  )
}

/** Tayyor hujjatlar: serverdan yuklab olinadi yoki Telegram'ga yuboriladi (/api/download_davomat) */
const DOCS: { type: string; tg: string; title: string; sub: string; icon: LucideIcon; tone: string }[] = [
  { type: 'excel', tg: 'excel', title: 'Davomat jurnali (.xlsx)', sub: 'Barcha guruhlar jurnali andozasi', icon: FileText, tone: 'bg-emerald/15 text-emerald-soft' },
  { type: 'zip', tg: 'zip', title: 'Barcha Word jurnallar (.zip)', sub: "Barcha guruhlarning to'ldirilgan Word jurnali", icon: Archive, tone: 'bg-amber/15 text-amber' },
  { type: 'docx', tg: 'docx', title: 'Davomat 26-02 (.docx)', sub: "To'ldirilgan rasmiy Word jurnali", icon: FileText, tone: 'bg-blue/15 text-blue-soft' },
  { type: 'sorovnoma', tg: 'sorovnoma', title: "1-kurs So'rovnoma (.xlsx)", sub: 'Manzillar, ota-ona va telefonlar', icon: ClipboardList, tone: 'bg-amber/15 text-amber' },
  { type: 'topshirmaganlar_xlsx', tg: 'topshirmaganlar', title: 'Topshirmaganlar (.xlsx)', sub: "1-kurs guruhlar kesimida ro'yxat", icon: FileSpreadsheet, tone: 'bg-rose/15 text-rose' },
  { type: 'topshirmaganlar_docx', tg: 'topshirmaganlar_docx', title: 'Topshirmaganlar (.docx)', sub: 'Chop etishga tayyor rasmiy Word hisobot', icon: FileText, tone: 'bg-rose/15 text-rose' },
]

function TgButton({ busy, disabled, title, onClick }: { busy: boolean; disabled: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="grid size-9 shrink-0 place-items-center rounded-lg border border-sky/30 bg-sky/10 text-sky-soft transition-colors hover:bg-sky/25 disabled:opacity-50 sm:size-8"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
    </button>
  )
}

function MenuTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pt-2 pb-1.5 text-[11px] font-bold tracking-wider text-fg-subtle uppercase">
      <span>{children}</span>
      <span className="hidden sm:inline">Yuklash · Telegram</span>
    </div>
  )
}

function ExportMenu({ students, notify }: { students: Student[]; notify: Notify }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Role | null>(null)
  const [tgBusy, setTgBusy] = useState<string | null>(null)
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

  const runTg = async (role: Role) => {
    setTgBusy(role)
    try {
      await sendRoleToTelegram(students, role)
      notify(`${ROLE_META[role].title} Telegram botga yuborildi!`)
    } catch (err) {
      notify(`Telegramga yuborishda xato: ${(err as Error).message}`, 'error')
    } finally {
      setTgBusy(null)
    }
  }

  const sendDoc = async (doc: (typeof DOCS)[number]) => {
    setTgBusy(doc.tg)
    try {
      const res = await fetch('/api/download_davomat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: doc.tg }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) notify(`${doc.title} Telegramga yuborildi!`)
      else notify(`Yuborilmadi: ${d.error || 'Server xatosi'}`, 'error')
    } catch (e) {
      notify(`Telegramga yuborishda xato: ${(e as Error).message}`, 'error')
    } finally {
      setTgBusy(null)
    }
  }

  const rowCls = 'group flex w-full items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-ink-700/60 sm:px-2.5'

  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" className="btn-primary h-9 px-3" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <FileSpreadsheet size={16} />
        <span>Excel<span className="hidden lg:inline">&nbsp;eksport</span></span>
        <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          {/* Telefonda menyu pastdan chiqadi, orqasi qoraytiriladi */}
          <div className="animate-fade-in fixed inset-0 z-40 bg-ink-950/60 sm:hidden" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="animate-slide-up pb-safe fixed inset-x-2 bottom-2 z-50 max-h-[80dvh] overflow-y-auto rounded-2xl border border-line-strong bg-ink-850 p-2 shadow-2xl shadow-black/50
              sm:animate-pop-in sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-auto sm:mt-2 sm:max-h-[calc(100dvh-90px)] sm:w-[400px] sm:pb-2"
          >
            <div className="flex items-center justify-between px-3 pt-1 pb-1 sm:hidden">
              <span className="text-[14px] font-bold text-fg">Excel va hujjatlar</span>
              <button type="button" className="grid size-9 place-items-center rounded-xl text-fg-muted hover:bg-ink-700" onClick={() => setOpen(false)} aria-label="Yopish"><X size={18} /></button>
            </div>
            <MenuTitle>4 bo'lim uchun .xlsx</MenuTitle>
            {(Object.keys(ROLE_META) as Role[]).map((role, i) => (
              <div key={role} className={rowCls}>
                <button type="button" onClick={() => run(role)} disabled={!!busy} className="flex min-w-0 flex-1 items-center gap-3 py-0.5 text-left">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald/20 to-sky/20 text-[13px] font-bold text-sky-soft">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold text-fg">{ROLE_META[role].title}</span>
                    <span className="block truncate text-[12px] text-fg-muted">{ROLE_META[role].sub}</span>
                  </span>
                  {busy === role ? <Loader2 size={16} className="animate-spin text-sky" /> : <Download size={16} className="shrink-0 text-fg-subtle group-hover:text-sky" />}
                </button>
                <TgButton busy={tgBusy === role} disabled={!!tgBusy} title={`${ROLE_META[role].title} — Telegramga yuborish`} onClick={() => runTg(role)} />
              </div>
            ))}

            <div className="my-1.5 border-t border-line/70" />
            <MenuTitle>Davomat va so'rovnoma</MenuTitle>
            {DOCS.map((doc) => {
              const Icon = doc.icon
              return (
                <div key={doc.type} className={rowCls}>
                  <a
                    href={`/api/download_davomat?type=${doc.type}`}
                    download
                    className="flex min-w-0 flex-1 items-center gap-3 py-0.5 text-left"
                    onClick={() => notify(`${doc.title} yuklanmoqda...`, 'info')}
                  >
                    <span className={cx('grid size-8 shrink-0 place-items-center rounded-lg', doc.tone)}><Icon size={17} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-fg">{doc.title}</span>
                      <span className="block truncate text-[12px] text-fg-muted">{doc.sub}</span>
                    </span>
                    <Download size={16} className="shrink-0 text-fg-subtle group-hover:text-sky" />
                  </a>
                  <TgButton busy={tgBusy === doc.tg} disabled={!!tgBusy} title={`${doc.title} — Telegramga yuborish`} onClick={() => sendDoc(doc)} />
                </div>
              )
            })}
          </div>
        </>
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
    try { localStorage.removeItem('portal_device_token') } catch { /* bo'sh */ }
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    window.location.replace('/login')
  }
  if (local) return null
  return (
    <button type="button" className="btn-ghost size-9 shrink-0 p-0" onClick={logout} disabled={busy} title="Tizimdan chiqish" aria-label="Tizimdan chiqish">
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

  const title = theme === 'dark' ? "Yorug' rejimga o'tish" : "To'q rejimga o'tish"
  return (
    <button type="button" className="btn-ghost size-9 shrink-0 p-0" onClick={toggle} title={title} aria-label={title}>
      {theme === 'dark' ? <Sun size={15} className="text-amber" /> : <Moon size={15} className="text-blue-soft" />}
    </button>
  )
}

type MainTab = 'students' | 'staff'

/** Talabalar / Xodimlar almashgichi */
function TabSwitch({ activeTab, onTabChange }: { activeTab: MainTab; onTabChange: (t: MainTab) => void }) {
  const tabs = [
    { id: 'students' as const, href: '/talabalar', label: 'Talabalar', icon: GraduationCap, on: 'border-sky/40 bg-sky/20 text-sky-soft' },
    { id: 'staff' as const, href: '/xodimlar', label: 'Xodimlar', icon: Users, on: 'border-emerald/40 bg-emerald/20 text-emerald-soft' },
  ]
  return (
    <div className="grid w-full grid-cols-2 rounded-xl border border-line bg-ink-900/90 p-1 shadow-inner sm:flex sm:w-auto">
      {tabs.map(({ id, href, label, icon: Icon, on }) => (
        <Link
          key={id}
          href={href}
          onClick={(e) => { e.preventDefault(); onTabChange(id) }}
          aria-current={activeTab === id ? 'page' : undefined}
          className={cx(
            'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-bold transition select-none',
            activeTab === id ? cx(on, 'shadow-sm') : 'border-transparent text-fg-muted hover:text-fg',
          )}
        >
          <Icon size={15} />
          <span>{label}</span>
        </Link>
      ))}
    </div>
  )
}

export default function Header({
  students, pendingCount, onRefresh, refreshing, onAdd, onOpenSettings, notify,
  activeTab = 'students', onTabChange, onAddStaff, onExportStaff,
}: {
  students: Student[]
  pendingCount: number
  onRefresh: () => void
  refreshing: boolean
  onAdd: () => void
  onOpenSettings?: () => void
  notify: Notify
  activeTab?: MainTab
  onTabChange?: (tab: MainTab) => void
  onAddStaff?: () => void
  onExportStaff?: () => void
}) {
  const staff = activeTab === 'staff'
  return (
    // Telefonda sarlavha yopishmaydi (joy tejaladi); backdrop-blur faqat kompyuterda — u ichidagi
    // fixed menyuning (pastdan chiqadigan) joylashuvini buzadi
    <header className="no-print z-40 border-b border-line bg-ink-950 sm:sticky sm:top-0 sm:bg-ink-950/85 sm:backdrop-blur-md">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-4 gap-y-2.5 px-3 py-2.5 sm:px-6 sm:py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-sky/30 bg-gradient-to-br from-emerald/20 via-blue/20 to-sky/20 sm:size-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="size-6 sm:size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[10.5px] font-bold tracking-[0.12em] text-emerald-soft uppercase sm:text-[11px] sm:tracking-[0.14em]">Shahrisabz Tibbiyot Texnikumi</div>
            <h1 className="truncate text-[16px] font-extrabold tracking-tight text-fg sm:text-[17px]">
              {staff ? 'Xodimlar boshqaruvi' : 'Talabalar portali'} <span className="hidden font-semibold text-fg-subtle min-[400px]:inline">· 2026/2027</span>
            </h1>
          </div>
          <div className="flex items-center gap-1.5 sm:hidden">
            <ThemeButton />
            <LogoutButton />
          </div>
        </div>

        {onTabChange && <TabSwitch activeTab={activeTab} onTabChange={onTabChange} />}

        <div className="flex w-full items-center gap-1.5 sm:w-auto sm:gap-2">
          {staff ? (
            <>
              {onAddStaff && (
                <button type="button" className="btn-success h-9 flex-1 px-3 sm:flex-none" onClick={onAddStaff} title="Yangi xodim qo'shish">
                  <UserPlus size={15} />
                  <span>Xodim qo'shish</span>
                </button>
              )}
              {onExportStaff && (
                <button type="button" className="btn-primary h-9 shrink-0 px-3" onClick={onExportStaff} title="Xodimlarni Excelga eksport qilish">
                  <FileSpreadsheet size={16} />
                  <span>Eksport</span>
                </button>
              )}
            </>
          ) : (
            <>
              <SyncBadge pendingCount={pendingCount} notify={notify} />
              <button type="button" className="btn-success h-9 flex-1 px-3 sm:flex-none" onClick={onAdd} title="Yangi talaba qo'shish">
                <UserPlus size={15} />
                <span className="lg:hidden">Qo'shish</span><span className="hidden lg:inline">Talaba qo'shish</span>
              </button>
            </>
          )}
          <a href="/majlis" className="btn-ghost h-9 shrink-0 px-2.5" title="O'qituvchilar majlisi davomati (asosiy va o'rindosh)" aria-label="Majlislar davomati">
            <CalendarCheck size={15} className="text-sky-soft" />
            <span className="hidden xl:inline">Majlislar</span>
          </a>
          <button type="button" className="btn-ghost h-9 shrink-0 px-2.5" onClick={onRefresh} disabled={refreshing} title="Serverdan eng yangi ma'lumotni olish" aria-label="Yangilash">
            <RefreshCw size={15} className={cx(refreshing && 'animate-spin')} />
            <span className="hidden xl:inline">Yangilash</span>
          </button>
          {onOpenSettings && (
            <button type="button" className="btn-ghost h-9 shrink-0 px-2.5" onClick={onOpenSettings} title="Sozlamalar (API kalitlar, AI modellar)" aria-label="Sozlamalar">
              <Settings size={15} />
              <span className="hidden xl:inline">Sozlamalar</span>
            </button>
          )}
          <span className="hidden sm:contents"><ThemeButton /></span>
          {!staff && <ExportMenu students={students} notify={notify} />}
          <span className="hidden sm:contents"><LogoutButton /></span>
        </div>
      </div>
    </header>
  )
}
