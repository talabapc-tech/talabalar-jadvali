/*
  Telegram bot va Mini App'dan foydalana oladigan chatlar: TELEGRAM_CHAT_ID + TELEGRAM_ALLOWED_IDS (vergul bilan).
  Alohida modul — proxy.ts (lib/auth.ts) ham, bot (lib/server/telegram.ts) ham bir xil ro'yxatni ko'rsin.
  node:crypto va server-only yo'q, shuning uchun proxy qaysi muhitda ishlasa ham ulanadi.
*/

export const tgChatId = () => process.env.TELEGRAM_CHAT_ID?.trim() || '8135594558'

export function tgAllowedIds(): Set<string> {
  return new Set(
    [tgChatId(), ...(process.env.TELEGRAM_ALLOWED_IDS || '').split(/[\s,;]+/)].map((s) => s.trim()).filter(Boolean),
  )
}
