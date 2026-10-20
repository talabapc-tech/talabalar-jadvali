'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Award, Check, FileText, IdCard, Loader2, Plus, Save, Sparkles, UserPlus, X } from 'lucide-react'
import { analyzeAndUploadDocs, getSavedAiModel, setSavedAiModel } from '@/lib/ai-doc'
import { getActiveAllowedModels } from '@/lib/settings'
import { YON_OPTIONS } from '@/lib/config'
import { decodePinfl, dobFromPinfl, findDuplicates, fullName, groupOptions, isAcademicLeave, isOfficialGroup, isWithdrawn } from '@/lib/student'
import type { EditFields, Student } from '@/lib/types'
import DocDropZone from './DocDropZone'
import { cx } from './ui'

interface Props {
  all: Student[]
  defaultGroup?: string
  onClose: () => void
  onAdd: (fields: EditFields, keepOpen?: boolean) => Promise<void>
}

function Input({ label, value, onChange, mono, placeholder, upper, highlight, required }: {
  label: string; value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string; upper?: boolean; highlight?: boolean; required?: boolean
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
        placeholder={placeholder}
        required={required}
        className={cx('field', mono && 'mono', highlight && 'border-emerald/70 ring-2 ring-emerald/20')}
        spellCheck={false}
      />
    </label>
  )
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field cursor-pointer">
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  )
}

function makeInitial(group?: string): EditFields {
  const validGroup = group && (isOfficialGroup(group) || isAcademicLeave(group) || isWithdrawn(group)) ? group : '26-02'
  return {
    ism: '',
    ota: '',
    pv: '',
    pinfl: '',
    dob: '',
    ber: '',
    doc_tur: 'Shahodatnoma',
    sh_doc: '',
    mak: '',
    yil: '2026',
    yon: validGroup === '26-01' ? 'Farmatsiya ishi' : 'Hamshiralik ishi - 3 yillik',
    shnum: '',
    group: validGroup,
    tel: '',
  }
}

export default function AddStudentModal({ all, defaultGroup, onClose, onAdd }: Props) {
  const [f, setF] = useState<EditFields>(() => makeInitial(defaultGroup))
  const [saving, setSaving] = useState(false)
  const [dobFlash, setDobFlash] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState('')
  const [allowedModels] = useState<[string, string][]>(() => getActiveAllowedModels())
  const [model, setModel] = useState<string>(() => {
    const saved = getSavedAiModel()
    const active = getActiveAllowedModels()
    if (active.some(([id]) => id === saved)) return saved
    return active[0]?.[0] || saved
  })
  const [passFiles, setPassFiles] = useState<File[]>([])
  const [certFiles, setCertFiles] = useState<File[]>([])
  const [docxFiles, setDocxFiles] = useState<File[]>([])

  const set = (k: keyof EditFields) => (v: string) => setF((x) => ({ ...x, [k]: v }))

  const runAutoFill = useCallback(async (docx = docxFiles) => {
    if (!docx.length && !passFiles.length && !certFiles.length) return
    setAiBusy(true)
    setAiMsg('Hujjat AI va QR orqali tahlil qilinmoqda…')
    try {
      const res = await analyzeAndUploadDocs({
        generalFiles: docx,
        passFiles,
        certFiles,
        student: { ism: f.ism, ota: f.ota, group: f.group },
        model,
      })
      setAiMsg(res.message)
      if (Object.keys(res.fields).length > 0 || res.docFile) {
        setF((prev) => {
          const next = { ...prev }
          for (const [k, val] of Object.entries(res.fields)) {
            if (val && k in next) (next as Record<string, string>)[k] = String(val)
          }
          if (res.docFile) next.doc_file = res.docFile
          if (next.pinfl && next.pinfl.length === 14 && !next.dob) {
            const d = dobFromPinfl(next.pinfl)
            if (d) next.dob = d
          }
          return next
        })
      }
    } catch (e) {
      setAiMsg(`Tahlil xatosi: ${(e as Error).message}`)
    } finally {
      setAiBusy(false)
    }
  }, [model, passFiles, certFiles, docxFiles])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dups = useMemo(() => findDuplicates(all, f.pv || '', f.pinfl || ''), [all, f.pv, f.pinfl])
  const pinDecoded = useMemo(() => decodePinfl(f.pinfl || ''), [f.pinfl])

  const onPinfl = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 14)
    const dob = dobFromPinfl(digits)
    setF((x) => ({ ...x, pinfl: digits, ...(digits.length === 14 && dob ? { dob } : {}) }))
    if (digits.length === 14 && dob) {
      setDobFlash(true)
      setTimeout(() => setDobFlash(false), 1200)
    }
  }

  const onGroupChange = (g: string) => {
    setF((x) => ({
      ...x,
      group: g,
      yon: g === '26-01' ? 'Farmatsiya ishi' : (x.yon === 'Farmatsiya ishi' ? 'Hamshiralik ishi - 3 yillik' : x.yon),
    }))
  }

  const submittingRef = useRef(false)

  const submit = async (keepOpen = false) => {
    if (submittingRef.current || saving) return
    if (!(f.ism || '').trim()) return
    if (dups.length && !confirm(
      "Diqqat! Pasport yoki JSHSHIR boshqa talabada ham bor:\n\n" +
      dups.map((d) => `• ${fullName(d.student)} (${d.student.group || '—'}, №${d.student.shnum || '—'})`).join('\n') +
      '\n\nBaribir qo\'shilsinmi?',
    )) return
    submittingRef.current = true
    setSaving(true)
    const finalFields = { ...f }
    if (!finalFields.doc_file && (docxFiles.length || passFiles.length || certFiles.length)) {
      try {
        const res = await analyzeAndUploadDocs({
          generalFiles: docxFiles,
          passFiles,
          certFiles,
          student: { ism: finalFields.ism, ota: finalFields.ota, group: finalFields.group },
          model,
        })
        if (res.docFile) finalFields.doc_file = res.docFile
      } catch {
        /* fayl biriktirish xatosi talabani kiritishni to'xtatmasin */
      }
    }
    try {
      await onAdd(finalFields, keepOpen)
      if (keepOpen) {
        setF(makeInitial(f.group))
      } else {
        onClose()
      }
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  const groupChoices = groupOptions(all)

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-stretch justify-center bg-ink-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="animate-pop-in flex h-full w-full max-w-[820px] flex-col overflow-hidden border-line-strong bg-ink-900 shadow-2xl shadow-black/60 sm:max-h-[92vh] sm:rounded-3xl sm:border"
        role="dialog"
        aria-modal="true"
        aria-label="Yangi talaba qo'shish"
      >
        <header className="flex items-center gap-3 border-b border-line bg-ink-850/80 px-5 py-3.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald/25 to-sky/25 text-emerald-soft">
            <UserPlus size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-extrabold text-fg">Yangi talaba qo'shish</h2>
            <p className="text-[12px] text-fg-muted">Excel bazaga va portal ro'yxatiga yangi talaba kiritish</p>
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

        <form
          className="flex-1 space-y-4 overflow-y-auto p-5"
          onSubmit={(e) => { e.preventDefault(); void submit(false) }}
        >
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-sky/35 bg-ink-950/60 p-3">
            <Sparkles size={16} className="text-sky" />
            <span className="text-[12.5px] font-bold text-fg">AI orqali to'ldirish:</span>
            <select
              value={model}
              onChange={(e) => { const m = e.target.value; setModel(m); setSavedAiModel(m) }}
              className="field h-8 w-auto min-w-[165px] py-1 pr-7 pl-2.5 text-[11.5px]"
              title="AI Tahlil modeli (Sozlamalar bo'limidan boshqariladi)"
            >
              {allowedModels.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <div className="w-full pt-1">
              <DocDropZone
                title="Shartnoma hujjati (.docx)"
                icon={FileText}
                tone="text-sky-soft"
                max={1}
                docxOnly
                hint="Bitta Word fayl — jadval, pasport va shahodatnoma AI tugmasi bosilganda o'qiladi"
                files={docxFiles}
                onChange={setDocxFiles}
                onMessage={setAiMsg}
                disabled={aiBusy}
              />
              <div className="mt-2 text-center text-[11px] text-fg-subtle">yoki hujjat rasmlarini alohida qo'ying</div>
            </div>
            <div className="grid w-full gap-2.5 sm:grid-cols-2">
              <DocDropZone title="Pasport / ID-karta" icon={IdCard} tone="text-blue-soft" max={2} hint="2 tagacha rasm (old va orqa tomoni)" files={passFiles} onChange={setPassFiles} onMessage={setAiMsg} disabled={aiBusy} />
              <DocDropZone title="Shahodatnoma / Diplom" icon={Award} tone="text-emerald-soft" max={1} files={certFiles} onChange={setCertFiles} onMessage={setAiMsg} disabled={aiBusy} />
            </div>
            <button
              type="button"
              className="btn-primary h-9 w-full justify-center text-[12.5px]"
              disabled={aiBusy || (!docxFiles.length && !passFiles.length && !certFiles.length)}
              onClick={() => void runAutoFill()}
            >
              {aiBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {aiBusy ? 'AI tahlil qilmoqda…' : "AI bilan maydonlarni to'ldirish"}
            </button>
            {aiMsg && <div className="w-full pt-1 text-[11.5px] text-sky-soft">{aiMsg}</div>}
          </div>

          <section className="rounded-2xl border border-line bg-ink-900/70 p-4">
            <h4 className="mb-3 flex items-center gap-2.5 text-[13px] font-bold text-fg">
              <span className="grid size-6 place-items-center rounded-lg bg-gradient-to-br from-blue to-sky text-[12px] font-extrabold text-ink-950">1</span>
              Shaxs va pasport ma'lumotlari
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Familiya va ism *" value={f.ism || ''} onChange={set('ism')} placeholder="Karimova Zilola" required />
              <Input label="Otasining ismi (Sharifi)" value={f.ota || ''} onChange={set('ota')} placeholder="Rustam qizi" />
              <Input label="Pasport / ID-karta seriya va №" value={f.pv || ''} onChange={set('pv')} mono upper placeholder="AD1234567" />
              <Input label="JSHSHIR (14 xonali PINFL)" value={f.pinfl || ''} onChange={onPinfl} mono placeholder="60406055720067" />
              <Input label="Tug'ilgan sana" value={f.dob || ''} onChange={set('dob')} mono placeholder="DD.MM.YYYY" highlight={dobFlash} />
              <Input label="Pasport berilgan sana" value={f.ber || ''} onChange={set('ber')} mono placeholder="DD.MM.YYYY" />
            </div>

            {pinDecoded && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-ink-950/50 px-3.5 py-2 text-[12px]">
                <span className="text-fg-muted">Jinsi: <b className="text-fg">{pinDecoded.jins}</b></span>
                <span className="text-fg-muted">Tug'ilgan sana: <b className="text-fg">{pinDecoded.sana}</b></span>
                <span className="text-fg-muted">Hudud: <b className="text-fg">{pinDecoded.joy}</b></span>
                <span className="ml-auto inline-flex items-center gap-1">
                  Nazorat raqami:{' '}
                  {pinDecoded.nazorat ? (
                    <span className="inline-flex items-center gap-1 font-bold text-emerald-soft">
                      to&apos;g&apos;ri <Check size={13} />
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-bold text-rose">
                      XATO <X size={13} />
                    </span>
                  )}
                </span>
              </div>
            )}

            {dups.length > 0 && (
              <div className="mt-3 flex gap-2 rounded-xl border border-rose/45 bg-rose/10 p-3 text-[12.5px] text-rose">
                <AlertTriangle size={16} className="mt-px shrink-0" />
                <span>Bu pasport/JSHSHIR bazada mavjud: <b>{dups.map((d) => `${fullName(d.student)} (${d.student.group})`).join(', ')}</b></span>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-ink-900/70 p-4">
            <h4 className="mb-3 flex items-center gap-2.5 text-[13px] font-bold text-fg">
              <span className="grid size-6 place-items-center rounded-lg bg-gradient-to-br from-emerald to-emerald-soft text-[12px] font-extrabold text-ink-950">2</span>
              Ta'lim hujjati (Shahodatnoma / Diplom)
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice label="Hujjat turi" value={f.doc_tur || 'Shahodatnoma'} onChange={set('doc_tur')} options={[['Shahodatnoma', 'Shahodatnoma'], ['Diplom', 'Diplom']]} />
              <Input label="Hujjat seriya va №" value={f.sh_doc || ''} onChange={set('sh_doc')} mono upper placeholder="UM 03752500" />
              <div className="sm:col-span-2">
                <Input label="Tugatgan ta'lim muassasasi" value={f.mak || ''} onChange={set('mak')} placeholder="Shahrisabz tumani 14-sonli maktab" />
              </div>
              <Input label="Bitirgan yili" value={f.yil || ''} onChange={set('yil')} mono placeholder="2026" />
              <Choice label="Yo'nalishi" value={f.yon || 'Hamshiralik ishi - 3 yillik'} onChange={set('yon')} options={YON_OPTIONS.map((y) => [y, y])} />
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-ink-900/70 p-4">
            <h4 className="mb-3 flex items-center gap-2.5 text-[13px] font-bold text-fg">
              <span className="grid size-6 place-items-center rounded-lg bg-gradient-to-br from-sky to-sky-soft text-[12px] font-extrabold text-ink-950">3</span>
              Shartnoma va akademik guruh
            </h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Shartnoma raqami" value={f.shnum || ''} onChange={set('shnum')} mono placeholder="319" />
              <Choice label="Akademik guruh" value={f.group || '26-02'} onChange={onGroupChange} options={groupChoices} />
              <Input label="Telefon raqami" value={f.tel || ''} onChange={set('tel')} placeholder="+998 90 123 45 67" />
            </div>
          </section>

          <div className="sticky -bottom-5 -mx-5 flex flex-wrap gap-2.5 border-t border-line bg-ink-900 px-5 pt-3 pb-5">
            <button type="submit" className="btn-success flex-1 py-2.5" disabled={saving || !(f.ism || '').trim()}>
              <Save size={16} /> {saving ? 'Saqlanmoqda…' : "Talabani qo'shish"}
            </button>
            <button
              type="button"
              className="btn-primary py-2.5"
              disabled={saving || !(f.ism || '').trim()}
              onClick={() => void submit(true)}
              title="Saqlab, oynani yopmasdan keyingi talabani kiritish"
            >
              <Plus size={16} /> Saqlash va yana qo'shish
            </button>
            <button type="button" className="btn-ghost py-2.5" onClick={onClose}>
              Bekor qilish
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
