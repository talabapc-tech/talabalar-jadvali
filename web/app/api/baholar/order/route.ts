import { NextRequest } from 'next/server'
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
    if (!guruh || !Array.isArray(order)) {
      return Response.json({ ok: false, error: 'Guruh va order massivi kerak' }, { status: 400 })
    }

    await saveStudentOrder(String(guruh), order)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
