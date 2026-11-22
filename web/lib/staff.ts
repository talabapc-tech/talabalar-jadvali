export interface StaffMember {
  id: string
  fish: string
  lavozim: string
  kategoriya?: string // 'ShTAT - xodimlar' | "Asosiy o'qituvchilar" | "O'rindosh o'qituvchilar"
  bolim?: string
  ish_turi?: string   // 'Shtat' | 'Asosiy' | "O'rindosh" | 'Soatbay'
  stavka?: string     // '1.0' | '0.5' | '0.25' | 'soatbay'
  tel?: string
  pinfl?: string
  pv?: string
  inn?: string
  plastik_karta?: string
  plastik_muddati?: string
  toifasi?: string
  ilmiy_unvoni?: string
  obektivka_file?: string
  dob?: string
  tugilgan_joy?: string
  tamomlagan_otm?: string
  otm_tamom_yili?: string
  mutaxassislik?: string
  buyruq_sana?: string
  ishga_sana?: string
  boshan_sana?: string
  yashash_joyi?: string
  pasport_berilgan_joy?: string
  maosh?: string | number
  soat_stavka?: string | number
  status?: 'faol' | 'tatilda' | 'boshatilgan'
  doc_file?: string
  izoh?: string
}

export const STAFF_CATEGORIES = [
  'Barchasi',
  'ShTAT - xodimlar',
  "Asosiy o'qituvchilar",
  "O'rindosh o'qituvchilar",
] as const

export const STAFF_DEPARTMENTS = [
  'Barchasi',
  'Rahbariyat',
  'Pedagog',
  "O'quv bo'limi",
  'Moliya bo\'limi',
  "Ma'muriy",
  "Xo'jalik",
  'Tibbiy xizmat',
  'Boshqa',
] as const

export const STAFF_WORK_TYPES = [
  'Barchasi',
  'Shtat',
  'Asosiy',
  "O'rindosh",
  'Soatbay',
] as const

export function formatSalary(val: string | number | undefined): string {
  if (val === undefined || val === null || val === '') return '—'
  const num = typeof val === 'number' ? val : Number(String(val).replace(/\D/g, ''))
  if (isNaN(num) || num <= 0) return String(val)
  return `${num.toLocaleString('uz-UZ')} so'm`
}

export function cleanStaffPhone(tel: string | undefined): string {
  if (!tel) return ''
  const digits = String(tel).replace(/\D/g, '')
  if (digits.length === 9) return `+998 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 7)} ${digits.slice(7)}`
  if (digits.length === 12 && digits.startsWith('998')) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`
  }
  return String(tel).trim()
}

export function cleanStaffPinfl(pinfl: string | undefined): string {
  if (!pinfl) return ''
  return String(pinfl).replace(/\s+/g, '').trim()
}

export function formatStaffCard(card: string | undefined): string {
  if (!card) return ''
  const trimmed = String(card).trim()
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 16) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)} ${digits.slice(12, 16)}`
  }
  return trimmed
}

export function matchesStaffCategory(s: StaffMember, category: string): boolean {
  const cat = String(category || '').trim()
  if (!cat || cat === 'Barchasi') return true
  const k = (s.kategoriya || '').toLowerCase()
  const t = (s.ish_turi || '').toLowerCase()
  const c = cat.toLowerCase()
  if (c === 'shtat' || c.includes('shtat')) return k.includes('shtat') || t.includes('shtat')
  if (c === 'asosiy' || c.includes('asosiy')) return k.includes('asosiy') || t.includes('asosiy')
  if (c.includes("o'rindosh") || c.includes('orindosh')) {
    return k.includes("o'rindosh") || t.includes("o'rindosh") || k.includes('orindosh') || t.includes('orindosh')
  }
  return s.kategoriya === cat || s.ish_turi === cat
}
