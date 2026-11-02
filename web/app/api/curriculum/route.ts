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

/** Saqlash: ham Supabase ga, ham lokal faylga */
async function savePlanToStore(plan: OquvReja, allPlans: OquvReja[]): Promise<void> {
  // 1. Lokal faylga yozish
  try {
    await writeLocalPlans(allPlans)
  } catch {
    // fayl tizimi read-only bo'lishi mumkin (Vercel)
  }

  // 2. Supabase ga yozish
  try {
    const db = getServiceSupabase()
    await db.from('oquv_rejalari').upsert(
      {
        id: plan.id,
        oquv_yili: plan.oquvYili,
        yonalish: plan.yonalish,
        muddati: plan.muddati,
        kod: plan.kod || '',
        daraja: plan.daraja || "O'rta maxsus professional",
        tavsif: plan.tavsif || '',
        groups: plan.groups || [],
        semestrlar: plan.semestrlar || {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
  } catch {
    // Supabase xatosi bo'lsa ham lokal fayl yetarli
  }
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

      // Boshqa rejalardan shu guruhlarni olib tashlash
      for (const p of plans) {
        if (p.id !== plan.id && p.groups && p.groups.some((g) => assignedGroups.has(g))) {
          p.groups = p.groups.filter((g) => !assignedGroups.has(g))
        }
      }

      const existingIdx = plans.findIndex((p) => p.id === plan.id)
      if (existingIdx >= 0) {
        plans[existingIdx] = updatedPlan
      } else {
        plans.push(updatedPlan)
      }

      await savePlanToStore(updatedPlan, plans)
      return Response.json({ ok: true, plan: updatedPlan, plans })
    }

    if (action === 'deletePlan') {
      const { id } = body
      if (!id) return Response.json({ ok: false, error: 'Reja ID si berilmagan' }, { status: 400 })
      const nextPlans = plans.filter((p) => p.id !== id)

      try {
        await writeLocalPlans(nextPlans)
      } catch { /* bo'sh */ }

      try {
        const db = getServiceSupabase()
        await db.from('oquv_rejalari').delete().eq('id', id)
      } catch { /* bo'sh */ }

      return Response.json({ ok: true, plans: nextPlans })
    }

    if (action === 'assignGroups') {
      const { planId, groups } = body as { planId: string; groups: string[] }
      if (!planId || !Array.isArray(groups)) {
        return Response.json({ ok: false, error: 'Reja va guruhlar kiritilishi shart' }, { status: 400 })
      }

      const assigned = new Set(groups)
      let targetPlan: OquvReja | undefined
      for (const p of plans) {
        if (p.id === planId) {
          p.groups = groups
          p.updatedAt = new Date().toISOString()
          targetPlan = p
        } else if (p.groups) {
          p.groups = p.groups.filter((g) => !assigned.has(g))
        }
      }

      try {
        await writeLocalPlans(plans)
      } catch { /* bo'sh */ }

      if (targetPlan) {
        await savePlanToStore(targetPlan, plans)
      }

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
      const rows = fanlar.map((f, i) => ({
        guruh: guruh.trim(),
        semestr,
        nom: f.nom.trim(),
        tartib: f.tartib ?? i + 1,
      }))

      const { error } = await db
        .from('fanlar')
        .upsert(rows, { onConflict: 'guruh,semestr,nom', ignoreDuplicates: true })

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
