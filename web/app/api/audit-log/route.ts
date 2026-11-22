import { loadAuditLog } from '@/lib/server/source'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await loadAuditLog()
    return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
