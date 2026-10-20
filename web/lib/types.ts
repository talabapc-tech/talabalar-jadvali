/** 03_hisobot_yasat.py yaratadigan students.json dagi bitta yozuv */
export interface Student {
  row: number // Excel'dagi qator raqami — serverga yozishda kalit
  tr: number
  shnum: string
  sana: string
  ism: string
  ota: string
  fish: string
  yon: string
  group: string
  pv: string
  pass_type: string
  pinfl: string
  dob: string
  ber: string
  sh_doc: string
  sh_qr: string
  mak: string
  doc_tur: string
  yil: string
  tel: string
  doc_file: string
  status: 'full' | 'chala' | 'yoq' | string
  pass_fish: string
  cert_fish: string
  name_match: string
  name_flag: '' | 'ok' | 'translit' | 'farq' | 'tekshir' | 'boshqa' | string
  verified: 'TASDIQLANDI' | 'KUTILMOQDA' | string
  /** Bazaga kiritilganligi tasdig'i (Excel 28-ustun, standart: KIRITILDI) */
  baza?: 'KIRITILDI' | 'KIRITILMAGAN' | string
  /** Safdan chiqarish / akademik ta'til buyrug'i (Excel 26–27-ustunlar) */
  buyruq?: string
  buyruq_sana?: string
  /** Maxfiy guruhdagi (26-07) talabaning bazadagi asl guruhi — data/asl_guruhlar.json dan */
  asl_guruh?: string
  /** Akademik ta'tilga / safdan chiqarilganda qaysi guruhdan chiqqani — data/guruh_tarixi.json dan */
  chiqqan_guruh?: string
  /** Guruh almashtirishlar tarixi (eskidan yangiga) — data/guruh_tarixi.json dan */
  guruh_tarixi?: GroupMove[]
  /** So'rovnomadan kiritilgan qo'shimcha ma'lumotlar */
  manzil_tuman?: string
  manzil_mfy?: string
  manzil_kocha?: string
  manzil_uy?: string
  manzil_toliq?: string
  qatnov?: string
  tel_shaxsiy?: string
  tel_otaona?: string
  tel_otaona_kim?: string
  sorovnoma_vaqti?: string
}

/** Bitta guruh almashtirish: qayerdan → qayerga, buyruq va tizimga kiritilgan vaqt */
export interface GroupMove {
  from: string
  to: string
  buyruq?: string
  buyruq_sana?: string
  /** Tizimda o'zgartirilgan vaqt (ISO). Bo'sh — qo'lda kiritilgan, vaqti noma'lum */
  vaqt?: string
  /** Qanday yozilgan: portal (avtomatik), qolda (oynada kiritilgan), tarix (git tarixidan tiklangan) */
  manba?: 'portal' | 'qolda' | 'tarix'
}

/** Qo'lda tahrirlanadigan maydonlar (eski app.js dagi STUDENT_EDIT_FIELDS) */
export const EDIT_FIELDS = [
  'ism', 'ota', 'group', 'pv', 'pinfl', 'dob', 'ber',
  'doc_tur', 'sh_doc', 'mak', 'yil', 'yon', 'shnum', 'tel',
  'buyruq', 'buyruq_sana', 'asl_guruh', 'chiqqan_guruh',
  'doc_file',
] as const
export type EditField = (typeof EDIT_FIELDS)[number]
export type EditFields = Partial<Record<EditField, string>>

export type VerifyStatus = 'TASDIQLANDI' | 'KUTILMOQDA'
export type BazaStatus = 'KIRITILDI' | 'KIRITILMAGAN'

/** Python xizmati tushunadigan o'zgarishlar (scripts/remote_changes.json formati) */
export type Change =
  | { type: 'update_student'; data: { row: number; fields: EditFields; shnum?: string; pinfl?: string; ism?: string } }
  | { type: 'verify_student'; data: { row: number; status: VerifyStatus; shnum: string; pinfl: string; ism: string } }
  | { type: 'baza_student'; data: { row: number; status: BazaStatus; shnum: string; pinfl: string; ism: string } }
  | { type: 'delete_student'; data: { row: number; shnum: string; pinfl: string; ism: string; fish: string } }
  | { type: 'add_student'; data: EditFields }

export interface StudentsPayload {
  students: Student[]
  source: 'supabase' | 'local' | 'github'
  fetchedAt: string
}

export interface ContractStudent {
  id: string
  tr?: number
  file_tr?: number
  student_row: number | null
  fish: string
  contract_fio: string
  base_fio?: string | null
  group: string
  contract_group: string
  base_group?: string
  kurs: number
  pinfl: string
  tel?: string
  shartnoma_summa: number
  tolangan_summa: number
  qarzdorlik: number
  tolov_foiz: number
  holat: 'qarzdor' | 'tolangan' | 'avans' | 'shartnoma_kutilmoqda' | 'topilmadi'
  toifa: 'aktiv' | 'akademik_tsg' | '1-kurs' | 'faqat_kontrakt' | 'shartnomasiz'
  is_hidden?: boolean
  hidden_reason?: string
  manba: string
  source_sheet: string | null
  source_row: number | null
}

export interface ContractGroupSummary {
  group: string
  kurs: number
  rahbar?: string
  total_students: number
  contracts_count: number
  total_req: number
  total_paid: number
  total_debt: number
  total_advance?: number
  debtors_count: number
  paid_count: number
  advance_count?: number
  pay_percent: number
}

export interface ContractKPI {
  date?: string
  file_name?: string
  total_students?: number
  visible_students?: number
  hidden_students_count?: number
  total_students_db?: number
  total_groups?: number
  total_contract_records?: number
  active_contracts_count?: number
  total_req_sum: number
  total_paid_sum: number
  total_debt_sum: number
  total_advance_sum?: number
  total_debtors_count: number
  total_paid_full_count: number
  total_advance_count?: number
  total_pay_percent: number
  akademik_debt_sum?: number
  akademik_debtors_count?: number
  course1_count?: number
  updated_at: string
}

export interface ContractTopSummary {
  row: number
  rahbar: string
  group: string
  kurs: number
  students_count: number
  total_debt: number
}

export interface ContractsPayload {
  kpi: ContractKPI
  summary_table?: ContractTopSummary[]
  groups: ContractGroupSummary[]
  students: ContractStudent[]
  hidden_rows?: number[]
}
