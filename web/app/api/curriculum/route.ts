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

async function readPlans(): Promise<OquvReja[]> {
  const fp = await getFilePath()
  try {
    const raw = await fs.readFile(fp, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function writePlans(plans: OquvReja[]): Promise<void> {
  const fp = await getFilePath()
  const dir = path.dirname(fp)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(fp, JSON.stringify(plans, null, 2), 'utf-8')
}

export async function GET(req: NextRequest) {
  try {
    const plans = await readPlans()
    const guruh = req.nextUrl.searchParams.get('guruh')
    const oquvYili = req.nextUrl.searchParams.get('oquvYili')

    let filtered = plans
    if (oquvYili) {
      filtered = filtered.filter((p) => p.oquvYili === oquvYili)
    }
    if (guruh) {
      const target = guruh.trim()
      const found = filtered.find((p) => p.groups && p.groups.includes(target))
      return Response.json({ ok: true, plan: found || null, plans: filtered }, { headers: { 'Cache-Control': 'no-store' } })
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
    const plans = await readPlans()

    if (action === 'savePlan') {
      const plan: OquvReja = body.plan
      if (!plan || !plan.id || !plan.oquvYili || !plan.yonalish) {
        return Response.json({ ok: false, error: "O'quv reja ma'lumotlari to'liq emas" }, { status: 400 })
      }

      // Agar bir xil guruh boshqa rejada bo'lsa, qaysi birida qolishini tartibga solish
      const assignedGroups = new Set(plan.groups || [])

      const existingIdx = plans.findIndex((p) => p.id === plan.id)
      const now = new Date().toISOString()
      const updatedPlan: OquvReja = {
        ...plan,
        createdAt: plan.createdAt || now,
        updatedAt: now,
      }

      // Boshqa rejalardan shu guruhlarni olib tashlash (bitta guruh faqat 1 ta rejaga birikadi)
      for (const p of plans) {
        if (p.id !== plan.id && p.groups && p.groups.some((g) => assignedGroups.has(g))) {
          p.groups = p.groups.filter((g) => !assignedGroups.has(g))
        }
      }

      if (existingIdx >= 0) {
        plans[existingIdx] = updatedPlan
      } else {
        plans.push(updatedPlan)
      }

      await writePlans(plans)
      return Response.json({ ok: true, plan: updatedPlan, plans })
    }

    if (action === 'deletePlan') {
      const { id } = body
      if (!id) return Response.json({ ok: false, error: 'Reja ID si berilmagan' }, { status: 400 })
      const nextPlans = plans.filter((p) => p.id !== id)
      await writePlans(nextPlans)
      return Response.json({ ok: true, plans: nextPlans })
    }

    if (action === 'assignGroups') {
      const { planId, groups } = body as { planId: string; groups: string[] }
      if (!planId || !Array.isArray(groups)) {
        return Response.json({ ok: false, error: 'Reja va guruhlar kiritilishi shart' }, { status: 400 })
      }

      const assigned = new Set(groups)
      for (const p of plans) {
        if (p.id === planId) {
          p.groups = groups
          p.updatedAt = new Date().toISOString()
        } else if (p.groups) {
          // boshqa rejalardan olib tashlash
          p.groups = p.groups.filter((g) => !assigned.has(g))
        }
      }

      await writePlans(plans)
      return Response.json({ ok: true, plans })
    }

    if (action === 'syncSubjectsToGrades') {
      // Rejadagi fanlarni tanlangan guruh va semestr uchun Supabase 'fanlar' jadvaliga to'g'ridan-to'g'ri yozish
      const { guruh, semestr, fanlar } = body as { guruh: string; semestr: number; fanlar: { nom: string; tartib: number }[] }
      if (!guruh || !semestr || !Array.isArray(fanlar) || !fanlar.length) {
        return Response.json({ ok: false, error: 'Guruh, semestr va fanlar kerak' }, { status: 400 })
      }

      const db = getServiceSupabase()
      // Har bir fanni upsert qilish
      const rows = fanlar.map((f, i) => ({
        guruh: guruh.trim(),
        semestr,
        nom: f.nom.trim(),
        tartib: f.tartib ?? i + 1,
      }))

      const { error } = await db.from('fanlar').upsert(rows, { onConflict: 'guruh,semestr,nom', ignoreDuplicates: true })
      if (error) {
        return Response.json({ ok: false, error: error.message }, { status: 500 })
      }

      return Response.json({ ok: true, count: rows.length })
    }

    return Response.json({ ok: false, error: "Noma'lum amal" }, { status: 400 })
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
