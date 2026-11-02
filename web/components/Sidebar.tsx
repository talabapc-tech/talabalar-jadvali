'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Award,
  BookOpen,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Database,
  GraduationCap,
  Layers,
  LogOut,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Users,
  X,
  Zap,
} from 'lucide-react'
import type { Student } from '@/lib/types'
import { academicGroups } from '@/lib/student'
import { cx } from './ui'

export type NavTab = 'students' | 'curriculum' | 'grades' | 'staff'

interface SidebarProps {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  students: Student[]
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

  // Statistika hisoblari
  const stats = useMemo(() => {
    const total = students.length
    const verified = students.filter((s) => s.verified).length
    const groups = academicGroups(students).length
    const verifiedPercent = total > 0 ? Math.round((verified / total) * 100) : 0
    return { total, verified, verifiedPercent, groups }
  }, [students])

  const navItems = [
    {
      id: 'students' as const,
      href: '/talabalar',
      label: 'Talabalar',
      sub: 'Kontingent va baza',
      icon: GraduationCap,
      badge: stats.total > 0 ? String(stats.total) : '569',
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
      sub: 'Pedagog va xodimlar',
      icon: Users,
      badge: `${staffCount}`,
      color: 'text-emerald',
      activeBg: 'bg-emerald/15 text-emerald-soft border-emerald/40',
      badgeCls: 'bg-emerald/20 text-emerald-soft',
    },
  ]

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between overflow-y-auto overflow-x-hidden p-3.5 select-none">
      {/* Yuqori qism: Brend va Logo */}
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-line">
          <Link
            href="/talabalar"
            onClick={(e) => {
              e.preventDefault()
              onTabChange('students')
              onMobileClose()
            }}
            className="flex items-center gap-2.5 min-w-0 group"
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-sky/30 bg-gradient-to-br from-emerald/20 via-blue/20 to-sky/20 shadow-inner group-hover:scale-105 transition-transform">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="" className="size-7" />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-extrabold tracking-[0.14em] text-emerald-soft uppercase">
                  Shahrisabz TT
                </div>
                <div className="truncate text-[14px] font-black text-fg tracking-tight">
                  Boshqaruv Tizimi
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

        {/* Asosiy navigatsiya */}
        <div className="space-y-1">
          {!collapsed && (
            <div className="px-2 pt-1 pb-1 text-[10.5px] font-bold tracking-wider text-fg-subtle uppercase">
              Asosiy bo'limlar
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
                  'group flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-all border',
                  isActive
                    ? cx(item.activeBg, 'shadow-sm font-bold')
                    : 'border-transparent text-fg-muted hover:bg-ink-800/80 hover:text-fg font-medium',
                  collapsed ? 'justify-center px-0' : '',
                )}
              >
                <div
                  className={cx(
                    'grid size-8 shrink-0 place-items-center rounded-lg transition-transform group-hover:scale-110',
                    isActive ? 'bg-ink-950/40 text-fg' : 'text-fg-subtle group-hover:text-fg',
                  )}
                >
                  <Icon size={18} className={isActive ? item.color : ''} />
                </div>

                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-[13.5px]">{item.label}</span>
                      <span
                        className={cx(
                          'rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums shrink-0',
                          isActive ? item.badgeCls : 'bg-ink-800 text-fg-subtle',
                        )}
                      >
                        {item.badge}
                      </span>
                    </div>
                    <div className="truncate text-[11px] text-fg-subtle font-normal">
                      {item.sub}
                    </div>
                  </div>
                )}
              </Link>
            )
          })}

          {/* Majlislar havolasi */}
          <a
            href="/majlis"
            title={collapsed ? 'Majlislar davomati' : undefined}
            className={cx(
              'group flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-all border border-transparent text-fg-muted hover:bg-ink-800/80 hover:text-fg font-medium',
              collapsed ? 'justify-center px-0' : '',
            )}
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-subtle group-hover:text-fg transition-transform group-hover:scale-110">
              <CalendarCheck size={18} className="text-teal-400" />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-[13.5px]">Majlislar</span>
                  <span className="rounded-md bg-teal-500/20 text-teal-300 px-1.5 py-0.5 text-[10.5px] font-semibold">
                    Davomat
                  </span>
                </div>
                <div className="truncate text-[11px] text-fg-subtle font-normal">
                  Pedkengash hisoboti
                </div>
              </div>
            )}
          </a>
        </div>

        {/* Stats Bar (Statistika bloki) */}
        {!collapsed && (
          <div className="rounded-2xl border border-line bg-gradient-to-b from-ink-900/90 to-ink-950/80 p-3 shadow-inner space-y-2.5">
            <div className="flex items-center justify-between text-[11px] font-bold text-fg-subtle uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Database size={12} className="text-sky" />
                Statistika
              </span>
              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-emerald-soft">
                <span className="size-1.5 rounded-full bg-emerald animate-pulse" />
                Jonli
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-xl border border-line/50 bg-ink-950/60 p-2">
                <div className="text-[10.5px] text-fg-subtle font-medium">Kontingent</div>
                <div className="text-[15px] font-extrabold text-fg tabular-nums">{stats.total}</div>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-soft">
                  <span>{stats.verifiedPercent}% tasdiq</span>
                </div>
              </div>

              <div className="rounded-xl border border-line/50 bg-ink-950/60 p-2">
                <div className="text-[10.5px] text-fg-subtle font-medium">Guruhlar</div>
                <div className="text-[15px] font-extrabold text-fg tabular-nums">{stats.groups} ta</div>
                <div className="mt-1 text-[10px] text-fg-subtle">
                  <span>3 ta kurs</span>
                </div>
              </div>
            </div>

            {/* Tasdiqlash progress bar */}
            <div>
              <div className="flex justify-between text-[10.5px] text-fg-subtle pb-1">
                <span>Hujjat tasdiqlanishi</span>
                <span className="font-semibold text-fg tabular-nums">{stats.verifiedPercent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, stats.verifiedPercent))}%` }}
                />
              </div>
            </div>

            <div className="pt-1 flex items-center justify-between text-[11px] text-fg-muted border-t border-line/60">
              <span className="truncate">O'quv yili:</span>
              <span className="font-bold text-fg">2026/2027</span>
            </div>
          </div>
        )}
      </div>

      {/* Pastki qism: Sozlamalar va Profil */}
      <div className="space-y-2 pt-3 border-t border-line">
        <div className="flex items-center gap-1">
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title="Tizim sozlamalari (API kalitlar, modellar)"
              className={cx(
                'btn-ghost h-9 text-[12.5px] text-fg-muted hover:text-fg',
                collapsed ? 'size-9 p-0 justify-center' : 'flex-1 justify-start px-2.5',
              )}
            >
              <Settings size={16} />
              {!collapsed && <span>Sozlamalar</span>}
            </button>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? "Yorug' rejim" : "To'q rejim"}
            className="btn-ghost size-9 shrink-0 p-0 justify-center"
            aria-label="Rejimni o'zgartirish"
          >
            {theme === 'dark' ? <Sun size={15} className="text-amber" /> : <Moon size={15} className="text-blue-soft" />}
          </button>

          {!local && (
            <button
              type="button"
              onClick={logout}
              title="Tizimdan chiqish"
              className="btn-ghost size-9 shrink-0 p-0 justify-center text-rose/80 hover:text-rose"
              aria-label="Tizimdan chiqish"
            >
              <LogOut size={15} />
            </button>
          )}

          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={collapsed ? 'Kengaytirish' : "Qisqartirish"}
              className="hidden lg:grid size-9 shrink-0 place-items-center rounded-lg text-fg-subtle hover:bg-ink-800 hover:text-fg transition-colors"
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
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
          collapsed ? 'w-[72px]' : 'w-[250px] xl:w-[260px]',
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
          <aside className="fixed inset-y-0 left-0 w-[280px] max-w-[85vw] bg-ink-950 shadow-2xl border-r border-line animate-slide-right flex flex-col">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  )
}
