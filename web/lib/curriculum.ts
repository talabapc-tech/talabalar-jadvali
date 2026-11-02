/*
  O'quv rejalari (Curriculum) moduli:
  - Har bir o'quv yili (2026/2027, 2025/2026, 2024/2025 va h.k.) bo'yicha mustaqil rejalar
  - Yo'nalishlar (Hamshiralik ishi, Farmatsiya ishi, Davolash ishi va boshqalar)
  - Ta'lim muddati (3 yillik, 2 yillik, 1.5 yillik)
  - Barcha semestrlar (1-dan 6-semestrgacha) bo'yicha fanlar ro'yxati, soat yuklamasi, nazorat turlari
  - Guruhlarga biriktirish (akademik guruhlar o'quv rejaga bog'lanadi)
  - Baholar bo'limiga avtomatik fanlar va reyting jadvalini shakllantirish
*/

export interface FanReja {
  id: string
  nom: string
  soat?: number
  kredit?: number
  nazorat?: 'Imtihon' | 'Sinov' | 'Yakuniy' | 'Diferensial sinov' | 'Reyting'
  tartib: number
}

export interface SemestrReja {
  semestr: number
  fanlar: FanReja[]
}

export interface OquvReja {
  id: string
  oquvYili: string // Masalan: "2026/2027", "2025/2026", "2024/2025"
  yonalish: string // Masalan: "Hamshiralik ishi", "Farmatsiya ishi"
  muddati: string // Masalan: "3 yillik", "2 yillik"
  kod?: string // Masalan: "5510101"
  daraja?: string // "O'rta maxsus professional"
  tavsif?: string
  groups: string[] // Biriktirilgan guruhlar: ["26-02", "26-03"]
  semestrlar: Record<string, SemestrReja> // kalit: '1', '2', ...
  createdAt: string
  updatedAt: string
}

export const STANDART_OQUV_YILLARI = ['2026/2027', '2025/2026', '2024/2025', '2023/2024'] as const
export const STANDART_MUDDATLAR = ['3 yillik', '2 yillik', '1.5 yillik', '4 yillik'] as const
export const STANDART_YONALISHLAR = [
  'Hamshiralik ishi',
  'Farmatsiya ishi',
  'Davolash ishi',
  'Akusherlik ishi',
  'Stomatologiya ishi',
  'Laboratoriya diagnostikasi',
  'Tibbiy profilaktika ishi',
] as const

export const NAZORAT_TURLARI = [
  'Imtihon',
  'Sinov',
  'Yakuniy',
  'Diferensial sinov',
  'Reyting',
] as const

/** Guruh nomi bo'yicha unga biriktirilgan o'quv rejasini topish */
export function findPlanForGroup(plans: OquvReja[], groupName: string): OquvReja | undefined {
  if (!groupName) return undefined
  const clean = groupName.trim()
  return plans.find((p) => p.groups && p.groups.includes(clean))
}

/** O'quv rejasidan ma'lum semestr fanlarini olish (tartiblangan holda) */
export function getPlanSubjectsForSemester(plan: OquvReja | undefined, semestr: number): FanReja[] {
  if (!plan || !plan.semestrlar) return []
  const s = plan.semestrlar[String(semestr)]
  if (!s || !s.fanlar) return []
  return [...s.fanlar].sort((a, b) => a.tartib - b.tartib)
}

/** Yangi unikal ID hosil qilish */
export function genId(prefix = 'item'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}
