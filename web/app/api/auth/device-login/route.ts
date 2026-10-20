import type { NextRequest } from 'next/server'
import {
  AUTH_COOKIE,
  authConfigured,
  createDeviceToken,
  createSessionToken,
  REMEMBER_SESSION_DAYS,
  verifyDeviceToken,
} from '@/lib/auth'

/*
  POST /api/auth/device-login { deviceToken }
  Tanilgan qurilmani tekshiradi va qayta login/parol kiritmasdan avtomatik sessiya ochadi.
*/

export async function POST(request: NextRequest) {
  if (!authConfigured()) {
    return Response.json({ ok: false, error: "Kirish sozlanmagan" }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const token = String(body.deviceToken || '').trim()
  const verification = await verifyDeviceToken(token)

  if (!verification.ok || !verification.deviceId) {
    return Response.json({ ok: false, error: "Qurilma tanilmadi yoki uning muddati tugagan" }, { status: 401 })
  }

  // Tokenni yangilab beramiz (har kirishda yangi 1 yilga uzayadi)
  const now = Date.now()
  const newDeviceToken = await createDeviceToken(verification.deviceId, now)
  const sessionToken = await createSessionToken(now, REMEMBER_SESSION_DAYS)

  const res = Response.json({ ok: true, deviceToken: newDeviceToken })
  const https = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https'
  const secure = https ? '; Secure' : ''
  res.headers.append(
    'Set-Cookie',
    `${AUTH_COOKIE}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${REMEMBER_SESSION_DAYS * 86400}${secure}`
  )
  return res
}
