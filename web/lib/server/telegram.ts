import 'server-only'
import { createHash } from 'node:crypto'
import { tgAllowedIds, tgChatId } from '@/lib/tg-ids'

/** Bot tokeni va hisobot chati — rasmiy bot: @new_students_shtt_bot.
 *  Token faqat muhit o'zgaruvchisidan (Netlify → Environment variables yoki .env.local) — kodga yozilmaydi, repo ommaviy. */
export const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
export const TG_CHAT_ID = tgChatId()
export const TG_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID?.trim() || '-1004375713276'

/** Botdan foydalanishga ruxsat berilgan chatlar: TELEGRAM_CHAT_ID + TELEGRAM_ALLOWED_IDS (vergul bilan).
 *  Bot pasport, JSHSHIR va telefonlarni beradi — begona odamga javob bermasligi shart. */
export const TG_ALLOWED_IDS = tgAllowedIds()

/** Webhook maxfiy kaliti: Telegram har so'rovda X-Telegram-Bot-Api-Secret-Token sarlavhasida yuboradi.
 *  Alohida o'rnatilmasa tokendan hosil qilinadi — yangi token qo'yilganda o'zi yangilanadi. */
export const TG_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ||
  (TG_BOT_TOKEN ? createHash('sha256').update(`webhook:${TG_BOT_TOKEN}`).digest('hex').slice(0, 48) : '')

/** Kunlik hisobotlarni (?action=kontingent / backup_json) chaqirish kaliti — netlify/functions/kunlik-*.mts
 *  ham xuddi shunday hisoblaydi. Kalitsiz begona odam chatga hisobot yubora olmaydi. */
export const TG_REPORT_KEY = TG_BOT_TOKEN ? createHash('sha256').update(`report:${TG_BOT_TOKEN}`).digest('hex').slice(0, 32) : ''

/** Saytning asosiy manzili. Netlify so'rovni ba'zan deploy nusxasi (abc123--sayt.netlify.app) orqali
 *  uzatadi — webhook unga ulansa, keyingi deploylar botga yetib bormaydi. */
export function siteOrigin(requestOrigin: string) {
  const env = process.env.URL?.trim()
  if (env?.startsWith('https://') && !env.includes('--')) return env.replace(/\/$/, '')
  return requestOrigin.replace(/^(https?:\/\/)[0-9a-f]{24}--/, '$1')
}

/** Telegram HTML rejimi uchun matnni xavfsiz qilish (<, >, & belgilari xabarni buzadi) */
export const tgEsc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Bot API usulini chaqirish (JSON) */
export async function tgCall(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch((e: Error) => ({ json: async () => ({ ok: false, description: e.message }) }))
  return res.json().catch(() => ({ ok: false, description: 'Telegram javobi o‘qilmadi' }))
}

/** JPG yoki PNG rasmni Telegram'ga rasm sifatida yuborish */
export async function tgSendPhoto(chatId: string | number, jpg: Buffer, fileName: string, caption: string, replyMarkup?: unknown) {
  const fd = new FormData()
  fd.append('chat_id', String(chatId))
  fd.append('caption', caption)
  fd.append('parse_mode', 'HTML')
  if (replyMarkup) fd.append('reply_markup', JSON.stringify(replyMarkup))
  const isPng = jpg[0] === 0x89 && jpg[1] === 0x50 // PNG
  fd.append('photo', new Blob([new Uint8Array(jpg)], { type: isPng ? 'image/png' : 'image/jpeg' }), fileName)
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: fd })
  const data = await res.json().catch(() => ({ ok: false }))
  if (!data.ok) throw new Error(data.description || `Telegram ${res.status} qaytardi`)
  return data
}

/** Hujjatni (.xlsx yoki .pdf) Telegram'ga yuborish */
export async function tgSendDocument(chatId: string | number, doc: Buffer, fileName: string, caption: string) {
  const fd = new FormData()
  fd.append('chat_id', String(chatId))
  fd.append('caption', caption)
  fd.append('document', new Blob([new Uint8Array(doc)]), fileName)
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd })
  const data = await res.json().catch(() => ({ ok: false }))
  if (!data.ok) throw new Error(data.description || `Telegram ${res.status} qaytardi`)
  return data
}
