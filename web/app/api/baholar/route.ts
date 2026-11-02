import type { NextRequest } from 'next/server'
import { getServiceSupabase } from '@/lib/supabase'
import {
  KIRITILADIGAN, amaliyotReyting, hisoblaReyting, isIsoDate, isPinfl, isSemestr, parseBaho, reytingSeed,
  type AmaliyotRow, type BahoRow, type BaholarPayload, type Fan,
} from '@/lib/baholar'

export const dynamic = 'force-dynamic'

/*
  Baholar API (Supabase: fanlar, baholar, malakaviy_amaliyot — web/supabase/baholar.sql).
  Jadvallarda RLS yoqilgan, siyosat yo'q — faqat shu yerdagi service_role mijozi yozadi/o'qiydi.
  Talaba kaliti — JSHSHIR (pinfl).
  Baho 5 ballik (2..5) keladi; 100 ballik reyting va 5 ballik R-semestr shu yerda hisoblanib saqlanadi (lib/baholar.ts).
*/

const NO_TABLE = "Baholar jadvallari hali yaratilmagan. web/supabase/baholar.sql faylini Supabase → SQL Editor da bir marta ishga tushiring."

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status })
}

/** Supabase xatosini foydalanuvchiga tushunarli matnga aylantirish */
function dbError(e: { code?: string; message: string }) {
  if (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message)) {
    return Response.json({ ok: false, error: NO_TABLE, setup: true }, { status: 503 })
  }
  return fail(e.message, 500)
}

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const guruhOf = (v: unknown) => text(v, 40)
const semestrOf = (v: unknown) => (typeof v === 'string' ? Number(v) : v)

export async function GET(req: NextRequest) {
  const guruh = guruhOf(req.nextUrl.searchParams.get('guruh'))
  const semestr = semestrOf(req.nextUrl.searchParams.get('semestr'))
  if (!guruh || !isSemestr(semestr)) return fail('guruh va semestr (1-8) kerak')

  const db = getServiceSupabase()
  const [fanlar, baholar, amaliyot] = await Promise.all([
    db.from('fanlar').select('nom,tartib').eq('guruh', guruh).eq('semestr', semestr).order('tartib').order('id'),
    db.from('baholar').select('pinfl,fan,yakuniy,joriy,oraliq,r_semestr,yakuniy100,joriy100,oraliq100,r100').eq('guruh', guruh).eq('semestr', semestr).limit(10000),
    db.from('malakaviy_amaliyot').select('pinfl,nom,joy,boshlanish,tugash,ball,ball100,izoh').eq('guruh', guruh).eq('semestr', semestr).limit(10000),
  ])
  const err = fanlar.error || baholar.error || amaliyot.error
  if (err) return dbError(err)

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  const body: BaholarPayload = {
    ok: true,
    fanlar: (fanlar.data ?? []) as Fan[],
    baholar: (baholar.data ?? []).map((r) => ({
      pinfl: r.pinfl, fan: r.fan,
      yakuniy: num(r.yakuniy), joriy: num(r.joriy), oraliq: num(r.oraliq), r_semestr: num(r.r_semestr),
      yakuniy100: num(r.yakuniy100), joriy100: num(r.joriy100), oraliq100: num(r.oraliq100), r100: num(r.r100),
    })) satisfies BahoRow[],
    amaliyot: (amaliyot.data ?? []).map((r) => ({
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
    // Avval baholar, so'ng fan — yarim qolsa ham fan ro'yxatda qoladi va qayta urinish mumkin
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
      const g: Record<(typeof KIRITILADIGAN)[number], number | null> = { yakuniy: null, joriy: null, oraliq: null }
      for (const key of KIRITILADIGAN) {
        const v = parseBaho(it[key])
        if (v === undefined) return fail(`${key} bahosi noto'g'ri (faqat 2, 3, 4 yoki 5): "${String(it[key])}"`)
        g[key] = v
      }
      const empty = KIRITILADIGAN.every((k) => g[k] === null)
      // R-semestr va 100 ballik reyting mijozdan olinmaydi — shu yerda hisoblanadi
      const rey = hisoblaReyting(reytingSeed(it.pinfl, semestr, fan), g)
      const row: Record<string, unknown> = {
        pinfl: it.pinfl, guruh, semestr, fan, ...g, r_semestr: rey.r_semestr,
        yakuniy100: rey.yakuniy100, joriy100: rey.joriy100, oraliq100: rey.oraliq100, r100: rey.r100,
        updated_at: new Date().toISOString(),
      }
      if (empty) remove.push({ pinfl: it.pinfl, fan })
      else save.push(row)
    }
    if (save.length) {
      const { error } = await db.from('baholar').upsert(save, { onConflict: 'pinfl,semestr,fan' })
      if (error) return dbError(error)
    }
    // Barcha 4 baho o'chirilgan qator bazada ham qolmasin
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
    const remove: string[] = []
    for (const raw of items) {
      const it = (raw ?? {}) as Record<string, unknown>
      if (!isPinfl(it.pinfl)) return fail("Noto'g'ri qator: JSHSHIR (14 raqam) kerak")
      const ball = parseBaho(it.ball)
      if (ball === undefined) return fail(`Amaliyot bahosi noto'g'ri (faqat 2, 3, 4 yoki 5): "${String(it.ball)}"`)
      const boshlanish = text(it.boshlanish, 10)
      const tugash = text(it.tugash, 10)
      if (boshlanish && !isIsoDate(boshlanish)) return fail(`Boshlanish sanasi noto'g'ri: "${boshlanish}"`)
      if (tugash && !isIsoDate(tugash)) return fail(`Tugash sanasi noto'g'ri: "${tugash}"`)
      if (boshlanish && tugash && tugash < boshlanish) return fail(`Tugash sanasi boshlanishdan oldin bo'lishi mumkin emas (${it.pinfl})`)
      const joy = text(it.joy, 200)
      const izoh = text(it.izoh, 500)
      if (ball === null && !joy && !boshlanish && !tugash && !izoh) { remove.push(it.pinfl); continue }
      save.push({
        pinfl: it.pinfl, guruh, semestr, nom, joy: joy || null, boshlanish: boshlanish || null, tugash: tugash || null,
        ball, ball100: amaliyotReyting(`${it.pinfl}|${semestr}|${nom}`, ball), izoh: izoh || null, updated_at: new Date().toISOString(),
      })
    }
    if (save.length) {
      const { error } = await db.from('malakaviy_amaliyot').upsert(save, { onConflict: 'pinfl,semestr,nom' })
      if (error) return dbError(error)
    }
    for (const pinfl of remove) {
      const { error } = await db.from('malakaviy_amaliyot').delete().eq('pinfl', pinfl).eq('semestr', semestr).eq('nom', nom)
      if (error) return dbError(error)
    }
    return Response.json({ ok: true, saved: save.length, removed: remove.length })
  }

  return fail(`Noma'lum amal: ${action || '(bo\'sh)'}`)
}
