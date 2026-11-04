import { isValidSana, todayTashkent, uzQuotes, yonalishOfGroup } from '@/lib/malumotnoma'
import { fullName, isAcademicLeave, isLeftGroup, isOfficialGroup, isWithdrawn, kursOf, lastMoveInto } from '@/lib/student'
import type { Student } from '@/lib/types'

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

/** Talaba saqlanishidan oldingi holat — guruh tarixi hali yangilanmagan bo'lsa ham to'g'ri buyruq taklif qilish uchun */
export interface BuyruqHint {
  prevGroup?: string
  prevBuyruq?: string
  prevBuyruqSana?: string
}

/** Talaba holatidan buyruq turi va maydonlarini taxmin qilish */
export function suggestBuyruq(s: Student, hint: BuyruqHint = {}): BuyruqFields {
  const g = String(s.group || '').trim()
  const base: BuyruqFields = {
    tur: 'guruh_otkazish', raqam: '', sana: todayTashkent(), kurs: '',
    avvalgiGuruh: '', yangiGuruh: '', avvalgiRaqam: '', avvalgiSana: '',
  }
  const withKurs = (f: BuyruqFields): BuyruqFields => ({
    ...f, kurs: f.kurs || String(kursOf(f.avvalgiGuruh) ?? kursOf(f.yangiGuruh) ?? ''),
  })

  if (isLeftGroup(g)) {
    // Buyruq raqami/sanasi talaba kartasida (Buyruq №, Buyruq sanasi) saqlanadi
    return withKurs({
      ...base,
      tur: isAcademicLeave(g) ? 'akademik_tatil' : 'safdan_1',
      raqam: String(s.buyruq || ''),
      sana: String(s.buyruq_sana || '') || base.sana,
      avvalgiGuruh: String(s.chiqqan_guruh || ''),
    })
  }

  const move = lastMoveInto(s)
  const from = String(hint.prevGroup ?? move?.from ?? '').trim()

  if (from && isAcademicLeave(from)) {
    // Ta'tilga chiqarish buyrug'i: avval kartadagi (saqlashdan oldingi), bo'lmasa tarixdagi
    const leave = [...(s.guruh_tarixi ?? [])].reverse().find((m) => isAcademicLeave(m.to))
    return withKurs({
      ...base,
      tur: 'qayta_tiklash',
      avvalgiGuruh: String(s.chiqqan_guruh || leave?.from || ''),
      yangiGuruh: g,
      avvalgiRaqam: String(hint.prevBuyruq ?? leave?.buyruq ?? ''),
      avvalgiSana: String(hint.prevBuyruqSana ?? leave?.buyruq_sana ?? ''),
    })
  }

  return withKurs({
    ...base,
    tur: 'guruh_otkazish',
    avvalgiGuruh: from && !isWithdrawn(from) ? from : '',
    yangiGuruh: isOfficialGroup(g) ? g : '',
  })
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
