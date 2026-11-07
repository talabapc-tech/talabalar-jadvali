import 'server-only'

/*
  QABUL shabloni uchun AI tarjima (OpenRouter) — /api/ai-translate (portal) va Telegram bot
  (lib/server/qabul-xlsx.ts) umumiy ishlatadi. Kalit: OPENROUTER_API_KEY.
*/

export interface TarjimaItem { uz: string; hudud?: string; turi?: string }

const MODELS = ['anthropic/claude-haiku-5.5', 'google/gemini-3.8-flash', 'google/gemini-2.5-flash']

const STEP_UZ = `Sen O'zbekiston ta'lim muassasalari nomlarini rasmiy hujjatlarga moslab yozadigan mutaxassissan.
Har bir nomni O'zbekiston Respublikasida rasmiy qabul qilingan o'zbekcha (lotin yozuvi) shaklga keltir:
- imlo va apostroflarni to'g'rila (o', g', '), kelishik qo'shimchalarini olib tashla ("maktabini" → "maktabi");
- raqamli nomlarni rasmiy shaklda yoz ("14-sonli umumiy o'rta ta'lim maktabi");
- "shahar"/"tuman" → rasmiy "shahri"/"tumani" ("Shahrisabz shahri", "Kitob tumani");
- viloyat nomini QO'SHMA ("Qashqadaryo viloyati" yozilmaydi);
- "hudud" faqat yordamchi: nomda HECH QANDAY joy nomi (shahar, tuman yoki muassasa nomidagi joy) bo'lmasagina tuman/shaharni boshiga qo'sh;
- mazmunni o'zgartirma, yangi ma'lumot to'qima.`

const STEP_RU = `Sen O'zbekistondagi rasmiy hujjatlar uchun o'zbekchadan ruschaga tarjimon (ta'lim muassasalari nomlari)san.
Har bir rasmiy o'zbekcha nomni O'zbekiston Respublikasida qabul qilingan rasmiy ruscha shaklga o'gir:
- tuman/shahar nomlari rasmiy ruscha ("Китабский район", "город Шахрисабз", "Яккабагский район");
- "N-sonli umumiy o'rta ta'lim maktabi" → "Общеобразовательная школа №N", "kasb-hunar kolleji" → "профессиональный колледж";
- o'zbekcha nomda yo'q narsani (masalan viloyatni) qo'shma.`

const STEP_EN = `Sen O'zbekistondagi rasmiy hujjatlar uchun ta'lim muassasalari nomlarini inglizchaga tarjima qiluvchisan.
Har bir nomni rasmiy o'zbekcha va ruscha shakllariga tayanib inglizchaga o'gir:
- joy nomlari o'zbek lotin yozuvi asosida ("Kitob District", "Shahrisabz City"), viloyatlar — "Kashkadarya Region";
- "General Secondary School No. N", "Vocational College", "Academic Lyceum", "Technical School";
- o'zbekcha nomda yo'q narsani (masalan viloyatni) qo'shma.`

async function ask(key: string, system: string, payload: unknown, count: number): Promise<string[]> {
  const prompt = `${system}

Kirish (JSON, tartib muhim):
${JSON.stringify(payload, null, 2)}

Faqat JSON massiv qaytar — aynan ${count} ta satr, kirish tartibida, izohsiz: ["...", "..."]`
  let lastErr = ''
  for (const model of MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(40_000),
      })
      if (!res.ok) { lastErr = `${model}: ${res.status}`; continue }
      const raw = String((await res.json())?.choices?.[0]?.message?.content ?? '')
      const m = raw.match(/\[[\s\S]*\]/)
      const arr = m ? (JSON.parse(m[0]) as unknown[]) : []
      if (arr.length === count && arr.every((x) => typeof x === 'string' && x.trim())) return arr.map((x) => String(x).trim())
      lastErr = `${model}: ${arr.length}/${count} ta javob`
    } catch (e) {
      lastErr = `${model}: ${(e as Error).message}`
    }
  }
  throw new Error(lastErr)
}

export interface TarjimaNatija { source: string; uz: string; ru: string; en: string }

/** Tartib qat'iy: rasmiy o'zbekcha → ruscha → inglizcha. Xato bo'lsa Error tashlaydi. */
export async function translateInstitutions(key: string, items: TarjimaItem[]): Promise<TarjimaNatija[]> {
  const uz = await ask(key, STEP_UZ, items, items.length)
  const ru = await ask(key, STEP_RU, uz, items.length)
  const en = await ask(key, STEP_EN, uz.map((u, i) => ({ uz: u, ru: ru[i] })), items.length)
  return items.map((it, i) => ({ source: it.uz, uz: uz[i], ru: ru[i], en: en[i] }))
}
