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
        kategoriya: item.kategoriya || "ShTAT - xodimlar",
        bolim: (item.bolim || "Ma'muriy").trim(),
        ish_turi: item.ish_turi || 'Shtat',
        stavka: item.stavka || '1.0',
        tel: (item.tel || '').trim(),
        pinfl: (item.pinfl || '').replace(/\s/g, '').trim(),
        pv: (item.pv || '').trim().toUpperCase(),
        dob: item.dob || '',
        tugilgan_joy: item.tugilgan_joy || '',
        tamomlagan_otm: item.tamomlagan_otm || '',
        otm_tamom_yili: item.otm_tamom_yili || '',
        mutaxassislik: item.mutaxassislik || '',
        buyruq_sana: item.buyruq_sana || '',
        ishga_sana: item.ishga_sana || '',
        boshan_sana: item.boshan_sana || '',
        yashash_joyi: item.yashash_joyi || '',
        pasport_berilgan_joy: item.pasport_berilgan_joy || '',
        maosh: item.maosh || '',
        soat_stavka: item.soat_stavka || '',
        status: item.status || 'faol',
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
          kategoriya: it.kategoriya || "ShTAT - xodimlar",
          bolim: (it.bolim || "Ma'muriy").trim(),
          ish_turi: it.ish_turi || 'Shtat',
          stavka: it.stavka || '1.0',
          tel: (it.tel || '').trim(),
          pinfl: (it.pinfl || '').replace(/\s/g, '').trim(),
          pv: (it.pv || '').trim().toUpperCase(),
          dob: it.dob || '',
          tugilgan_joy: it.tugilgan_joy || '',
          tamomlagan_otm: it.tamomlagan_otm || '',
          otm_tamom_yili: it.otm_tamom_yili || '',
          mutaxassislik: it.mutaxassislik || '',
          buyruq_sana: it.buyruq_sana || '',
          ishga_sana: it.ishga_sana || '',
          boshan_sana: it.boshan_sana || '',
          yashash_joyi: it.yashash_joyi || '',
          pasport_berilgan_joy: it.pasport_berilgan_joy || '',
          maosh: it.maosh || '',
          soat_stavka: it.soat_stavka || '',
          status: it.status || 'faol',
          doc_file: it.doc_file || '',
          izoh: it.izoh || '',
        }
        staff.push(newMember)
        count++
      }

      await saveStaff(staff, `${count} nafar xodim import qilindi`)
      return Response.json({ ok: true, count, staff })
    }

    if (action === 'sync_hr') {
      try {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)
        await execAsync('python scripts/sync_hr_staff.py')
        const refreshed = await loadStaff()
        return Response.json({ ok: true, count: refreshed.length, staff: refreshed })
      } catch (err) {
        const refreshed = await loadStaff()
        return Response.json({ ok: true, count: refreshed.length, staff: refreshed, note: String(err) })
      }
    }

    return Response.json({ ok: false, error: "Noma'lum amal" }, { status: 400 })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
