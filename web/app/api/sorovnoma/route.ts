import { NextRequest } from 'next/server'
import { invalidateCache, loadStudents, readRepoFile, saveRepoJsonFile, sendChange } from '@/lib/server/source'
import { fullName, isOfficialGroup } from '@/lib/student'

export const dynamic = 'force-dynamic'

const SURVEY_PATH = 'data/sorovnoma_1kurs.json'
const UZB_PREFIXES = new Set([
  '90', '91', '92', '93', '94', '95', '97', '98', '99',
  '88', '77', '33', '50', '55', '70', '71', '75', '76', '78', '20',
])

type SurveyMap = Record<string, Record<string, unknown>>
let sorovnomaOverlay: SurveyMap | null = null

async function loadSurveyMap(): Promise<SurveyMap> {
  if (sorovnomaOverlay) return sorovnomaOverlay
  try {
    const buf = await readRepoFile([SURVEY_PATH], { maxAgeMs: 30_000 })
    if (buf) {
      const parsed = JSON.parse(buf.toString('utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as SurveyMap
    }
  } catch { /* bo'sh */ }
  return {}
}

function formatUzbPhone(raw: string): string | null {
  let d = String(raw || '').replace(/\D/g, '')
  if (d.startsWith('998') && d.length === 12) d = d.slice(3)
  else if (d.startsWith('8') && d.length === 10 && !d.startsWith('88')) d = d.slice(1)
  if (d.length !== 9 || !UZB_PREFIXES.has(d.slice(0, 2))) return null
  return `+998 ${d.slice(0, 2)} ${d.slice(2, 5)}-${d.slice(5, 7)}-${d.slice(7)}`
}

const cleanStr = (v: unknown, max = 120) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)

export async function GET() {
  try {
    const [students, surveyMap] = await Promise.all([loadStudents(), loadSurveyMap()])
    const submittedPinfls = new Set<string>()
    const submittedRows = new Set<number>()
    for (const [k, rec] of Object.entries(surveyMap)) {
      if (!rec || rec.topshirgan !== true) continue
      const p = String(rec.pinfl || '').replace(/\s/g, '')
      if (p.length === 14) submittedPinfls.add(p)
      const r = Number(rec.row ?? k)
      if (Number.isInteger(r)) submittedRows.add(r)
    }

    // Ommaviy ro'yxatda faqat F.I.Sh., guruh, qator va topshirgan holati qaytariladi (JSHSHIR/telefon emas)
    const list = students
      .filter((s) => isOfficialGroup(s.group))
      .map((s) => {
        const pin = String(s.pinfl || '').replace(/\s/g, '')
        const topshirgan = (pin.length === 14 && submittedPinfls.has(pin)) || submittedRows.has(s.row)
        return {
          row: s.row,
          fish: fullName(s),
          group: s.group,
          topshirgan,
        }
      })

    return Response.json({ ok: true, students: list }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return Response.json({ ok: false, error: "Ma'lumot formati noto'g'ri" }, { status: 400 })
  }

  const row = Number(body.row)
  const group = cleanStr(body.group, 30)
  if (!Number.isInteger(row) || row < 2 || !group) {
    return Response.json({ ok: false, error: 'Guruh va talaba tanlanishi shart' }, { status: 400 })
  }

  const telShaxsiy = formatUzbPhone(cleanStr(body.tel_shaxsiy, 30))
  if (!telShaxsiy) {
    return Response.json(
      { ok: false, error: "Shaxsiy telefon raqami noto'g'ri (masalan: 90 123 45 67)" },
      { status: 400 },
    )
  }

  const rawOtaTel = cleanStr(body.tel_otaona, 30)
  let telOtaona = ''
  if (rawOtaTel) {
    const fmt = formatUzbPhone(rawOtaTel)
    if (!fmt) {
      return Response.json(
        { ok: false, error: "Ota-ona/yaqinining telefon raqami noto'g'ri (masalan: 91 234 56 78)" },
        { status: 400 },
      )
    }
    telOtaona = fmt
  }

  const tuman = cleanStr(body.manzil_tuman, 100)
  const mfy = cleanStr(body.manzil_mfy, 120)
  const kocha = cleanStr(body.manzil_kocha, 120)
  const uy = cleanStr(body.manzil_uy, 50)
  const qatnov = cleanStr(body.qatnov, 80)
  const kim = telOtaona ? cleanStr(body.tel_otaona_kim, 50) || 'Otasi / Onasi' : ''
  const dob = cleanStr(body.dob, 20)

  if (!tuman || !mfy) {
    return Response.json({ ok: false, error: 'Tuman/shahar va MFY nomi kiritilishi shart' }, { status: 400 })
  }

  try {
    const students = await loadStudents()
    const st = students.find((s) => s.row === row && s.group === group && isOfficialGroup(s.group))
    if (!st) {
      return Response.json({ ok: false, error: 'Tanlangan talaba bazadan topilmadi' }, { status: 404 })
    }

    const manzil_toliq = [tuman, mfy, kocha, uy].filter(Boolean).join(', ')
    const tel = telOtaona ? `${telShaxsiy} / ${telOtaona}${kim ? ` (${kim})` : ''}` : telShaxsiy
    const fish = fullName(st)
    const pinfl = String(st.pinfl || '').replace(/\s/g, '')

    const currentMap = { ...(await loadSurveyMap()) }
    const key = String(st.row)
    currentMap[key] = {
      row: st.row,
      tr: st.tr,
      fish,
      pinfl,
      group: st.group,
      topshirgan: true,
      timestamp: new Date().toISOString(),
      dob: dob || st.dob || '',
      manzil_tuman: tuman,
      manzil_mfy: mfy,
      manzil_kocha: kocha,
      manzil_uy: uy,
      manzil_toliq,
      qatnov,
      tel_shaxsiy: telShaxsiy,
      tel_otaona: telOtaona,
      tel_otaona_kim: kim,
      tel,
    }
    const sorted = Object.fromEntries(Object.entries(currentMap).sort(([a], [b]) => Number(a) - Number(b)))
    await saveRepoJsonFile(SURVEY_PATH, sorted, `So'rovnoma: ${fish} (${st.group})`)
    sorovnomaOverlay = sorted
    invalidateCache()

    await sendChange({
      type: 'update_student',
      data: {
        row: st.row,
        pinfl: st.pinfl,
        shnum: st.shnum,
        ism: st.ism,
        fields: {
          tel,
          ...(dob && !st.dob ? { dob } : {}),
        },
      },
    })

    return Response.json({ ok: true, fish, group: st.group })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
