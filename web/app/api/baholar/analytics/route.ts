import { NextRequest } from 'next/server'
import { isSemestr } from '@/lib/baholar'
import { getServiceSupabase } from '@/lib/server/supabase'

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

type Page = PromiseLike<{ data: Record<string, any>[] | null; error: { message: string; code?: string } | null }> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Supabase bir so'rovda ko'pi bilan 1000 qator qaytaradi */
async function selectAll(page: (from: number, to: number) => Page) {
  const STEP = 1000
  const data: Record<string, any>[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let from = 0; ; from += STEP) {
    const r = await page(from, from + STEP - 1)
    if (r.error) return { data: null, error: r.error }
    data.push(...(r.data ?? []))
    if (!r.data || r.data.length < STEP) return { data, error: null }
  }
}

export async function GET(req: NextRequest) {
  const rawSem = Number(req.nextUrl.searchParams.get('semestr'))
  const semestr = !rawSem ? 1 : rawSem
  if (!isSemestr(semestr)) {
    return Response.json({ ok: false, error: 'semestr 1-8 oralig\'ida bo\'lishi kerak' }, { status: 400 })
  }

  const db = getServiceSupabase()
  const [f, b, a] = await Promise.all([
    selectAll((from, to) =>
      db.from('fanlar').select('guruh, nom, tartib').eq('semestr', semestr).order('tartib').order('id').range(from, to),
    ),
    selectAll((from, to) =>
      db
        .from('baholar')
        .select('pinfl, guruh, fan, yakuniy, joriy, oraliq, r_semestr, yakuniy100, joriy100, oraliq100, r100')
        .eq('semestr', semestr)
        .order('id')
        .range(from, to),
    ),
    selectAll((from, to) =>
      db
        .from('malakaviy_amaliyot')
        .select('pinfl, guruh, nom, ball, ball100')
        .eq('semestr', semestr)
        .order('id')
        .range(from, to),
    ),
  ])

  if (f.error) return Response.json({ ok: false, error: f.error.message }, { status: 500 })
  if (b.error) return Response.json({ ok: false, error: b.error.message }, { status: 500 })
  if (a.error) return Response.json({ ok: false, error: a.error.message }, { status: 500 })

  const fanlarByGroup: Record<string, { nom: string; tartib: number }[]> = {}
  for (const r of f.data ?? []) {
    const g = String(r.guruh || '').trim()
    if (!g) continue
    ;(fanlarByGroup[g] ??= []).push({ nom: String(r.nom || ''), tartib: Number(r.tartib || 0) })
  }

  const baholarByGroup: Record<string, Record<string, unknown>[]> = {}
  for (const r of b.data ?? []) {
    const g = String(r.guruh || '').trim()
    if (!g) continue
    ;(baholarByGroup[g] ??= []).push({
      pinfl: r.pinfl,
      fan: r.fan,
      guruh: g,
      yakuniy: num(r.yakuniy),
      joriy: num(r.joriy),
      oraliq: num(r.oraliq),
      r_semestr: num(r.r_semestr),
      yakuniy100: num(r.yakuniy100),
      joriy100: num(r.joriy100),
      oraliq100: num(r.oraliq100),
      r100: num(r.r100),
    })
  }

  const amaliyotByGroup: Record<string, Record<string, unknown>[]> = {}
  for (const r of a.data ?? []) {
    const g = String(r.guruh || '').trim()
    if (!g) continue
    ;(amaliyotByGroup[g] ??= []).push({
      pinfl: r.pinfl,
      nom: r.nom,
      guruh: g,
      ball: num(r.ball),
      ball100: num(r.ball100),
    })
  }

  return Response.json(
    { ok: true, semestr, fanlarByGroup, baholarByGroup, amaliyotByGroup },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
