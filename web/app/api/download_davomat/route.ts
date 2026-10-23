import type { NextRequest } from 'next/server'
import { readRepoFileIn } from '@/lib/server/source'
import { TG_BOT_TOKEN, TG_CHAT_ID, tgSendDocument } from '@/lib/server/telegram'

/**
 * Tayyor hisobotlarni (rollar bo'yicha Excel, qabul shabloni, kontraktlar) yuklab olish / Telegramga yuborish:
 * GET  /api/download_davomat?role=buxgalteriya|admin|guruh_rahbari|toliq|qabul_shablon
 *      /api/download_davomat?type=qabul_group&group=26-01 | type=contracts
 * POST /api/download_davomat  { type?: string, role?: string, chatId?: string }
 * (Manzil nomi eski — /api/download_export ham shu yerga ulangan. Davomat jurnallari va
 *  so'rovnoma hisobotlari olib tashlangan; so'rovnoma ma'lumotlari talaba kartochkasida va
 *  "4. To'liq ma'lumotlar bazasi" Excel'ida qoladi.)
 */
export async function GET(request: NextRequest) {
  const type = (request.nextUrl.searchParams.get('type') || '').toLowerCase().trim()
  const role = (request.nextUrl.searchParams.get('role') || '').toLowerCase().trim()
  const group = (request.nextUrl.searchParams.get('group') || '').trim()

  let fileName = ''
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const dirs = [
    'Kontraktlar',
    'hisobotlar/rollar',
    'hisobotlar/qabul',
    'hisobotlar/qabul/guruhlar',
    'hisobotlar',
    '',
  ]

  // 1. Rollar bo'yicha .xlsx eksportlar
  if (role === 'buxgalteriya' || role === '1') {
    fileName = '1_Buxgalteriya_Shartnoma_va_Pasport.xlsx'
  } else if (role === 'admin' || role === 'baza_admin' || role === '2') {
    fileName = '2_Baza_Admin_Pasport_va_Shahodatnoma.xlsx'
  } else if (role === 'guruh_rahbari' || role === 'guruh_rahbarlari' || role === '3') {
    fileName = '3_Guruh_Rahbarlari_Talabalar_Malumotlari.xlsx'
  } else if (role === 'toliq' || role === '4') {
    fileName = '4_Toliq_Malumotlar_Bazasi.xlsx'
  } else if (role === 'qabul_shablon' || role === 'qabul') {
    fileName = 'QABUL - 2026.xlsx'
  }
  // 2. Turlar bo'yicha hisobotlar
  else if (type === 'qabul_group' && group) {
    fileName = `QABUL - 2026 (${group}).xlsx`
  } else if (type === 'contracts_file' || type === '02.10') {
    fileName = '02.10.2026_GACHA_KONTRAKTLAR.xlsx'
  } else if (type === 'contracts' || type === 'kontraktlar' || role === 'contracts') {
    fileName = '02.10.2026_GACHA_KONTRAKTLAR.xlsx'
  }

  if (!fileName) {
    return Response.json({ error: "Hisobot turi noto'g'ri yoki ko'rsatilmagan (role= yoki type=)" }, { status: 400 })
  }
  const buf = await readRepoFileIn(dirs, fileName)
  if (!buf) {
    return Response.json({ error: `${fileName} fayli topilmadi` }, { status: 404 })
  }

  const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_')
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    if (!TG_BOT_TOKEN) {
      return Response.json({ error: 'TELEGRAM_BOT_TOKEN sozlanmagan' }, { status: 500 })
    }
    const body = await request.json().catch(() => ({}))
    const r = (body.role || '').toLowerCase().trim()
    const chatId = body.chatId || TG_CHAT_ID

    let fileName = ''
    let caption = ''
    const dirs = [
      'hisobotlar/rollar',
      'hisobotlar/qabul',
      'hisobotlar/qabul/guruhlar',
      'hisobotlar',
      '',
    ]

    if (r === 'buxgalteriya' || r === '1') {
      fileName = '1_Buxgalteriya_Shartnoma_va_Pasport.xlsx'
      caption = "📊 <b>1. Buxgalteriya (Shartnoma № va Pasport) (.xlsx)</b>\nBarcha 19 ta guruh sahifalari bilan"
    } else if (r === 'guruh_rahbari' || r === '3') {
      fileName = '3_Guruh_Rahbarlari_Talabalar_Malumotlari.xlsx'
      caption = "📊 <b>3. Guruh Rahbarlari Uchun Ma'lumotlar (.xlsx)</b>\nTug'ilgan sana, pasport, shahodatnoma va barcha guruhlar"
    } else if (r === 'toliq' || r === '4') {
      fileName = '4_Toliq_Malumotlar_Bazasi.xlsx'
      caption = "📊 <b>4. To'liq Ma'lumotlar Bazasi (.xlsx)</b>\nBarcha ustunlar jamlangan to'liq hisobot"
    } else if (r === 'qabul_shablon' || r === 'qabul') {
      fileName = 'QABUL - 2026.xlsx'
      caption = "📋 <b>QABUL - 2026 Rasmiy Admin Shabloni (.xlsx)</b>\n180 nafar 1-kurs talabalari rasmiy tarjimalari bilan"
    }

    if (!fileName) {
      return Response.json({ error: "Hisobot turi noto'g'ri yoki ko'rsatilmagan" }, { status: 400 })
    }
    const buf = await readRepoFileIn(dirs, fileName)
    if (!buf) {
      return Response.json({ error: `${fileName} fayli topilmadi` }, { status: 404 })
    }

    await tgSendDocument(chatId, buf, fileName, caption)
    return Response.json({ ok: true, file: fileName })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
