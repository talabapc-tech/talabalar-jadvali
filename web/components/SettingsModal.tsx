'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  HardDrive,
  Key,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import {
  DEFAULT_CATALOG_MODELS,
  getAppSettings,
  saveAppSettings,
  type AppSettings,
  type ModelPermission,
} from '@/lib/settings'
import type { Notify } from './Toast'
import { cx } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  notify: Notify
}

interface ServerEnvStatus {
  openrouter?: { isSet: boolean; masked: string }
  telegram?: { isSet: boolean; masked: string; chatId?: string; channelId?: string }
  webjurnal?: { isSet: boolean; url?: string; maskedKey?: string }
  mytest?: { isSet: boolean; masked: string }
  github?: { isSet: boolean; masked: string; repo?: string }
  supabase?: { isSet: boolean; url?: string }
}

type TabKey = 'ai' | 'keys' | 'system'

export default function SettingsModal({ open, onClose, notify }: Props) {
  const [tab, setTab] = useState<TabKey>('ai')
  const [settings, setSettings] = useState<AppSettings>(() => getAppSettings())
  const [serverEnv, setServerEnv] = useState<ServerEnvStatus | null>(null)
  const [loadingEnv, setLoadingEnv] = useState(false)

  // Show/Hide secret passwords
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})

  // New model form
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [newModelDesc, setNewModelDesc] = useState('')

  // AI model test states: modelId -> { testing: boolean, result?: { ok: boolean; latencyMs?: number; reply?: string; error?: string } }
  const [aiTestStates, setAiTestStates] = useState<Record<string, { testing: boolean; ok?: boolean; latencyMs?: number; reply?: string; error?: string }>>({})

  // Telegram test state
  const [tgTesting, setTgTesting] = useState(false)
  const [tgTestResult, setTgTestResult] = useState<{ ok: boolean; botName?: string; error?: string } | null>(null)

  // Load settings and fetch server env status when opened
  useEffect(() => {
    if (!open) return
    setSettings(getAppSettings())
    setLoadingEnv(true)

    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.serverEnv) setServerEnv(d.serverEnv)
      })
      .catch(() => {})
      .finally(() => setLoadingEnv(false))
  }, [open])

  // Escape key to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const toggleShow = (key: string) => {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleToggleModel = (id: string) => {
    setSettings((prev) => {
      const updated = prev.allowedModels.map((m) => {
        if (m.id === id) {
          return { ...m, enabled: !m.enabled }
        }
        return m
      })
      // Agar o'chirilayotgan model hozirgi default bo'lsa, birinchi faol modelga o'tkazish
      let nextDef = prev.defaultModel
      if (id === prev.defaultModel) {
        const nextActive = updated.find((m) => m.enabled && m.id !== id)
        if (nextActive) nextDef = nextActive.id
      }
      return { ...prev, allowedModels: updated, defaultModel: nextDef }
    })
  }

  const handleSetDefaultModel = (id: string) => {
    setSettings((prev) => ({
      ...prev,
      defaultModel: id,
      allowedModels: prev.allowedModels.map((m) => (m.id === id ? { ...m, enabled: true } : m)),
    }))
  }

  const handleAddModel = () => {
    const id = newModelId.trim()
    const name = newModelName.trim()
    if (!id || !name) {
      notify("Model ID va nomi kiritilishi shart", 'error')
      return
    }
    if (settings.allowedModels.some((m) => m.id === id)) {
      notify("Bu model ro'yxatda allaqachon mavjud", 'error')
      return
    }

    const newModel: ModelPermission = {
      id,
      name,
      desc: newModelDesc.trim() || 'Maxsus qo\'shilgan model',
      badge: 'Maxsus',
      enabled: true,
    }

    setSettings((prev) => ({
      ...prev,
      allowedModels: [...prev.allowedModels, newModel],
    }))

    setNewModelId('')
    setNewModelName('')
    setNewModelDesc('')
    notify(`«${name}» modeli qo'shildi`, 'success')
  }

  const handleDeleteModel = (id: string) => {
    setSettings((prev) => {
      const filtered = prev.allowedModels.filter((m) => m.id !== id)
      let nextDef = prev.defaultModel
      if (prev.defaultModel === id) {
        nextDef = filtered[0]?.id || DEFAULT_CATALOG_MODELS[0].id
      }
      return { ...prev, allowedModels: filtered, defaultModel: nextDef }
    })
    notify("Model o'chirildi", 'info')
  }

  const handleTestAiModel = async (modelId: string) => {
    setAiTestStates((prev) => ({ ...prev, [modelId]: { testing: true } }))
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test_ai',
          model: modelId,
          apiKey: settings.openrouterKey || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setAiTestStates((prev) => ({
          ...prev,
          [modelId]: { testing: false, ok: true, latencyMs: data.latencyMs, reply: data.reply },
        }))
        notify(`${modelId}: Muvaffaqiyatli bog'landi (${data.latencyMs} ms)`, 'success')
      } else {
        setAiTestStates((prev) => ({
          ...prev,
          [modelId]: { testing: false, ok: false, latencyMs: data.latencyMs, error: data.error || 'Bog\'lanmadi' },
        }))
        notify(`${modelId}: Xatolik yuz berdi`, 'error')
      }
    } catch (e) {
      setAiTestStates((prev) => ({
        ...prev,
        [modelId]: { testing: false, ok: false, error: (e as Error).message },
      }))
      notify("Tarmoq xatosi", 'error')
    }
  }

  const handleTestTelegram = async () => {
    setTgTesting(true)
    setTgTestResult(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test_telegram',
          token: settings.telegramToken || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setTgTestResult({ ok: true, botName: `@${data.bot.username} (${data.bot.first_name})` })
        notify(`Telegram bot faol: @${data.bot.username}`, 'success')
      } else {
        setTgTestResult({ ok: false, error: data.error || 'Token yaroqsiz' })
        notify("Telegram bot tekshiruvdan o'tmadi", 'error')
      }
    } catch (e) {
      setTgTestResult({ ok: false, error: (e as Error).message })
    } finally {
      setTgTesting(false)
    }
  }

  const handleSave = () => {
    saveAppSettings(settings)
    notify("Sozlamalar muvaffaqiyatli saqlandi!", 'success')
    onClose()
  }

  const handleResetDefaults = () => {
    if (!confirm("Barcha sozlamalar va API kalitlarni asl holatiga qaytarishni xohlaysizmi?")) return
    const defaultSettings: AppSettings = {
      allowedModels: DEFAULT_CATALOG_MODELS,
      defaultModel: DEFAULT_CATALOG_MODELS[0].id,
    }
    setSettings(defaultSettings)
    saveAppSettings(defaultSettings)
    notify("Standart sozlamalar tiklandi", 'info')
  }

  const handleClearCache = () => {
    try {
      localStorage.removeItem('portal_doc_cache')
      sessionStorage.clear()
      notify("Vaqtinchalik kesh tozalandi", 'success')
    } catch {
      notify("Keshni tozalashda xatolik", 'error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity" onClick={onClose} />

      <div className="animate-pop-in relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-line-strong bg-ink-900 shadow-2xl shadow-black/80">
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl border border-sky/30 bg-sky/10 text-sky">
              <Settings size={20} />
            </div>
            <div>
              <h2 className="text-[17px] font-bold text-fg">Portal Sozlamalari</h2>
              <p className="text-[12px] text-fg-muted">API kalitlar, AI modellar ruxsati va tizim holati</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost size-9 p-0 text-fg-muted hover:text-fg"
            title="Yopish"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs Bar */}
        <div className="flex shrink-0 gap-1 border-b border-line bg-ink-950/60 px-5 pt-2 sm:px-6">
          <button
            type="button"
            onClick={() => setTab('ai')}
            className={cx(
              'flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors',
              tab === 'ai'
                ? 'border-sky text-sky-soft'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            <Bot size={16} />
            <span>AI Modellar & Ruxsatlar</span>
            <span className="rounded-md bg-ink-800 px-1.5 py-0.5 text-[11px] tabular-nums text-fg-subtle">
              {settings.allowedModels.filter((m) => m.enabled).length}/{settings.allowedModels.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab('keys')}
            className={cx(
              'flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors',
              tab === 'keys'
                ? 'border-sky text-sky-soft'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            <Key size={16} />
            <span>API Kalitlar</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('system')}
            className={cx(
              'flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors',
              tab === 'system'
                ? 'border-sky text-sky-soft'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            <Server size={16} />
            <span>Tizim & Kesh</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {/* TAB 1: AI MODELLAR */}
          {tab === 'ai' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-sky/20 bg-sky/5 p-4 text-[12.5px] text-fg-muted">
                <div className="flex items-center gap-2 font-semibold text-sky-soft">
                  <Sparkles size={16} />
                  <span>Hujjatlarni o'qish (OCR) va AI tahlil modellari</span>
                </div>
                <p className="mt-1 leading-relaxed">
                  Pasport, ID-karta va shahodatnoma rasmlarini o'qish uchun qaysi modellarga ruxsat berilishini belgilang.
                  Foydalanuvchi faqat ruxsat etilgan modellardan foydalanishi mumkin.
                </p>
              </div>

              {/* Modellar ro'yxati */}
              <div className="space-y-3">
                <div className="text-[12px] font-bold tracking-wider text-fg-subtle uppercase">
                  Mavjud modellar katalogi
                </div>

                <div className="grid gap-2.5 sm:grid-cols-1">
                  {settings.allowedModels.map((m) => {
                    const isDef = settings.defaultModel === m.id
                    const testState = aiTestStates[m.id]
                    const isCustom = !DEFAULT_CATALOG_MODELS.some((d) => d.id === m.id)

                    return (
                      <div
                        key={m.id}
                        className={cx(
                          'flex flex-col gap-3 rounded-2xl border p-4 transition-all sm:flex-row sm:items-center sm:justify-between',
                          m.enabled
                            ? isDef
                              ? 'border-sky/50 bg-gradient-to-r from-sky/10 via-ink-850 to-ink-850'
                              : 'border-line-strong bg-ink-850/80 hover:border-line-strong'
                            : 'border-line/60 bg-ink-950/40 opacity-60',
                        )}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[14px] font-bold text-fg">{m.name}</span>
                            {m.badge && (
                              <span
                                className={cx(
                                  'rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                                  m.badge === 'Tavsiya'
                                    ? 'bg-emerald/15 text-emerald-soft'
                                    : m.badge === 'Arzon'
                                    ? 'bg-blue/15 text-blue-soft'
                                    : 'bg-amber/15 text-amber',
                                )}
                              >
                                {m.badge}
                              </span>
                            )}
                            {isDef && (
                              <span className="flex items-center gap-1 rounded-md border border-sky/40 bg-sky/20 px-2 py-0.5 text-[11px] font-bold text-sky-soft">
                                <Zap size={11} /> Asosiy model
                              </span>
                            )}
                            <span className="mono text-[11.5px] text-fg-subtle">({m.id})</span>
                          </div>
                          {m.desc && <div className="text-[12px] text-fg-muted">{m.desc}</div>}

                          {/* Test natijasi agar bo'lsa */}
                          {testState && (
                            <div className="pt-1 text-[11.5px]">
                              {testState.testing ? (
                                <span className="flex items-center gap-1 text-sky-soft">
                                  <Loader2 size={12} className="animate-spin" /> OpenRouter bilan sinovdan o'tkazilmoqda…
                                </span>
                              ) : testState.ok ? (
                                <span className="flex items-center gap-1 text-emerald-soft">
                                  <CheckCircle2 size={13} /> Aloqa bor · {testState.latencyMs} ms · Javob: &quot;{testState.reply}&quot;
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-rose">
                                  <AlertCircle size={13} /> Xatolik: {testState.error}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Boshqaruv tugmalari */}
                        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                          {/* Test tugmasi */}
                          <button
                            type="button"
                            onClick={() => handleTestAiModel(m.id)}
                            disabled={testState?.testing}
                            className="btn-ghost h-8 px-2.5 text-[12px]"
                            title="OpenRouter orqali modelni tekshirish"
                          >
                            {testState?.testing ? (
                              <Loader2 size={13} className="animate-spin text-sky" />
                            ) : (
                              <Play size={13} className="text-emerald-soft" />
                            )}
                            <span>Test</span>
                          </button>

                          {/* Asosiy qilish */}
                          {m.enabled && !isDef && (
                            <button
                              type="button"
                              onClick={() => handleSetDefaultModel(m.id)}
                              className="btn-ghost h-8 px-2.5 text-[12px] text-fg-muted hover:text-sky-soft"
                              title="Birlamchi model qilib belgilash"
                            >
                              Asosiy qilish
                            </button>
                          )}

                          {/* Faollashtirish / O'chirish switch */}
                          <button
                            type="button"
                            onClick={() => handleToggleModel(m.id)}
                            className={cx(
                              'relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                              m.enabled ? 'bg-emerald' : 'bg-ink-700',
                            )}
                            role="switch"
                            aria-checked={m.enabled}
                            title={m.enabled ? "Ruxsatni o'chirish" : "Ruxsat berish"}
                          >
                            <span
                              className={cx(
                                'pointer-events-none inline-block size-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                                m.enabled ? 'translate-x-5' : 'translate-x-0',
                              )}
                            />
                          </button>

                          {/* Agar maxsus foydalanuvchi qo'shgan bo'lsa - o'chirish tugmasi */}
                          {isCustom && (
                            <button
                              type="button"
                              onClick={() => handleDeleteModel(m.id)}
                              className="btn-ghost size-8 p-0 text-fg-subtle hover:text-rose"
                              title="Modelni o'chirish"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Yangi model qo'shish */}
              <div className="rounded-2xl border border-line-strong bg-ink-950/60 p-4">
                <div className="mb-3 flex items-center gap-2 text-[13px] font-bold text-fg">
                  <Plus size={15} className="text-sky" />
                  <span>Boshqa model qo'shish (OpenRouter)</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-fg-subtle">Model ID</label>
                    <input
                      type="text"
                      placeholder="masalan: openai/gpt-4o-mini"
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                      className="field h-8 w-full text-[12px] mono"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-fg-subtle">Ko'rsatiladigan nom</label>
                    <input
                      type="text"
                      placeholder="masalan: GPT-4o Mini"
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      className="field h-8 w-full text-[12px]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-fg-subtle">Izoh (ixtiyoriy)</label>
                    <input
                      type="text"
                      placeholder="Tezkor va tejamkor model"
                      value={newModelDesc}
                      onChange={(e) => setNewModelDesc(e.target.value)}
                      className="field h-8 w-full text-[12px]"
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddModel}
                    className="btn-primary h-8 px-3 text-[12px]"
                  >
                    <Plus size={14} /> Modelni qo'shish
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: API KALITLAR */}
          {tab === 'keys' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-line bg-ink-950/60 p-4 text-[12.5px] text-fg-muted">
                <div className="flex items-center gap-2 font-semibold text-fg">
                  <Key size={16} className="text-amber" />
                  <span>Tashqi xizmatlar bilan integratsiya kalitlari</span>
                </div>
                <p className="mt-1 leading-relaxed">
                  Ushbu kalitlar brauzeringizda saqlanadi. Agar bu yerda maydon bo'sh qoldirilsa,
                  portal avtomatik ravishda Vercel serveridagi asosiy (.env) konfiguratsiya kalitlaridan foydalanadi.
                </p>
              </div>

              {/* Server holati */}
              {loadingEnv ? (
                <div className="flex items-center gap-2 text-[12px] text-fg-muted">
                  <Loader2 size={14} className="animate-spin text-sky" /> Server konfiguratsiyasi tekshirilmoqda…
                </div>
              ) : serverEnv ? (
                <div className="grid gap-2 text-[12px] sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-xl border border-line bg-ink-850/60 px-3 py-2">
                    <span className="text-fg-muted">OpenRouter (.env):</span>
                    {serverEnv.openrouter?.isSet ? (
                      <span className="flex items-center gap-1 font-semibold text-emerald-soft">
                        <Check size={13} /> {serverEnv.openrouter.masked}
                      </span>
                    ) : (
                      <span className="text-amber">Mavjud emas</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-line bg-ink-850/60 px-3 py-2">
                    <span className="text-fg-muted">Telegram Bot (.env):</span>
                    {serverEnv.telegram?.isSet ? (
                      <span className="flex items-center gap-1 font-semibold text-emerald-soft">
                        <Check size={13} /> {serverEnv.telegram.masked}
                      </span>
                    ) : (
                      <span className="text-amber">Mavjud emas</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-line bg-ink-850/60 px-3 py-2">
                    <span className="text-fg-muted">Supabase Baza (.env):</span>
                    {serverEnv.supabase?.isSet ? (
                      <span className="flex items-center gap-1 font-semibold text-emerald-soft">
                        <Check size={13} /> Ulangan (Jonli)
                      </span>
                    ) : (
                      <span className="text-amber">Mavjud emas</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-line bg-ink-850/60 px-3 py-2">
                    <span className="text-fg-muted">GitHub Sync (.env):</span>
                    {serverEnv.github?.isSet ? (
                      <span className="flex items-center gap-1 font-semibold text-emerald-soft">
                        <Check size={13} /> {serverEnv.github.repo}
                      </span>
                    ) : (
                      <span className="text-amber">Mavjud emas</span>
                    )}
                  </div>
                </div>
              ) : null}

              {/* 1. OpenRouter API Key */}
              <div className="space-y-1.5 rounded-2xl border border-line bg-ink-850/60 p-4">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-bold text-fg">OpenRouter API Kaliti</label>
                  <button
                    type="button"
                    onClick={() => handleTestAiModel(settings.defaultModel)}
                    className="flex items-center gap-1 text-[11.5px] font-semibold text-sky-soft hover:underline"
                  >
                    <Play size={11} /> Kalitni sinash
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showKeys['openrouter'] ? 'text' : 'password'}
                    placeholder={serverEnv?.openrouter?.isSet ? `Server kaliti faol (${serverEnv.openrouter.masked})` : 'sk-or-v1-...'}
                    value={settings.openrouterKey || ''}
                    onChange={(e) => setSettings((s) => ({ ...s, openrouterKey: e.target.value }))}
                    className="field h-9 w-full pr-10 text-[12.5px] mono"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShow('openrouter')}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-subtle hover:text-fg"
                  >
                    {showKeys['openrouter'] ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-[11.5px] text-fg-subtle">
                  Pasport, ID-karta va shahodatnomalarni Gemini / Claude orqali yuqori aniqlikda tahlil qilish uchun.
                </p>
              </div>

              {/* 2. Telegram Bot Token & Chat ID */}
              <div className="space-y-3 rounded-2xl border border-line bg-ink-850/60 p-4">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-bold text-fg">Telegram Bot & Bildirishnomalar</label>
                  <button
                    type="button"
                    onClick={handleTestTelegram}
                    disabled={tgTesting}
                    className="flex items-center gap-1 text-[11.5px] font-semibold text-emerald-soft hover:underline"
                  >
                    {tgTesting ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                    <span>Botni tekshirish</span>
                  </button>
                </div>

                {tgTestResult && (
                  <div
                    className={cx(
                      'flex items-center gap-2 rounded-xl border p-2.5 text-[12px]',
                      tgTestResult.ok ? 'border-emerald/40 bg-emerald/10 text-emerald-soft' : 'border-rose/40 bg-rose/10 text-rose',
                    )}
                  >
                    {tgTestResult.ok ? (
                      <>
                        <CheckCircle2 size={15} className="shrink-0 text-emerald" />
                        <span>{tgTestResult.botName} faol va ishlayapti</span>
                      </>
                    ) : (
                      <>
                        <XCircle size={15} className="shrink-0 text-rose" />
                        <span>Xatolik: {tgTestResult.error}</span>
                      </>
                    )}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-[11px] font-semibold text-fg-subtle">Bot Token</label>
                    <div className="relative">
                      <input
                        type={showKeys['telegram'] ? 'text' : 'password'}
                        placeholder={serverEnv?.telegram?.isSet ? `Server tokeni faol (${serverEnv.telegram.masked})` : '8615940322:AAGF-...'}
                        value={settings.telegramToken || ''}
                        onChange={(e) => setSettings((s) => ({ ...s, telegramToken: e.target.value }))}
                        className="field h-9 w-full pr-10 text-[12.5px] mono"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShow('telegram')}
                        className="absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-subtle hover:text-fg"
                      >
                        {showKeys['telegram'] ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-fg-subtle">Guruh / Chat ID</label>
                    <input
                      type="text"
                      placeholder="-1002773347907"
                      value={settings.telegramChatId || ''}
                      onChange={(e) => setSettings((s) => ({ ...s, telegramChatId: e.target.value }))}
                      className="field h-9 w-full text-[12.5px] mono"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-fg-subtle">Kanal ID (ixtiyoriy)</label>
                    <input
                      type="text"
                      placeholder="-100..."
                      value={settings.telegramChannelId || ''}
                      onChange={(e) => setSettings((s) => ({ ...s, telegramChannelId: e.target.value }))}
                      className="field h-9 w-full text-[12.5px] mono"
                    />
                  </div>
                </div>
              </div>

              {/* 3. Web Jurnal & MyTest */}
              <div className="space-y-3 rounded-2xl border border-line bg-ink-850/60 p-4">
                <label className="text-[13px] font-bold text-fg">Web Jurnal & MyTest Integratsiyasi</label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-fg-subtle">Web Jurnal API URL</label>
                    <input
                      type="text"
                      placeholder="https://webjurnal.uz"
                      value={settings.webjurnalUrl || ''}
                      onChange={(e) => setSettings((s) => ({ ...s, webjurnalUrl: e.target.value }))}
                      className="field h-9 w-full text-[12.5px]"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-fg-subtle">Web Jurnal API Kaliti</label>
                    <input
                      type={showKeys['webjurnal'] ? 'text' : 'password'}
                      placeholder="API Kalit"
                      value={settings.webjurnalKey || ''}
                      onChange={(e) => setSettings((s) => ({ ...s, webjurnalKey: e.target.value }))}
                      className="field h-9 w-full text-[12.5px] mono"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-fg-subtle">MyTest Roster Token</label>
                    <input
                      type={showKeys['mytest'] ? 'text' : 'password'}
                      placeholder="mytest_token_..."
                      value={settings.mytestToken || ''}
                      onChange={(e) => setSettings((s) => ({ ...s, mytestToken: e.target.value }))}
                      className="field h-9 w-full text-[12.5px] mono"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-fg-subtle">GitHub Shaxsiy Token</label>
                    <input
                      type={showKeys['github'] ? 'text' : 'password'}
                      placeholder="ghp_..."
                      value={settings.githubToken || ''}
                      onChange={(e) => setSettings((s) => ({ ...s, githubToken: e.target.value }))}
                      className="field h-9 w-full text-[12.5px] mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TIZIM & KESH */}
          {tab === 'system' && (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-line bg-ink-850/60 p-4">
                  <div className="flex items-center gap-2 text-[12px] font-bold text-fg-muted">
                    <Globe size={15} className="text-sky" />
                    <span>Vercel Platformasi</span>
                  </div>
                  <div className="mt-2 text-[14px] font-bold text-fg">Avtomatik Serverless</div>
                  <div className="flex items-center gap-1.5 text-[11.5px] text-emerald-soft"><Zap size={12} className="text-amber fill-amber" /> Tezkor CDN va Kesh faol</div>
                </div>

                <div className="rounded-2xl border border-line bg-ink-850/60 p-4">
                  <div className="flex items-center gap-2 text-[12px] font-bold text-fg-muted">
                    <HardDrive size={15} className="text-emerald" />
                    <span>Supabase Baza</span>
                  </div>
                  <div className="mt-2 text-[14px] font-bold text-fg">PostgreSQL Jonli Sync</div>
                  <div className="text-[11.5px] text-fg-subtle">Avtomatik zaxiralash</div>
                </div>

                <div className="rounded-2xl border border-line bg-ink-850/60 p-4">
                  <div className="flex items-center gap-2 text-[12px] font-bold text-fg-muted">
                    <ShieldCheck size={15} className="text-amber" />
                    <span>Xavfsizlik</span>
                  </div>
                  <div className="mt-2 text-[14px] font-bold text-fg">Shifrlangan Aloqa</div>
                  <div className="text-[11.5px] text-fg-subtle">HTTPS / TLS 1.3</div>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-line bg-ink-850/60 p-4">
                <div className="text-[13px] font-bold text-fg">Xotira va Keshni boshqarish</div>
                <p className="text-[12px] text-fg-muted">
                  Agar portalda eski rasmlar yoki ma&apos;lumotlar ko&apos;rinayotgan bo&apos;lsa, lokal brauzer keshini tozalashingiz mumkin.
                </p>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleClearCache}
                    className="btn-ghost h-9 px-3 text-[12.5px]"
                  >
                    <RefreshCw size={14} className="text-sky" />
                    <span>Lokal keshni tozalash</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResetDefaults}
                    className="btn-ghost h-9 px-3 text-[12.5px] text-amber hover:text-amber"
                  >
                    <RotateCcw size={14} />
                    <span>Barcha sozlamalarni standartga qaytarish</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-line bg-ink-950/80 px-5 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost h-9 px-4 text-[13px]"
          >
            Bekor qilish
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="btn-primary h-9 px-5 text-[13px]"
          >
            <Save size={15} />
            <span>Sozlamalarni saqlash</span>
          </button>
        </div>
      </div>
    </div>
  )
}
