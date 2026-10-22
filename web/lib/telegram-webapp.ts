'use client'

/*
  Telegram Mini App bilan ishlash (faqat /majlis sahifasi).
  Telegram sahifani #tgWebAppData=... bilan ochadi — initData shu yerdan olinadi va har API
  so'roviga x-telegram-init-data sarlavhasida qo'shiladi (proxy.ts imzoni tekshiradi).
  Oddiy brauzerda initData bo'lmaydi — portal cookie'si ishlaydi.
*/

export interface TgWebApp {
  initData: string
  colorScheme?: 'light' | 'dark'
  ready: () => void
  expand: () => void
  close: () => void
  setHeaderColor?: (c: string) => void
  setBackgroundColor?: (c: string) => void
  HapticFeedback?: { selectionChanged: () => void; notificationOccurred: (t: 'success' | 'error' | 'warning') => void }
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void }
}

declare global {
  interface Window { Telegram?: { WebApp?: TgWebApp } }
}

const KEY = 'tg_init_data'
const SCRIPT = 'https://telegram.org/js/telegram-web-app.js?59'

export function readInitData(): string {
  if (typeof window === 'undefined') return ''
  try {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('tgWebAppData')
    if (fromHash) {
      sessionStorage.setItem(KEY, fromHash)
      return fromHash
    }
    return window.Telegram?.WebApp?.initData || sessionStorage.getItem(KEY) || ''
  } catch {
    return window.Telegram?.WebApp?.initData || ''
  }
}

let loading: Promise<TgWebApp | null> | null = null

/** Telegram ichida ochilgan bo'lsa rasmiy skriptni yuklaydi (tema, expand, haptic uchun) */
export function loadTelegram(): Promise<TgWebApp | null> {
  if (typeof window === 'undefined' || !readInitData()) return Promise.resolve(null)
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp)
  loading ??= new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = SCRIPT
    s.async = true
    s.onload = () => resolve(window.Telegram?.WebApp ?? null)
    s.onerror = () => resolve(null)
    document.head.appendChild(s)
  })
  return loading
}

/** fetch + Telegram initData sarlavhasi */
export function tgFetch(url: string, init: RequestInit = {}) {
  const data = readInitData()
  const headers = new Headers(init.headers)
  if (data) headers.set('x-telegram-init-data', data)
  return fetch(url, { cache: 'no-store', ...init, headers })
}

export function haptic(kind: 'select' | 'success' | 'error' = 'select') {
  const h = typeof window !== 'undefined' ? window.Telegram?.WebApp?.HapticFeedback : undefined
  if (!h) return
  if (kind === 'select') h.selectionChanged()
  else h.notificationOccurred(kind)
}
