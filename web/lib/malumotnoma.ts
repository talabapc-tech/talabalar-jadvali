import { fullName, isOfficialGroup } from '@/lib/student'
import type { Student } from '@/lib/types'

/*
  "O'qiyotganligi haqida ma'lumotnoma" — namunadagi (Ozodova Klara ...docx) matn va
  qiymatlar. Word fayl shablondan to'ldiriladi: lib/server/malumotnoma.ts.
*/

export interface MalumotnomaData {
  fish: string
  yon: string
  group: string
  bosqich: number
  oquvYili: string // 2026/2027
  sana: string // 28.09.2026
}

/** O'zbek lotinidagi tutuq belgilarini hujjatdagidek qilish: o‘/g‘ — U+2018, qolgani — U+2019 */
export function uzQuotes(s: string): string {
  return s
    .replace(/([oOgG])[`'ʻ‘’ʼ]/g, '$1‘')
    .replace(/[`'ʻʼ]/g, '’')
}

/** Toshkent vaqti bo'yicha bugungi sana: DD.MM.YYYY */
export function todayTashkent(): string {
  const d = new Date(Date.now() + 5 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
}

export function isValidSana(s: string): boolean {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s)
  if (!m) return false
  const [dd, mm] = [Number(m[1]), Number(m[2])]
  return dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12
}

/** O'quv yili avgustdan boshlanadi: 28.09.2026 → 2026 (2026/2027) */
function oquvYiliBoshi(sana: string): number {
  const [, mm, yyyy] = sana.split('.').map(Number)
  return mm >= 8 ? yyyy : yyyy - 1
}

/**
 * Ta'lim yo'nalishi qoidasi:
 * - 01-guruh (masalan 26-01) qat'iy "Farmatsiya ishi"
 * - Qolgan barcha guruhlar qat'iy "Hamshiralik ishi"
 */
export function yonalishOfGroup(group: string | undefined): string {
  const g = String(group || '').trim()
  if (g === '26-01' || g.endsWith('-01')) return 'Farmatsiya ishi'
  return 'Hamshiralik ishi'
}

/** "Hamshiralik ishi - 3 yillik" → "Hamshiralik ishi", 01-guruhlar → "Farmatsiya ishi" */
export function cleanYon(yon: string, group?: string): string {
  if (group) return yonalishOfGroup(group)
  const gMatch = /^(\d{2}-\d{2})/.exec(yon)
  if (gMatch) return yonalishOfGroup(gMatch[1])
  const cleaned = yon.replace(/\s*[-–—]\s*\d+\s*yillik\s*$/i, '').trim()
  if (cleaned.toLowerCase().includes('farm')) return 'Farmatsiya ishi'
  return 'Hamshiralik ishi'
}

/** Ma'lumotnoma berib bo'lmasa — sababi, aks holda null */
export function malumotnomaBlocker(s: Pick<Student, 'group' | 'fish' | 'ism' | 'ota'>): string | null {
  if (!isOfficialGroup(s.group)) return "Talaba faol guruhda emas — o'qiyotganligi haqida ma'lumotnoma berilmaydi"
  if (!fullName(s)) return "Talabaning F.I.SH yo'q"
  return null
}

export function malumotnomaData(s: Student, sana = todayTashkent()): MalumotnomaData {
  const start = oquvYiliBoshi(sana)
  // Guruh kodi qabul yilini bildiradi: 26-05 → 2026-yil qabuli
  const qabul = /^(\d{2})-/.exec(s.group)
  const bosqich = qabul ? Math.max(1, start - (2000 + Number(qabul[1])) + 1) : 1
  return {
    fish: uzQuotes(fullName(s)),
    yon: uzQuotes(yonalishOfGroup(s.group)),
    group: s.group,
    bosqich,
    oquvYili: `${start}/${start + 1}`,
    sana,
  }
}

export function malumotnomaFileName(s: Pick<Student, 'fish' | 'ism' | 'ota'>, ext: 'jpg' | 'docx' = 'jpg'): string {
  const name = fullName(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim()
  return `${name} O'qiyotganligi haqida ma'lumotnoma.${ext}`
}
