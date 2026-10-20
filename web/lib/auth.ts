/*
  Portalga kirish (login + parol). Hisob faqat muhit o'zgaruvchilaridan — kodga yozilmaydi (repo ommaviy):
    PORTAL_LOGIN, PORTAL_PASSWORD           — Netlify → Environment variables, kompyuterda web/.env.local
    PORTAL_SESSION_SECRET (ixtiyoriy)       — bo'lmasa login+paroldan hosil qilinadi (parol o'zgarsa
                                              barcha eski sessiyalar o'zi bekor bo'ladi)
  Sessiya: HttpOnly cookie "<tugash_vaqti>.<HMAC-SHA256>". proxy.ts har so'rovda imzoni tekshiradi.
  Qurilmani tanib olish (Ishonchli qurilma):
    deviceToken "<tugash_vaqti>.<deviceId>.<HMAC-SHA256>". Brauzer localStorage'ida saqlanadi,
    cookie muddati tugasa ham foydalanuvchini qayta login kiritmasdan tanib oladi.
  Web Crypto ishlatiladi — proxy va route handler'larda bir xil ishlaydi.
*/

export const AUTH_COOKIE = 'portal_session'
export const SESSION_DAYS = 30
export const REMEMBER_SESSION_DAYS = 180
export const DEVICE_TOKEN_DAYS = 365

const enc = new TextEncoder()

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Kompyuterda o'zi ochilgan portal — login so'ralmaydi. Ikkala shart ham kerak:
 *  - internetdagi sayt emas (Netlify/Vercel muhit o'zgaruvchilari yo'q);
 *  - manzil localhost — tarmoqdagi boshqa qurilma IP orqali ochsa (100.x.x.x:3000) login so'raladi.
 * Netlify'da manzil har doim *.netlify.app, shuning uchun bu yerda hech qachon ochilmaydi.
 */
export function isLocalRequest(hostname: string): boolean {
  const deployed = !!(process.env.NETLIFY || process.env.SITE_ID || process.env.VERCEL)
  return !deployed && LOCAL_HOSTS.has(hostname.toLowerCase())
}

export function authConfigured(): boolean {
  return !!(process.env.PORTAL_LOGIN?.trim() && process.env.PORTAL_PASSWORD)
}

function secret(): string {
  return process.env.PORTAL_SESSION_SECRET?.trim() ||
    `session:${process.env.PORTAL_LOGIN?.trim() ?? ''}:${process.env.PORTAL_PASSWORD ?? ''}`
}

async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Uzunligi va mazmuni bo'yicha vaqtga bog'liq bo'lmagan taqqoslash */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

/** Login va parolni tekshirish (har ikkisi HMAC orqali — vaqt bo'yicha farq sezilmaydi) */
export async function checkCredentials(login: string, password: string): Promise<boolean> {
  if (!authConfigured()) return false
  const key = 'credentials-check'
  const [a, b, c, d] = await Promise.all([
    hmacHex(key, login.trim()), hmacHex(key, process.env.PORTAL_LOGIN!.trim()),
    hmacHex(key, password), hmacHex(key, process.env.PORTAL_PASSWORD!),
  ])
  return safeEqual(a, b) && safeEqual(c, d)
}

export async function createSessionToken(now = Date.now(), days = SESSION_DAYS): Promise<string> {
  const exp = now + days * 24 * 3600 * 1000
  return `${exp}.${await hmacHex(secret(), `portal:${exp}`)}`
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !authConfigured()) return false
  const [expStr, sig] = token.split('.')
  const exp = Number(expStr)
  if (!sig || !Number.isFinite(exp) || exp < now) return false
  return safeEqual(sig, await hmacHex(secret(), `portal:${exp}`))
}

/** Qurilmani tanib olish uchun xavfsiz token (1 yil amal qiladi) */
export async function createDeviceToken(deviceId: string, now = Date.now()): Promise<string> {
  const exp = now + DEVICE_TOKEN_DAYS * 24 * 3600 * 1000
  const cleanId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'device'
  const sig = await hmacHex(secret(), `device:${cleanId}:${exp}`)
  return `${exp}.${cleanId}.${sig}`
}

/** Qurilma tokenini tekshirish */
export async function verifyDeviceToken(token: string | undefined, now = Date.now()): Promise<{ ok: boolean; deviceId?: string }> {
  if (!token || !authConfigured()) return { ok: false }
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false }
  const [expStr, deviceId, sig] = parts
  const exp = Number(expStr)
  if (!sig || !deviceId || !Number.isFinite(exp) || exp < now) return { ok: false }
  const expectedSig = await hmacHex(secret(), `device:${deviceId}:${exp}`)
  if (!safeEqual(sig, expectedSig)) return { ok: false }
  return { ok: true, deviceId }
}
