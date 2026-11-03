import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Ota papkada ham package.json bor — Turbopack ildizni adashtirmasin
  turbopack: { root: __dirname },
  // Dasturchi rejimidagi Next belgisi yon menyuni to'smasin
  devIndicators: { position: 'bottom-right' },
  // Ma'lumotnoma Word shabloni — diskdan o'qiladi, Vercel'ga ham tushsin
  outputFileTracingIncludes: {
    '/api/malumotnoma': ['./assets/malumotnoma/**/*'],
    '/api/telegram_webhook': ['./assets/malumotnoma/**/*'],
  },
}

export default nextConfig
