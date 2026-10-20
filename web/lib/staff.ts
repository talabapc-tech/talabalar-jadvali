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
