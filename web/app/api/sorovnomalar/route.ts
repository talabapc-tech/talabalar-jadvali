import { NextRequest } from 'next/server'
import { getServiceSupabase } from '@/lib/server/supabase'
import {
  cleanText,
  makeSlug,
  sanitizeQuestions,
  type SurveyAudience,
} from '@/lib/sorovnoma'

export const dynamic = 'force-dynamic'

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status })

function dbError(e: { message: string; code?: string }) {
  const setup =
    e.code === '42P01' ||
    e.code === 'PGRST205' ||
    /relation.*does not exist|Could not find the table/i.test(e.message)
  return Response.json({ ok: false, error: e.message, setup }, { status: 500 })
}

type Page = PromiseLike<{ data: Record<string, any>[] | null; error: { message: string; code?: string } | null }> // eslint-disable-line @typescript-eslint/no-explicit-any

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

const VALID_AUDIENCES = new Set<SurveyAudience>(['talabalar', 'xodimlar', 'ochiq'])

function parseAudience(v: unknown): SurveyAudience {
  const s = String(v || 'talabalar') as SurveyAudience
  return VALID_AUDIENCES.has(s) ? s : 'talabalar'
}

function parseCourses(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 4))].sort((a, b) => a - b)
}

function parseGroups(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.map((x) => cleanText(x, 30)).filter(Boolean))].slice(0, 80)
}

function parseExpires(v: unknown): string | null {
  const s = cleanText(v, 40)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

async function generateUniqueSlug(db: ReturnType<typeof getServiceSupabase>, baseTitle: string): Promise<string> {
  const base = makeSlug(baseTitle)
  const existing = await db.from('sorovnomalar').select('id').eq('slug', base).limit(1)
  if (!existing.error && (!existing.data || existing.data.length === 0)) {
    return base
  }
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base.slice(0, 42)}-${suffix}`
}

export async function GET(req: NextRequest) {
  try {
    const db = getServiceSupabase()
    const id = cleanText(req.nextUrl.searchParams.get('id'), 64)

    if (id) {
      const [sRes, rRes] = await Promise.all([
        db.from('sorovnomalar').select('*').eq('id', id).maybeSingle(),
        selectAll((from, to) =>
          db
            .from('sorovnoma_javoblar')
            .select('*')
            .eq('survey_id', id)
            .order('updated_at', { ascending: false })
            .range(from, to),
        ),
      ])
      if (sRes.error) return dbError(sRes.error)
      if (!sRes.data) return fail("So'rovnoma topilmadi", 404)
      if (rRes.error) return dbError(rRes.error)
      return Response.json(
        { ok: true, survey: sRes.data, responses: rRes.data ?? [] },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const [surveysRes, countsRes] = await Promise.all([
      db.from('sorovnomalar').select('*').order('created_at', { ascending: false }),
      selectAll((from, to) => db.from('sorovnoma_javoblar').select('survey_id').order('id').range(from, to)),
    ])
    if (surveysRes.error) return dbError(surveysRes.error)
    if (countsRes.error) return dbError(countsRes.error)

    const counts: Record<string, number> = {}
    for (const row of countsRes.data ?? []) {
      const sid = String(row.survey_id || '')
      if (sid) counts[sid] = (counts[sid] ?? 0) + 1
    }

    const surveys = (surveysRes.data ?? []).map((s) => ({
      ...s,
      response_count: counts[String(s.id)] ?? 0,
    }))

    return Response.json({ ok: true, surveys }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return fail((e as Error).message, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return fail("JSON ma'lumot noto'g'ri")

    const action = cleanText(body.action, 32)
    const db = getServiceSupabase()

    if (action === 'create') {
      const title = cleanText(body.title, 200)
      if (!title) return fail("So'rovnoma sarlavhasi kiritilishi shart")
      const audience = parseAudience(body.audience)
      const slug = await generateUniqueSlug(db, cleanText(body.slug, 80) || title)

      const row = {
        slug,
        title,
        description: cleanText(body.description, 1000),
        audience,
        target_courses: audience === 'talabalar' ? parseCourses(body.target_courses) : [],
        target_groups: audience === 'talabalar' ? parseGroups(body.target_groups) : [],
        questions: sanitizeQuestions(body.questions),
        active: body.active !== false,
        allow_update: body.allow_update !== false,
        expires_at: parseExpires(body.expires_at),
      }

      const { data, error } = await db.from('sorovnomalar').insert(row).select('*').single()
      if (error) return dbError(error)
      return Response.json({ ok: true, survey: { ...data, response_count: 0 } })
    }

    if (action === 'update') {
      const id = cleanText(body.id, 64)
      if (!id) return fail("So'rovnoma ID si ko'rsatilmagan")
      const title = cleanText(body.title, 200)
      if (!title) return fail("So'rovnoma sarlavhasi bo'sh bo'lmasin")
      const audience = parseAudience(body.audience)

      const patch = {
        title,
        description: cleanText(body.description, 1000),
        audience,
        target_courses: audience === 'talabalar' ? parseCourses(body.target_courses) : [],
        target_groups: audience === 'talabalar' ? parseGroups(body.target_groups) : [],
        questions: sanitizeQuestions(body.questions),
        active: body.active !== false,
        allow_update: body.allow_update !== false,
        expires_at: parseExpires(body.expires_at),
        updated_at: new Date().toISOString(),
      }

      const { data, error } = await db.from('sorovnomalar').update(patch).eq('id', id).select('*').single()
      if (error) return dbError(error)
      return Response.json({ ok: true, survey: data })
    }

    if (action === 'toggleActive') {
      const id = cleanText(body.id, 64)
      if (!id) return fail("So'rovnoma ID si ko'rsatilmagan")
      const active = Boolean(body.active)
      const { error } = await db
        .from('sorovnomalar')
        .update({ active, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) return dbError(error)
      return Response.json({ ok: true, active })
    }

    if (action === 'duplicate') {
      const id = cleanText(body.id, 64)
      if (!id) return fail("So'rovnoma ID si ko'rsatilmagan")
      const src = await db.from('sorovnomalar').select('*').eq('id', id).maybeSingle()
      if (src.error) return dbError(src.error)
      if (!src.data) return fail("Manba so'rovnoma topilmadi", 404)

      const copyTitle = `${src.data.title} (nusxa)`.slice(0, 200)
      const slug = await generateUniqueSlug(db, copyTitle)
      const { data, error } = await db
        .from('sorovnomalar')
        .insert({
          slug,
          title: copyTitle,
          description: src.data.description || '',
          audience: src.data.audience,
          target_courses: src.data.target_courses ?? [],
          target_groups: src.data.target_groups ?? [],
          questions: src.data.questions ?? [],
          active: true,
          allow_update: src.data.allow_update ?? true,
          expires_at: null,
        })
        .select('*')
        .single()
      if (error) return dbError(error)
      return Response.json({ ok: true, survey: { ...data, response_count: 0 } })
    }

    if (action === 'delete') {
      const id = cleanText(body.id, 64)
      if (!id) return fail("So'rovnoma ID si ko'rsatilmagan")
      const { error } = await db.from('sorovnomalar').delete().eq('id', id)
      if (error) return dbError(error)
      return Response.json({ ok: true })
    }

    if (action === 'deleteResponse') {
      const surveyId = cleanText(body.surveyId, 64)
      const responseId = Number(body.responseId)
      if (!surveyId || !Number.isInteger(responseId)) return fail("Javob ID si noto'g'ri")
      const { error } = await db
        .from('sorovnoma_javoblar')
        .delete()
        .eq('id', responseId)
        .eq('survey_id', surveyId)
      if (error) return dbError(error)
      return Response.json({ ok: true })
    }

    return fail(`Noma'lum amal: ${action}`)
  } catch (e) {
    return fail((e as Error).message, 500)
  }
}
