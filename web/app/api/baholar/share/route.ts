import { NextRequest } from 'next/server'
import {
  createShare,
  deleteShare,
  getShareByToken,
  loadShares,
  loadStudentOrders,
  updateShare,
} from '@/lib/server/baholar-shares'
import { loadStudents } from '@/lib/server/source'
import { fullName } from '@/lib/student'
import { getServiceSupabase } from '@/lib/supabase'
import { hisoblaReyting, isPinfl, parseBaho, reytingSeed } from '@/lib/baholar'

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status })

/** Havoladagi guruhning o'qituvchiga ko'rinadigan talabalari (maxsus tartib bilan) */
async function shareStudents(share: { guruh: string; hiddenPinfls?: string[] }) {
  const [allStudents, orders] = await Promise.all([loadStudents(), loadStudentOrders()])
  const g = share.guruh.trim().toLowerCase()
  const hiddenSet = new Set(share.hiddenPinfls || [])
  const visible = allStudents.filter((s) => s.group.trim().toLowerCase() === g && s.pinfl && !hiddenSet.has(s.pinfl))
  const groupOrder = orders[share.guruh] || []
  const orderMap = new Map(groupOrder.map((pinfl, idx) => [pinfl, idx]))
  visible.sort((a, b) => {
    const ai = orderMap.get(a.pinfl) ?? 9999
    const bi = orderMap.get(b.pinfl) ?? 9999
    if (ai !== bi) return ai - bi
    return fullName(a).localeCompare(fullName(b))
  })
  return visible
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const token = searchParams.get('token')
    const action = searchParams.get('action')
    const guruh = searchParams.get('guruh')
    const semestr = searchParams.get('semestr') ? Number(searchParams.get('semestr')) : undefined

    // 1. O'qituvchi tokeni orqali yuklash (Parol talab qilinmaydi)
    if (token) {
      const share = await getShareByToken(token.trim())
      if (!share) {
        return Response.json(
          { ok: false, error: "Havola yaroqsiz yoki admin tomonidan to'xtatilgan" },
          { status: 404 },
        )
      }

      const visible = await shareStudents(share)

      // Ushbu fan va semestr bo'yicha mavjud baholarni olish
      const db = getServiceSupabase()
      const gradesRes = await db
        .from('baholar')
        .select('pinfl, yakuniy, joriy, oraliq, r_semestr')
        .eq('guruh', share.guruh)
        .eq('semestr', share.semestr)
        .eq('fan', share.fan)

      if (gradesRes.error) return fail(gradesRes.error.message, 500)
      const grades = gradesRes.data || []

      return Response.json(
        {
          ok: true,
          share: {
            id: share.id,
            token: share.token,
            guruh: share.guruh,
            semestr: share.semestr,
            fan: share.fan,
            teacherName: share.teacherName,
          },
          students: visible.map((s, idx) => ({
            tartib: idx + 1,
            pinfl: s.pinfl,
            name: fullName(s),
          })),
          grades,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // 2. Admin uchun havolalar ro'yxati
    if (action === 'list') {
      const shares = await loadShares()
      let filtered = shares
      if (guruh) {
        filtered = filtered.filter((s) => s.guruh.toLowerCase() === guruh.trim().toLowerCase())
      }
      if (semestr) {
        filtered = filtered.filter((s) => s.semestr === semestr)
      }
      return Response.json({ ok: true, shares: filtered }, { headers: { 'Cache-Control': 'no-store' } })
    }

    return Response.json({ ok: false, error: "Noma'lum so'rov" }, { status: 400 })
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { action } = body

    // 1. O'qituvchi baholarni saqlashi (token orqali)
    if (action === 'saveTeacherGrades') {
      const { token, items } = body as {
        token: string
        items: Array<{
          pinfl: string
          yakuniy?: number | string | null
          joriy?: number | string | null
          oraliq?: number | string | null
          r_semestr?: number | string | null
        }>
      }

      if (!token || !Array.isArray(items)) {
        return Response.json({ ok: false, error: "Token va baholar ma'lumoti kerak" }, { status: 400 })
      }

      const share = await getShareByToken(token.trim())
      if (!share) {
        return Response.json(
          { ok: false, error: "Havola yaroqsiz yoki admin tomonidan bekor qilingan" },
          { status: 403 },
        )
      }

      if (items.length > 2000) return fail("Bir so'rovda 2000 tadan ortiq qator yuborib bo'lmaydi")

      // O'qituvchi faqat havoladagi guruhning o'ziga ko'rinadigan talabalariga baho qo'ya oladi
      const allowed = new Set((await shareStudents(share)).map((s) => s.pinfl))
      const db = getServiceSupabase()
      const now = new Date().toISOString()
      const upsertRows: Record<string, unknown>[] = []
      const deletePinfls: string[] = []

      for (const it of items) {
        if (!it || !isPinfl(it.pinfl) || !allowed.has(it.pinfl)) continue
        const g = { yakuniy: parseBaho(it.yakuniy), joriy: parseBaho(it.joriy), oraliq: parseBaho(it.oraliq), r_semestr: parseBaho(it.r_semestr) }
        for (const [k, v] of Object.entries(g)) {
          if (v === undefined) return fail(`Baho noto'g'ri (faqat 2, 3, 4 yoki 5): ${k} = "${String(it[k as keyof typeof it])}"`)
        }
        const clean = g as Record<keyof typeof g, number | null>
        if (Object.values(clean).every((v) => v === null)) {
          deletePinfls.push(it.pinfl)
          continue
        }
        // Reyting admin sahifasidagi bilan aynan bir xil qoida bo'yicha (lib/baholar.ts)
        const rey = hisoblaReyting(reytingSeed(it.pinfl, share.semestr, share.fan), clean)
        upsertRows.push({
          pinfl: it.pinfl,
          guruh: share.guruh,
          semestr: share.semestr,
          fan: share.fan,
          yakuniy: clean.yakuniy,
          joriy: clean.joriy,
          oraliq: clean.oraliq,
          r_semestr: clean.r_semestr,
          yakuniy100: rey.yakuniy100,
          joriy100: rey.joriy100,
          oraliq100: rey.oraliq100,
          r100: rey.r100,
          updated_at: now,
        })
      }

      if (upsertRows.length) {
        const { error } = await db.from('baholar').upsert(upsertRows, { onConflict: 'pinfl,semestr,fan' })
        if (error) return fail(error.message, 500)
      }
      if (deletePinfls.length) {
        const { error } = await db
          .from('baholar')
          .delete()
          .in('pinfl', deletePinfls)
          .eq('semestr', share.semestr)
          .eq('fan', share.fan)
        if (error) return fail(error.message, 500)
      }

      return Response.json({ ok: true, saved: upsertRows.length, deleted: deletePinfls.length })
    }

    // 2. Yangi ulashish havolasi yaratish (Admin)
    if (action === 'create') {
      const { guruh, semestr, fan, teacherName, hiddenPinfls } = body
      if (!guruh || !semestr || !fan) {
        return Response.json({ ok: false, error: "Guruh, semestr va fan nomi majburiy" }, { status: 400 })
      }

      const share = await createShare({
        guruh: String(guruh),
        semestr: Number(semestr),
        fan: String(fan).slice(0, 120),
        teacherName: teacherName ? String(teacherName).slice(0, 120) : undefined,
        hiddenPinfls: Array.isArray(hiddenPinfls) ? hiddenPinfls.filter(isPinfl) : [],
      })

      return Response.json({ ok: true, share })
    }

    // 3. Mavjud havolani yangilash (Admin)
    if (action === 'update') {
      const { id, teacherName, hiddenPinfls, active, fan } = body
      if (!id) return Response.json({ ok: false, error: "ID kiritilmagan" }, { status: 400 })

      const updates: Parameters<typeof updateShare>[1] = {}
      if (typeof teacherName === 'string') updates.teacherName = teacherName.trim().slice(0, 120)
      if (Array.isArray(hiddenPinfls)) updates.hiddenPinfls = hiddenPinfls.filter(isPinfl)
      if (typeof active === 'boolean') updates.active = active
      if (typeof fan === 'string' && fan.trim()) updates.fan = fan.trim().slice(0, 120)

      const updated = await updateShare(String(id), updates)
      if (!updated) return fail('Havola topilmadi', 404)
      return Response.json({ ok: true, share: updated })
    }

    // 4. Havolani o'chirish / bekor qilish (Admin)
    if (action === 'delete') {
      const { id } = body
      if (!id) return Response.json({ ok: false, error: "ID kiritilmagan" }, { status: 400 })

      const ok = await deleteShare(String(id))
      return ok ? Response.json({ ok: true }) : fail('Havola topilmadi', 404)
    }

    return Response.json({ ok: false, error: "Noma'lum amal" }, { status: 400 })
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
