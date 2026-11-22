'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, MapPin, Phone, Send } from 'lucide-react'
import { COURSES } from '@/lib/config'

interface SurveyStudent {
  row: number
  fish: string
  group: string
  topshirgan: boolean
}

function kursOfGroup(g: string): number | null {
  const found = COURSES.find((c) => c.groups.includes(g))
  if (found) return found.kurs
  const m = /^(\d{2})-\d{2}$/.exec(g)
  return m ? Math.max(1, 2026 - (2000 + Number(m[1])) + 1) : null
}

function SorovnomaForm() {
  const params = useSearchParams()
  const initialGroup = params.get('guruh')?.trim() || ''

  const [students, setStudents] = useState<SurveyStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')

  const [kurs, setKurs] = useState('')
  const [group, setGroup] = useState(initialGroup)
  const [rowStr, setRowStr] = useState('')
  const [searchFish, setSearchFish] = useState('')

  const [dob, setDob] = useState('')
  const [tuman, setTuman] = useState('')
  const [mfy, setMfy] = useState('')
  const [kocha, setKocha] = useState('')
  const [uy, setUy] = useState('')
  const [qatnov, setQatnov] = useState("O'z uyidan")
  const [telShaxsiy, setTelShaxsiy] = useState('')
  const [telOtaona, setTelOtaona] = useState('')
  const [kim, setKim] = useState('Onasi')

  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState('')
  const [done, setDone] = useState<{ fish: string; group: string } | null>(null)

  useEffect(() => {
    fetch('/api/sorovnoma', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b: { ok?: boolean; students?: SurveyStudent[]; error?: string }) => {
        if (!b.ok || !Array.isArray(b.students)) throw new Error(b.error || "Ro'yxatni yuklab bo'lmadi")
        setStudents(b.students)
        if (initialGroup) {
          const k = kursOfGroup(initialGroup)
          if (k) setKurs(String(k))
        }
      })
      .catch((e: Error) => setLoadErr(e.message))
      .finally(() => setLoading(false))
  }, [initialGroup])

  const groups = useMemo(() => {
    const set = new Set<string>()
    for (const s of students) {
      if (kurs && kursOfGroup(s.group) !== Number(kurs)) continue
      set.add(s.group)
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [students, kurs])

  const groupStudents = useMemo(() => {
    const q = searchFish.trim().toLowerCase()
    return students
      .filter((s) => (!group ? false : s.group === group))
      .filter((s) => (!q ? true : s.fish.toLowerCase().includes(q)))
      .sort((a, b) => a.fish.localeCompare(b.fish, 'uz'))
  }, [students, group, searchFish])

  const selectedStudent = useMemo(
    () => students.find((s) => String(s.row) === rowStr && s.group === group) ?? null,
    [students, rowStr, group],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitErr('')
    if (!selectedStudent) {
      setSubmitErr('Iltimos, guruhingiz va F.I.Sh. ingizni tanlang')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/sorovnoma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          row: selectedStudent.row,
          group: selectedStudent.group,
          dob,
          manzil_tuman: tuman,
          manzil_mfy: mfy,
          manzil_kocha: kocha,
          manzil_uy: uy,
          qatnov,
          tel_shaxsiy: telShaxsiy,
          tel_otaona: telOtaona,
          tel_otaona_kim: kim,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fish?: string; group?: string }
      if (!res.ok || !body.ok) throw new Error(body.error || `Server xatosi (${res.status})`)
      setStudents((prev) => prev.map((s) => (s.row === selectedStudent.row ? { ...s, topshirgan: true } : s)))
      setDone({ fish: body.fish || selectedStudent.fish, group: body.group || selectedStudent.group })
    } catch (err) {
      setSubmitErr((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const resetForAnother = () => {
    setDone(null)
    setRowStr('')
    setSearchFish('')
    setDob('')
    setTuman('')
    setMfy('')
    setKocha('')
    setUy('')
    setTelShaxsiy('')
    setTelOtaona('')
    setSubmitErr('')
  }

  return (
    <div className="min-h-screen bg-ink-950 px-3 py-6 text-fg sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <header className="panel flex items-center gap-3 p-4 sm:p-5">
          <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border border-sky/40 bg-ink-900 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="ShTT" className="size-12 object-contain" />
          </div>
          <div>
            <h1 className="text-[17px] font-extrabold tracking-tight text-fg sm:text-[19px]">
              Talabalar so&apos;rovnomasi (1–3-kurs)
            </h1>
            <p className="text-[12.5px] text-fg-muted">
              Shahrisabz Tibbiyot Texnikumi · Yashash manzili va aloqa telefonlari bazasi
            </p>
          </div>
        </header>

        {loading ? (
          <div className="panel flex items-center justify-center gap-2 py-14 text-[13px] text-fg-muted">
            <Loader2 size={18} className="animate-spin text-sky" /> Ro&apos;yxat yuklanmoqda…
          </div>
        ) : loadErr ? (
          <div className="panel border-rose/40 bg-rose/5 p-5 text-[13px] text-rose">{loadErr}</div>
        ) : done ? (
          <div className="panel space-y-4 p-6 text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-full border border-emerald/40 bg-emerald/15 text-emerald-soft">
              <CheckCircle2 size={30} />
            </div>
            <div>
              <h2 className="text-[17px] font-bold text-fg">Ma&apos;lumotlaringiz saqlandi!</h2>
              <p className="mt-1 text-[13px] text-fg-muted">
                <b className="text-fg">{done.fish}</b> ({done.group}-guruh) uchun manzil va telefon raqamlari bazaga kiritildi.
              </p>
            </div>
            <button type="button" onClick={resetForAnother} className="btn-primary mx-auto h-10 px-5">
              Boshqa talaba uchun to&apos;ldirish
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="panel space-y-4 p-4 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="s-kurs">
                  Kurs
                </label>
                <select
                  id="s-kurs"
                  className="field h-10"
                  value={kurs}
                  onChange={(e) => {
                    setKurs(e.target.value)
                    setGroup('')
                    setRowStr('')
                  }}
                >
                  <option value="">Barcha kurslar</option>
                  {COURSES.map((c) => (
                    <option key={c.kurs} value={String(c.kurs)}>
                      {c.kurs}-kurs
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="s-group">
                  Guruh *
                </label>
                <select
                  id="s-group"
                  className="field h-10 font-semibold"
                  value={group}
                  required
                  onChange={(e) => {
                    setGroup(e.target.value)
                    setRowStr('')
                    setSearchFish('')
                  }}
                >
                  <option value="">Guruhni tanlang…</option>
                  {groups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="s-fish">
                Talaba (F.I.Sh.) *
              </label>
              {group && (
                <input
                  type="search"
                  className="field mb-2 h-9"
                  placeholder="Ismingizni tez topish uchun yozing…"
                  value={searchFish}
                  onChange={(e) => setSearchFish(e.target.value)}
                />
              )}
              <select
                id="s-fish"
                className="field h-10"
                value={rowStr}
                required
                disabled={!group}
                onChange={(e) => setRowStr(e.target.value)}
              >
                <option value="">{group ? `Talabani tanlang (${groupStudents.length} ta)…` : 'Avval guruhni tanlang'}</option>
                {groupStudents.map((s) => (
                  <option key={s.row} value={String(s.row)}>
                    {s.fish} {s.topshirgan ? '✓ (topshirgan)' : ''}
                  </option>
                ))}
              </select>
              {selectedStudent?.topshirgan && (
                <p className="mt-1 text-[11.5px] text-amber">
                  Bu talaba avval topshirgan — qayta yuborsangiz ma&apos;lumotlar yangilanadi.
                </p>
              )}
            </div>

            <div className="border-t border-line pt-3">
              <div className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-bold text-sky-soft">
                <MapPin size={14} /> Yashash manzili va qatnov
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="s-tuman">
                    Tuman / Shahar *
                  </label>
                  <input
                    id="s-tuman"
                    className="field h-10"
                    required
                    placeholder="Masalan: Shahrisabz tumani"
                    value={tuman}
                    onChange={(e) => setTuman(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="s-mfy">
                    MFY / Mahalla *
                  </label>
                  <input
                    id="s-mfy"
                    className="field h-10"
                    required
                    placeholder="Masalan: Chorshanbe MFY"
                    value={mfy}
                    onChange={(e) => setMfy(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="s-kocha">
                    Ko&apos;cha / Qishloq
                  </label>
                  <input
                    id="s-kocha"
                    className="field h-10"
                    placeholder="Masalan: Navbahor ko'chasi"
                    value={kocha}
                    onChange={(e) => setKocha(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="s-uy">
                    Uy / Xonadon raqami
                  </label>
                  <input
                    id="s-uy"
                    className="field h-10"
                    placeholder="Masalan: 15-uy"
                    value={uy}
                    onChange={(e) => setUy(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="s-qatnov">
                    Texnikumga qatnov holati
                  </label>
                  <select id="s-qatnov" className="field h-10" value={qatnov} onChange={(e) => setQatnov(e.target.value)}>
                    <option value="O'z uyidan">O&apos;z uyidan</option>
                    <option value="Ijarada">Ijarada</option>
                    <option value="Yaqin qarindoshinikidan">Yaqin qarindoshinikidan</option>
                    <option value="Yotoqxonada">Yotoqxonada</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="s-dob">
                    Tug&apos;ilgan sana (ixtiyoriy)
                  </label>
                  <input
                    id="s-dob"
                    className="field h-10"
                    placeholder="KK.OO.YYYY (15.05.2007)"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-line pt-3">
              <div className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-bold text-emerald-soft">
                <Phone size={14} /> Telefon raqamlari
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor="s-tel1">
                    Talabaning o&apos;z telefoni *
                  </label>
                  <input
                    id="s-tel1"
                    type="tel"
                    className="field h-10"
                    required
                    placeholder="+998 90 123 45 67"
                    value={telShaxsiy}
                    onChange={(e) => setTelShaxsiy(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="s-tel2">
                    Ota-onasi / yaqinining telefoni
                  </label>
                  <input
                    id="s-tel2"
                    type="tel"
                    className="field h-10"
                    placeholder="+998 91 234 56 78"
                    value={telOtaona}
                    onChange={(e) => setTelOtaona(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="s-kim">
                    Kimniki?
                  </label>
                  <select id="s-kim" className="field h-10" value={kim} onChange={(e) => setKim(e.target.value)}>
                    <option value="Onasi">Onasi</option>
                    <option value="Otasi">Otasi</option>
                    <option value="Otasi / Onasi">Otasi / Onasi</option>
                    <option value="Turmush o'rtog'i">Turmush o&apos;rtog&apos;i</option>
                    <option value="Akasi / Opasi">Akasi / Opasi</option>
                    <option value="Boshqa">Boshqa</option>
                  </select>
                </div>
              </div>
            </div>

            {submitErr && (
              <div className="rounded-xl border border-rose/40 bg-rose/10 px-3 py-2 text-[12.5px] text-rose">
                {submitErr}
              </div>
            )}

            <button type="submit" disabled={submitting} className="btn-primary h-11 w-full justify-center text-[14px] font-bold">
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
              <span>{submitting ? 'Saqlanmoqda…' : "Ma'lumotlarni yuborish"}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function SorovnomaPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-ink-950 grid place-items-center text-[13px] text-fg-muted">
          Yuklanmoqda…
        </div>
      }
    >
      <SorovnomaForm />
    </Suspense>
  )
}
