import type { NextRequest } from 'next/server'
import { GET as shareGet, POST as sharePost } from '../share/route'

/*
  O'qituvchi havolasi (/baholar/ulashilgan?token=...) uchun OCHIQ API — login so'ralmaydi (proxy.ts).
  Faqat token bilan ishlaydigan ikki amal o'tkaziladi: baholarni o'qish va saqlash.
  Havolalarni yaratish/o'chirish/ro'yxati (admin) — /api/baholar/share da, kirish talab qiladi.
*/

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status })

export async function GET(req: NextRequest) {
  if (!new URL(req.url).searchParams.get('token')?.trim()) return fail("Havola manzili to'liq emas (token yo'q)")
  return shareGet(req)
}

export async function POST(req: NextRequest) {
  const body = await req.clone().json().catch(() => null)
  if (!body || body.action !== 'saveTeacherGrades' || typeof body.token !== 'string' || !body.token.trim()) {
    return fail("Noma'lum so'rov", 403)
  }
  return sharePost(req)
}
