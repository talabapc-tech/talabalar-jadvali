import { AI_MODELS } from '@/lib/ai-doc'

/*
  Pasport / ID-karta va shahodatnoma rasmlarini OpenRouter AI orqali o'qish.
  Kompyuterdagi Python xizmati (upload_student_section_files) ishlamaganda yoki
  yangi talaba rasmi uchun ishlatiladi — eski portaldagi brauzer AI zaxirasi o'rnida,
  lekin kalit brauzerga chiqmaydi: OPENROUTER_API_KEY muhit o'zgaruvchisidan olinadi.
  Prompt xizmatlar/telegram_sync_service.py dagi bilan bir xil.
*/

export const maxDuration = 60

const PROMPT = `Sen professional O'zbekiston ID-karta, Biometrik pasport va Shahodatnoma/Diplom o'quvchisisan.
Ushbu rasmlarni juda sinchiklab tahlil qil va talabaning haqiqiy ma'lumotlarini chiqargin.

Qat'iy Qoidalar:
1. Pasport/ID seriya va raqami:
   - ID-karta: 'AD' yoki 'AE' harflari va KETMA-KET ANIQ 7 TA RAQAM (jami 9 ta belgi!). Masalan: AD1234567, AE4629898.
   - Biometrik pasport: 'AA', 'AB', 'AC', 'FA' va 7 ta raqam.
   - Hech qachon 8 ta yoki 6 ta raqam yozma!
2. JSHSHIR (PINFL):
   - ID-karta yoki pasport pastidagi/orqasidagi ANIQ 14 xonali raqam!
   - MUHIM MRZ QOIDASI: Biometrik pasportning pastki MRZ qatorida (masalan: AB63041584UZB9807154F270327641507985590024<52) 'UZB' dan keyin keladigan tug'ilgan sana (YYMMDD) va amal qilish sanasi (F2703276) raqamlarini JSHSHIR bilan ASLO adashtirma! Haqiqiy 14 xonali JSHSHIR amal qilish sanasidan KEYIN keladi va HAR DOIM 3, 4, 5 yoki 6 raqami + tug'ilgan sana (DDMMYY, masalan 15.07.1998 da tug'ilgan ayol uchun '41507985590024') bilan boshlanadi!
3. Tug'ilgan sana (DOB):
   - Pasportdagi tug'ilgan sana (DD.MM.YYYY).
4. Pasport BERILGAN SANASI (Date of issue):
   - FAQAT Pasport yoki ID-karta berilgan sanasi (Date of issue: DD.MM.YYYY).
   - Shahodatnoma sanasini yoki kelajak sanani EMAS!
5. Shahodatnoma yoki Diplom:
   - Hujjat turi: Maktab bo'lsa 'Shahodatnoma', Kollej/Litsey/Texnikum bo'lsa 'Diplom'
   - Seriya va raqami: Masalan 'UM 03729356' yoki 'T-V 123456'
   - Maktab/Muassasa nomi: Maktab yoki Kollejning to'liq nomi
   - Bitirgan yili: Masalan '2024'
6. Rasmda ko'rinmagan maydonni bo'sh qoldir ("") — taxmin qilma.

Aniq JSON formatda qaytar:
{
  "ism": "Familiya Ism",
  "ota": "... qizi / ... o'g'li",
  "pass_ser": "AE1234567",
  "pinfl": "14 xonali PINFL (3/4/5/6 + DDMMYY bilan boshlanuvchi)",
  "mrz_line2": "Agar pasport MRZ qatori ko'rinsa, 2-qatorni to'liq yoz",
  "dob": "DD.MM.YYYY",
  "pass_ber": "DD.MM.YYYY",
  "tel": "+998...",
  "sh_doc": "UM 1234567",
  "doc_tur": "Shahodatnoma",
  "maktab": "...-maktab",
  "yil": "2024"
}`

// Tanlangan model javob bermasa — navbatdagilari (Python: AI_FALLBACK_MODELS)
const FALLBACK_MODELS = ['google/gemini-3.8-flash', 'anthropic/claude-haiku-5.5', 'google/gemini-2.5-flash']

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { model?: unknown; images?: unknown; openrouterKey?: unknown } | null
  const customKey = typeof body?.openrouterKey === 'string' ? body.openrouterKey.trim() : ''
  const key = customKey || request.headers.get('x-openrouter-key') || process.env.OPENROUTER_API_KEY
  if (!key) {
    return Response.json(
      { success: false, error: "AI sozlanmagan: OPENROUTER_API_KEY yo'q (Sozlamalar oynasida yoki Vercel Environment variables'da kiriting)" },
      { status: 503 },
    )
  }

  const images = (Array.isArray(body?.images) ? body.images : [])
    .filter((s): s is string => typeof s === 'string' && s.startsWith('data:image/'))
    .slice(0, 6)
  if (!images.length) return Response.json({ success: false, error: 'Rasm yuborilmadi' }, { status: 400 })

  const rawModel = typeof body?.model === 'string' ? body.model.trim() : ''
  const picked = rawModel || FALLBACK_MODELS[0]
  const models = [picked, ...FALLBACK_MODELS.filter((m) => m !== picked)]
  const content = [{ type: 'text', text: PROMPT }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]

  let lastErr = ''
  for (const model of models) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content }] }),
        signal: AbortSignal.timeout(45_000),
      })
      if (!res.ok) {
        lastErr = `${model}: ${res.status} ${(await res.text()).slice(0, 120)}`
        continue
      }
      const json = await res.json()
      const raw = String(json?.choices?.[0]?.message?.content ?? '')
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) {
        lastErr = `${model}: JSON qaytarmadi`
        continue
      }
      const data = JSON.parse(m[0]) as Record<string, unknown>

      // Python xizmatidagi kabi tuzatishlar: seriya 2 harf + 7 raqam, JSHSHIR MRZ dan
      const pv = String(data.pass_ser ?? '').toUpperCase().replace(/\s/g, '').match(/([A-Z]{2})(\d{7})/)
      if (pv) data.pass_ser = pv[1] + pv[2]
      const mrz = String(data.mrz_line2 ?? '').toUpperCase().replace(/\s/g, '').match(/[MF]\d{7}([3456]\d{13})/)
      if (mrz) data.pinfl = mrz[1]

      return Response.json({ success: true, model, data })
    } catch (e) {
      lastErr = `${model}: ${(e as Error).message}`
    }
  }
  return Response.json({ success: false, error: `AI javob bermadi (${lastErr})` }, { status: 502 })
}
