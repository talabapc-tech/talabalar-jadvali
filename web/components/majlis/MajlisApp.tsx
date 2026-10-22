'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BarChart3, CalendarCheck, CloudCheck, CloudUpload, Loader2, LogIn, TriangleAlert, Users } from 'lucide-react'
import { sortMajlislar, yangiMajlis, type Majlis, type MajlisDb, type Oqituvchi } from '@/lib/majlis'
import { haptic, loadTelegram, readInitData, tgFetch } from '@/lib/telegram-webapp'
import { Toasts, useToasts } from '../Toast'
import { cx } from '../ui'
import MajlisEditor from './MajlisEditor'
import MajlisList from './MajlisList'
import MajlisHisobot from './MajlisHisobot'
import OqituvchilarTab from './OqituvchilarTab'

type Tab = 'majlislar' | 'hisobot' | 'oqituvchilar'
type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

/** Tahrirdan keyin shuncha kutib saqlanadi — har bosishda GitHub'ga commit bo'lmasin */
const SAVE_DELAY_MS = 2500

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'majlislar', label: 'Majlislar', icon: CalendarCheck },
  { id: 'hisobot', label: 'Hisobot', icon: BarChart3 },
  { id: 'oqituvchilar', label: "O'qituvchilar", icon: Users },
]

export default function MajlisApp() {
  const { toasts, notify } = useToasts()
  const [db, setDb] = useState<MajlisDb | null>(null)
  const [error, setError] = useState('')
  const [needLogin, setNeedLogin] = useState(false)
  const [inTelegram, setInTelegram] = useState(false)
  const [tab, setTab] = useState<Tab>('majlislar')
  const [openId, setOpenId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')

  // Saqlanishi kutilayotgan majlislar (id → oxirgi holati)
  const pending = useRef(new Map<string, Majlis>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef<Promise<void> | null>(null)

  /* ---------------------------------------------------------------- yuklash */

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await tgFetch('/api/majlislar')
      if (res.status === 401) {
        setNeedLogin(true)
        return
      }
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || `Server ${res.status}`)
      setDb({ oqituvchilar: d.oqituvchilar, majlislar: sortMajlislar(d.majlislar) })
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    const tg = !!readInitData()
    setInTelegram(tg)
    let theme: 'dark' | 'light' = 'dark'
    try { theme = localStorage.getItem('portal_theme') === 'light' ? 'light' : 'dark' } catch { /* bo'sh */ }
    document.documentElement.dataset.theme = theme
    if (tg) {
      loadTelegram().then((app) => {
        if (!app) return
        app.ready()
        app.expand()
        if (app.colorScheme) document.documentElement.dataset.theme = app.colorScheme
        const bg = app.colorScheme === 'light' ? '#f1f5f9' : '#040b14'
        app.setHeaderColor?.(bg)
        app.setBackgroundColor?.(bg)
      })
    }
    load()
  }, [load])

  /* ---------------------------------------------------------------- saqlash */

  const flush = useCallback(async (keepalive = false) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (saving.current) await saving.current
    if (!pending.current.size) return
    const batch = [...pending.current.values()]
    pending.current.clear()
    setSaveState('saving')
    const run = (async () => {
      try {
        // Ketma-ket: har biri GitHub'dagi faylni qayta o'qib yozadi
        for (const majlis of batch) {
          const res = await tgFetch('/api/majlislar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save', majlis }),
            keepalive,
          })
          const d = await res.json().catch(() => ({}))
          if (!res.ok || !d.ok) throw new Error(d.error || `Server ${res.status}`)
        }
        setSaveState(pending.current.size ? 'dirty' : 'saved')
      } catch (e) {
        // Yo'qolmasin — keyingi urinishda qayta yuboriladi (yangiroq tahrir bo'lsa o'shani qoldiramiz)
        for (const m of batch) if (!pending.current.has(m.id)) pending.current.set(m.id, m)
        setSaveState('error')
        notify(`Saqlanmadi: ${(e as Error).message}`, 'error')
      }
    })()
    saving.current = run
    await run
    saving.current = null
  }, [notify])

  const schedule = useCallback(() => {
    setSaveState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, SAVE_DELAY_MS)
  }, [flush])

  // Ilova yopilayotganda / fon rejimiga o'tganda kutmasdan yuboramiz
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(true) }
    const onUnload = (e: BeforeUnloadEvent) => {
      if (pending.current.size) { void flush(true); e.preventDefault() }
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [flush])

  const updateMajlis = useCallback((m: Majlis) => {
    setDb((d) => d && { ...d, majlislar: sortMajlislar([m, ...d.majlislar.filter((x) => x.id !== m.id)]) })
    pending.current.set(m.id, m)
    schedule()
  }, [schedule])

  const createMajlis = useCallback(() => {
    if (!db) return
    const m = yangiMajlis(db.oqituvchilar)
    updateMajlis(m)
    setOpenId(m.id)
    haptic('success')
  }, [db, updateMajlis])

  const deleteMajlis = useCallback(async (m: Majlis) => {
    pending.current.delete(m.id)
    setDb((d) => d && { ...d, majlislar: d.majlislar.filter((x) => x.id !== m.id) })
    setOpenId(null)
    try {
      const res = await tgFetch('/api/majlislar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: m.id }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) throw new Error(d.error || `Server ${res.status}`)
      notify("Majlis o'chirildi", 'warning')
    } catch (e) {
      notify(`O'chirilmadi: ${(e as Error).message}`, 'error')
      void load()
    }
  }, [load, notify])

  const saveOqituvchilar = useCallback(async (list: Oqituvchi[]) => {
    const prev = db
    setDb((d) => d && { ...d, oqituvchilar: list })
    const res = await tgFetch('/api/majlislar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'teachers', oqituvchilar: list }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || !d.ok) {
      setDb(prev)
      throw new Error(d.error || `Server ${res.status}`)
    }
    setDb((cur) => cur && { ...cur, oqituvchilar: d.oqituvchilar })
  }, [db])

  const openMajlis = useCallback((id: string | null) => {
    if (id === null) void flush()
    setOpenId(id)
    window.scrollTo({ top: 0 })
  }, [flush])

  // Telegram'ning "orqaga" tugmasi majlisdan ro'yxatga qaytaradi
  useEffect(() => {
    const bb = window.Telegram?.WebApp?.BackButton
    if (!bb) return
    const back = () => openMajlis(null)
    if (openId) { bb.show(); bb.onClick(back) } else bb.hide()
    return () => bb.offClick(back)
  }, [openId, openMajlis, inTelegram])

  const current = useMemo(() => db?.majlislar.find((m) => m.id === openId) ?? null, [db, openId])

  /* ---------------------------------------------------------------- ko'rinish */

  return (
    <div className="min-h-dvh pb-16">
      <header className="sticky top-0 z-40 border-b border-line bg-ink-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          {current ? (
            <button type="button" className="btn-ghost size-9 shrink-0 p-0" onClick={() => openMajlis(null)} aria-label="Majlislar ro'yxatiga qaytish">
              <ArrowLeft size={17} />
            </button>
          ) : (
            <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-sky/30 bg-gradient-to-br from-emerald/20 via-blue/20 to-sky/20">
              <CalendarCheck size={18} className="text-sky-soft" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-bold tracking-[0.14em] text-emerald-soft uppercase">Shahrisabz Tibbiyot Texnikumi</div>
            <h1 className="truncate text-[16px] font-extrabold tracking-tight text-fg">Majlislar davomati</h1>
          </div>
          {db && <SaveBadge state={saveState} onRetry={() => void flush()} />}
          {!inTelegram && (
            <a href="/" className="btn-ghost h-9 shrink-0 px-3" title="Talabalar portaliga qaytish">Portal</a>
          )}
        </div>
        {!current && db && (
          <nav className="mx-auto flex max-w-3xl gap-1 px-4 pb-2.5">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => { setTab(id); haptic() }}
                className={cx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[13px] font-semibold transition-colors',
                  tab === id ? 'bg-sky/15 text-sky-soft ring-1 ring-sky/40' : 'text-fg-muted hover:bg-ink-800/70 hover:text-fg',
                )}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        {needLogin ? (
          <LoginNeeded inTelegram={inTelegram} />
        ) : error ? (
          <div className="panel flex flex-col items-center gap-3 p-8 text-center">
            <TriangleAlert size={28} className="text-rose" />
            <div className="text-[14px] font-semibold text-fg">Ma'lumot yuklanmadi</div>
            <div className="text-[13px] text-fg-muted">{error}</div>
            <button type="button" className="btn-primary" onClick={load}>Qayta urinish</button>
          </div>
        ) : !db ? (
          <div className="flex items-center justify-center gap-2 py-20 text-fg-muted"><Loader2 size={18} className="animate-spin" /> Yuklanmoqda...</div>
        ) : current ? (
          <MajlisEditor
            majlis={current}
            oqituvchilar={db.oqituvchilar}
            onChange={updateMajlis}
            onDelete={deleteMajlis}
            notify={notify}
            inTelegram={inTelegram}
          />
        ) : tab === 'majlislar' ? (
          <MajlisList db={db} onOpen={openMajlis} onCreate={createMajlis} />
        ) : tab === 'hisobot' ? (
          <MajlisHisobot db={db} notify={notify} inTelegram={inTelegram} />
        ) : (
          <OqituvchilarTab oqituvchilar={db.oqituvchilar} onSave={saveOqituvchilar} notify={notify} />
        )}
      </main>
      <Toasts toasts={toasts} />
    </div>
  )
}

function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'error') {
    return (
      <button type="button" onClick={onRetry} className="chip h-8 cursor-pointer border-rose/45 bg-rose/10 text-rose" title="Qayta yuborish">
        <TriangleAlert size={13} /> Saqlanmadi
      </button>
    )
  }
  const busy = state !== 'saved'
  return (
    <span className={cx('chip h-8', busy ? 'border-sky/40 bg-sky/10 text-sky-soft' : 'border-emerald/40 bg-emerald/10 text-emerald-soft')}>
      {state === 'saving' ? <Loader2 size={13} className="animate-spin" /> : busy ? <CloudUpload size={13} /> : <CloudCheck size={13} />}
      <span className="hidden sm:inline">{state === 'saving' ? 'Saqlanmoqda' : busy ? 'Kutilmoqda' : 'Saqlangan'}</span>
    </span>
  )
}

function LoginNeeded({ inTelegram }: { inTelegram: boolean }) {
  return (
    <div className="panel flex flex-col items-center gap-3 p-8 text-center">
      <LogIn size={28} className="text-sky-soft" />
      {inTelegram ? (
        <>
          <div className="text-[14px] font-semibold text-fg">Ruxsat yo'q</div>
          <div className="text-[13px] text-fg-muted">
            Telegram ID raqamingiz ruxsat berilganlar ro'yxatida yo'q. Botga <b>/id</b> yozib, raqamni administratorga yuboring.
          </div>
        </>
      ) : (
        <>
          <div className="text-[14px] font-semibold text-fg">Kirish talab qilinadi</div>
          <a href="/login?next=/majlis" className="btn-primary">Portalga kirish</a>
        </>
      )}
    </div>
  )
}
