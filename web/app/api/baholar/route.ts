import { NextRequest } from 'next/server'
import {
  AM_FIELDS,
  isIsoDate,
  isPinfl,
  isSemestr,
  parseBaho,
  reytingSeed,
  hisoblaReyting,
  KIRITILADIGAN,
  type AmaliyotRow,
  type BaholarPayload,
  type BahoRow,
  type Fan,
} from '@/lib/baholar'
import { getServiceSupabase } from '@/lib/supabase'

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const guruhOf = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status })

function dbError(e: { message: string; code?: string }) {
  const setup = e.code === '42P01' || /relation.*does not exist/i.test(e.message)
  return Response.json({ ok: false, error: e.message, setup }, { status: 500 })
}

export async function GET(req: NextRequest) {
  const guruh = guruhOf(req.nextUrl.searchParams.get('guruh'))
  const semestr = Number(req.nextUrl.searchParams.get('semestr'))
  if (!guruh || !isSemestr(semestr)) return fail('guruh va semestr (1-8) kerak')
  const db = getServiceSupabase()

  const [f, b, a] = await Promise.all([
    db.from('fanlar').select('nom, tartib').eq('guruh', guruh).eq('semestr', semestr).order('tartib', { ascending: true }),
    db.from('baholar').select('*').eq('guruh', guruh).eq('semestr', semestr),
    db.from('malakaviy_amaliyot').select('*').eq('guruh', guruh).eq('semestr', semestr),
  ])
  if (f.error) return dbError(f.error)
  if (b.error) return dbError(b.error)
  if (a.error) return dbError(a.error)

  const body: BaholarPayload = {
    ok: true,
    fanlar: (f.data ?? []).map((r) => ({ nom: r.nom, tartib: r.tartib })) satisfies Fan[],
    baholar: (b.data ?? []).map((r) => ({
      pinfl: r.pinfl, fan: r.fan,
      yakuniy: num(r.yakuniy), joriy: num(r.joriy), oraliq: num(r.oraliq), r_semestr: num(r.r_semestr),
      yakuniy100: num(r.yakuniy100), joriy100: num(r.joriy100), oraliq100: num(r.oraliq100), r100: num(r.r100),
    })) satisfies BahoRow[],
    amaliyot: (a.data ?? []).map((r) => ({
      pinfl: r.pinfl, nom: r.nom, joy: r.joy ?? '', boshlanish: r.boshlanish ?? '', tugash: r.tugash ?? '',
      ball: num(r.ball), ball100: num(r.ball100), izoh: r.izoh ?? '',
    })) satisfies AmaliyotRow[],
  }
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return fail("JSON ma'lumoti yaroqsiz")
  const action = text(body.action, 30)
  const guruh = guruhOf(body.guruh)
  const semestr = body.semestr
  if (!guruh || !isSemestr(semestr)) return fail('guruh va semestr (1-8) kerak')
  const db = getServiceSupabase()

  if (action === 'addFan') {
    const nom = text(body.nom, 120)
    if (!nom) return fail('Fan nomi kiritilmagan')
    const last = await db.from('fanlar').select('tartib').eq('guruh', guruh).eq('semestr', semestr).order('tartib', { ascending: false }).limit(1)
    if (last.error) return dbError(last.error)
    const tartib = (last.data?.[0]?.tartib ?? 0) + 1
    const { error } = await db.from('fanlar').upsert({ guruh, semestr, nom, tartib }, { onConflict: 'guruh,semestr,nom', ignoreDuplicates: true })
    return error ? dbError(error) : Response.json({ ok: true })
  }

  if (action === 'deleteFan') {
    const nom = text(body.nom, 120)
    if (!nom) return fail('Fan nomi kiritilmagan')
    const b = await db.from('baholar').delete().eq('guruh', guruh).eq('semestr', semestr).eq('fan', nom)
    if (b.error) return dbError(b.error)
    const f = await db.from('fanlar').delete().eq('guruh', guruh).eq('semestr', semestr).eq('nom', nom)
    return f.error ? dbError(f.error) : Response.json({ ok: true })
  }

  if (action === 'saveBaholar') {
    const items: unknown[] = Array.isArray(body.items) ? body.items : []
    if (!items.length) return fail("Saqlanadigan baho yo'q")
    if (items.length > 5000) return fail("Bir so'rovda 5000 tadan ortiq qator yuborib bo'lmaydi")
    const save: Record<string, unknown>[] = []
    const remove: { pinfl: string; fan: string }[] = []
    for (const raw of items) {
      const it = (raw ?? {}) as Record<string, unknown>
      const fan = text(it.fan, 120)
      if (!isPinfl(it.pinfl) || !fan) return fail(`Noto'g'ri qator: JSHSHIR (14 raqam) va fan nomi kerak`)
      const g: Record<(typeof KIRITILADIGAN)[number], number | null> = {
        yakuniy: null,
        joriy: null,
        oraliq: null,
        r_semestr: null,
      }
      for (const key of KIRITILADIGAN) {
        const v = parseBaho(it[key])
        if (v === undefined) return fail(`${key} bahosi noto'g'ri (faqat 2, 3, 4 yoki 5): "${String(it[key])}"`)
        g[key] = v
      }
      const empty = KIRITILADIGAN.every((k) => g[k] === null)
      // Reyting hisoblash (R-semestr mijozdan olingan bo'lsa shu saqlanadi, avtomatik majburlanmaydi)
      const rey = hisoblaReyting(reytingSeed(it.pinfl, semestr, fan), g)
      const row: Record<string, unknown> = {
        pinfl: it.pinfl,
        guruh,
        semestr,
        fan,
        yakuniy: g.yakuniy,
        joriy: g.joriy,
        oraliq: g.oraliq,
        r_semestr: g.r_semestr,
        yakuniy100: rey.yakuniy100,
        joriy100: rey.joriy100,
        oraliq100: rey.oraliq100,
        r100: rey.r100,
        updated_at: new Date().toISOString(),
      }
      if (empty) remove.push({ pinfl: it.pinfl, fan })
      else save.push(row)
    }
    if (save.length) {
      const { error } = await db.from('baholar').upsert(save, { onConflict: 'pinfl,semestr,fan' })
      if (error) return dbError(error)
    }
    // Barcha baholari o'chirilgan qator bazada qolmasin
    for (const r of remove) {
      const { error } = await db.from('baholar').delete().eq('pinfl', r.pinfl).eq('semestr', semestr).eq('fan', r.fan)
      if (error) return dbError(error)
    }
    return Response.json({ ok: true, saved: save.length, removed: remove.length })
  }

  if (action === 'saveAmaliyot') {
    const nom = text(body.nom, 120)
    if (!nom) return fail('Amaliyot nomi kiritilmagan')
    const items: unknown[] = Array.isArray(body.items) ? body.items : []
    if (!items.length) return fail("Saqlanadigan ma'lumot yo'q")
    if (items.length > 5000) return fail("Bir so'rovda 5000 tadan ortiq qator yuborib bo'lmaydi")
    const save: Record<string, unknown>[] = []
    const remove: { pinfl: string }[] = []
    for (const raw of items) {
      const it = (raw ?? {}) as Record<string, unknown>
      if (!isPinfl(it.pinfl)) return fail("Noto'g'ri JSHSHIR")
      const joy = text(it.joy, 200)
      const boshlanish = it.boshlanish ? text(it.boshlanish, 10) : ''
      const tugash = it.tugash ? text(it.tugash, 10) : ''
      if (boshlanish && !isIsoDate(boshlanish)) return fail(`boshlanish sanasi noto'g'ri (YYYY-MM-DD): "${boshlanish}"`)
      if (tugash && !isIsoDate(tugash)) return fail(`tugash sanasi noto'g'ri (YYYY-MM-DD): "${tugash}"`)
      const ball = parseBaho(it.ball)
      if (ball === undefined) return fail(`Baho noto'g'ri: "${String(it.ball)}"`)
      const izoh = text(it.izoh, 500)
      const empty = !joy && !boshlanish && !tugash && ball === null && !izoh
      if (empty) { remove.push({ pinfl: it.pinfl }); continue }
      const ball100 = ball === null ? null : (ball >= 5 ? 90 : ball === 4 ? 78 : ball === 3 ? 68 : 50)
      save.push({
        pinfl: it.pinfl, guruh, semestr, nom, joy,
        boshlanish: boshlanish || null, tugash: tugash || null,
        ball, ball100, izoh, updated_at: new Date().toISOString(),
      })
    }
    if (save.length) {
      const { error } = await db.from('malakaviy_amaliyot').upsert(save, { onConflict: 'pinfl,semestr,nom' })
      if (error) return dbError(error)
    }
    for (const r of remove) {
      const { error } = await db.from('malakaviy_amaliyot').delete().eq('pinfl', r.pinfl).eq('semestr', semestr).eq('nom', nom)
      if (error) return dbError(error)
    }
    return Response.json({ ok: true, saved: save.length, removed: remove.length })
  }

  return fail("Noma'lum action")
}
