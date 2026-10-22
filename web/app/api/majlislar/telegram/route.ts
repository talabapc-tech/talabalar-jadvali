import type { NextRequest } from 'next/server'
import { TG_INIT_HEADER, verifyTelegramInitData } from '@/lib/auth'
import { TG_BOT_TOKEN, TG_CHAT_ID, tgCall, tgSendDocument } from '@/lib/server/telegram'

/*
  POST /api/majlislar/telegram  (multipart: text, file?)
  Majlis davomati matni va Excel faylini Telegram'ga yuborish. Mini App'dan ochilgan bo'lsa —
  ochgan xodimning o'ziga, portaldan — asosiy hisobot chatiga (TELEGRAM_CHAT_ID).
*/

export async function POST(request: NextRequest) {
  if (!TG_BOT_TOKEN) return Response.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN sozlanmagan' }, { status: 503 })
  try {
    const user = await verifyTelegramInitData(request.headers.get(TG_INIT_HEADER))
    const chatId = user ? String(user.id) : TG_CHAT_ID
    const fd = await request.formData()
    const text = String(fd.get('text') || '').slice(0, 16_000)
    const file = fd.get('file') as File | null

    // Hisobot bo'limlari bo'sh qator bilan ajratilgan — Telegram 4096 belgidan oshsa bo'limlar bo'yicha
    // bo'linadi (<pre> jadvali o'rtasidan kesilmaydi)
    const chunks: string[] = []
    for (const block of text.split('\n\n')) {
      const last = chunks.length - 1
      if (last >= 0 && chunks[last].length + block.length + 2 <= 3900) chunks[last] += `\n\n${block}`
      else chunks.push(block)
    }
    for (const chunk of chunks.filter((c) => c.trim())) {
      const r = await tgCall('sendMessage', { chat_id: chatId, text: chunk, parse_mode: 'HTML', disable_web_page_preview: true })
      if (!r.ok) throw new Error(r.description || 'Xabar yuborilmadi')
    }
    if (file && file.size) {
      await tgSendDocument(chatId, Buffer.from(await file.arrayBuffer()), file.name, '')
    }
    return Response.json({ ok: true, to: user ? 'siz' : 'hisobot chati' })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 })
  }
}
