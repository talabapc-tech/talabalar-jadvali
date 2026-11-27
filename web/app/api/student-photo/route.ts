import { invalidateCache } from '@/lib/server/source'
import { deleteStudentPhoto, loadPhotoIndex, uploadStudentPhoto } from '@/lib/server/student-photos'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const idx = await loadPhotoIndex()
    return Response.json({ ok: true, count: Object.keys(idx.items).length })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: 'Rasm fayli yuborilmadi' }, { status: 400 })
    }
    const rowRaw = form.get('row')
    const row = rowRaw != null && String(rowRaw).trim() !== '' ? Number(rowRaw) : undefined
    const pinfl = String(form.get('pinfl') ?? '').trim()
    const fish = String(form.get('fish') ?? '').trim()

    const buffer = Buffer.from(await file.arrayBuffer())
    const rec = await uploadStudentPhoto({ row, pinfl, fish, buffer })
    invalidateCache()

    return Response.json({
      ok: true,
      photo_url: rec.url,
      updatedAt: rec.updatedAt,
    })
  } catch (e) {
    const msg = (e as Error).message || 'Rasm yuklashda xatolik'
    const status = /5 MB|JPG|PNG|WebP|bo'sh|identifikatori/i.test(msg) ? 400 : 500
    return Response.json({ ok: false, error: msg }, { status })
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      row?: unknown
      pinfl?: unknown
      fish?: unknown
    } | null
    if (!body) {
      return Response.json({ ok: false, error: "So'rov ma'lumoti noto'g'ri" }, { status: 400 })
    }
    const row = body.row != null && String(body.row).trim() !== '' ? Number(body.row) : undefined
    const pinfl = String(body.pinfl ?? '').trim()
    const fish = String(body.fish ?? '').trim()

    const deleted = await deleteStudentPhoto({ row, pinfl, fish })
    invalidateCache()
    return Response.json({ ok: true, deleted })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message || "Rasmni o'chirishda xatolik" }, { status: 500 })
  }
}
