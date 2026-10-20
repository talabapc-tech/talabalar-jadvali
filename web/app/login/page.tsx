'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, CheckSquare, Eye, EyeOff, Loader2, LockKeyhole, LogIn, ShieldCheck, Smartphone, Square, User } from 'lucide-react'

/** Faqat sayt ichidagi manzilga qaytish ("//boshqa.sayt" yoki "https://..." emas) */
function safeNext(): string {
  if (typeof window === 'undefined') return '/'
  const n = new URLSearchParams(window.location.search).get('next') || '/'
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/'
}

const STORAGE_KEYS = {
  DEVICE_TOKEN: 'portal_device_token',
  DEVICE_ID: 'portal_device_id',
  SAVED_LOGIN: 'portal_saved_login',
} as const

function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEYS.DEVICE_ID)
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`
      localStorage.setItem(STORAGE_KEYS.DEVICE_ID, id)
    }
    return id
  } catch {
    return 'fallback_device'
  }
}

export default function LoginPage() {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Qurilmani avtomatik tanib olish holati
  const [autoChecking, setAutoChecking] = useState(true)
  const [deviceRecognized, setDeviceRecognized] = useState(false)

  const loginInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // 1. Sahifa yuklanganda saqlangan login va qurilma tokenini tekshirish
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem(STORAGE_KEYS.SAVED_LOGIN)
      if (savedUser) setLogin(savedUser)

      const token = localStorage.getItem(STORAGE_KEYS.DEVICE_TOKEN)
      if (!token) {
        setAutoChecking(false)
        return
      }

      setDeviceRecognized(true)
      let cancelled = false

      const tryDeviceLogin = async () => {
        try {
          const res = await fetch('/api/auth/device-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceToken: token }),
          })
          if (cancelled) return
          const data = await res.json().catch(() => ({}))
          if (res.ok && data.ok) {
            if (data.deviceToken) {
              localStorage.setItem(STORAGE_KEYS.DEVICE_TOKEN, data.deviceToken)
            }
            window.location.replace(safeNext())
            return
          }
          // Token eskirgan yoki bekor qilingan
          localStorage.removeItem(STORAGE_KEYS.DEVICE_TOKEN)
          setDeviceRecognized(false)
          setAutoChecking(false)
        } catch {
          if (!cancelled) {
            setDeviceRecognized(false)
            setAutoChecking(false)
          }
        }
      }

      void tryDeviceLogin()
      return () => { cancelled = true }
    } catch {
      setAutoChecking(false)
    }
  }, [])

  // Brauzer avtoto'ldirish (autofill) qiymatlarini DOM dan vaqti-vaqti bilan sinxronlash
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loginInputRef.current?.value && !login) setLogin(loginInputRef.current.value)
      if (passwordInputRef.current?.value && !password) setPassword(passwordInputRef.current.value)
    }, 250)
    return () => clearTimeout(timer)
  }, [login, password])

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return

    // Har doim to'g'ridan-to'g'ri FormData dan o'qiymiz — brauzer avtoto'ldirganda React state yangilanmagan bo'lsa ham ishlaydi
    const fd = new FormData(e.currentTarget)
    const loginVal = String(fd.get('login') ?? loginInputRef.current?.value ?? login ?? '').trim()
    const passwordVal = String(fd.get('password') ?? passwordInputRef.current?.value ?? password ?? '')

    if (!loginVal || !passwordVal) {
      setError("Iltimos, login va parolni kiriting")
      if (!loginVal) loginInputRef.current?.focus()
      else passwordInputRef.current?.focus()
      return
    }

    setBusy(true)
    setError('')

    try {
      const deviceId = getOrCreateDeviceId()
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: loginVal,
          password: passwordVal,
          rememberDevice,
          deviceId,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.ok && data.ok) {
        try {
          localStorage.setItem(STORAGE_KEYS.SAVED_LOGIN, loginVal)
          if (rememberDevice && data.deviceToken) {
            localStorage.setItem(STORAGE_KEYS.DEVICE_TOKEN, data.deviceToken)
          } else {
            localStorage.removeItem(STORAGE_KEYS.DEVICE_TOKEN)
          }
        } catch {
          /* localStorage xatosi */
        }
        window.location.replace(safeNext())
        return
      }

      setError(data.error || 'Kirib bo‘lmadi')
      setPassword('')
      if (passwordInputRef.current) passwordInputRef.current.value = ''
    } catch {
      setError('Server bilan aloqa yo‘q. Internet yoki tarmoqni tekshiring.')
    } finally {
      setBusy(false)
    }
  }

  const cancelAutoLogin = () => {
    try {
      localStorage.removeItem(STORAGE_KEYS.DEVICE_TOKEN)
    } catch {}
    setDeviceRecognized(false)
    setAutoChecking(false)
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-ink-950 px-4 py-8">
      {/* Orqa fon nur effekti */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/2 h-[340px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald/10 blur-[120px]" />
        <div className="absolute top-2/3 left-1/3 h-[280px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky/10 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-[410px]">
        {/* Qurilmani avtomatik tanib olish jarayoni ko'rinishi */}
        {autoChecking && deviceRecognized ? (
          <div className="panel animate-fade-in p-7 text-center shadow-2xl shadow-black/70">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl border border-emerald/40 bg-emerald/15 text-emerald-soft">
              <Smartphone size={28} className="animate-pulse" />
            </div>
            <h2 className="text-[17px] font-extrabold text-fg">Qurilma tanildi</h2>
            <p className="mt-1.5 text-[12.5px] text-fg-muted">
              Ushbu qurilma eslab qolingan. Talabalar portaliga avtomatik kirilmoqda…
            </p>
            <div className="mt-5 flex items-center justify-center gap-2 text-[12px] text-emerald-soft">
              <Loader2 size={16} className="animate-spin" />
              <span>Sessiya tasdiqlanmoqda…</span>
            </div>
            <button
              type="button"
              onClick={cancelAutoLogin}
              className="btn-ghost mt-6 h-8 text-[11.5px] text-fg-subtle hover:text-fg"
            >
              Boshqa hisob bilan kirish
            </button>
          </div>
        ) : (
          <form
            ref={formRef}
            onSubmit={submit}
            className="panel relative overflow-hidden p-6 sm:p-7 shadow-2xl shadow-black/80"
          >
            {/* Yuqori sarlavha va logo */}
            <div className="mb-6 flex items-center gap-3.5">
              <div className="grid size-12 place-items-center rounded-2xl border border-line bg-gradient-to-br from-ink-850 to-ink-900 shadow-inner">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.svg" alt="Texnikum" className="size-7 object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold tracking-[0.12em] text-emerald-soft uppercase">
                  Shahrisabz Tibbiyot Texnikumi
                </div>
                <h1 className="text-[18px] font-extrabold tracking-tight text-fg">Talabalar portali</h1>
              </div>
            </div>

            {/* Himoyalangan tizim eslatmasi */}
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-sky/30 bg-sky/10 px-3.5 py-2.5 text-[12px] text-fg-muted">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-sky-soft" />
              <span>Portalda talabalarning shaxsiy ma'lumotlari mavjud. Tizimga kirish uchun login va parolni kiriting.</span>
            </div>

            {/* Login kiritish */}
            <div className="mb-3.5 block">
              <label htmlFor="portal-login-input" className="label flex items-center gap-1.5">
                <User size={13} className="text-fg-subtle" />
                <span>Login</span>
              </label>
              <input
                id="portal-login-input"
                name="login"
                ref={loginInputRef}
                className="field mt-1"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="Loginni kiriting"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus={!login}
              />
            </div>

            {/* Parol kiritish */}
            <div className="mb-4 block">
              <label htmlFor="portal-password-input" className="label flex items-center gap-1.5">
                <LockKeyhole size={13} className="text-fg-subtle" />
                <span>Parol</span>
              </label>
              <div className="relative mt-1">
                <input
                  id="portal-password-input"
                  name="password"
                  ref={passwordInputRef}
                  className="field pr-10"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Parolni kiriting"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShow((v) => !v)}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-fg-subtle hover:text-fg"
                  aria-label={show ? 'Parolni yashirish' : "Parolni ko'rsatish"}
                  title={show ? 'Parolni yashirish' : "Parolni ko'rsatish"}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Qurilmani eslab qolish switch/checkbox */}
            <label className="mb-5 flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-ink-950/40 p-2.5 transition hover:border-line-strong select-none">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="sr-only"
              />
              <div className="mt-0.5 grid size-4 shrink-0 place-items-center rounded border border-line-strong bg-ink-900 transition">
                {rememberDevice ? <Check size={12} className="text-emerald-soft stroke-[3]" /> : null}
              </div>
              <div className="min-w-0 flex-1 text-[12px]">
                <div className="font-semibold text-fg">Ushbu qurilmani eslab qolish</div>
                <div className="text-[11px] text-fg-subtle">Keyingi safar parolsiz avtomatik kirish yoqiladi</div>
              </div>
            </label>

            {/* Xatolik xabari */}
            {error && (
              <div role="alert" className="animate-pop-in mb-4 rounded-xl border border-rose/45 bg-rose/10 px-3 py-2 text-[12.5px] text-rose">
                {error}
              </div>
            )}

            {/* Kirish tugmasi — hech qachon sun'iy o'chiq (disabled) turmaydi! */}
            <button
              type="submit"
              className="btn-success h-11 w-full justify-center text-[13.5px] font-bold shadow-lg shadow-emerald/20 transition-all hover:shadow-emerald/30 active:scale-[0.99]"
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Tekshirilmoqda…</span>
                </>
              ) : (
                <>
                  <LogIn size={16} />
                  <span>Kirish</span>
                </>
              )}
            </button>
          </form>
        )}

        <div className="mt-5 text-center text-[11.5px] text-fg-subtle">
          Shahrisabz Tibbiyot Texnikumi &copy; {new Date().getFullYear()}
        </div>
      </div>
    </main>
  )
}
