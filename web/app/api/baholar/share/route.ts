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
import {
  BALL_ORALIQ,
  hisoblaReyting,
  parseBaho,
  reytingSeed,
} from '@/lib/baholar'

function ballFor(seed: string, baho: number): number {
  const [lo, hi] = BALL_ORALIQ[baho] || [60, 70]
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const factor = ((h >>> 0) % 1000) / 1000
  return lo + Math.floor(factor * (hi - lo + 1))
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

      // Talabalarni yuklash
      const allStudents = await loadStudents()
      const groupStudents = allStudents.filter(
        (s) => s.group.trim().toLowerCase() === share.guruh.toLowerCase() && s.pinfl,
      )

      // Yashirilgan talabalarni chiqarib tashlash
      const hiddenSet = new Set(share.hiddenPinfls || [])
      const visible = groupStudents.filter((s) => !hiddenSet.has(s.pinfl))

      // Maxsus tartibni qo'llash
      const orders = await loadStudentOrders()
      const groupOrder = orders[share.guruh] || []
      const orderMap = new Map(groupOrder.map((pinfl, idx) => [pinfl, idx]))

      visible.sort((a, b) => {
        const ai = orderMap.has(a.pinfl) ? orderMap.get(a.pinfl)! : 9999
        const bi = orderMap.has(b.pinfl) ? orderMap.get(b.pinfl)! : 9999
        if (ai !== bi) return ai - bi
        return fullName(a).localeCompare(fullName(b))
      })

      // Ushbu fan va semestr bo'yicha mavjud baholarni olish
      const db = getServiceSupabase()
      const gradesRes = await db
        .from('baholar')
        .select('pinfl, yakuniy, joriy, oraliq, r_semestr')
        .eq('guruh', share.guruh)
        .eq('semestr', share.semestr)
        .eq('fan', share.fan)

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

      const hiddenSet = new Set(share.hiddenPinfls || [])
      const db = getServiceSupabase()
      const now = new Date().toISOString()
      const upsertRows: Record<string, unknown>[] = []
      const deletePinfls: string[] = []

      for (const it of items) {
        if (!it.pinfl || hiddenSet.has(it.pinfl)) continue // Yashirilgan talabani o'qituvchi o'zgartira olmaydi

        const y = parseBaho(it.yakuniy)
        const j = parseBaho(it.joriy)
        const o = parseBaho(it.oraliq)
        const r = parseBaho(it.r_semestr)

        const isAllEmpty = y === null && j === null && o === null && r === null
        if (isAllEmpty) {
          deletePinfls.push(it.pinfl)
          continue
        }

        const seed = reytingSeed(it.pinfl, share.semestr, share.fan)
        const calcReyting = hisoblaReyting(seed, {
          yakuniy: y ?? null,
          joriy: j ?? null,
          oraliq: o ?? null,
        })

        const r100 = r !== null && r !== undefined ? ballFor(`${seed}|r_semestr`, r) : calcReyting.r100

        upsertRows.push({
          pinfl: it.pinfl,
          guruh: share.guruh,
          semestr: share.semestr,
          fan: share.fan,
          yakuniy: y ?? null,
          joriy: j ?? null,
          oraliq: o ?? null,
          r_semestr: r ?? null,
          yakuniy100: calcReyting.yakuniy100,
          joriy100: calcReyting.joriy100,
          oraliq100: calcReyting.oraliq100,
          r100,
          updated_at: now,
        })
      }

      if (upsertRows.length) {
        const { error: upsertErr } = await db
          .from('baholar')
          .upsert(upsertRows, { onConflict: 'pinfl,semestr,fan' })
        if (upsertErr) {
          return Response.json({ ok: false, error: upsertErr.message }, { status: 500 })
        }
      }

      if (deletePinfls.length) {
        for (const p of deletePinfls) {
          await db
            .from('baholar')
            .delete()
            .eq('pinfl', p)
            .eq('semestr', share.semestr)
            .eq('fan', share.fan)
        }
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
        fan: String(fan),
        teacherName: teacherName ? String(teacherName) : undefined,
        hiddenPinfls: Array.isArray(hiddenPinfls) ? hiddenPinfls : [],
      })

      return Response.json({ ok: true, share })
    }

    // 3. Mavjud havolani yangilash (Admin)
    if (action === 'update') {
      const { id, teacherName, hiddenPinfls, active, fan } = body
      if (!id) return Response.json({ ok: false, error: "ID kiritilmagan" }, { status: 400 })

      const updated = await updateShare(String(id), {
        teacherName,
        hiddenPinfls,
        active,
        fan,
      })

      return Response.json({ ok: true, share: updated })
    }

    // 4. Havolani o'chirish / bekor qilish (Admin)
    if (action === 'delete') {
      const { id } = body
      if (!id) return Response.json({ ok: false, error: "ID kiritilmagan" }, { status: 400 })

      const ok = await deleteShare(String(id))
      return Response.json({ ok })
    }

    return Response.json({ ok: false, error: "Noma'lum amal" }, { status: 400 })
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
