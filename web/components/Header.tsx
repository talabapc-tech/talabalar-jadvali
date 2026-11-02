'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Award,
  BookOpen,
  CalendarCheck,
  ChevronDown,
  CloudCheck,
  CloudOff,
  CloudUpload,
  Download,
  FileSpreadsheet,
  GraduationCap,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sun,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { exportRole, ROLE_META, sendRoleToTelegram, type Role } from '@/lib/excel'
import type { Student } from '@/lib/types'
import type { Notify } from './Toast'
import { cx } from './ui'

interface SyncInfo {
  mode: 'local' | 'github'
  state?: string
  pending?: boolean
  pending_seconds?: number
  last_sync?: string
}

/** Saqlash holati: brauzerdagi kutilayotgan o'zgarishlar + (lokalda) Python xizmatining GitHub navbati */
function SyncBadge({ pendingCount, notify }: { pendingCount: number; notify: Notify }) {
  const [info, setInfo] = useState<SyncInfo | null>(null)
  const [flushing, setFlushing] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () =>
      document.visibilityState === 'visible' &&
      fetch('/api/sync', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return
          setInfo(d)
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
      notify(
        r.success ? (r.had_pending ? "GitHub'ga yuborilmoqda..." : "Yuboriladigan o'zgarish yo'q") : r.error || 'Xatolik',
        r.success ? 'success' : 'error',
      )
    } finally {
      setFlushing(false)
    }
  }

  let text: string
  if (offline) text = "Python xizmati o'chiq"
  else if (pendingCount > 0) text = `${pendingCount} ta o'zgarish saqlanmoqda`
  else if (gitPending)
    text = info?.state === 'syncing' ? "Saqlandi • GitHub'ga yuborilmoqda" : `Saqlandi (GitHub navbatda${info?.pending_seconds ? ` ${info.pending_seconds}s` : ''})`
  else text = 'Hammasi saqlangan'

  return (
    <>
      <button
        type="button"
        onClick={() => notify(text, offline ? 'error' : busy ? 'info' : 'success')}
        className={cx(
          'chip size-9 shrink-0 justify-center rounded-xl px-0 text-[12.5px] 2xl:w-auto 2xl:cursor-default 2xl:px-3',
          offline
            ? 'border-rose/45 bg-rose/10 text-rose'
            : busy
              ? 'border-sky/40 bg-sky/10 text-sky-soft'
              : 'border-emerald/40 bg-emerald/10 text-emerald-soft',
        )}
        title={
          offline
            ? "Kompyuterdagi Python xizmati ishlamayapti. ISHGA_TUSHIRISH.bat ni ishga tushiring"
            : local
              ? "Lokal rejim: o'zgarishlar kompyuterdagi Python xizmati orqali Excelga yoziladi"
              : "O'zgarishlar GitHub navbatiga yoziladi"
        }
      >
        {offline ? (
          <CloudOff size={14} className="shrink-0" />
        ) : pendingCount > 0 ? (
          <Loader2 size={14} className="shrink-0 animate-spin" />
        ) : gitPending ? (
          <CloudUpload size={14} className="shrink-0 animate-pulse" />
        ) : (
          <CloudCheck size={14} className="shrink-0" />
        )}
        <span className="hidden 2xl:inline">{text}</span>
      </button>
      {local && !offline && (
        <button
          type="button"
          className="btn-ghost h-9 shrink-0 px-2.5"
          onClick={flush}
          disabled={flushing}
          title="30 soniyani kutmasdan hisobotni qayta yaratib GitHub'ga yuborish"
        >
          <CloudUpload size={15} />
          <span className="hidden 2xl:inline">Hozir yuborish</span>
        </button>
      )}
    </>
  )
}

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

  const rowCls = 'group flex w-full items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-ink-700/60 sm:px-2.5'

  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" className="btn-primary h-9 px-3" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <FileSpreadsheet size={16} />
        <span>Excel<span className="hidden 2xl:inline">&nbsp;eksport</span></span>
        <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="animate-fade-in fixed inset-0 z-40 bg-ink-950/60 sm:hidden" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="animate-slide-up pb-safe fixed inset-x-2 bottom-2 z-50 max-h-[80dvh] overflow-y-auto rounded-2xl border border-line-strong bg-ink-850 p-2 shadow-2xl shadow-black/50
              sm:animate-pop-in sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-auto sm:mt-2 sm:max-h-[calc(100dvh-90px)] sm:w-[400px] sm:pb-2"
          >
            <div className="flex items-center justify-between px-3 pt-1 pb-1 sm:hidden">
              <span className="text-[14px] font-bold text-fg">Excel eksport</span>
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
          </div>
        </>
      )}
    </div>
  )
}

export type MainTab = 'students' | 'curriculum' | 'staff' | 'grades'

export default function Header({
  students,
  pendingCount,
  onRefresh,
  refreshing,
  onAdd,
  onOpenSettings,
  notify,
  activeTab = 'students',
  onAddStaff,
  onExportStaff,
  onOpenSidebar,
  onAddCurriculum,
}: {
  students: Student[]
  pendingCount: number
  onRefresh: () => void
  refreshing: boolean
  onAdd: () => void
  onOpenSettings?: () => void
  notify: Notify
  activeTab?: MainTab
  onAddStaff?: () => void
  onExportStaff?: () => void
  onOpenSidebar?: () => void
  onAddCurriculum?: () => void
}) {
  const staff = activeTab === 'staff'
  const grades = activeTab === 'grades'
  const curriculum = activeTab === 'curriculum'

  const titleText = staff
    ? 'Xodimlar boshqaruvi'
    : grades
      ? 'Baholar va reyting'
      : curriculum
        ? "O'quv rejalari va fanlar"
        : 'Talabalar portali'

  return (
    <header className="no-print z-20 border-b border-line bg-ink-950 sm:sticky sm:top-0 sm:bg-ink-950/85 sm:backdrop-blur-md">
      <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-3 px-3 py-2.5 sm:px-6 sm:py-3">
        {/* Chap qism: Hamburger (mobilda) va Sarlavha */}
        <div className="flex min-w-0 items-center gap-2.5">
          {onOpenSidebar && (
            <button
              type="button"
              onClick={onOpenSidebar}
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-ink-900 text-fg-muted hover:text-fg hover:bg-ink-850 lg:hidden"
              aria-label="Menyu ochish"
            >
              <Menu size={18} />
            </button>
          )}

          <div className="min-w-0">
            <div className="truncate text-[10px] font-bold tracking-[0.14em] text-emerald-soft uppercase sm:text-[11px]">
              Shahrisabz Abu Ali ibn Sino nomidagi JTSM
            </div>
            <h1 className="truncate text-[15px] font-extrabold tracking-tight text-fg sm:text-[17px]">
              {titleText}
              <span className="hidden font-semibold text-fg-subtle min-[480px]:inline"> · 2026/2027</span>
            </h1>
          </div>
        </div>

        {/* O'ng qism: Amallar tugmalari */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {curriculum ? (
            onAddCurriculum && (
              <button
                type="button"
                className="btn-success h-9 px-3 text-[13px]"
                onClick={onAddCurriculum}
                title="Yangi o'quv reja yaratish"
              >
                <Plus size={15} />
                <span>Yangi reja</span>
              </button>
            )
          ) : grades ? null : staff ? (
            <>
              {onAddStaff && (
                <button
                  type="button"
                  className="btn-success h-9 px-3 text-[13px]"
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
                  className="btn-primary h-9 shrink-0 px-3 text-[13px]"
                  onClick={onExportStaff}
                  title="Xodimlarni Excelga eksport qilish"
                >
                  <FileSpreadsheet size={16} />
                  <span className="hidden sm:inline">Eksport</span>
                </button>
              )}
            </>
          ) : (
            <>
              <SyncBadge pendingCount={pendingCount} notify={notify} />
              <button
                type="button"
                className="btn-success h-9 px-3 text-[13px]"
                onClick={onAdd}
                title="Yangi talaba qo'shish"
              >
                <UserPlus size={15} />
                <span className="hidden sm:inline">Talaba qo'shish</span>
                <span className="sm:hidden">Qo'shish</span>
              </button>
            </>
          )}

          <button
            type="button"
            className="btn-ghost h-9 shrink-0 px-2.5"
            onClick={onRefresh}
            disabled={refreshing}
            title="Serverdan eng yangi ma'lumotni olish"
            aria-label="Yangilash"
          >
            <RefreshCw size={15} className={cx(refreshing && 'animate-spin')} />
            <span className="hidden xl:inline">Yangilash</span>
          </button>

          {!staff && !grades && !curriculum && <ExportMenu students={students} notify={notify} />}
        </div>
      </div>
    </header>
  )
}
