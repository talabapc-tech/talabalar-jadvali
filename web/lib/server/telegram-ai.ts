import 'server-only'
import type { PendingData } from './telegram-session'

const PROMPT = `Sen professional O'zbekiston hujjatlarini (ID-karta, Biometrik pasport, Diplom, Shahodatnoma, Obyektivka) tahlil qiluvchi AI assistentisan.
Rasmdagi shaxsning barcha ma'lumotlarini juda sinchiklab tahlil qil va to'liq JSON formatida qaytar.

Qat'iy Qoidalar:
1. Pasport/ID seriya va raqami:
   - ID-karta: 'AD' yoki 'AE' harflari va ketma-ket aniq 7 ta raqam (jami 9 ta belgi). Masalan: AE4629898, AD1234567.
   - Biometrik pasport: 'AA', 'AB', 'AC', 'FA' va 7 ta raqam.
2. JSHSHIR (PINFL):
   - Pasport yoki ID-karta pastidagi/orqasidagi ANIQ 14 xonali raqam (3, 4, 5 yoki 6 raqami bilan boshlanadi).
   - Biometrik pasport pastki MRZ qatoridagi amal qilish sanasidan keyingi 14 xonali raqam!
3. Tug'ilgan sana (dob):
   - Pasportdagi tug'ilgan sana: DD.MM.YYYY.
4. Pasport berilgan sana (pass_ber):
   - FAQAT pasport yoki ID-karta berilgan sanasi (Date of issue: DD.MM.YYYY).
5. Shahodatnoma yoki Diplom:
   - doc_tur: Maktab bo'lsa 'Shahodatnoma', Kollej/OTM bo'lsa 'Diplom'
   - sh_doc: Seriya va raqam (masalan UM 1234567)
   - maktab: Muassasa yoki maktab nomi
   - yil: Bitirgan yili
6. Xodim / Mutaxassislik / Fan:
   - mutaxassislik: Agar diplom yoki obyektivka bo'lsa, mutaxassisligi yoki o'qitadigan fani (masalan Hamshiralik ishi, Ona tili, Informatika, Davolash ishi).
   - lavozim: Agar xodim hujjati bo'lsa, lavozimi.
7. Telefon raqami:
   - tel: +998... (agar hujjatda bo'lsa)

Faqat toza JSON formatida javob ber:
{
  "fish": "Familiya Ism Otasining ismi",
  "ism": "Familiya Ism",
  "ota": "... qizi / ... o'g'li",
  "pv": "AE1234567",
  "pinfl": "14 xonali raqam",
  "dob": "DD.MM.YYYY",
  "pass_ber": "DD.MM.YYYY",
  "tel": "+998...",
  "sh_doc": "UM 1234567",
  "doc_tur": "Shahodatnoma",
  "maktab": "301-maktab",
  "yil": "2024",
  "mutaxassislik": "Hamshiralik ishi",
  "lavozim": "O'qituvchi",
  "yashash_joyi": "Shahrisabz shahri"
}`

const FALLBACK_MODELS = ['google/gemini-3.8-flash', 'anthropic/claude-haiku-5.5', 'google/gemini-2.5-flash']

function normalizeExtracted(raw: Record<string, unknown>): PendingData {
  const str = (k: string) => String(raw[k] ?? '').trim()
  
  let pv = str('pv') || str('pass_ser') || str('pasport')
  pv = pv.toUpperCase().replace(/\s/g, '')
  const mPv = pv.match(/([A-Z]{2})(\d{7})/)
  if (mPv) pv = mPv[1] + mPv[2]

  let pinfl = str('pinfl')
  const mPinfl = pinfl.match(/([3456]\d{13})/)
  if (mPinfl) pinfl = mPinfl[1]

  const ism = str('ism')
  const ota = str('ota')
  let fish = str('fish') || str('full_name')
  if (!fish && ism) fish = `${ism} ${ota}`.trim()

  let dob = str('dob') || str('birth_date')
  const mDob = dob.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/)
  if (mDob) dob = `${mDob[1].padStart(2, '0')}.${mDob[2].padStart(2, '0')}.${mDob[3]}`

  let pass_ber = str('pass_ber') || str('passport_issue_date')
  const mBer = pass_ber.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/)
  if (mBer) pass_ber = `${mBer[1].padStart(2, '0')}.${mBer[2].padStart(2, '0')}.${mBer[3]}`

  let tel = str('tel') || str('phone')
  if (tel) {
    tel = tel.replace(/[^\d+]/g, '')
    if (tel.startsWith('998') && !tel.startsWith('+')) tel = `+${tel}`
    else if (tel.length === 9) tel = `+998${tel}`
  }

  return {
    fish,
    ism,
    ota,
    pv,
    pinfl,
    dob,
    pass_ber,
    tel,
    sh_doc: str('sh_doc') || str('doc_series') || str('cert_num'),
    doc_tur: str('doc_tur') || str('doc_type') || 'Shahodatnoma',
    maktab: str('maktab') || str('otm') || str('school'),
    yil: str('yil') || str('grad_year'),
    mutaxassislik: str('mutaxassislik') || str('specialty'),
    lavozim: str('lavozim') || str('role'),
    yashash_joyi: str('yashash_joyi') || str('address'),
  }
}

/**
 * Rasmni OpenRouter yoki Gemini Vision orqali tahlil qilish
 */
export async function analyzeDocumentImage(imgBuf: Buffer): Promise<{ success: boolean; data?: PendingData; error?: string }> {
  const b64 = imgBuf.toString('base64')
  const dataUrl = `data:image/jpeg;base64,${b64}`

  // 1. Google Gemini rasmiy API (agar GEMINI_API_KEY bo'lsa)
  const geminiKey = process.env.GEMINI_API_KEY?.trim()
  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: b64,
                  },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      })
      if (resp.ok) {
        const json = await resp.json()
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || ''
        const m = text.match(/\{[\s\S]*\}/)
        if (m) {
          const parsed = JSON.parse(m[0])
          return { success: true, data: normalizeExtracted(parsed) }
        }
      }
    } catch (e) {
      console.warn('Gemini API xatosi:', e)
    }
  }

  // 2. OpenRouter AI (OPENROUTER_API_KEY)
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim()
  if (openrouterKey) {
    const content = [
      { type: 'text', text: PROMPT },
      { type: 'image_url', image_url: { url: dataUrl } },
    ]

    let lastErr = ''
    for (const model of FALLBACK_MODELS) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openrouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://talabalar-jadvali.vercel.app',
            'X-Title': 'Talabalar Portali Bot',
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [{ role: 'user', content }],
          }),
          signal: AbortSignal.timeout(45_000),
        })

        if (!res.ok) {
          lastErr = `${model}: HTTP ${res.status}`
          continue
        }

        const json = await res.json()
        const raw = String(json?.choices?.[0]?.message?.content ?? '')
        const m = raw.match(/\{[\s\S]*\}/)
        if (!m) {
          lastErr = `${model}: JSON topilmadi`
          continue
        }
        const data = JSON.parse(m[0]) as Record<string, unknown>
        return { success: true, data: normalizeExtracted(data) }
      } catch (e) {
        lastErr = `${model}: ${(e as Error).message}`
      }
    }
    return { success: false, error: `AI javob bermadi (${lastErr})` }
  }

  return {
    success: false,
    error: "AI API kaliti sozlanmagan (OPENROUTER_API_KEY yoki GEMINI_API_KEY kiritilishi kerak)",
  }
}

/**
 * Matn ko'rinishidagi ma'lumotlarni aqlli regex va qoidalar bilan ajratib olish
 */
export function parseTextData(text: string): PendingData | null {
  const clean = text.trim()
  if (clean.length < 5) return null

  // 1. Pasport
  let pv = ''
  const mPv = clean.match(/\b([A-Za-z]{2})\s*(\d{7})\b/)
  if (mPv) pv = `${mPv[1].toUpperCase()}${mPv[2]}`

  // 2. PINFL
  let pinfl = ''
  const mPinfl = clean.match(/\b([3456]\d{13})\b/)
  if (mPinfl) pinfl = mPinfl[1]

  // 3. Tug'ilgan sana
  let dob = ''
  const mDob = clean.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/)
  if (mDob) dob = `${mDob[1].padStart(2, '0')}.${mDob[2].padStart(2, '0')}.${mDob[3]}`

  // 4. Telefon
  let tel = ''
  const mTel = clean.match(/(?:\+?998)?[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/)
  if (mTel) {
    tel = mTel[0].replace(/[^\d+]/g, '')
    if (tel.startsWith('998') && !tel.startsWith('+')) tel = `+${tel}`
    else if (tel.length === 9) tel = `+998${tel}`
  }

  // 5. Guruh
  let group = ''
  const mGrp = clean.match(/\b(2[4-6]-\d{2})\b/)
  if (mGrp) group = mGrp[1]

  // 6. Kategoriya / Ish turi
  let kategoriya = ''
  let lavozim = ''
  if (/asosiy/i.test(clean)) {
    kategoriya = "Asosiy o'qituvchilar"
    lavozim = "O'qituvchi"
  } else if (/o['‘`]?rindosh/i.test(clean)) {
    kategoriya = "O'rindosh o'qituvchilar"
    lavozim = "O'qituvchi"
  } else if (/shtat/i.test(clean)) {
    kategoriya = "ShTAT - xodimlar"
    lavozim = "Xodim"
  }

  // Mutaxassislik
  let mutaxassislik = ''
  const specMatch = clean.match(/(hamshiralik\s*ishi|davolash\s*ishi|farmatsiya|pediatriya|informatika|ona\s*tili|ingliz\s*tili|biologiya|kimyo|tarix)/i)
  if (specMatch) mutaxassislik = specMatch[0]

  // 7. Ism-familiya topish (vergul yoki bosh qismidan)
  let fish = ''
  let ism = ''
  let ota = ''

  const parts = clean.split(/[,\n]/).map((p) => p.trim()).filter(Boolean)
  // Birinchi bo'lak odatda F.I.SH bo'ladi
  if (parts.length > 0 && !/\d{4,}/.test(parts[0])) {
    fish = parts[0]
  } else {
    // Regex orqali 2-4 ta so'z
    const nameMatch = clean.match(/\b([A-ZА-ЯЁO‘`ʼG‘][a-zа-яёo‘`ʼg‘]+(?:\s+[A-ZА-ЯЁO‘`ʼG‘][a-zа-яёo‘`ʼg‘]+){1,3})\b/)
    if (nameMatch) fish = nameMatch[1]
  }

  if (fish) {
    const words = fish.split(/\s+/)
    if (words.length >= 2) {
      ism = `${words[0]} ${words[1]}`
      if (words.length >= 3) {
        ota = words.slice(2).join(' ')
      }
    } else {
      ism = fish
    }
  }

  // Kamida bitta asosiy identifikator bo'lishi kerak
  if (!fish && !pv && !pinfl) return null

  return {
    fish,
    ism,
    ota,
    pv,
    pinfl,
    dob,
    tel,
    group,
    kategoriya,
    lavozim,
    mutaxassislik,
  }
}
