import { ACADEMIC_LEAVE_GROUP, WITHDRAWN_GROUP } from '@/lib/config'
import { isValidSana, todayTashkent, uzQuotes, yonalishOfGroup } from '@/lib/malumotnoma'
import { fullName, isAcademicLeave, isLeftGroup, isOfficialGroup, kursOf } from '@/lib/student'
import type { EditFields, Student } from '@/lib/types'

/*
  Talabalar bo'yicha buyruqlar (Word shablonlaridan: assets/buyruqlar/*.docx).
  YORDAMCHI-TOOLS loyihasidagi buyruq shablonlari ko'chirilgan; matn faqat bazadagi talaba
  ma'lumotidan olinadi, buyruq raqami/sanasi/guruhlar oynada tekshirib tuzatiladi.
*/

export type BuyruqTur = 'akademik_tatil' | 'qayta_tiklash' | 'guruh_otkazish' | 'safdan_1' | 'safdan_2'

export interface BuyruqTurInfo {
  nom: string
  /** assets/buyruqlar/ ichidagi shablon fayli */
  fayl: string
  /** Shablonda qaysi maydonlar ishlatiladi (oynada faqat shular ko'rsatiladi) */
  maydonlar: ('kurs' | 'avvalgiGuruh' | 'yangiGuruh' | 'avvalgiBuyruq')[]
  avvalgiGuruhNomi: string
}

export const BUYRUQ_TURLARI: Record<BuyruqTur, BuyruqTurInfo> = {
  akademik_tatil: {
    nom: "Akademik ta'til berish",
    fayl: 'akademik-tatil-berish.docx',
    maydonlar: ['kurs', 'avvalgiGuruh'],
    avvalgiGuruhNomi: 'Guruhi',
  },
  qayta_tiklash: {
    nom: "Akademik ta'tildan qayta tiklash",
    fayl: 'akademik-tatildan-qayta-tiklash.docx',
    maydonlar: ['kurs', 'avvalgiGuruh', 'yangiGuruh', 'avvalgiBuyruq'],
    avvalgiGuruhNomi: 'Avvalgi guruhi',
  },
  guruh_otkazish: {
    nom: "Guruhdan guruhga o'tkazish",
    fayl: 'guruhdan-guruhga-otkazish.docx',
    maydonlar: ['avvalgiGuruh', 'yangiGuruh'],
    avvalgiGuruhNomi: "Qaysi guruhdan",
  },
  safdan_1: {
    nom: "Safidan chiqarish — talaba arizasi asosida",
    fayl: 'safdan-chiqarish-1-asos.docx',
    maydonlar: ['kurs', 'avvalgiGuruh'],
    avvalgiGuruhNomi: 'Guruhi',
  },
  safdan_2: {
    nom: "Safidan chiqarish — guruh rahbari bildirgisi asosida",
    fayl: 'safdan-chiqarish-2-asos.docx',
    maydonlar: ['kurs', 'avvalgiGuruh'],
    avvalgiGuruhNomi: 'Guruhi',
  },
}

export const BUYRUQ_TUR_LIST = Object.keys(BUYRUQ_TURLARI) as BuyruqTur[]
export const isBuyruqTur = (v: unknown): v is BuyruqTur => typeof v === 'string' && v in BUYRUQ_TURLARI

/** Oynada tahrirlanadigan va serverga yuboriladigan maydonlar */
export interface BuyruqFields {
  tur: BuyruqTur
  raqam: string
  sana: string
  kurs: string
  avvalgiGuruh: string
  yangiGuruh: string
  avvalgiRaqam: string
  avvalgiSana: string
}

/**
 * Guruh o'zgarib saqlangandan keyin buyruq ochilganda: talaba ma'lumoti allaqachon yangi holatda,
 * saqlashdan oldingi guruh va buyruq shu yerda beriladi (guruh tarixi mijozda hali yangilanmagan bo'ladi).
 */
export interface BuyruqHint {
  prevGroup?: string
  prevBuyruq?: string
  prevBuyruqSana?: string
}

/** Buyruq turining standart tanlovi (talaba holatidan) */
export function defaultTur(s: Student, hint?: BuyruqHint): BuyruqTur {
  const g = String(s.group || '').trim()
  if (isLeftGroup(g)) return isAcademicLeave(g) ? 'akademik_tatil' : 'safdan_1'
  return hint?.prevGroup && isAcademicLeave(hint.prevGroup) ? 'qayta_tiklash' : 'guruh_otkazish'
}

/**
 * Buyruq maydonlari talaba holatidan:
 *  - hint yo'q — buyruq talaba o'tkazilishidan OLDIN tayyorlanadi: "guruhi" = hozirgi guruhi;
 *    ta'til/safdan chiqarilgan talaba uchun — qaysi guruhdan chiqqani (chiqqan_guruh);
 *  - hint bor — o'tkazish allaqachon saqlangan: "qayerdan" = saqlashdan oldingi guruh.
 */
export function suggestBuyruq(s: Student, hint?: BuyruqHint, tur: BuyruqTur = defaultTur(s, hint)): BuyruqFields {
  const g = String(s.group || '').trim()
  const left = isLeftGroup(g)
  const cur = isOfficialGroup(g) ? g : ''
  const leftFrom = String(s.chiqqan_guruh || '').trim()
  const prev = String(hint?.prevGroup ?? '').trim()
  const f: BuyruqFields = {
    tur, raqam: '', sana: todayTashkent(), kurs: '',
    avvalgiGuruh: '', yangiGuruh: '', avvalgiRaqam: '', avvalgiSana: '',
  }

  if (tur === 'akademik_tatil' || tur === 'safdan_1' || tur === 'safdan_2') {
    f.avvalgiGuruh = left ? leftFrom : cur
    // Talaba shu holatda turgan bo'lsa — buyruq raqami/sanasi kartadan
    const same = left && (tur === 'akademik_tatil') === isAcademicLeave(g)
    if (same) { f.raqam = String(s.buyruq || ''); f.sana = String(s.buyruq_sana || '') || f.sana }
  } else if (tur === 'qayta_tiklash') {
    if (hint) {
      const leave = [...(s.guruh_tarixi ?? [])].reverse().find((m) => isAcademicLeave(m.to))
      f.avvalgiGuruh = leftFrom || String(leave?.from || '')
      f.yangiGuruh = cur
      f.avvalgiRaqam = String(hint.prevBuyruq ?? leave?.buyruq ?? '')
      f.avvalgiSana = String(hint.prevBuyruqSana ?? leave?.buyruq_sana ?? '')
    } else if (isAcademicLeave(g)) {
      // Ta'tildagi talaba o'z guruhiga tiklanadi (oynada boshqa guruh tanlash mumkin)
      f.avvalgiGuruh = leftFrom
      f.yangiGuruh = isOfficialGroup(leftFrom) ? leftFrom : ''
      f.avvalgiRaqam = String(s.buyruq || '')
      f.avvalgiSana = String(s.buyruq_sana || '')
    } else {
      f.avvalgiGuruh = left ? leftFrom : cur
    }
  } else {
    // guruh_otkazish
    f.avvalgiGuruh = hint ? (prev && !isLeftGroup(prev) ? prev : '') : (left ? leftFrom : cur)
    f.yangiGuruh = hint ? cur : ''
  }
  f.kurs = String(kursOf(f.avvalgiGuruh) ?? kursOf(f.yangiGuruh) ?? '')
  return f
}

/** Buyruq chiqarilgach talaba qaysi guruhga o'tkazilishi: null — o'tkazish kerak emas / mumkin emas */
export function buyruqMove(s: Pick<Student, 'group'>, f: BuyruqFields): { group: string; fields: EditFields; label: string } | null {
  const cur = String(s.group || '').trim()
  let group = ''
  let fields: EditFields = {}
  if (f.tur === 'akademik_tatil' || f.tur === 'safdan_1' || f.tur === 'safdan_2') {
    group = f.tur === 'akademik_tatil' ? ACADEMIC_LEAVE_GROUP : WITHDRAWN_GROUP
    // Safdan chiqarish / akademik ta'til: buyruq raqami, sanasi va qaysi guruhdan chiqqani talabaga yoziladi
    fields = { buyruq: f.raqam.trim(), buyruq_sana: f.sana.trim(), chiqqan_guruh: f.avvalgiGuruh.trim() }
  } else {
    group = f.yangiGuruh.trim()
    if (!isOfficialGroup(group)) return null
  }
  if (!group || group === cur) return null
  return { group, fields: { ...fields, group }, label: group }
}

/** Buyruqni chiqarib bo'lmasa — sababi, aks holda null */
export function buyruqBlocker(f: BuyruqFields): string | null {
  const info = BUYRUQ_TURLARI[f.tur]
  if (!f.raqam.trim()) return 'Buyruq raqamini kiriting'
  if (!isValidSana(f.sana.trim())) return "Buyruq sanasini KK.OO.YYYY ko'rinishida kiriting"
  if (info.maydonlar.includes('kurs') && !/^[1-4]$/.test(f.kurs.trim())) return 'Kursni (1–4) tanlang'
  if (info.maydonlar.includes('avvalgiGuruh') && !f.avvalgiGuruh.trim()) return `${info.avvalgiGuruhNomi} kiritilmagan`
  if (info.maydonlar.includes('yangiGuruh') && !f.yangiGuruh.trim()) return 'Yangi guruh kiritilmagan'
  if (info.maydonlar.includes('avvalgiBuyruq')) {
    if (!f.avvalgiRaqam.trim()) return "Ta'til berilgan avvalgi buyruq raqamini kiriting"
    if (!isValidSana(f.avvalgiSana.trim())) return "Avvalgi buyruq sanasini KK.OO.YYYY ko'rinishida kiriting"
  }
  return null
}

/** Guruh kodidagi chiziqcha qatorlar orasida bo'linmasin — bo'linmaydigan chiziqcha */
const nb = (g: string) => g.trim().replace(/-/g, '‑')
const clean = (v: string) => uzQuotes(v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 80)

/**
 * Shablondagi {{kalit}} larning qiymatlari. Shablonlarda ba'zi joylarda kalitdan keyin bo'shliq yo'q
 * ("{{sanasi}}yil.", "{{avvalgi_guruhi}}guruhdan") — bo'shliq qiymatga qo'shiladi.
 */
export function buyruqQiymatlari(fish: string, f: BuyruqFields): Record<string, string> {
  const transfer = f.tur === 'guruh_otkazish'
  return {
    buyruq_raqami: clean(f.raqam),
    sanasi: `${clean(f.sana)} `,
    IFO: clean(fish),
    kursi: clean(f.kurs),
    guruhi: nb(clean(f.avvalgiGuruh)),
    avvalgi_guruhi: nb(clean(f.avvalgiGuruh)) + (transfer ? ' ' : ''),
    yangi_guruhi: nb(clean(f.yangiGuruh)) + (transfer ? ' ' : ''),
    yonalishi: uzQuotes(yonalishOfGroup(f.avvalgiGuruh)),
    avvalgi_buyruq_raqami: clean(f.avvalgiRaqam),
    avvalgi_buyruq_sanasi: clean(f.avvalgiSana),
  }
}

/** Oynada ko'rsatiladigan qisqa matn — buyruqning asosiy bandi */
export function buyruqMatni(s: Pick<Student, 'fish' | 'ism' | 'ota'>, f: BuyruqFields): string {
  const name = fullName(s) || '—'
  const k = f.kurs || '?'
  switch (f.tur) {
    case 'akademik_tatil':
      return `${k}-bosqich ${f.avvalgiGuruh || '?'}-guruh talabasi ${name}ga akademik ta’til berilsin.`
    case 'qayta_tiklash':
      return `${f.avvalgiSana || '?'} yildagi ${f.avvalgiRaqam || '?'}-sonli buyruq bilan akademik ta’til berilgan ${k}-bosqich ${f.avvalgiGuruh || '?'}-guruh talabasi ${name}ni ${k}-bosqich ${f.yangiGuruh || '?'}-guruhga o‘quv jarayonlarini davom ettirishi uchun tiklansin.`
    case 'guruh_otkazish':
      return `${name}: ${f.avvalgiGuruh || '?'} guruhdan ${f.yangiGuruh || '?'} guruhga o‘tkazilsin.`
    default:
      return `${k}-bosqich ${f.avvalgiGuruh || '?'}-guruh talabasi ${name}ni o‘quvchilar safidan chiqarilsin.`
  }
}

export function buyruqFileName(s: Pick<Student, 'fish' | 'ism' | 'ota'>, tur: BuyruqTur): string {
  const name = fullName(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim()
  return `${name} — ${BUYRUQ_TURLARI[tur].nom} buyrug‘i.docx`
}

/** Brauzer → server so'rov satri */
export function buyruqQuery(row: number, f: BuyruqFields): string {
  const q = new URLSearchParams({ row: String(row), tur: f.tur, raqam: f.raqam, sana: f.sana })
  const info = BUYRUQ_TURLARI[f.tur]
  if (info.maydonlar.includes('kurs')) q.set('kurs', f.kurs)
  if (info.maydonlar.includes('avvalgiGuruh')) q.set('avvalgi', f.avvalgiGuruh)
  if (info.maydonlar.includes('yangiGuruh')) q.set('yangi', f.yangiGuruh)
  if (info.maydonlar.includes('avvalgiBuyruq')) { q.set('avvalgi_raqam', f.avvalgiRaqam); q.set('avvalgi_sana', f.avvalgiSana) }
  return q.toString()
}
