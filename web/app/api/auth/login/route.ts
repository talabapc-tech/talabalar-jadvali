import type { NextRequest } from 'next/server'
import {
  AUTH_COOKIE,
  authConfigured,
  checkCredentials,
  createDeviceToken,
  createSessionToken,
  REMEMBER_SESSION_DAYS,
  SESSION_DAYS,
} from '@/lib/auth'

/*
  POST /api/auth/login  { login, password, rememberDevice?: boolean, deviceId?: string }
  Parolni terib ko'rishni sekinlashtirish: noto'g'ri urinishda 1 s kutish va bitta IP dan
  15 daqiqada 10 tadan ortiq xato urinish bloklanadi (funksiya nusxasi xotirasida).
*/

const WINDOW_MS = 15 * 60_000
const MAX_FAILS = 10
const fails = new Map<string, { n: number; until: number }>()

function clientIp(request: NextRequest) {
  return request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

export async function POST(request: NextRequest) {
  if (!authConfigured()) {
    return Response.json({ ok: false, error: "Kirish sozlanmagan: PORTAL_LOGIN va PORTAL_PASSWORD o'rnatilmagan" }, { status: 503 })
  }
  const ip = clientIp(request)
  const now = Date.now()
  const f = fails.get(ip)
  if (f && f.until > now && f.n >= MAX_FAILS) {
    return Response.json({ ok: false, error: "Juda ko'p noto'g'ri urinish. 15 daqiqadan keyin qayta urinib ko'ring." }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const ok = await checkCredentials(String(body.login ?? ''), String(body.password ?? ''))
  if (!ok) {
    const cur = f && f.until > now ? f : { n: 0, until: now + WINDOW_MS }
    fails.set(ip, { n: cur.n + 1, until: cur.until })
    await new Promise((r) => setTimeout(r, 1000))
    return Response.json({ ok: false, error: "Login yoki parol noto'g'ri" }, { status: 401 })
  }

  fails.delete(ip)

  const rememberDevice = Boolean(body.rememberDevice)
  const days = rememberDevice ? REMEMBER_SESSION_DAYS : SESSION_DAYS
  const sessionToken = await createSessionToken(now, days)

  let deviceToken: string | undefined
  if (rememberDevice) {
    const rawDeviceId = String(body.deviceId || '').trim() || crypto.randomUUID()
    deviceToken = await createDeviceToken(rawDeviceId, now)
  }

  const res = Response.json({ ok: true, deviceToken })
  const https = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https'
  const secure = https ? '; Secure' : ''
  res.headers.append('Set-Cookie',
    `${AUTH_COOKIE}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${secure}`)
  return res
}
