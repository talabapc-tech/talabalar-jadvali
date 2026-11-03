import { NextRequest } from 'next/server'
import { isPinfl } from '@/lib/baholar'
import { loadStudentOrders, saveStudentOrder } from '@/lib/server/baholar-shares'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const guruh = searchParams.get('guruh')
    if (!guruh) return Response.json({ ok: false, error: 'Guruh kerak' }, { status: 400 })

    const orders = await loadStudentOrders()
    const order = orders[guruh.trim()] || []
    return Response.json({ ok: true, order }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { guruh, order } = body
    if (typeof guruh !== 'string' || !guruh.trim() || !Array.isArray(order)) {
      return Response.json({ ok: false, error: 'Guruh va order massivi kerak' }, { status: 400 })
    }
    // Faqat JSHSHIR (14 raqam), takrorlarsiz
    const clean = [...new Set(order.filter(isPinfl))].slice(0, 500)

    await saveStudentOrder(guruh.trim(), clean)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
