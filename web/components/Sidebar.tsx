'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Award,
  BookOpen,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CloudCheck,
  CloudOff,
  CloudUpload,
  GraduationCap,
  Loader2,
  LogOut,
  Moon,
  RefreshCw,
  Send,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react'
import type { Student } from '@/lib/types'
import type { Notify } from './Toast'
import { cx } from './ui'

export type NavTab = 'students' | 'curriculum' | 'grades' | 'staff'

interface SyncInfo {
  mode: 'local' | 'github'
  state?: string
  pending?: boolean
  pending_seconds?: number
  last_sync?: string
}

interface SidebarProps {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  students: Student[]
  pendingCount?: number
  notify: Notify
  mobileOpen: boolean
  onMobileClose: () => void
  onOpenSettings?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
  curriculumCount?: number
  staffCount?: number
}

export default function Sidebar({
  activeTab,
  onTabChange,
  students,
  pendingCount = 0,
  notify,
  mobileOpen,
  onMobileClose,
  onOpenSettings,
  collapsed = false,
  onToggleCollapse,
  curriculumCount = 4,
  staffCount = 29,
}: SidebarProps) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [local, setLocal] = useState(true)

  // GitHub va Python sync holati
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null)
  const [flushing, setFlushing] = useState(false)

  useEffect(() => {
    let alive = true
    const loadSync = () => {
      if (document.visibilityState !== 'visible') return
      fetch('/api/sync', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return
          setSyncInfo(d)
        })
        .catch(() => {})
    }

    const t = setInterval(loadSync, 20_000)
    loadSync()
    return () => { alive = false; clearInterval(t) }
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('portal_theme') === 'light' ? 'light' : 'dark'
    setTheme(saved)
    setLocal(['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname))
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('portal_theme', next) } catch { /* bo'sh */ }
  }

  const logout = async () => {
    if (!confirm('Tizimdan chiqasizmi?')) return
    try { localStorage.removeItem('portal_device_token') } catch { /* bo'sh */ }
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    window.location.replace('/login')
  }

  // GitHub ga darhol yuborish
  const handleFlushSync = async () => {
    setFlushing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const r = await res.json()
      if (r.success) {
        notify(r.had_pending ? "GitHub'ga yuborilmoqda..." : "Yuboriladigan o'zgarish yo'q", 'success')
      } else {
        notify(r.error || 'Sinxronlashda xatolik', 'error')
      }
      // statusni yangilash
      const check = await fetch('/api/sync', { cache: 'no-store' }).then((x) => x.json())
      setSyncInfo(check)
    } catch (e) {
      notify(`Aloqa xatosi: ${(e as Error).message}`, 'error')
    } finally {
      setFlushing(false)
    }
  }

  const isLocal = syncInfo?.mode === 'local'
  const isOffline = isLocal && syncInfo?.state === 'offline'
  const isGitPending = isLocal && (syncInfo?.pending || syncInfo?.state === 'pending' || syncInfo?.state === 'syncing')
  const isBusy = pendingCount > 0 || isGitPending

  let syncText: string
  if (isOffline) syncText = "Python xizmati o'chiq"
  else if (pendingCount > 0) syncText = `${pendingCount} ta o'zgarish saqlanmoqda`
  else if (isGitPending) syncText = syncInfo?.state === 'syncing' ? "GitHub'ga yuborilmoqda" : `GitHub navbatda${syncInfo?.pending_seconds ? ` (${syncInfo.pending_seconds}s)` : ''}`
  else syncText = 'Hammasi saqlangan'

  const navItems = [
    {
      id: 'students' as const,
      href: '/talabalar',
      label: 'Talabalar',
      sub: 'Baza va kontingent',
      icon: GraduationCap,
      badge: `${students.length || 569}`,
      color: 'text-sky',
      activeBg: 'bg-sky/15 text-sky-soft border-sky/40',
      badgeCls: 'bg-sky/20 text-sky-soft',
    },
    {
      id: 'curriculum' as const,
      href: '/oquv-reja',
      label: "O'quv reja",
      sub: 'Yillar, fanlar, guruhlar',
      icon: BookOpen,
      badge: `${curriculumCount} ta`,
      color: 'text-indigo-400',
      activeBg: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
      badgeCls: 'bg-indigo-500/20 text-indigo-300',
    },
    {
      id: 'grades' as const,
      href: '/baholar',
      label: 'Baholar',
      sub: 'Reyting va amaliyot',
      icon: Award,
      badge: 'Semestr',
      color: 'text-amber',
      activeBg: 'bg-amber/15 text-amber border-amber/40',
      badgeCls: 'bg-amber/20 text-amber',
    },
    {
      id: 'staff' as const,
      href: '/xodimlar',
      label: 'Xodimlar',
      sub: 'Pedagoglar ro\'yxati',
      icon: Users,
      badge: `${staffCount}`,
      color: 'text-emerald',
      activeBg: 'bg-emerald/15 text-emerald-soft border-emerald/40',
      badgeCls: 'bg-emerald/20 text-emerald-soft',
    },
  ]

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between overflow-y-auto overflow-x-hidden p-3 select-none">
      {/* Yuqori qism: Brend va Logo */}
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-2.5 border-b border-line">
          <Link
            href="/talabalar"
            onClick={(e) => {
              e.preventDefault()
              onTabChange('students')
              onMobileClose()
            }}
            className="flex items-center gap-2.5 min-w-0 group"
          >
            <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-sky/30 bg-gradient-to-br from-emerald/20 via-blue/20 to-sky/20 shadow-inner group-hover:scale-105 transition-transform">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="" className="size-6" />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-extrabold tracking-[0.14em] text-emerald-soft uppercase">
                  Shahrisabz TT
                </div>
                <div className="truncate text-[13.5px] font-black text-fg tracking-tight">
                  Boshqaruv Portali
                </div>
              </div>
            )}
          </Link>

          {/* Mobilda yopish tugmasi */}
          <button
            type="button"
            onClick={onMobileClose}
            className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-ink-800 lg:hidden"
            aria-label="Yopish"
          >
            <X size={18} />
          </button>
        </div>

        {/* Asosiy navigatsiya ro'yxati */}
        <div className="space-y-1">
          {!collapsed && (
            <div className="px-2 pt-0.5 pb-1 text-[10.5px] font-bold tracking-wider text-fg-subtle uppercase">
              Bo'limlar
            </div>
          )}

          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activeTab === item.id
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault()
                  onTabChange(item.id)
                  onMobileClose()
                }}
                title={collapsed ? `${item.label} (${item.sub})` : undefined}
                className={cx(
                  'group flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 transition-all border',
                  isActive
                    ? cx(item.activeBg, 'shadow-sm font-bold')
                    : 'border-transparent text-fg-muted hover:bg-ink-800/80 hover:text-fg font-medium',
                  collapsed ? 'justify-center px-0' : '',
                )}
              >
                <div
                  className={cx(
                    'grid size-7 shrink-0 place-items-center rounded-lg transition-transform group-hover:scale-110',
                    isActive ? 'bg-ink-950/40 text-fg' : 'text-fg-subtle group-hover:text-fg',
                  )}
                >
                  <Icon size={17} className={isActive ? item.color : ''} />
                </div>

                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-[13px]">{item.label}</span>
                      <span
                        className={cx(
                          'rounded-md px-1.5 py-0.2 text-[10px] font-semibold tabular-nums shrink-0',
                          isActive ? item.badgeCls : 'bg-ink-800 text-fg-subtle',
                        )}
                      >
                        {item.badge}
                      </span>
                    </div>
                    <div className="truncate text-[10.5px] text-fg-subtle font-normal">
                      {item.sub}
                    </div>
                  </div>
                )}
              </Link>
            )
          })}

          {/* Majlislar davomati */}
          <a
            href="/majlis"
            title={collapsed ? 'Majlislar davomati' : undefined}
            className={cx(
              'group flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 transition-all border border-transparent text-fg-muted hover:bg-ink-800/80 hover:text-fg font-medium',
              collapsed ? 'justify-center px-0' : '',
            )}
          >
            <div className="grid size-7 shrink-0 place-items-center rounded-lg text-fg-subtle group-hover:text-fg transition-transform group-hover:scale-110">
              <CalendarCheck size={17} className="text-teal-400" />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-[13px]">Majlislar</span>
                  <span className="rounded-md bg-teal-500/20 text-teal-300 px-1.5 py-0.2 text-[10px] font-semibold">
                    Davomat
                  </span>
                </div>
                <div className="truncate text-[10.5px] text-fg-subtle font-normal">
                  Pedkengash hisoboti
                </div>
              </div>
            )}
          </a>
        </div>
      </div>

      {/* O'rta / Pastki qism: GitHub & Sinxronizatsiya Status Bari */}
      <div className="space-y-3 pt-3 border-t border-line">
        {/* GitHub / Lokal Sinxronizatsiya bloki (foydalanuvchi so'ragandek) */}
        {!collapsed ? (
          <div className="rounded-xl border border-line bg-ink-900/80 p-2.5 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-fg-subtle uppercase tracking-wider">
              <span>GitHub & Tizim</span>
              <span
                className={cx(
                  'size-2 rounded-full',
                  isOffline
                    ? 'bg-rose animate-pulse'
                    : isBusy
                      ? 'bg-sky animate-ping'
                      : 'bg-emerald',
                )}
              />
            </div>

            <div className="flex items-center gap-2 text-[11.5px]">
              <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-ink-950 border border-line">
                {isOffline ? (
                  <CloudOff size={14} className="text-rose" />
                ) : flushing || pendingCount > 0 ? (
                  <Loader2 size={14} className="animate-spin text-sky" />
                ) : isGitPending ? (
                  <CloudUpload size={14} className="animate-pulse text-sky" />
                ) : (
                  <CloudCheck size={14} className="text-emerald" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-fg text-[11.5px]">{syncText}</div>
                <div className="truncate text-[10px] text-fg-subtle">
                  {isLocal ? 'Lokal Python xizmati' : 'GitHub navbati'}
                </div>
              </div>
            </div>

            {/* GitHub'ga yuborish tugmasi */}
            <button
              type="button"
              onClick={handleFlushSync}
              disabled={flushing || isOffline}
              className="btn-ghost w-full h-8 justify-center gap-1.5 text-[11.5px] font-bold border-line bg-ink-950 hover:bg-ink-800 text-sky-soft"
              title="O'zgarishlarni darhol hisoblab GitHub'ga yuborish"
            >
              {flushing ? (
                <Loader2 size={13} className="animate-spin text-sky" />
              ) : (
                <CloudUpload size={13} className="text-sky" />
              )}
              <span>GitHub'ga yuborish</span>
            </button>
          </div>
        ) : (
          /* Collapsed holatda ixcham tugma */
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleFlushSync}
              disabled={flushing || isOffline}
              className={cx(
                'grid size-9 place-items-center rounded-xl border transition-all',
                isOffline
                  ? 'border-rose/40 bg-rose/10 text-rose'
                  : isBusy
                    ? 'border-sky/40 bg-sky/10 text-sky-soft animate-pulse'
                    : 'border-emerald/40 bg-emerald/10 text-emerald-soft',
              )}
              title={syncText}
            >
              {flushing ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <CloudUpload size={15} />
              )}
            </button>
          </div>
        )}

        {/* Profil, Tema va Sozlamalar amallari */}
        <div className="flex items-center gap-1 pt-1">
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title="Sozlamalar (API kalitlar, modellar)"
              className={cx(
                'btn-ghost h-8 text-[12px] text-fg-muted hover:text-fg',
                collapsed ? 'size-8 p-0 justify-center' : 'flex-1 justify-start px-2',
              )}
            >
              <Settings size={15} />
              {!collapsed && <span>Sozlamalar</span>}
            </button>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? "Yorug' rejim" : "To'q rejim"}
            className="btn-ghost size-8 shrink-0 p-0 justify-center"
            aria-label="Rejim"
          >
            {theme === 'dark' ? <Sun size={14} className="text-amber" /> : <Moon size={14} className="text-blue-soft" />}
          </button>

          {!local && (
            <button
              type="button"
              onClick={logout}
              title="Tizimdan chiqish"
              className="btn-ghost size-8 shrink-0 p-0 justify-center text-rose/80 hover:text-rose"
              aria-label="Chiqish"
            >
              <LogOut size={14} />
            </button>
          )}

          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={collapsed ? 'Kengaytirish' : "Qisqartirish"}
              className="hidden lg:grid size-8 shrink-0 place-items-center rounded-lg text-fg-subtle hover:bg-ink-800 hover:text-fg transition-colors"
            >
              {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop doimiy Sidebar */}
      <aside
        className={cx(
          'no-print fixed inset-y-0 left-0 z-30 hidden lg:flex flex-col border-r border-line bg-ink-950 transition-all duration-200',
          collapsed ? 'w-[72px]' : 'w-[240px]',
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Drawer (Parda) */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-ink-950/70 backdrop-blur-sm transition-opacity"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 w-[270px] max-w-[85vw] bg-ink-950 shadow-2xl border-r border-line animate-slide-right flex flex-col">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  )
}
