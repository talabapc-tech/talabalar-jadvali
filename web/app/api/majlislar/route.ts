import type { NextRequest } from 'next/server'
import { deleteMajlis, loadMajlisDb, saveMajlis, saveOqituvchilar } from '@/lib/server/majlis-store'

/*
  Majlislar davomati (o'qituvchilar: asosiy va o'rindosh) — data/majlislar.json
  GET                                    → { oqituvchilar, majlislar }
  POST { action: 'save', majlis }        → majlisni qo'shish / yangilash
  POST { action: 'delete', id }          → majlisni o'chirish
  POST { action: 'teachers', oqituvchilar } → o'qituvchilar ro'yxatini saqlash
  Kirish: portal cookie'si yoki Telegram Mini App initData (proxy.ts).
*/

const err = (e: unknown, status = 500) => Response.json({ ok: false, error: (e as Error).message || String(e) }, { status })

export async function GET() {
  try {
    return Response.json({ ok: true, ...(await loadMajlisDb()) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return err(e)
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return err(new Error("So'rov noto'g'ri"), 400)
  try {
    switch (body.action) {
      case 'save':
        return Response.json({ ok: true, majlis: await saveMajlis(body.majlis) })
      case 'delete':
        await deleteMajlis(String(body.id ?? ''))
        return Response.json({ ok: true })
      case 'teachers':
        return Response.json({ ok: true, ...(await saveOqituvchilar(body.oqituvchilar)) })
      default:
        return err(new Error(`Noma'lum amal: ${body.action}`), 400)
    }
  } catch (e) {
    return err(e)
  }
}
