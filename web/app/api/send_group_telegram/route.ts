import type { NextRequest } from 'next/server'
import { applyGroupSettings } from '@/lib/config'
import { groupListFileName, groupListInput, renderGroupListPng } from '@/lib/server/guruh-rasm'
import { loadGroupSettings, loadStudents } from '@/lib/server/source'
import { tashkentStamp, TG_BOT_TOKEN, TG_CHANNEL_ID, TG_CHAT_ID, tgEsc as esc, tgSendPhoto } from '@/lib/server/telegram'

/**
 * Guruh ro'yxati rasmini Telegram kanalga va/yoki botga yuborish:
 * POST /api/send_group_telegram
 * Body: { groups: string[], target: 'channel' | 'bot' | 'both' }
 *
 * Rasm botdagi "👥 Guruhlar ro'yxati" bilan bir xil (lib/server/guruh-rasm) — har safar jonli
 * ma'lumotdan chiziladi, shuning uchun to'liq va yangi. Ilgari hisobotlar/pdf_jurnallar dagi
 * tayyor JPG yuborilardi — u faqat Python hisobot yasalganda yangilanardi.
 */

/** "akademik" / "safdan" va eski nomlar ("...chiqarilganlar", "Akademik ta'til...") — bitta kalitga */
function listKey(group: string) {
  const g = String(group ?? '').trim()
  const low = g.toLowerCase()
  if (g === 'safdan' || low.includes('chiqaril')) return 'safdan'
  if (g === 'akademik' || low.includes('akademik')) return 'akademik'
  return g
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { groups, target = 'both' } = body as { groups: string[]; target?: 'channel' | 'bot' | 'both' }

    if (!Array.isArray(groups) || !groups.length) {
      return Response.json({ error: "Guruhlar ro'yxati berilmadi" }, { status: 400 })
    }

    if (!TG_BOT_TOKEN) {
      return Response.json({ error: 'TELEGRAM_BOT_TOKEN sozlanmagan' }, { status: 500 })
    }

    const dests: { id: string; label: string }[] =
      target === 'both'
        ? [{ id: TG_CHANNEL_ID, label: 'Kanal' }, { id: TG_CHAT_ID, label: 'Shaxsiy bot' }]
        : target === 'bot'
          ? [{ id: TG_CHAT_ID, label: 'Shaxsiy bot' }]
          : [{ id: TG_CHANNEL_ID, label: 'Kanal' }]

    const [allStudents, groupSettings] = await Promise.all([loadStudents(), loadGroupSettings()])
    // Rahbar va yo'nalish rasmda saytdagi "Guruh sozlamalari" bo'yicha chiqsin
    applyGroupSettings(groupSettings)
    const { stamp } = tashkentStamp()

    const sent: string[] = []
    const failed: string[] = []

    for (const group of groups) {
      const gTrim = String(group ?? '').trim()
      const key = listKey(gTrim)
      const input = groupListInput(key, allStudents, stamp)
      if (!input) {
        failed.push(`${gTrim} (talaba topilmadi)`)
        continue
      }

      let png: Buffer
      try {
        png = await renderGroupListPng(input)
      } catch (err) {
        failed.push(`${gTrim} (rasm chizilmadi: ${(err as Error).message})`)
        continue
      }

      const caption = [
        `📋 <b>${esc(input.title)}</b> — ${input.students.length} nafar`,
        input.special ? `<i>${esc(input.subtitle)}</i>` : `📚 ${esc(input.subtitle)}`,
        ...(input.leader ? [`👤 <b>Guruh rahbari:</b> ${esc(input.leader)}`] : []),
        `🏛 <b>Shahrisabz Tibbiyot Texnikumi</b>`,
        `🕒 ${stamp}`,
      ].join('\n')

      let groupSentOk = false
      for (const dest of dests) {
        try {
          await tgSendPhoto(dest.id, png, groupListFileName(key), caption)
          groupSentOk = true
        } catch (err) {
          const errMsg = (err as Error).message || ''
          if (dest.label === 'Kanal' && errMsg.includes('chat not found')) {
            console.warn(`[Telegram] ${gTrim} kanalga yuborilmadi: @shartnoma_editor_bot kanal admini qilinmagan.`)
            if (target !== 'both') {
              failed.push(`${gTrim} (Kanalda @shartnoma_editor_bot admin qilinmagan)`)
            }
          } else {
            failed.push(`${gTrim} -> ${dest.label}: ${errMsg}`)
          }
        }
      }

      if (groupSentOk) {
        sent.push(gTrim)
      }

      // Kichik tanaffus (Telegram rate limit ga tushmaslik uchun)
      if (groups.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
    }

    return Response.json({ ok: true, sent, failed })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}
