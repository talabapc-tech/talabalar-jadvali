import type { NextRequest } from 'next/server'
import { loadStaff, saveStaff } from '@/lib/server/source'
import type { StaffMember } from '@/lib/staff'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const staff = await loadStaff()
    return Response.json({ ok: true, staff })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '').trim()
    const staff = await loadStaff()

    if (action === 'add') {
      const item = body.data as Partial<StaffMember>
      if (!item || !item.fish?.trim()) {
        return Response.json({ ok: false, error: "Xodim F.I.Sh kiritilishi shart" }, { status: 400 })
      }

      // Yangi xodim ID generatsiya qilish: X-001, X-002, ...
      const existingNums = staff
        .map((s) => {
          const m = s.id?.match(/(\d+)/)
          return m ? parseInt(m[1], 10) : 0
        })
        .filter((n) => n > 0)
      const nextNum = (existingNums.length ? Math.max(...existingNums) : 0) + 1
      const newId = item.id || `X-${String(nextNum).padStart(3, '0')}`

      const newMember: StaffMember = {
        id: newId,
        fish: item.fish.trim(),
        lavozim: (item.lavozim || 'Xodim').trim(),
        bolim: (item.bolim || "Ma'muriy").trim(),
        ish_turi: item.ish_turi || 'Shtat',
        stavka: item.stavka || '1.0',
        tel: (item.tel || '').trim(),
        pinfl: (item.pinfl || '').replace(/\s/g, '').trim(),
        pv: (item.pv || '').trim().toUpperCase(),
        dob: item.dob || '',
        ishga_sana: item.ishga_sana || '',
        boshan_sana: item.boshan_sana || '',
        maosh: item.maosh || '',
        soat_stavka: item.soat_stavka || '',
        status: item.status || 'faol',
        mutaxassislik: item.mutaxassislik || '',
        doc_file: item.doc_file || '',
        izoh: item.izoh || '',
      }

      staff.push(newMember)
      await saveStaff(staff, `Yangi xodim qo'shildi: ${newMember.fish}`)
      return Response.json({ ok: true, member: newMember, staff })
    }

    if (action === 'update') {
      const item = body.data as StaffMember
      if (!item || !item.id) {
        return Response.json({ ok: false, error: "Xodim ID ko'rsatilmagan" }, { status: 400 })
      }

      const idx = staff.findIndex((s) => s.id === item.id)
      if (idx === -1) {
        return Response.json({ ok: false, error: "Xodim topilmadi" }, { status: 404 })
      }

      staff[idx] = { ...staff[idx], ...item }
      await saveStaff(staff, `Xodim ma'lumotlari yangilandi: ${item.fish || item.id}`)
      return Response.json({ ok: true, member: staff[idx], staff })
    }

    if (action === 'delete') {
      const id = String(body.id || '').trim()
      if (!id) {
        return Response.json({ ok: false, error: "O'chiriladigan xodim ID ko'rsatilmagan" }, { status: 400 })
      }

      const filtered = staff.filter((s) => s.id !== id)
      await saveStaff(filtered, `Xodim o'chirildi: ${id}`)
      return Response.json({ ok: true, staff: filtered })
    }

    if (action === 'batch_import') {
      const items = (body.items as Partial<StaffMember>[]) || []
      if (!Array.isArray(items) || !items.length) {
        return Response.json({ ok: false, error: "Import qilinadigan xodimlar ro'yxati bo'sh" }, { status: 400 })
      }

      let count = 0
      const existingNums = staff
        .map((s) => {
          const m = s.id?.match(/(\d+)/)
          return m ? parseInt(m[1], 10) : 0
        })
        .filter((n) => n > 0)
      let nextNum = (existingNums.length ? Math.max(...existingNums) : 0) + 1

      for (const it of items) {
        if (!it.fish?.trim()) continue
        const newMember: StaffMember = {
          id: it.id || `X-${String(nextNum++).padStart(3, '0')}`,
          fish: it.fish.trim(),
          lavozim: (it.lavozim || 'Xodim').trim(),
          bolim: (it.bolim || "Ma'muriy").trim(),
          ish_turi: it.ish_turi || 'Shtat',
          stavka: it.stavka || '1.0',
          tel: (it.tel || '').trim(),
          pinfl: (it.pinfl || '').replace(/\s/g, '').trim(),
          pv: (it.pv || '').trim().toUpperCase(),
          dob: it.dob || '',
          ishga_sana: it.ishga_sana || '',
          boshan_sana: it.boshan_sana || '',
          maosh: it.maosh || '',
          soat_stavka: it.soat_stavka || '',
          status: it.status || 'faol',
          mutaxassislik: it.mutaxassislik || '',
          doc_file: it.doc_file || '',
          izoh: it.izoh || '',
        }
        staff.push(newMember)
        count++
      }

      await saveStaff(staff, `${count} nafar xodim import qilindi`)
      return Response.json({ ok: true, count, staff })
    }

    return Response.json({ ok: false, error: "Noma'lum amal" }, { status: 400 })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
