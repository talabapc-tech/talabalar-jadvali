import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { applyGroupSettings } from '@/lib/config'
import { loadGroupSettings, loadStaff, loadStudents } from '@/lib/server/source'
import { getServiceSupabase } from '@/lib/server/supabase'
import {
  cleanText,
  studentRespondentKey,
  validateAndNormalizeAnswers,
  type OfficialGroupOption,
  type SurveyQuestion,
} from '@/lib/sorovnoma'
import { academicGroups, fullName, groupTitle, isOfficialGroup, isSecretGroup, kursOf } from '@/lib/student'

export const dynamic = 'force-dynamic'

const fail = (error: string, status = 400, extra?: Record<string, unknown>) =>
  Response.json({ ok: false, error, ...extra }, { status })

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

function isClosed(survey: { active?: boolean; expires_at?: string | null }): boolean {
  if (survey.active === false) return true
  if (survey.expires_at) {
    const ts = new Date(survey.expires_at).getTime()
    if (!Number.isNaN(ts) && ts < Date.now()) return true
  }
  return false
}

export async function GET(req: NextRequest) {
  try {
    const slug = cleanText(req.nextUrl.searchParams.get('slug'), 100).toLowerCase()
    if (!slug) return fail("So'rovnoma manzili (slug) ko'rsatilmagan")

    const db = getServiceSupabase()
    const { data: survey, error } = await db
      .from('sorovnomalar')
      .select('id, slug, title, description, audience, target_courses, target_groups, questions, active, allow_update, expires_at')
      .eq('slug', slug)
      .maybeSingle()

    if (error) return dbError(error)
    if (!survey) return fail("So'rovnoma topilmadi yoki o'chirilgan", 404)

    const closed = isClosed(survey)
    const keysRes = await selectAll((from, to) =>
      db.from('sorovnoma_javoblar').select('respondent_key').eq('survey_id', survey.id).order('id').range(from, to),
    )
    if (keysRes.error) return dbError(keysRes.error)
    const submittedKeys = new Set((keysRes.data ?? []).map((r) => String(r.respondent_key || '')))

    const groupSettings = await loadGroupSettings().catch(() => null)
    if (groupSettings) applyGroupSettings(groupSettings)

    const buildOfficialGroups = (studentsList: Awaited<ReturnType<typeof loadStudents>>): OfficialGroupOption[] =>
      academicGroups(studentsList)
        .filter((g) => !isSecretGroup(g))
        .map((code) => ({ code, kurs: kursOf(code) ?? 0, title: groupTitle(code) }))

    if (survey.audience === 'talabalar') {
      const studentsAll = await loadStudents()
      const courses: number[] = Array.isArray(survey.target_courses) ? survey.target_courses.map(Number) : []
      const groupsFilter: string[] = Array.isArray(survey.target_groups) ? survey.target_groups.map(String) : []

      // Ommaviy sahifaga FAQAT F.I.Sh., guruh, kurs va topshirgan holati beriladi (JSHSHIR/telefon emas!)
      const students = studentsAll
        .filter((s) => isOfficialGroup(s.group))
        .filter((s) => {
          const g = (s.group || '').trim()
          const k = kursOf(g) ?? 0
          if (courses.length > 0 && !courses.includes(k)) return false
          if (groupsFilter.length > 0 && !groupsFilter.includes(g)) return false
          return true
        })
        .map((s) => ({
          row: s.row,
          fish: fullName(s),
          group: (s.group || '').trim(),
          kurs: kursOf(s.group) ?? 0,
          topshirgan: submittedKeys.has(studentRespondentKey(s.pinfl, s.row)),
        }))

      return Response.json(
        { ok: true, survey, closed, students, groups: buildOfficialGroups(studentsAll) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    if (survey.audience === 'xodimlar') {
      const [staffAll, studentsAll] = await Promise.all([loadStaff(), loadStudents()])
      const staff = staffAll
        .filter((m) => m.status !== 'boshatilgan')
        .map((m) => ({
          id: m.id,
          fish: m.fish,
          kategoriya: (m.kategoriya || m.ish_turi || 'Xodim').trim(),
          lavozim: (m.lavozim || '').trim(),
          topshirgan: submittedKeys.has(`staff:${m.id}`),
        }))

      return Response.json(
        { ok: true, survey, closed, staff, groups: buildOfficialGroups(studentsAll) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const studentsAll = await loadStudents()
    return Response.json(
      { ok: true, survey, closed, totalSubmitted: submittedKeys.size, groups: buildOfficialGroups(studentsAll) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    return fail((e as Error).message, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return fail("Ma'lumot formati noto'g'ri")

    const slug = cleanText(body.slug, 100).toLowerCase()
    if (!slug) return fail("So'rovnoma manzili ko'rsatilmagan")

    const db = getServiceSupabase()
    const { data: survey, error: sErr } = await db
      .from('sorovnomalar')
      .select('*')
      .eq('slug', slug)
      .maybeSingle()

    if (sErr) return dbError(sErr)
    if (!survey) return fail("So'rovnoma topilmadi", 404)
    if (isClosed(survey)) {
      return fail("Bu so'rovnoma yopilgan yoki muddati tugagan", 403)
    }

    let respondentKey = ''
    let respondentName = ''
    let respondentGroup = ''
    let respondentPinfl = ''

    if (survey.audience === 'talabalar') {
      const rowNum = Number(body.studentRow)
      const groupStr = cleanText(body.studentGroup, 30)
      if (!Number.isInteger(rowNum) || rowNum < 2 || !groupStr) {
        return fail("Iltimos, guruh va talaba (F.I.Sh.) ni tanlang")
      }
      const studentsAll = await loadStudents()
      const found = studentsAll.find((s) => s.row === rowNum && (s.group || '').trim() === groupStr)
      if (!found || !isOfficialGroup(found.group)) {
        return fail("Tanlangan talaba bazada topilmadi", 404)
      }
      const courses: number[] = Array.isArray(survey.target_courses) ? survey.target_courses.map(Number) : []
      const groups: string[] = Array.isArray(survey.target_groups) ? survey.target_groups.map(String) : []
      const k = kursOf(found.group) ?? 0
      if ((courses.length > 0 && !courses.includes(k)) || (groups.length > 0 && !groups.includes((found.group || '').trim()))) {
        return fail("Bu so'rovnoma sizning guruhingiz uchun mo'ljallanmagan", 403)
      }
      respondentPinfl = String(found.pinfl || '').replace(/\D/g, '')
      respondentKey = studentRespondentKey(found.pinfl, found.row)
      respondentName = fullName(found)
      respondentGroup = (found.group || '').trim()
    } else if (survey.audience === 'xodimlar') {
      const staffId = cleanText(body.staffId, 40)
      if (!staffId) return fail("Iltimos, ro'yxatdan o'zingizni tanlang")
      const staffAll = await loadStaff()
      const found = staffAll.find((m) => m.id === staffId && m.status !== 'boshatilgan')
      if (!found) return fail("Tanlangan xodim bazada topilmadi", 404)
      respondentKey = `staff:${found.id}`
      respondentName = found.fish.trim()
      respondentGroup = (found.kategoriya || found.ish_turi || '').trim()
      respondentPinfl = String(found.pinfl || '').replace(/\D/g, '')
    } else {
      respondentName = cleanText(body.respondentName, 120)
      if (!respondentName || respondentName.length < 3) {
        return fail("Iltimos, ism-familiyangizni (F.I.Sh.) to'liq kiriting")
      }
      respondentGroup = cleanText(body.respondentGroup, 60)
      if (!respondentGroup) {
        return fail("Iltimos, guruhingizni tanlang")
      }
      respondentKey = `open:${crypto.randomUUID()}`
      respondentPinfl = ''
    }

    let alreadyExists = false
    if (survey.audience !== 'ochiq') {
      const ex = await db
        .from('sorovnoma_javoblar')
        .select('id')
        .eq('survey_id', survey.id)
        .eq('respondent_key', respondentKey)
        .maybeSingle()
      if (ex.error) return dbError(ex.error)
      alreadyExists = Boolean(ex.data)
      if (alreadyExists && survey.allow_update === false) {
        return fail("Siz bu so'rovnomani allaqachon topshirgansiz (qayta tahrirlash o'chirilgan)", 409)
      }
    }

    const questions: SurveyQuestion[] = Array.isArray(survey.questions) ? survey.questions : []
    const validated = validateAndNormalizeAnswers(
      questions,
      body.answers as Record<string, unknown> | undefined,
    )
    if (!validated.ok) {
      return fail(validated.firstError, 400, { fieldErrors: validated.errors })
    }

    const nowIso = new Date().toISOString()
    const payload = {
      survey_id: survey.id,
      respondent_key: respondentKey,
      respondent_type: survey.audience,
      respondent_name: respondentName,
      respondent_group: respondentGroup,
      respondent_pinfl: respondentPinfl,
      answers: validated.answers,
      updated_at: nowIso,
    }

    const { error: upErr } = await db
      .from('sorovnoma_javoblar')
      .upsert(payload, { onConflict: 'survey_id,respondent_key' })

    if (upErr) return dbError(upErr)

    return Response.json({
      ok: true,
      updated: alreadyExists,
      respondentName,
      respondentGroup,
    })
  } catch (e) {
    return fail((e as Error).message, 500)
  }
}
