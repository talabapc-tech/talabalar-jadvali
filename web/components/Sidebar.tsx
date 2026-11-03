'use client'

/*
  Chap yon menyu.
  Desktop (lg+): doimiy panel, qisqartirish mumkin (holat Portal'da saqlanadi). Tuzilishi: brend (yuqori) —
  bo'limlar (o'rta, o'zi aylanadi) — tizim holati, sozlamalar, versiya (pastda doim ko'rinadi).
  Mobil: chapdan silliq chiqadigan parda — orqa fon bosilsa, Escape yoki chapga surilsa yopiladi,
  ochiq paytda sahifa orqada aylanmaydi.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
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
  Globe,
  GraduationCap,
  Loader2,
  LogOut,
  Moon,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react'
import type { Student } from '@/lib/types'
import type { Notify } from './Toast'
import VersionBadge from './VersionBadge'
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
}

/** Bo'limlardagi sonlar (o'quv rejalar, xodimlar) — bir marta olinadi, sessiya davomida keshlanadi */
function useSectionCounts() {
  const [counts, setCounts] = useState<{ curriculum?: number; staff?: number }>({})
  useEffect(() => {
    let alive = true
    try {
      const c = JSON.parse(sessionStorage.getItem('sidebar_counts') || '{}')
      if (c && typeof c === 'object') setCounts(c)
    } catch {
      /* bo'sh */
    }
    const get = (url: string, pick: (d: Record<string, unknown>) => unknown) =>
      fetch(url, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          const v = pick(d)
          return Array.isArray(v) ? v.length : undefined
        })
        .catch(() => undefined)
    Promise.all([get('/api/curriculum', (d) => d.plans), get('/api/staff', (d) => d.staff)]).then(([curriculum, staff]) => {
      if (!alive) return
      setCounts((prev) => {
        const next = { curriculum: curriculum ?? prev.curriculum, staff: staff ?? prev.staff }
        try {
          sessionStorage.setItem('sidebar_counts', JSON.stringify(next))
        } catch {
          /* bo'sh */
        }
        return next
      })
    })
    return () => {
      alive = false
    }
  }, [])
  return counts
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
}: SidebarProps) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [local, setLocal] = useState(true)
  const counts = useSectionCounts()

  // GitHub va Python sync holati
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null)
  const [flushing, setFlushing] = useState(false)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    const loadSync = () => {
      if (document.visibilityState !== 'visible') return
      fetch('/api/sync', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: SyncInfo) => {
          if (!alive) return
          setSyncInfo(d)
          // Internetdagi saytda holat o'zgarmaydi — qayta-qayta so'ramaymiz
          if (d.mode !== 'local' && timer) {
            clearInterval(timer)
            timer = null
          }
        })
        .catch(() => {})
    }
    timer = setInterval(loadSync, 20_000)
    loadSync()
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem('portal_theme') === 'light' ? 'light' : 'dark'
      } catch {
        return 'dark'
      }
    })()
    setTheme(saved)
    document.documentElement.dataset.theme = saved
    setLocal(['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname))
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('portal_theme', next)
    } catch {
      /* bo'sh */
    }
  }

  const logout = async () => {
    if (!confirm('Tizimdan chiqasizmi?')) return
    try {
      localStorage.removeItem('portal_device_token')
    } catch {
      /* bo'sh */
    }
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    window.location.replace('/login')
  }

  // GitHub ga darhol yuborish (faqat kompyuterdagi Python xizmati bilan)
  const handleFlushSync = async () => {
    setFlushing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const r = await res.json().catch(() => ({}))
      if (r.success) {
        notify(r.had_pending ? "GitHub'ga yuborilmoqda..." : "Yuboriladigan o'zgarish yo'q", 'success')
      } else {
        notify(r.error || 'Sinxronlashda xatolik', 'error')
      }
      const check = await fetch('/api/sync', { cache: 'no-store' }).then((x) => x.json())
      setSyncInfo(check)
    } catch (e) {
      notify(`Aloqa xatosi: ${(e as Error).message}`, 'error')
    } finally {
      setFlushing(false)
    }
  }

  /* ---------------------------- Mobil parda: yopilish animatsiyasi, Escape, surish ---------------------------- */

  const [drawerMounted, setDrawerMounted] = useState(false)
  const [drawerClosing, setDrawerClosing] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (mobileOpen) {
      setDrawerMounted(true)
      setDrawerClosing(false)
      return
    }
    if (!drawerMounted) return
    setDrawerClosing(true)
    const t = setTimeout(() => {
      setDrawerMounted(false)
      setDrawerClosing(false)
    }, 200)
    return () => clearTimeout(t)
  }, [mobileOpen, drawerMounted])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onMobileClose()
    window.addEventListener('keydown', onKey)
    // Parda ochiqligida orqadagi sahifa aylanmasin
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Ekran kengaysa (desktop) parda o'zi yopiladi
    const mq = window.matchMedia('(min-width: 1024px)')
    const onMq = () => mq.matches && onMobileClose()
    mq.addEventListener('change', onMq)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      mq.removeEventListener('change', onMq)
    }
  }, [mobileOpen, onMobileClose])

  // Barmoq bilan chapga surib yopish
  const swipe = useRef<{ x: number; y: number; dx: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    swipe.current = { x: t.clientX, y: t.clientY, dx: 0 }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const s = swipe.current
    const el = drawerRef.current
    if (!s || !el) return
    const t = e.touches[0]
    const dx = t.clientX - s.x
    // Asosan gorizontal va chapga harakat bo'lsagina parda ergashadi
    if (s.dx === 0 && Math.abs(t.clientY - s.y) > Math.abs(dx)) {
      swipe.current = null
      return
    }
    s.dx = Math.min(0, dx)
    el.style.transition = 'none'
    el.style.transform = `translateX(${s.dx}px)`
  }
  const onTouchEnd = () => {
    const s = swipe.current
    const el = drawerRef.current
    swipe.current = null
    if (!el) return
    el.style.transition = ''
    el.style.transform = ''
    if (s && s.dx < -70) onMobileClose()
  }

  const go = useCallback(
    (tab: NavTab) => {
      onTabChange(tab)
      onMobileClose()
    },
    [onTabChange, onMobileClose],
  )

  /* ---------------------------- Holat matnlari ---------------------------- */

  const isLocal = syncInfo?.mode === 'local'
  const isOnline = syncInfo?.mode === 'github'
  const isOffline = isLocal && syncInfo?.state === 'offline'
  const isGitPending = isLocal && (syncInfo?.pending || syncInfo?.state === 'pending' || syncInfo?.state === 'syncing')
  const isBusy = pendingCount > 0 || !!isGitPending

  let syncText: string
  let syncSub: string
  if (!syncInfo) {
    syncText = 'Holat tekshirilmoqda…'
    syncSub = ''
  } else if (isOnline) {
    syncText = pendingCount > 0 ? `${pendingCount} ta o'zgarish saqlanmoqda` : 'Onlayn — hammasi saqlangan'
    syncSub = "O'zgarishlar GitHub navbatiga yoziladi"
  } else if (isOffline) {
    syncText = "Python xizmati o'chiq"
    syncSub = 'ISHGA_TUSHIRISH.bat ni ishga tushiring'
  } else if (pendingCount > 0) {
    syncText = `${pendingCount} ta o'zgarish saqlanmoqda`
    syncSub = 'Lokal Python xizmati'
  } else if (isGitPending) {
    syncText =
      syncInfo.state === 'syncing'
        ? "GitHub'ga yuborilmoqda"
        : `GitHub navbatda${syncInfo.pending_seconds ? ` (${syncInfo.pending_seconds}s)` : ''}`
    syncSub = 'Lokal Python xizmati'
  } else {
    syncText = 'Hammasi saqlangan'
    syncSub = 'Lokal Python xizmati'
  }
  const tone = isOffline ? 'rose' : isBusy || !syncInfo ? 'sky' : 'emerald'

  const navItems = [
    {
      id: 'students' as const,
      href: '/talabalar',
      label: 'Talabalar',
      sub: 'Baza va kontingent',
      icon: GraduationCap,
      badge: students.length ? String(students.length) : '',
      color: 'text-sky',
      active: 'bg-sky/12 text-sky-soft border-sky/35',
      bar: 'bg-sky',
      badgeCls: 'bg-sky/20 text-sky-soft',
    },
    {
      id: 'curriculum' as const,
      href: '/oquv-reja',
      label: "O'quv reja",
      sub: 'Yillar, fanlar, guruhlar',
      icon: BookOpen,
      badge: counts.curriculum !== undefined ? `${counts.curriculum} ta` : '',
      color: 'text-indigo-400',
      active: 'bg-indigo-500/12 text-indigo-300 border-indigo-500/35',
      bar: 'bg-indigo-400',
      badgeCls: 'bg-indigo-500/20 text-indigo-300',
    },
    {
      id: 'grades' as const,
      href: '/baholar',
      label: 'Baholar',
      sub: 'Reyting va amaliyot',
      icon: Award,
      badge: '',
      color: 'text-amber',
      active: 'bg-amber/12 text-amber border-amber/35',
      bar: 'bg-amber',
      badgeCls: 'bg-amber/20 text-amber',
    },
    {
      id: 'staff' as const,
      href: '/xodimlar',
      label: 'Xodimlar',
      sub: "Pedagoglar ro'yxati",
      icon: Users,
      badge: counts.staff !== undefined ? String(counts.staff) : '',
      color: 'text-emerald',
      active: 'bg-emerald/12 text-emerald-soft border-emerald/35',
      bar: 'bg-emerald',
      badgeCls: 'bg-emerald/20 text-emerald-soft',
    },
  ]

  /** compact — desktop'da qisqartirilgan holat (mobil pardada hech qachon) */
  const renderContent = (compact: boolean) => (
    <div className="flex h-full min-h-0 flex-col">
      {/* Brend */}
      <div
        className={cx(
          'flex shrink-0 items-center gap-2 border-b border-line',
          compact ? 'justify-center px-2 py-3' : 'justify-between px-3 py-3',
        )}
      >
        <Link
          href="/talabalar"
          onClick={(e) => {
            e.preventDefault()
            go('students')
          }}
          className="flex min-w-0 items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-sky/50"
          title="Boshqaruv portali"
        >
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-sky/30 bg-gradient-to-br from-emerald/20 via-blue/20 to-sky/20 shadow-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="size-6" />
          </div>
          {!compact && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[10px] font-extrabold uppercase tracking-[0.14em] text-emerald-soft">
                Shahrisabz TT
              </div>
              <div className="truncate text-[13.5px] font-black tracking-tight text-fg">Boshqaruv Portali</div>
            </div>
          )}
        </Link>

        {/* Mobilda yopish */}
        <button
          type="button"
          onClick={onMobileClose}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-ink-800 hover:text-fg lg:hidden"
          aria-label="Menyuni yopish"
        >
          <X size={18} />
        </button>
      </div>

      {/* Bo'limlar (joy yetmasa faqat shu qism aylanadi) */}
      <nav aria-label="Bo'limlar" className={cx('min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden py-3', compact ? 'px-2' : 'px-3')}>
        {!compact && (
          <div className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-fg-subtle">Bo'limlar</div>
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
                go(item.id)
              }}
              aria-current={isActive ? 'page' : undefined}
              title={compact ? `${item.label} — ${item.sub}` : undefined}
              className={cx(
                'group relative flex items-center gap-2.5 rounded-xl border py-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky/50',
                compact ? 'justify-center px-0' : 'px-2.5',
                isActive
                  ? cx(item.active, 'font-bold')
                  : 'border-transparent font-medium text-fg-muted hover:bg-ink-800/80 hover:text-fg',
              )}
            >
              {/* Faol bo'lim chizig'i */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className={cx('absolute top-2 bottom-2 w-[3px] rounded-full', compact ? '-left-2' : '-left-3', item.bar)}
                />
              )}
              <div
                className={cx(
                  'grid size-8 shrink-0 place-items-center rounded-lg',
                  isActive ? 'bg-ink-950/40' : 'text-fg-subtle group-hover:text-fg',
                )}
              >
                <Icon size={18} className={isActive ? item.color : ''} />
              </div>

              {!compact && (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px]">{item.label}</span>
                    {item.badge && (
                      <span
                        className={cx(
                          'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums',
                          isActive ? item.badgeCls : 'bg-ink-800 text-fg-subtle',
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[10.5px] font-normal text-fg-subtle">{item.sub}</div>
                </div>
              )}
            </Link>
          )
        })}

        {/* Majlislar davomati (alohida sahifa) */}
        <a
          href="/majlis"
          title={compact ? 'Majlislar — pedkengash davomati' : undefined}
          className={cx(
            'group flex items-center gap-2.5 rounded-xl border border-transparent py-2 font-medium text-fg-muted transition-colors outline-none hover:bg-ink-800/80 hover:text-fg focus-visible:ring-2 focus-visible:ring-sky/50',
            compact ? 'justify-center px-0' : 'px-2.5',
          )}
        >
          <div className="grid size-8 shrink-0 place-items-center rounded-lg">
            <CalendarCheck size={18} className="text-teal-400" />
          </div>
          {!compact && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">Majlislar</div>
              <div className="truncate text-[10.5px] font-normal text-fg-subtle">Pedkengash davomati</div>
            </div>
          )}
        </a>
      </nav>

      {/* Pastki qism: tizim holati, amallar, versiya — doim ko'rinadi */}
      <div className={cx('shrink-0 space-y-2 border-t border-line pt-2.5 pb-safe', compact ? 'px-2' : 'px-3')}>
        {compact ? (
          <button
            type="button"
            onClick={isLocal && !isOffline ? handleFlushSync : undefined}
            disabled={flushing}
            className={cx(
              'mx-auto grid size-10 place-items-center rounded-xl border transition-colors',
              tone === 'rose'
                ? 'border-rose/40 bg-rose/10 text-rose'
                : tone === 'sky'
                  ? 'border-sky/40 bg-sky/10 text-sky-soft'
                  : 'border-emerald/40 bg-emerald/10 text-emerald-soft',
              isLocal && !isOffline ? 'cursor-pointer' : 'cursor-default',
            )}
            title={`${syncText}${syncSub ? ` — ${syncSub}` : ''}${isLocal && !isOffline ? "\nBosing: GitHub'ga hozir yuborish" : ''}`}
            aria-label={syncText}
          >
            {flushing || pendingCount > 0 ? (
              <Loader2 size={16} className="animate-spin" />
            ) : isOffline ? (
              <CloudOff size={16} />
            ) : isOnline ? (
              <Globe size={16} />
            ) : isGitPending ? (
              <CloudUpload size={16} />
            ) : (
              <CloudCheck size={16} />
            )}
          </button>
        ) : (
          <div className="space-y-2 rounded-xl border border-line bg-ink-900/80 p-2.5">
            <div className="flex items-center gap-2">
              <div
                className={cx(
                  'grid size-8 shrink-0 place-items-center rounded-lg border',
                  tone === 'rose'
                    ? 'border-rose/30 bg-rose/10 text-rose'
                    : tone === 'sky'
                      ? 'border-sky/30 bg-sky/10 text-sky'
                      : 'border-emerald/30 bg-emerald/10 text-emerald',
                )}
              >
                {flushing || pendingCount > 0 || !syncInfo ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : isOffline ? (
                  <CloudOff size={15} />
                ) : isOnline ? (
                  <Globe size={15} />
                ) : isGitPending ? (
                  <CloudUpload size={15} />
                ) : (
                  <CloudCheck size={15} />
                )}
              </div>
              <div className="min-w-0 flex-1" aria-live="polite">
                <div className="truncate text-[12px] font-semibold text-fg" title={syncText}>
                  {syncText}
                </div>
                {syncSub && (
                  <div className="truncate text-[10.5px] text-fg-subtle" title={syncSub}>
                    {syncSub}
                  </div>
                )}
              </div>
            </div>

            {/* "GitHub'ga yuborish" faqat kompyuterdagi Python xizmati bilan ishlaydi */}
            {isLocal && (
              <button
                type="button"
                onClick={handleFlushSync}
                disabled={flushing || isOffline}
                className="btn-ghost h-8 w-full justify-center gap-1.5 border-line bg-ink-950 text-[11.5px] font-bold text-sky-soft hover:bg-ink-800 disabled:opacity-50"
                title={isOffline ? "Avval Python xizmatini yoqing" : "O'zgarishlarni darhol GitHub'ga yuborish"}
              >
                {flushing ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={13} />}
                <span>GitHub'ga yuborish</span>
              </button>
            )}
          </div>
        )}

        {/* Amallar: sozlamalar, rejim, chiqish, qisqartirish */}
        <div className={cx('flex gap-1', compact ? 'flex-col items-center' : 'items-center')}>
          {onOpenSettings && (
            <button
              type="button"
              onClick={() => {
                onMobileClose()
                onOpenSettings()
              }}
              title="Sozlamalar (API kalitlar, modellar)"
              aria-label="Sozlamalar"
              className={cx(
                'btn-ghost h-9 text-[12px] text-fg-muted hover:text-fg',
                compact ? 'w-9 justify-center p-0' : 'min-w-0 flex-1 justify-start px-2.5',
              )}
            >
              <Settings size={15} className="shrink-0" />
              {!compact && <span className="truncate">Sozlamalar</span>}
            </button>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? "Yorug' rejimga o'tish" : "To'q rejimga o'tish"}
            aria-label={theme === 'dark' ? "Yorug' rejim" : "To'q rejim"}
            className="btn-ghost size-9 shrink-0 justify-center p-0"
          >
            {theme === 'dark' ? <Sun size={15} className="text-amber" /> : <Moon size={15} className="text-blue-soft" />}
          </button>

          {!local && (
            <button
              type="button"
              onClick={logout}
              title="Tizimdan chiqish"
              aria-label="Chiqish"
              className="btn-ghost size-9 shrink-0 justify-center p-0 text-rose/80 hover:text-rose"
            >
              <LogOut size={15} />
            </button>
          )}

          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={compact ? 'Menyuni kengaytirish' : 'Menyuni qisqartirish'}
              aria-label={compact ? 'Menyuni kengaytirish' : 'Menyuni qisqartirish'}
              className="hidden size-9 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-ink-800 hover:text-fg lg:grid"
            >
              {compact ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          )}
        </div>

        <VersionBadge variant="sidebar" collapsed={compact} />
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop doimiy menyu */}
      <aside
        aria-label="Asosiy menyu"
        className={cx(
          'no-print fixed inset-y-0 left-0 z-30 hidden select-none flex-col border-r border-line bg-ink-950 transition-[width] duration-200 ease-out lg:flex',
          collapsed ? 'w-[72px]' : 'w-[240px]',
        )}
      >
        {renderContent(collapsed)}
      </aside>

      {/* Mobil parda */}
      {drawerMounted && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Asosiy menyu">
          <div
            className={cx(
              'absolute inset-0 bg-ink-950/70 backdrop-blur-sm transition-opacity duration-200',
              drawerClosing ? 'opacity-0' : 'animate-fade-in',
            )}
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <aside
            ref={drawerRef}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            className={cx(
              'absolute inset-y-0 left-0 flex w-[280px] max-w-[86vw] select-none flex-col border-r border-line bg-ink-950 shadow-2xl transition-transform duration-200 ease-out',
              drawerClosing ? '-translate-x-full' : 'animate-slide-right',
            )}
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            {renderContent(false)}
          </aside>
        </div>
      )}
    </>
  )
}
