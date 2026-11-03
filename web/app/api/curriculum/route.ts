import { promises as fs } from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'
import { getServiceSupabase } from '@/lib/supabase'
import type { OquvReja } from '@/lib/curriculum'

export const dynamic = 'force-dynamic'

const FILE_PATH = path.join(process.cwd(), '..', 'data', 'oquv_rejalari.json')
const FALLBACK_FILE_PATH = path.join(process.cwd(), 'data', 'oquv_rejalari.json')

async function getFilePath(): Promise<string> {
  try {
    await fs.access(FILE_PATH)
    return FILE_PATH
  } catch {
    try {
      await fs.access(FALLBACK_FILE_PATH)
      return FALLBACK_FILE_PATH
    } catch {
      return FILE_PATH
    }
  }
}

async function readLocalPlans(): Promise<OquvReja[]> {
  const fp = await getFilePath()
  try {
    const raw = await fs.readFile(fp, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function writeLocalPlans(plans: OquvReja[]): Promise<void> {
  const fp = await getFilePath()
  const dir = path.dirname(fp)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(fp, JSON.stringify(plans, null, 2), 'utf-8')
}

/** Supabase dan yoki fayldan o'qish */
async function getPlans(): Promise<OquvReja[]> {
  const db = getServiceSupabase()
  try {
    const res = await db.from('oquv_rejalari').select('*').order('created_at', { ascending: false })
    if (!res.error && res.data && res.data.length > 0) {
      return res.data.map((r) => ({
        id: r.id,
        oquvYili: r.oquv_yili,
        yonalish: r.yonalish,
        muddati: r.muddati || '3 yillik',
        kod: r.kod || '',
        daraja: r.daraja || "O'rta maxsus professional",
        tavsif: r.tavsif || '',
        groups: Array.isArray(r.groups) ? r.groups : [],
        semestrlar: typeof r.semestrlar === 'object' && r.semestrlar ? r.semestrlar : {},
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
    }
  } catch {
    // Supabase da jadval hali yaratilmagan bo'lsa lokal faylga o'tiladi
  }

  // Fallback: lokal fayl
  const local = await readLocalPlans()
  return local
}

const toRow = (plan: OquvReja) => ({
  id: plan.id,
  oquv_yili: plan.oquvYili,
  yonalish: plan.yonalish,
  muddati: plan.muddati || '3 yillik',
  kod: plan.kod || '',
  daraja: plan.daraja || "O'rta maxsus professional",
  tavsif: plan.tavsif || '',
  groups: plan.groups || [],
  semestrlar: plan.semestrlar || {},
  updated_at: new Date().toISOString(),
})

/**
 * Saqlash: Supabase'ga (asosiy) va lokal faylga (kompyuterda zaxira).
 * Internetdagi saytda fayl tizimi faqat o'qish uchun — u holda Supabase'ga yozilmasa xato qaytariladi,
 * "saqlandi" deb aldamaydi. changed — o'zgargan barcha rejalar (boshqa rejadan olingan guruhlar ham).
 */
async function savePlansToStore(changed: OquvReja[], allPlans: OquvReja[]): Promise<void> {
  let fileOk = false
  try {
    await writeLocalPlans(allPlans)
    fileOk = true
  } catch {
    // fayl tizimi read-only bo'lishi mumkin (Netlify/Vercel)
  }

  let dbError = ''
  if (changed.length) {
    try {
      const db = getServiceSupabase()
      const { error } = await db.from('oquv_rejalari').upsert(changed.map(toRow), { onConflict: 'id' })
      if (error) dbError = error.message
    } catch (e) {
      dbError = (e as Error).message
    }
  }
  // Supabase'da jadval bo'lsa u asosiy manba (GET avval undan o'qiydi) — unga yozilmasa o'zgarish
  // ko'rinmaydi. Faqat jadval umuman yo'q bo'lsa lokal fayl yetarli.
  const noTable = /does not exist|42P01|schema cache/i.test(dbError)
  if (dbError && !(fileOk && noTable)) throw new Error(`O'quv reja saqlanmadi: ${dbError}`)
}

export async function GET(req: NextRequest) {
  try {
    const plans = await getPlans()
    const guruh = req.nextUrl.searchParams.get('guruh')
    const oquvYili = req.nextUrl.searchParams.get('oquvYili')

    let filtered = plans
    if (oquvYili) {
      filtered = filtered.filter((p) => p.oquvYili === oquvYili)
    }
    if (guruh) {
      const target = guruh.trim()
      const found = filtered.find((p) => p.groups && p.groups.includes(target))
      return Response.json(
        { ok: true, plan: found || null, plans: filtered },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    return Response.json({ ok: true, plans: filtered }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return Response.json({ ok: false, error: "Yaroqsiz ma'lumot" }, { status: 400 })
    }

    const { action } = body
    const plans = await getPlans()

    if (action === 'savePlan') {
      const plan: OquvReja = body.plan
      if (!plan || !plan.id || !plan.oquvYili || !plan.yonalish) {
        return Response.json({ ok: false, error: "O'quv reja ma'lumotlari to'liq emas" }, { status: 400 })
      }

      const assignedGroups = new Set(plan.groups || [])
      const now = new Date().toISOString()
      const updatedPlan: OquvReja = {
        ...plan,
        createdAt: plan.createdAt || now,
        updatedAt: now,
      }

      // Boshqa rejalardan shu guruhlarni olib tashlash (ular ham bazada yangilanadi)
      const changed: OquvReja[] = [updatedPlan]
      for (const p of plans) {
        if (p.id !== plan.id && p.groups && p.groups.some((g) => assignedGroups.has(g))) {
          p.groups = p.groups.filter((g) => !assignedGroups.has(g))
          p.updatedAt = now
          changed.push(p)
        }
      }

      const existingIdx = plans.findIndex((p) => p.id === plan.id)
      if (existingIdx >= 0) {
        plans[existingIdx] = updatedPlan
      } else {
        plans.push(updatedPlan)
      }

      await savePlansToStore(changed, plans)
      return Response.json({ ok: true, plan: updatedPlan, plans })
    }

    if (action === 'deletePlan') {
      const { id } = body
      if (!id) return Response.json({ ok: false, error: 'Reja ID si berilmagan' }, { status: 400 })
      const nextPlans = plans.filter((p) => p.id !== id)

      let fileOk = false
      try {
        await writeLocalPlans(nextPlans)
        fileOk = true
      } catch { /* bo'sh */ }

      let dbErr = ''
      try {
        const { error } = await getServiceSupabase().from('oquv_rejalari').delete().eq('id', id)
        if (error) dbErr = error.message
      } catch (e) { dbErr = (e as Error).message }
      if (dbErr && !(fileOk && /does not exist|42P01|schema cache/i.test(dbErr))) {
        return Response.json({ ok: false, error: `O'chirilmadi: ${dbErr}` }, { status: 500 })
      }

      return Response.json({ ok: true, plans: nextPlans })
    }

    if (action === 'assignGroups') {
      const { planId, groups } = body as { planId: string; groups: string[] }
      if (!planId || !Array.isArray(groups)) {
        return Response.json({ ok: false, error: 'Reja va guruhlar kiritilishi shart' }, { status: 400 })
      }

      const clean = [...new Set(groups.filter((g) => typeof g === 'string' && g.trim()).map((g) => g.trim()))]
      const assigned = new Set(clean)
      const now = new Date().toISOString()
      const changed: OquvReja[] = []
      for (const p of plans) {
        if (p.id === planId) {
          p.groups = clean
          p.updatedAt = now
          changed.push(p)
        } else if (p.groups && p.groups.some((g) => assigned.has(g))) {
          p.groups = p.groups.filter((g) => !assigned.has(g))
          p.updatedAt = now
          changed.push(p)
        }
      }
      if (!changed.some((p) => p.id === planId)) {
        return Response.json({ ok: false, error: 'Reja topilmadi' }, { status: 404 })
      }

      await savePlansToStore(changed, plans)
      return Response.json({ ok: true, plans })
    }

    if (action === 'syncSubjectsToGrades') {
      const { guruh, semestr, fanlar } = body as {
        guruh: string
        semestr: number
        fanlar: { nom: string; tartib: number }[]
      }
      if (!guruh || !semestr || !Array.isArray(fanlar) || !fanlar.length) {
        return Response.json({ ok: false, error: 'Guruh, semestr va fanlar kerak' }, { status: 400 })
      }

      const db = getServiceSupabase()
      const sem = Number(semestr)
      if (!Number.isInteger(sem) || sem < 1 || sem > 8) {
        return Response.json({ ok: false, error: 'Semestr 1-8 oralig\'ida bo\'lishi kerak' }, { status: 400 })
      }
      // Takroriy nomlar bitta upsert'da bo'lsa Postgres xato beradi — olib tashlaymiz
      const seen = new Set<string>()
      const rows = fanlar
        .map((f, i) => ({
          guruh: guruh.trim(),
          semestr: sem,
          nom: String(f?.nom ?? '').trim().slice(0, 120),
          tartib: Number.isFinite(Number(f?.tartib)) ? Number(f.tartib) : i + 1,
        }))
        .filter((r) => r.nom && !seen.has(r.nom) && (seen.add(r.nom), true))

      // Mavjud fanlarning faqat tartibi yangilanadi, yangilari qo'shiladi. Baholar va qo'lda
      // qo'shilgan fanlar o'chirilmaydi.
      const { error } = await db
        .from('fanlar')
        .upsert(rows, { onConflict: 'guruh,semestr,nom' })

      if (error) {
        // Agar fanlar jadvali bo'lmasa, tushunarli xabar
        return Response.json({ ok: false, error: `Supabase xatosi: ${error.message}` }, { status: 500 })
      }

      return Response.json({ ok: true, count: rows.length })
    }

    return Response.json({ ok: false, error: "Noma'lum amal" }, { status: 400 })
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
