import { translateInstitutions, type TarjimaItem } from '@/lib/server/qabul-translate'

/*
  QABUL shabloni: qoidalar (lib/qabul.ts) tanimagan o'quv muassasasi nomlarini AI orqali
  tarjima qilish. Tartib qat'iy — har bosqich oldingisining natijasiga tayanadi
  (lib/server/qabul-translate.ts): rasmiy o'zbekcha → ruscha → inglizcha.
  Kalit: OPENROUTER_API_KEY (lib/ai-analyze bilan bir xil).
*/

export const maxDuration = 60

export async function POST(request: Request) {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return Response.json({ success: false, error: "OPENROUTER_API_KEY sozlanmagan" }, { status: 503 })

  const body = (await request.json().catch(() => null)) as { items?: unknown } | null
  const items: TarjimaItem[] = (Array.isArray(body?.items) ? body.items : [])
    .filter((x): x is TarjimaItem => !!x && typeof (x as TarjimaItem).uz === 'string' && !!(x as TarjimaItem).uz.trim())
    .slice(0, 40)
    .map((x) => ({ uz: x.uz.trim().slice(0, 300), hudud: String(x.hudud ?? '').slice(0, 100), turi: String(x.turi ?? '').slice(0, 30) }))
  if (!items.length) return Response.json({ success: false, error: 'Nom yuborilmadi' }, { status: 400 })

  try {
    return Response.json({ success: true, results: await translateInstitutions(key, items) })
  } catch (e) {
    return Response.json({ success: false, error: `AI tarjima qila olmadi (${(e as Error).message})` }, { status: 502 })
  }
}
