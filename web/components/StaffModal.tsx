'use client'

import { useEffect, useState } from 'react'
import {
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Phone,
  Save,
  Trash2,
  User,
  UserCheck,
  X,
} from 'lucide-react'
import { STAFF_DEPARTMENTS, STAFF_WORK_TYPES, type StaffMember } from '@/lib/staff'

interface Props {
  member?: StaffMember | null
  onClose: () => void
  onSave: (data: Partial<StaffMember>) => Promise<void>
  onDelete?: (id: string, name: string) => Promise<void>
  hasPrev?: boolean
  hasNext?: boolean
  onNav?: (dir: -1 | 1) => void
}

const defaultMemberData = (): Partial<StaffMember> => ({
  fish: '',
  lavozim: "O'qituvchi",
  bolim: 'Pedagog',
  ish_turi: 'Shtat',
  stavka: '1.0',
  tel: '',
  pinfl: '',
  pv: '',
  dob: '',
  ishga_sana: '',
  maosh: '',
  status: 'faol',
  mutaxassislik: '',
  izoh: '',
})

export default function StaffModal({
  member,
  onClose,
  onSave,
  onDelete,
  hasPrev = false,
  hasNext = false,
  onNav,
}: Props) {
  const isEdit = Boolean(member?.id)

  const [f, setF] = useState<Partial<StaffMember>>(() => {
    if (member) return { ...member }
    return defaultMemberData()
  })

  useEffect(() => {
    if (member) {
      setF({ ...member })
    } else {
      setF(defaultMemberData())
    }
  }, [member])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof StaffMember) => (v: string) => setF((prev) => ({ ...prev, [k]: v }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft' && hasPrev && onNav) onNav(-1)
      if (e.key === 'ArrowRight' && hasNext && onNav) onNav(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, hasPrev, hasNext, onNav])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.fish?.trim()) {
      setError("Xodimning F.I.Sh kiritilishi shart")
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSave(f)
      onClose()
    } catch (err) {
      setError((err as Error).message || "Saqlashda xatolik yuz berdi")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-stretch justify-center bg-ink-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="animate-pop-in flex h-full w-full max-w-[720px] flex-col overflow-hidden border-line-strong bg-ink-900 shadow-2xl shadow-black/60 sm:max-h-[92vh] sm:rounded-3xl sm:border"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Xodim ma'lumotlarini tahrirlash" : "Yangi xodim qo'shish"}
      >
        <header className="flex items-center gap-3 border-b border-line bg-ink-850/80 px-5 py-3.5">
          {onNav && isEdit && (
            <div className="flex items-center gap-1 mr-1">
              <button
                type="button"
                disabled={!hasPrev}
                onClick={() => onNav(-1)}
                className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-ink-700 hover:text-fg disabled:opacity-30 transition-opacity"
                title="Oldingi xodim (Chapga)"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => onNav(1)}
                className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-ink-700 hover:text-fg disabled:opacity-30 transition-opacity"
                title="Keyingi xodim (O'ngga)"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald/25 to-sky/25 text-emerald-soft">
            <UserCheck size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-extrabold text-fg truncate">
              {isEdit ? f.fish || "Xodim ma'lumotlari" : "Yangi xodim qo'shish"}
            </h2>
            <p className="text-[12px] text-fg-muted truncate">
              {isEdit
                ? `${f.lavozim || ''} · ${f.bolim || ''}${member?.id ? ` · ID: ${member.id}` : ''}`
                : "Texnikum xodimlari ro'yxatiga yangi xodim kiritish"}
            </p>
          </div>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-xl text-fg-muted hover:bg-ink-700 hover:text-fg"
            onClick={onClose}
            title="Yopish (Esc)"
          >
            <X size={20} />
          </button>
        </header>

        <form onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="rounded-xl border border-rose/45 bg-rose/10 px-3.5 py-2.5 text-[12.5px] text-rose">
              {error}
            </div>
          )}

          {/* 1. Asosiy ma'lumotlar */}
          <section className="rounded-2xl border border-line bg-ink-900/70 p-4">
            <h4 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-fg">
              <User size={15} className="text-sky" />
              <span>Asosiy shaxsiy ma&apos;lumotlar</span>
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block">
                  <span className="label">F.I.Sh (To&apos;liq ism-familiyasi) *</span>
                  <input
                    value={f.fish || ''}
                    onChange={(e) => set('fish')(e.target.value)}
                    placeholder="Masalan: Karimova Zilola Rustam qizi"
                    required
                    className="field font-semibold"
                    autoFocus
                  />
                </label>
              </div>

              <label className="block">
                <span className="label">Telefon raqami</span>
                <input
                  value={f.tel || ''}
                  onChange={(e) => set('tel')(e.target.value)}
                  placeholder="+998 90 123 45 67"
                  className="field mono"
                />
              </label>

              <label className="block">
                <span className="label">Tug&apos;ilgan sana</span>
                <input
                  value={f.dob || ''}
                  onChange={(e) => set('dob')(e.target.value)}
                  placeholder="DD.MM.YYYY"
                  className="field mono"
                />
              </label>

              <label className="block">
                <span className="label">Pasport / ID-karta seriya va №</span>
                <input
                  value={f.pv || ''}
                  onChange={(e) => set('pv')(e.target.value.toUpperCase())}
                  placeholder="AD1234567"
                  className="field mono uppercase"
                />
              </label>

              <label className="block">
                <span className="label">JSHSHIR (14 xonali PINFL)</span>
                <input
                  value={f.pinfl || ''}
                  onChange={(e) => set('pinfl')(e.target.value.replace(/\D/g, '').slice(0, 14))}
                  placeholder="30102935680021"
                  className="field mono"
                />
              </label>
            </div>
          </section>

          {/* 2. Ish faoliyati va lavozimi */}
          <section className="rounded-2xl border border-line bg-ink-900/70 p-4">
            <h4 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-fg">
              <Briefcase size={15} className="text-emerald" />
              <span>Ish faoliyati va lavozimi</span>
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Lavozimi *</span>
                <input
                  value={f.lavozim || ''}
                  onChange={(e) => set('lavozim')(e.target.value)}
                  placeholder="O'qituvchi, Hamshira, ..."
                  required
                  className="field"
                />
              </label>

              <label className="block">
                <span className="label">Bo&apos;limi / Yo&apos;nalishi</span>
                <select
                  value={f.bolim || "Ma'muriy"}
                  onChange={(e) => set('bolim')(e.target.value)}
                  className="field cursor-pointer"
                >
                  {STAFF_DEPARTMENTS.filter((d) => d !== 'Barchasi').map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                  <option value="Boshqa">Boshqa bo&apos;lim</option>
                </select>
              </label>

              <label className="block">
                <span className="label">Ish turi</span>
                <select
                  value={f.ish_turi || 'Shtat'}
                  onChange={(e) => set('ish_turi')(e.target.value)}
                  className="field cursor-pointer"
                >
                  {STAFF_WORK_TYPES.filter((t) => t !== 'Barchasi').map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="label">Stavka / Yuklama</span>
                <input
                  value={f.stavka || ''}
                  onChange={(e) => set('stavka')(e.target.value)}
                  placeholder="1.0, 0.75, 0.5, ..."
                  className="field"
                />
              </label>

              <label className="block">
                <span className="label">Ishga qabul qilingan sana</span>
                <input
                  value={f.ishga_sana || ''}
                  onChange={(e) => set('ishga_sana')(e.target.value)}
                  placeholder="DD.MM.YYYY"
                  className="field mono"
                />
              </label>

              <label className="block">
                <span className="label">Oylik maosh / Stavka (so&apos;m)</span>
                <input
                  value={f.maosh || ''}
                  onChange={(e) => set('maosh')(e.target.value)}
                  placeholder="Masalan: 4 500 000"
                  className="field"
                />
              </label>

              <label className="block">
                <span className="label">Mutaxassisligi / Ma&apos;lumoti</span>
                <input
                  value={f.mutaxassislik || ''}
                  onChange={(e) => set('mutaxassislik')(e.target.value)}
                  placeholder="Oliy / Shifokor / Hamshira..."
                  className="field"
                />
              </label>

              <label className="block">
                <span className="label">Holati</span>
                <select
                  value={f.status || 'faol'}
                  onChange={(e) => set('status')(e.target.value as 'faol' | 'tatilda' | 'boshatilgan')}
                  className="field cursor-pointer"
                >
                  <option value="faol">Faol ishlamoqda</option>
                  <option value="tatilda">Ta&apos;tilda (Mehnat / Homiladorlik)</option>
                  <option value="boshatilgan">Ishdan bo&apos;shatilgan</option>
                </select>
              </label>
            </div>

            <div className="mt-3">
              <label className="block">
                <span className="label">Qo&apos;shimcha izoh</span>
                <input
                  value={f.izoh || ''}
                  onChange={(e) => set('izoh')(e.target.value)}
                  placeholder="Xodim bo'yicha qo'shimcha eslatmalar..."
                  className="field"
                />
              </label>
            </div>
          </section>

          <footer className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-between gap-2.5 border-t border-line bg-ink-900/95 p-4 backdrop-blur-md">
            <div>
              {isEdit && onDelete && member?.id && (
                <button
                  type="button"
                  className="btn-ghost h-10 px-3.5 text-[12.5px] text-rose hover:bg-rose/15 flex items-center gap-1.5"
                  onClick={async () => {
                    await onDelete(member.id, member.fish)
                    onClose()
                  }}
                  disabled={saving}
                  title="Xodimni ro'yxatdan o'chirish"
                >
                  <Trash2 size={15} />
                  <span>O&apos;chirish</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-ghost h-10 px-4 text-[13px]" onClick={onClose} disabled={saving}>
                Bekor qilish
              </button>
              <button type="submit" className="btn-success h-10 px-5 text-[13px]" disabled={saving}>
                <Save size={15} />
                <span>{saving ? 'Saqlanmoqda…' : isEdit ? "O'zgarishlarni saqlash" : "Xodimni qo'shish"}</span>
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}
