'use client'

import { useEffect, useState, useRef } from 'react'
import { GitCommit, History, RefreshCw, X } from 'lucide-react'
import defaultVersion from '@/lib/version.json'

interface VersionData {
  version: string
  build?: number
  commit?: string
  commitDate?: string
  lastPushDate?: string
  commitMessage?: string
  serverTime?: string
}

function formatTimeAgo(isoDate?: string): string {
  if (!isoDate) return 'hozirgina'
  try {
    const diffMs = Date.now() - new Date(isoDate).getTime()
    if (diffMs < 0 || isNaN(diffMs)) return 'hozirgina'
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)

    if (diffMin < 1) return 'hozirgina'
    if (diffMin === 1) return '1 daqiqa oldin'
    if (diffMin < 60) return `${diffMin} daqiqa oldin`
    if (diffHour === 1) {
      const rem = diffMin % 60
      return rem > 0 ? `1 soat ${rem} daq oldin` : '1 soat oldin'
    }
    if (diffHour < 24) {
      const rem = diffMin % 60
      return rem > 0 ? `${diffHour} soat ${rem} daq oldin` : `${diffHour} soat oldin`
    }
    if (diffDay === 1) return 'kecha'
    if (diffDay < 30) return `${diffDay} kun oldin`
    return new Date(isoDate).toLocaleDateString('uz-UZ')
  } catch {
    return 'hozirgina'
  }
}

export default function VersionBadge() {
  const [data, setData] = useState<VersionData>(defaultVersion)
  const [timeAgo, setTimeAgo] = useState(() => formatTimeAgo(defaultVersion.commitDate || defaultVersion.lastPushDate))
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Serverdan versiya ma'lumotini olish
  const checkVersion = async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        setData(json)
        setTimeAgo(formatTimeAgo(json.lastPushDate || json.commitDate))
      }
    } catch {
      // Aloqa xatosi bo'lsa default saqlanadi
    } finally {
      setChecking(false)
    }
  }

  // 1. Dastlab yuklanganda va har 30 soniyada daqiqalarni avtomatik yangilash
  useEffect(() => {
    void checkVersion()
    const timer = setInterval(() => {
      setTimeAgo(formatTimeAgo(data.lastPushDate || data.commitDate))
    }, 30_000)
    return () => clearInterval(timer)
  }, [data.lastPushDate, data.commitDate])

  // Tashqariga bosganda popoverni yopish
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const dateStr = (data.lastPushDate || data.commitDate)
    ? new Date(data.lastPushDate || data.commitDate!).toLocaleString('uz-UZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

  return (
    <aside aria-label="Versiya ma'lumoti" ref={popoverRef} className="fixed bottom-3 left-3 z-30 select-none">
      {/* Kichik qulay belgi (Badge) */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title={`Versiya: v${data.version} · Oxirgi push: ${timeAgo} (${dateStr})\nBatafsil ko'rish uchun bosing`}
        className={`group flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-mono shadow-md backdrop-blur-md transition-all ${
          open
            ? 'border-emerald-500/50 bg-ink-900 text-fg ring-1 ring-emerald-500/30 shadow-emerald-500/10'
            : 'border-line/70 bg-ink-950/75 text-fg-subtle hover:border-line-hover hover:bg-ink-900/90 hover:text-fg'
        }`}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="font-semibold text-emerald-400">v{data.version}</span>
        <span className="text-line-strong">·</span>
        <span className="text-[10.5px] transition-colors group-hover:text-fg">{timeAgo}</span>
      </button>

      {/* Ochiluvchi batafsil axborot oynachasi */}
      {open && (
        <div className="animate-pop-in absolute bottom-8 left-0 z-40 mb-2 w-72 rounded-2xl border border-line-strong bg-ink-900/95 p-3.5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <div className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
                <History size={13} />
              </span>
              <span className="text-[12px] font-bold text-fg">Tizim versiyasi</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-fg-subtle hover:bg-ink-800 hover:text-fg"
            >
              <X size={13} />
            </button>
          </div>

          <div className="mt-2.5 space-y-2 text-[11.5px]">
            <div className="flex items-center justify-between">
              <span className="text-fg-subtle">Hozirgi versiya:</span>
              <span className="font-mono font-bold text-emerald-400">v{data.version}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-fg-subtle">Oxirgi push:</span>
              <span className="font-medium text-fg">{timeAgo}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-fg-subtle">Sana va vaqt:</span>
              <span className="text-fg-muted font-mono text-[11px]">{dateStr}</span>
            </div>

            {data.commit && (
              <div className="flex items-center justify-between">
                <span className="text-fg-subtle">Commit ID:</span>
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-sky-400">
                  <GitCommit size={11} /> {data.commit}
                </span>
              </div>
            )}

            {data.commitMessage && (
              <div className="rounded-lg border border-line bg-ink-950/50 p-2 text-[10.5px] text-fg-muted">
                <span className="block font-semibold text-fg-subtle uppercase text-[9.5px]">Oxirgi o&apos;zgarish:</span>
                <span className="line-clamp-2 mt-0.5">{data.commitMessage}</span>
              </div>
            )}
          </div>

          <div className="mt-3 border-t border-line pt-2 flex items-center justify-between">
            <span className="text-[10px] text-fg-subtle">Shahrisabz Tibbiyot Texnikumi</span>
            <button
              type="button"
              onClick={checkVersion}
              disabled={checking}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-sky-400 hover:bg-sky-500/10"
              title="Yangilanishni tekshirish"
            >
              <RefreshCw size={10} className={checking ? 'animate-spin' : ''} />
              <span>Tekshirish</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
