/** Joriy o'quv yili boshlangan yil: 2026 → 2026/2027 */
export const OQUV_YILI_BOSHI = 2026

/** Maxsus guruhlar — rasmiy kontingentga kirmaydi */
export const ACADEMIC_LEAVE_GROUP = "Akademik ta'til olganlar"
export const WITHDRAWN_GROUP = 'Talabalar safidan chiqarilganlar'

/**
 * Maxfiy guruh — bazaga kiritilgan, lekin darslarga kelmaydigan talabalar.
 * Kontingentda oddiy guruh sifatida sanaladi, har bir talabaning asl guruhi
 * (data/asl_guruhlar.json) yonida ko'rsatiladi, kontraktlarga kirmaydi.
 */
export const SECRET_GROUP = '26-07'

/* ---------------------------------------------------------------- guruhlar */

export interface GroupSetting {
  kurs: number
  /** Joriy semestr: kurs bo'yicha 2·kurs−1 (kuzgi) yoki 2·kurs (bahorgi) */
  semestr: number
  /** Xodimlar ro'yxatidagi to'liq F.I.Sh */
  rahbar: string
  yonalish: string
}
export type GroupSettings = Record<string, GroupSetting>

export const KURS_LIST = [1, 2, 3] as const
export const GROUP_DIRECTIONS = ['Hamshiralik ishi', 'Farmatsiya ishi', 'Feldsherlik ishi', 'Davolash ishi']
/** Akademik guruh kodi: 26-01, 25-03 ... */
export const GROUP_CODE = /^\d{2}-\d{2}$/

const H = 'Hamshiralik ishi'

/** Kursning ikki semestri: 2-kurs → [3, 4] */
export const kursSemestrlari = (kurs: number): [number, number] => [kurs * 2 - 1, kurs * 2]

/** Sanaga qarab taxminiy joriy semestr: sentyabr–yanvar — kuzgi (toq), fevral–avgust — bahorgi (juft) */
export function defaultSemestr(kurs: number, now = new Date()): number {
  const m = now.getMonth()
  return kurs * 2 - (m >= 8 || m === 0 ? 1 : 0)
}

/** Kurs o'zgarganda semestr shu kursning mos (kuzgi/bahorgi) semestriga o'tadi */
export const moveSemestr = (semestr: number, kurs: number) => kurs * 2 - (semestr % 2)

/** "Mirzayeva Dilnavoz Quchkarovna" → "Mirzayeva D.Q."; eski "Mirzayeva.D" o'zgarishsiz qoladi */
export function shortFio(fio: string): string {
  const w = fio.trim().split(/\s+/).filter((x) => !/^(o['‘’`ʻ]?g['‘’`ʻ]?li|qizi)$/i.test(x))
  if (w.length < 2) return fio.trim()
  return `${w[0]} ${w.slice(1, 3).map((x) => `${x[0].toUpperCase()}.`).join('')}`
}

const s = (kurs: number, rahbar: string, yonalish = H): GroupSetting => ({ kurs, semestr: defaultSemestr(kurs), rahbar, yonalish })

/**
 * Boshlang'ich guruh sozlamalari. Portalda "Guruh sozlamalari" orqali o'zgartirilganlari
 * data/guruhlar.json da saqlanadi va applyGroupSettings() bilan shular ustiga qo'yiladi.
 * 26-07 — maxfiy guruh (SECRET_GROUP), darslarga kelmaydigan talabalar uchun.
 * 2025-2026 kontingenti jadvalidagidek: 24-15, 24-16 — 2-kurs; 24-14 bitirgan (bazada yo'q).
 */
export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
  '26-01': s(1, 'Mirzayeva Dilnavoz Quchkarovna', 'Farmatsiya ishi'),
  '26-02': s(1, 'Ochilov Dilshod Hamroqulovich'),
  '26-03': s(1, 'Asraliyev Asomiddin Fayzullayevich'),
  '26-04': s(1, 'Xamdamova Maxliyo Abdusoat qizi'),
  '26-05': s(1, 'Rayimova Xurshida Mahmanazar qizi'),
  '26-06': s(1, "Yo'ldoshev Oybek Alikulovich"),
  '26-07': s(1, 'Asraliyev Asomiddin Fayzullayevich'),
  '24-15': s(2, 'Asraliyev Asomiddin Fayzullayevich'),
  '24-16': s(2, "Yo'ldoshev Oybek Alikulovich"),
  '25-16': s(2, 'Xidirova Nargiza Bahirovna'),
  '25-17': s(2, 'Meyliyev Bekmurod Orifovich'),
  '25-18': s(2, 'Eshnayev Bahrom Baxtiyorovich'),
  '25-19': s(2, 'Shukurova Gulnora Ubaydullayevna'),
  '25-20': s(2, 'Muhammadiyev Laziz Mansurovich'),
  '25-21': s(2, 'Eshnayev Bahrom Baxtiyorovich'),
  '25-22': s(2, 'Raxmatova Shahlo Samirjon qizi'),
  '25-23': s(2, "Quldosheva Kumush Jo'ra qizi"),
  '24-11': s(3, 'Raxmatova Shahlo Samirjon qizi'),
  '24-12': s(3, 'Botirova Gulandon Shokirovna'),
  '24-13': s(3, 'Elmurodova Nilufar Abdurazzoqovna'),
}

/*
  Quyidagilar applyGroupSettings() tomonidan O'RNIDA yangilanadi (import qilgan
  modullar doim eng so'nggi sozlamani ko'radi). Qo'lda o'zgartirmang.
*/
/** Kurslar va ularning akademik guruhlari */
export const COURSES: { kurs: number; groups: string[] }[] = KURS_LIST.map((kurs) => ({ kurs, groups: [] }))
/** Barcha rasmiy akademik guruhlar (kurs, keyin kod tartibida) */
export const GROUPS: string[] = []
export const GROUP_LEADERS: Record<string, string> = {}
export const GROUP_TITLES: Record<string, string> = {}
/** Hozir qo'llanilgan sozlamalar */
export const GROUP_SETTINGS: GroupSettings = {}

/** Sozlamalarni tekshirib, faqat to'g'ri yozuvlarni qaytaradi */
export function sanitizeGroupSettings(raw: unknown): GroupSettings {
  const out: GroupSettings = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [g, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!GROUP_CODE.test(g) || !v || typeof v !== 'object') continue
    const { kurs, semestr, rahbar, yonalish } = v as Partial<GroupSetting>
    const k = Number(kurs)
    if (!KURS_LIST.includes(k as 1 | 2 | 3)) continue
    const sem = Number(semestr)
    out[g] = {
      kurs: k,
      semestr: kursSemestrlari(k).includes(sem) ? sem : defaultSemestr(k),
      rahbar: String(rahbar ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
      yonalish: String(yonalish ?? '').trim().slice(0, 60) || H,
    }
  }
  return out
}

export function applyGroupSettings(settings: GroupSettings) {
  const clean = sanitizeGroupSettings(settings)
  for (const k of Object.keys(GROUP_SETTINGS)) delete GROUP_SETTINGS[k]
  for (const k of Object.keys(GROUP_LEADERS)) delete GROUP_LEADERS[k]
  for (const k of Object.keys(GROUP_TITLES)) delete GROUP_TITLES[k]
  for (const c of COURSES) c.groups.length = 0
  GROUPS.length = 0

  for (const g of Object.keys(clean).sort()) {
    const v = clean[g]
    GROUP_SETTINGS[g] = v
    if (v.rahbar) GROUP_LEADERS[g] = v.rahbar
    GROUP_TITLES[g] = v.yonalish
    COURSES.find((c) => c.kurs === v.kurs)?.groups.push(g)
  }
  for (const c of COURSES) GROUPS.push(...c.groups)
}

applyGroupSettings(DEFAULT_GROUP_SETTINGS)

export const YON_OPTIONS = [
  'Hamshiralik ishi - 3 yillik',
  'Hamshiralik ishi - 2 yillik',
  'Hamshiralik ishi',
  'Feldsherlik ishi',
  'Farmatsiya ishi',
  'Davolash ishi',
]
