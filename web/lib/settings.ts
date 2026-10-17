import { AI_MODELS, DEFAULT_AI_MODEL, type AiModelId } from './ai-doc'

export interface ModelPermission {
  id: string
  name: string
  desc?: string
  badge?: string
  enabled: boolean
}

export interface AppSettings {
  // API Keys (brauzer override, agar bo'sh bo'lsa serverdagi env ishlatiladi)
  openrouterKey?: string
  telegramToken?: string
  telegramChatId?: string
  telegramChannelId?: string
  webjurnalUrl?: string
  webjurnalKey?: string
  mytestToken?: string
  githubToken?: string

  // AI Modellar ruxsati va tanlovi
  allowedModels: ModelPermission[]
  defaultModel: string

  // Oxirgi yangilanish
  updatedAt?: string
}

export const DEFAULT_CATALOG_MODELS: ModelPermission[] = [
  {
    id: 'google/gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    desc: 'Eng tezkor va aniq OCR modeli (Tavsiya etiladi)',
    badge: 'Tavsiya',
    enabled: true,
  },
  {
    id: 'anthropic/claude-haiku-5.5',
    name: 'Claude Haiku 5.5',
    desc: 'Eng tejamkor va arzon model (yuqori aniqlik)',
    badge: 'Arzon',
    enabled: true,
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    desc: 'Barqaror zaxira modeli',
    enabled: true,
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    desc: 'Katta hajmli va xira hujjatlar uchun chuqur tahlil',
    badge: 'Aniq',
    enabled: true,
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    desc: 'OpenAI flagman ko‘p modalli modeli',
    enabled: true,
  },
]

const SETTINGS_KEY = 'portal_app_settings_v2'

export function getAppSettings(): AppSettings {
  if (typeof window === 'undefined') {
    return {
      allowedModels: DEFAULT_CATALOG_MODELS,
      defaultModel: DEFAULT_AI_MODEL,
    }
  }

  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      // Yangi katalog modellarini mavjud sozlamalar bilan birlashtirish
      const savedMap = new Map((parsed.allowedModels || []).map((m) => [m.id, m]))
      const mergedModels: ModelPermission[] = DEFAULT_CATALOG_MODELS.map((def) => {
        const saved = savedMap.get(def.id)
        return saved ? { ...def, ...saved } : def
      })

      // Foydalanuvchi qo'shgan maxsus modellarni ham qo'shish
      for (const m of parsed.allowedModels || []) {
        if (!DEFAULT_CATALOG_MODELS.some((d) => d.id === m.id)) {
          mergedModels.push(m)
        }
      }

      return {
        openrouterKey: parsed.openrouterKey || '',
        telegramToken: parsed.telegramToken || '',
        telegramChatId: parsed.telegramChatId || '',
        telegramChannelId: parsed.telegramChannelId || '',
        webjurnalUrl: parsed.webjurnalUrl || '',
        webjurnalKey: parsed.webjurnalKey || '',
        mytestToken: parsed.mytestToken || '',
        githubToken: parsed.githubToken || '',
        allowedModels: mergedModels,
        defaultModel: parsed.defaultModel || DEFAULT_AI_MODEL,
        updatedAt: parsed.updatedAt,
      }
    }
  } catch {
    /* bo'sh */
  }

  return {
    allowedModels: DEFAULT_CATALOG_MODELS,
    defaultModel: DEFAULT_AI_MODEL,
  }
}

export function saveAppSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return
  try {
    const toSave: AppSettings = {
      ...settings,
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(toSave))
    // AI model tanlovini ham moslash
    if (settings.defaultModel) {
      localStorage.setItem('portal_ai_model', settings.defaultModel)
    }
  } catch {
    /* bo'sh */
  }
}

/** Hujjat tahlili va kartalar uchun faqat ruxsat berilgan (enabled) modellarni qaytaradi */
export function getActiveAllowedModels(): [string, string][] {
  const s = getAppSettings()
  const enabled = s.allowedModels.filter((m) => m.enabled)
  if (enabled.length === 0) {
    // Agar hamma model o'chirilgan bo'lsa, xavfsizlik uchun gemini-3.8-flash qoladi
    return [[DEFAULT_AI_MODEL, 'Gemini 3.8 Flash']]
  }
  return enabled.map((m) => [m.id, m.name])
}
