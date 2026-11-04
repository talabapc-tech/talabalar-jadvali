import type { NextRequest } from 'next/server'
import { buyruqBlocker, buyruqFileName, isBuyruqTur, type BuyruqFields } from '@/lib/buyruq'
import { renderBuyruq } from '@/lib/server/buyruq'
import { loadStudents } from '@/lib/server/source'
import { fullName } from '@/lib/student'
import { uzQuotes } from '@/lib/malumotnoma'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/*
  Talabalar bo'yicha buyruqlar (akademik ta'til, qayta tiklash, guruhdan guruhga o'tkazish,
  safdan chiqarish) — Word shabloni (assets/buyruqlar) asosida.

  GET ?row=99&tur=akademik_tatil&raqam=14-B&sana=04.11.2026&kurs=2&avvalgi=25-03
      [&yangi=25-04][&avvalgi_raqam=..&avvalgi_sana=..]            — .docx

  Talabaning F.I.SH i faqat bazadan olinadi — erkin ism qabul qilinmaydi.
*/

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  try {
    const row = Number(q.get('row'))
    const tur = q.get('tur')
    if (!Number.isInteger(row) || row <= 0) return Response.json({ error: "row noto'g'ri" }, { status: 400 })
    if (!isBuyruqTur(tur)) return Response.json({ error: "Buyruq turi noto'g'ri" }, { status: 400 })

    const fields: BuyruqFields = {
      tur,
      raqam: q.get('raqam') ?? '',
      sana: q.get('sana') ?? '',
      kurs: q.get('kurs') ?? '',
      avvalgiGuruh: q.get('avvalgi') ?? '',
      yangiGuruh: q.get('yangi') ?? '',
      avvalgiRaqam: q.get('avvalgi_raqam') ?? '',
      avvalgiSana: q.get('avvalgi_sana') ?? '',
    }
    const blocker = buyruqBlocker(fields)
    if (blocker) return Response.json({ error: blocker }, { status: 422 })

    const student = (await loadStudents()).find((s) => s.row === row)
    if (!student) return Response.json({ error: 'Talaba topilmadi' }, { status: 404 })
    if (!fullName(student)) return Response.json({ error: "Talabaning F.I.SH yo'q" }, { status: 422 })

    const file = await renderBuyruq(fullName(student), fields)
    const name = buyruqFileName(student, tur)
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': DOCX_MIME,
        'Content-Disposition': `attachment; filename="buyruq.docx"; filename*=UTF-8''${encodeURIComponent(uzQuotes(name)).replace(/'/g, '%27')}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
