'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Camera, Check, ChevronLeft, ChevronRight, FileText, Link2, Loader2, Pencil, Save, ScrollText, Trash2, X } from 'lucide-react'
import { YON_OPTIONS } from '@/lib/config'
import { removeStudentPhoto, uploadStudentPhotoFile } from '@/lib/photo-upload'
import { decodePinfl, dobFromPinfl, findDuplicates, formatPinfl, fullName, groupOptions, isAcademicLeave, isLeftGroup, isOfficialGroup, isSecretGroup, isWithdrawn, lastMoveInto, NAME_FLAGS, needsOrder, ORDER_DATE_RE } from '@/lib/student'
import { EDIT_FIELDS, type EditFields, type GroupMove, type Student } from '@/lib/types'
import type { BuyruqHint } from '@/lib/buyruq'
import BuyruqModal from './BuyruqModal'
import DocImages from './DocImages'
import Lightbox from './Lightbox'
import MalumotnomaModal from './MalumotnomaModal'
import StudentAvatar from './StudentAvatar'
import type { Notify } from './Toast'
import { BazaButton, CopyBtn, cx, formatPassportBundle, GroupBadge, Mono, StatusIcon } from './ui'

interface Props {
  student: Student
  all: Student[]
  hasPrev: boolean
  hasNext: boolean
  onNav: (dir: -1 | 1) => void
  onClose: () => void
  onSave: (s: Student, fields: EditFields) => Promise<void>
  onToggleBaza: (s: Student) => void
  onDelete: (s: Student) => Promise<void>
  onOpenRow: (row: number) => void
  onPhotoChange?: (s: Student, photoUrl: string | undefined) => void
  notify?: Notify
}

function Section({ n, title, children, tone = 'blue', action }: { n: number; title: string; children: React.ReactNode; tone?: 'blue' | 'emerald' | 'sky' | 'amber'; action?: React.ReactNode }) {
  const tones = { blue: 'from-blue to-sky', emerald: 'from-emerald to-emerald-soft', sky: 'from-sky to-sky-soft', amber: 'from-amber to-amber-soft' }
  return (
    <section className="rounded-xl border border-line bg-ink-900/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2.5 text-[13px] font-bold text-fg">
          <span className={cx('grid size-6 place-items-center rounded-lg bg-gradient-to-br text-[12px] font-extrabold text-ink-950', tones[tone])}>{n}</span>
          {title}
        </h4>
        {action}
      </div>
      {children}
    </section>
  )
}

function Row({ label, children, copyValue, copyLabel, onCopied }: { label: string; children: React.ReactNode; copyValue?: string; copyLabel?: string; onCopied?: (msg: string) => void }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2 last:border-0">
      <span className="shrink-0 text-[12.5px] text-fg-muted">{label}</span>
      <span className="inline-flex min-w-0 items-center justify-end gap-1.5 text-right text-[13.5px] font-semibold break-words text-fg">
        <span className="min-w-0 break-words">{children}</span>
        {copyValue?.trim() && <CopyBtn value={copyValue} label={copyLabel || label} onCopied={onCopied} />}
      </span>
    </div>
  )
}

/** Tizimga kiritilgan vaqt: 14.10.2026 15:20 */
function fmtMoment(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '')
}

const groupLabel = (g: string) => isAcademicLeave(g) ? "Akademik ta'til" : isWithdrawn(g) ? 'Safdan chiqarilgan' : g || 'Guruhsiz'

/** Guruh almashtirishlar ro'yxati (yangisi tepada) */
function GroupHistory({ moves }: { moves: GroupMove[] }) {
  return (
    <ol className="mt-2 space-y-1.5 border-t border-line/70 pt-3">
      {[...moves].reverse().map((m, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12.5px]">
          <span className="mono font-semibold text-fg">{groupLabel(m.from)}</span>
          <span className="text-fg-subtle">→</span>
          <span className={cx('font-semibold', isLeftGroup(m.to) ? (isWithdrawn(m.to) ? 'text-rose' : 'text-violet') : 'mono text-fg')}>{groupLabel(m.to)}</span>
          {m.buyruq_sana && <span className="mono text-sky-soft">{m.buyruq ? `${m.buyruq}, ` : ''}{m.buyruq_sana}</span>}
          <span className="ml-auto text-[11.5px] text-fg-subtle">
            {m.vaqt ? `kiritilgan ${fmtMoment(m.vaqt)}` : "qo'lda kiritilgan"}{m.manba === 'tarix' ? ' (tarixdan tiklangan)' : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}

function PinflCard({ pinfl }: { pinfl: string }) {
  const p = decodePinfl(pinfl)
  if (!pinfl) return null
  if (!p) return <div className="mt-3 rounded-xl border border-amber/30 bg-amber/5 px-3 py-2 text-[12.5px] text-amber">JSHSHIR 14 xonali emas</div>
  const seg = (t: string, cls: string, title: string) => <span title={title} className={cx('rounded px-1', cls)}>{t}</span>
  return (
    <div className="mt-3 rounded-xl border border-line bg-ink-950/50 p-3">
      <div className="mono mb-2.5 flex flex-wrap gap-0.5 text-[16px] font-bold">
        {seg(p.raw[0], 'bg-violet/20 text-violet', 'Jinsi va asr')}
        {seg(p.raw.slice(1, 7), 'bg-sky/15 text-sky-soft', "Tug'ilgan sana KKOOYY")}
        {seg(p.raw.slice(7, 10), 'bg-emerald/15 text-emerald-soft', 'Hudud kodi')}
        {seg(p.raw.slice(10, 13), 'bg-blue/15 text-blue-soft', 'Tartib raqami')}
        {seg(p.raw[13], p.nazorat ? 'bg-emerald/25 text-emerald-soft' : 'bg-rose/25 text-rose', 'Nazorat raqami')}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <span className="text-fg-muted">Jinsi: <b className="text-fg">{p.jins}</b></span>
        <span className="text-fg-muted">Sana: <b className="text-fg">{p.sana}</b></span>
        <span className="col-span-2 text-fg-muted">Hudud: <b className="text-fg">{p.kod} — {p.joy}</b></span>
        <span className="col-span-2 text-fg-muted inline-flex items-center gap-1">
          Nazorat raqami:{' '}
          {p.nazorat ? (
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
    </div>
  )
}

function Input({ label, value, onChange, mono, placeholder, upper, highlight, inputMode }: {
  label: string; value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string; upper?: boolean; highlight?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={cx('field', mono && 'mono', highlight && 'border-emerald/70 ring-2 ring-emerald/20')}
        spellCheck={false}
      />
    </label>
  )
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const opts = options.some(([v]) => v === value) ? options : [[value, value] as [string, string], ...options]
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field cursor-pointer">
        {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  )
}

function EditForm({ student, all, onCancel, onSave }: { student: Student; all: Student[]; onCancel: () => void; onSave: (f: EditFields) => Promise<void> }) {
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(EDIT_FIELDS.map((k) => [k, String(student[k] ?? '')])))
  const [saving, setSaving] = useState(false)
  const [dobFlash, setDobFlash] = useState(false)
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }))

  const dups = useMemo(() => findDuplicates(all, f.pv, f.pinfl, student.row), [all, f.pv, f.pinfl, student.row])

  const onPinfl = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 14)
    const dob = dobFromPinfl(digits)
    setF((x) => ({ ...x, pinfl: digits, ...(digits.length === 14 && dob ? { dob } : {}) }))
    if (digits.length === 14 && dob) { setDobFlash(true); setTimeout(() => setDobFlash(false), 1200) }
  }

  // Safdan chiqarish / akademik ta'tilga o'tkazish — buyruq raqami va sanasi majburiy
  const orderGroup = isWithdrawn(f.group) || isAcademicLeave(f.group)
  const orderRequired = needsOrder(student.group, f.group)
  const orderError = !orderRequired ? ''
    : !f.buyruq.trim() ? 'Buyruq raqamini kiriting'
    : !ORDER_DATE_RE.test(f.buyruq_sana.trim()) ? "Buyruq sanasini KK.OO.YYYY ko'rinishida kiriting"
    : ''

  // Maxfiy guruhga o'tkazilsa — asl guruh sifatida hozirgi guruhi taklif qilinadi
  const aslDefault = (g: string, x: Record<string, string>) =>
    isSecretGroup(g) && !x.asl_guruh && isOfficialGroup(student.group) && !isSecretGroup(student.group) ? { asl_guruh: student.group } : {}

  // Akademik ta'tilga / safdan chiqarilsa — qaysi guruhdan chiqqani sifatida hozirgi guruhi yoziladi
  const leftFrom = (g: string) => isLeftGroup(g) && isOfficialGroup(student.group) ? student.group : String(student.chiqqan_guruh ?? '')

  const onGroup = (g: string) => setF((x) => (needsOrder(student.group, g)
    // Yangi buyruq — eski raqam/sana qolib ketmasin (sana bugungi kun bilan to'ldiriladi)
    ? { ...x, group: g, buyruq: '', buyruq_sana: new Date().toLocaleDateString('ru-RU'), chiqqan_guruh: leftFrom(g) }
    : { ...x, group: g, buyruq: String(student.buyruq ?? ''), buyruq_sana: String(student.buyruq_sana ?? ''), chiqqan_guruh: String(student.chiqqan_guruh ?? ''), ...aslDefault(g, x) }))

  const submit = async () => {
    if (!f.ism.trim() || orderError) return
    if (dups.length && !confirm(
      "Diqqat! Pasport yoki JSHSHIR boshqa talabada ham bor:\n\n" +
      dups.map((d) => `• ${fullName(d.student)} (${d.student.group || '—'}, №${d.student.shnum || '—'})`).join('\n') +
      '\n\nBaribir saqlansinmi?',
    )) return
    // Faqat o'zgargan maydonlarni yuboramiz
    const changed: EditFields = {}
    for (const k of EDIT_FIELDS) if ((f[k] ?? '').trim() !== String(student[k] ?? '').trim()) changed[k] = f[k].trim()
    if (!Object.keys(changed).length) { onCancel(); return }
    setSaving(true)
    try { await onSave(changed) } finally { setSaving(false) }
  }

  const groupChoices: [string, string][] = [['', 'Guruh belgilanmagan'], ...groupOptions(all)]
  const aslChoices: [string, string][] = [['', "Ko'rsatilmagan"], ...groupOptions(all).filter(([g]) => isOfficialGroup(g) && !isSecretGroup(g))]

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <Section n={1} title="Shaxs va pasport">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Familiya va ism *" value={f.ism} onChange={set('ism')} placeholder="Karimova Zilola" />
          <Input label="Otasining ismi" value={f.ota} onChange={set('ota')} placeholder="... qizi / ... o'g'li" />
          <Input label="Pasport seriya va №" value={f.pv} onChange={set('pv')} mono upper placeholder="AD1234567" />
          <Input label="JSHSHIR (14 raqam)" value={f.pinfl} onChange={onPinfl} mono placeholder="60406055720067" inputMode="numeric" />
          <Input label="Tug'ilgan sana" value={f.dob} onChange={set('dob')} mono placeholder="DD.MM.YYYY" highlight={dobFlash} inputMode="decimal" />
          <Input label="Pasport berilgan sana" value={f.ber} onChange={set('ber')} mono placeholder="DD.MM.YYYY" inputMode="decimal" />
        </div>
        {dups.length > 0 && (
          <div className="mt-3 flex gap-2 rounded-xl border border-rose/45 bg-rose/10 p-3 text-[12.5px] text-rose">
            <AlertTriangle size={16} className="mt-px shrink-0" />
            <span>Bu pasport/JSHSHIR boshqa talabada ham bor: {dups.map((d) => fullName(d.student)).join(', ')}</span>
          </div>
        )}
      </Section>
      <Section n={2} title="Ta'lim hujjati" tone="emerald">
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice label="Hujjat turi" value={f.doc_tur} onChange={set('doc_tur')} options={[['Shahodatnoma', 'Shahodatnoma'], ['Diplom', 'Diplom']]} />
          <Input label="Hujjat seriya va №" value={f.sh_doc} onChange={set('sh_doc')} mono upper placeholder="UM 03752500" />
          <div className="sm:col-span-2"><Input label="Tugatgan muassasa" value={f.mak} onChange={set('mak')} placeholder="14-sonli umumiy o'rta ta'lim maktabi" /></div>
          <Input label="Bitirgan yili" value={f.yil} onChange={set('yil')} mono placeholder="2026" inputMode="numeric" />
          <Choice label="Yo'nalishi" value={f.yon} onChange={set('yon')} options={YON_OPTIONS.map((y) => [y, y])} />
        </div>
      </Section>
      <Section n={3} title="Shartnoma va guruh" tone="sky">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Shartnoma raqami" value={f.shnum} onChange={set('shnum')} mono placeholder="203" inputMode="numeric" />
          <Choice label="Akademik guruh" value={f.group} onChange={onGroup} options={groupChoices} />
          {isSecretGroup(f.group) && (
            <div className="sm:col-span-2">
              <Choice label="Bazadagi asl guruhi (maxfiy guruh uchun)" value={f.asl_guruh} onChange={set('asl_guruh')} options={aslChoices} />
            </div>
          )}
          {isLeftGroup(f.group) && (
            <div className="sm:col-span-2">
              <Choice label={isAcademicLeave(f.group) ? "Qaysi guruhdan akademik ta'tilga chiqqan" : 'Qaysi guruhdan chiqarilgan'}
                value={f.chiqqan_guruh} onChange={set('chiqqan_guruh')} options={aslChoices} />
            </div>
          )}
          <div className="sm:col-span-2"><Input label="Telefon" value={f.tel} onChange={set('tel')} placeholder="+998 90 123 45 67" inputMode="tel" /></div>
          <Input label={`Buyruq raqami${orderRequired ? ' *' : ''}`} value={f.buyruq} onChange={set('buyruq')} mono placeholder="T-40/2" highlight={orderRequired && !f.buyruq.trim()} />
          <Input label={`Buyruq sanasi${orderRequired ? ' *' : ''}`} value={f.buyruq_sana} onChange={set('buyruq_sana')} mono placeholder="02.09.2026" inputMode="decimal" />
        </div>
        {orderError && (
          <div className="mt-3 flex gap-2 rounded-xl border border-amber/45 bg-amber/10 p-3 text-[12.5px] text-amber">
            <AlertTriangle size={16} className="mt-px shrink-0" />
            <span>{isAcademicLeave(f.group) ? "Akademik ta'tilga o'tkazish" : 'Talabalar safidan chiqarish'} uchun buyruq kerak: {orderError}</span>
          </div>
        )}
      </Section>
      <div className="sticky -bottom-4 -mx-1 flex gap-2 bg-gradient-to-t from-ink-900 via-ink-900 to-transparent px-1 pt-4 pb-4 sm:-bottom-5 sm:pb-5">
        <button type="submit" className="btn-success flex-1 py-2.5" disabled={saving || !f.ism.trim() || !!orderError}>
          <Save size={16} /> {saving ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>
        <button type="button" className="btn-ghost py-2.5" onClick={onCancel}>Bekor qilish</button>
      </div>
    </form>
  )
}

function ViewInfo({ s, onEdit, onToggleBaza, onCopy }: { s: Student; onEdit: () => void; onToggleBaza: (s: Student) => void; onCopy?: (msg: string) => void }) {
  const flag = NAME_FLAGS[s.name_flag]
  const flagCls = !flag ? 'text-fg' : flag.tone === 'ok' ? 'text-emerald-soft' : flag.tone === 'warn' ? 'text-amber' : flag.tone === 'bad' ? 'text-rose' : 'text-violet'
  const cleanPinfl = (s.pinfl || '').replace(/\s/g, '')
  const passportBundle = formatPassportBundle({
    fish: fullName(s),
    pv: s.pv,
    pinfl: cleanPinfl,
    dob: s.dob,
    ber: s.ber,
  })
  return (
    <div className="space-y-3">
      <Section
        n={1}
        title="Pasport / shaxs guvohnomasi"
        action={<CopyBtn value={passportBundle} text="Pasportni nusxalash" label="Pasport ma'lumotlari" onCopied={onCopy} />}
      >
        <Row label="Hujjat turi">{s.pass_type || '—'}</Row>
        <Row label="Seriya va №" copyValue={s.pv} copyLabel={`Pasport (${s.pv})`} onCopied={onCopy}><Mono value={s.pv} className="text-[14.5px]" /></Row>
        <Row label="JSHSHIR" copyValue={cleanPinfl} copyLabel="JSHSHIR" onCopied={onCopy}><Mono value={formatPinfl(s.pinfl)} /></Row>
        <Row label="Tug'ilgan sana" copyValue={s.dob} onCopied={onCopy}>{s.dob || '—'}</Row>
        <Row label="Berilgan sana" copyValue={s.ber} onCopied={onCopy}>{s.ber || '—'}</Row>
        <Row label="Otasining ismi">{s.ota || '—'}</Row>
        {s.pass_fish && <Row label="Pasportdagi F.I.SH" copyValue={s.pass_fish} onCopied={onCopy}><span className={flagCls} title={flag?.label}>{s.pass_fish}</span></Row>}
        <PinflCard pinfl={s.pinfl} />
      </Section>
      <Section n={2} title="Diplom / shahodatnoma" tone="emerald">
        <Row label="Hujjat turi">{s.doc_tur || '—'}</Row>
        <Row label="Seriya va №" copyValue={s.sh_doc} copyLabel="Hujjat raqami" onCopied={onCopy}>
          <span className="inline-flex items-center gap-2">
            <Mono value={s.sh_doc} className="text-[14.5px]" />
            {s.sh_qr && <a href={s.sh_qr} target="_blank" rel="noreferrer" className="chip border-sky/40 bg-sky/10 text-sky-soft hover:bg-sky/20"><Link2 size={12} /> QR PDF</a>}
          </span>
        </Row>
        <Row label="Muassasa">{s.mak || '—'}</Row>
        <Row label="Bitirgan yili">{s.yil || '—'}</Row>
        <Row label="Yo'nalishi"><span className="text-sky-soft">{s.yon || '—'}</span></Row>
        {s.cert_fish && <Row label="Hujjatdagi F.I.SH" copyValue={s.cert_fish} onCopied={onCopy}><span className={flagCls} title={flag?.label}>{s.cert_fish}</span></Row>}
      </Section>
      <Section n={3} title="Shartnoma va aloqa" tone="sky">
        <Row label="Shartnoma raqami"><span className="mono text-blue-soft">#{s.shnum || '—'}</span></Row>
        <Row label="Akademik guruh"><GroupBadge group={s.group} asl={s.asl_guruh} inline /></Row>
        {isSecretGroup(s.group) && <Row label="Bazadagi asl guruhi"><span className="mono text-amber">{s.asl_guruh || "ko'rsatilmagan"}</span></Row>}
        {isLeftGroup(s.group) && (
          <>
            <Row label={isAcademicLeave(s.group) ? "Qaysi guruhdan ta'tilga chiqqan" : 'Qaysi guruhdan chiqarilgan'}>
              {s.chiqqan_guruh
                ? <span className="mono font-bold text-fg">{s.chiqqan_guruh}</span>
                : <button type="button" onClick={onEdit} className="text-amber underline-offset-2 hover:underline">kiritilmagan — kiritish</button>}
            </Row>
            <Row label="Qachon">
              {s.buyruq_sana
                ? <span className="mono font-bold text-sky-soft">{s.buyruq_sana}</span>
                : <span className="text-amber">buyruq sanasi kiritilmagan</span>}
              {lastMoveInto(s)?.vaqt && <span className="block text-[11.5px] font-normal text-fg-subtle">tizimga kiritilgan {fmtMoment(lastMoveInto(s)?.vaqt)}</span>}
            </Row>
          </>
        )}
        {(s.buyruq || isLeftGroup(s.group)) && (
          <Row label={isLeftGroup(s.group) ? 'Buyruq raqami' : "Qabul / Holat buyrug'i"}>
            {s.buyruq ? (
              <span className="mono font-bold text-sky-soft">
                {s.buyruq}{s.buyruq_sana && !isLeftGroup(s.group) ? ` (${s.buyruq_sana})` : ''}
              </span>
            ) : (
              <span className="text-amber">kiritilmagan</span>
            )}
          </Row>
        )}
        <Row label="Telefon" copyValue={s.tel} onCopied={onCopy}>{s.tel || '—'}</Row>
        <Row label="Shartnoma sanasi">{s.sana || '—'}</Row>
        <Row label="Hujjatlar holati"><span className="inline-flex items-center gap-1.5"><StatusIcon status={s.status} size={15} />{s.status === 'full' ? "To'liq" : s.status === 'chala' ? 'Chala' : "Yo'q"}</span></Row>
        <Row label="Ism tekshiruvi"><span className={flagCls}>{flag?.label || s.name_match || 'Tekshirilmagan'}</span></Row>
        <Row label="Bazaga kiritilganligi"><BazaButton student={s} onToggle={onToggleBaza} /></Row>
        {!!s.guruh_tarixi?.length && <GroupHistory moves={s.guruh_tarixi} />}
      </Section>
      {(s.manzil_toliq || s.qatnov || s.tel_otaona) && (
        <Section n={4} title="Yashash joyi va so'rovnoma" tone="amber">
          {s.manzil_toliq && <Row label="Doimiy manzili" copyValue={s.manzil_toliq} onCopied={onCopy}><span className="font-semibold text-fg">{s.manzil_toliq}</span></Row>}
          {s.qatnov && <Row label="Qatnov holati"><span className="chip border-amber/40 bg-amber/10 text-amber">{s.qatnov}</span></Row>}
          {s.tel_shaxsiy && <Row label="Shaxsiy telefon" copyValue={s.tel_shaxsiy} onCopied={onCopy}>{s.tel_shaxsiy}</Row>}
          {s.tel_otaona && <Row label="Qo'shimcha aloqa" copyValue={s.tel_otaona} onCopied={onCopy}>{s.tel_otaona} ({s.tel_otaona_kim || "Oila a'zosi"})</Row>}
          {s.sorovnoma_vaqti && <Row label="To'ldirilgan vaqti"><span className="mono text-[12px] text-fg-subtle">{s.sorovnoma_vaqti}</span></Row>}
        </Section>
      )}
      <button type="button" className="btn-primary w-full py-2.5" onClick={onEdit}><Pencil size={15} /> Ma'lumotlarni tahrirlash</button>
    </div>
  )
}

export default function StudentModal({ student: s, all, hasPrev, hasNext, onNav, onClose, onSave, onToggleBaza, onDelete, onOpenRow, onPhotoChange, notify }: Props) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [cert, setCert] = useState(false)
  // Buyruq oynasi: guruh o'zgarib saqlanganda o'zi ochiladi (hint — saqlashdan oldingi holat)
  const [order, setOrder] = useState<{ student: Student; hint?: BuyruqHint } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoDrag, setPhotoDrag] = useState(false)
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Boshqa talabaga o'tilganda tahrirlash rejimidan chiqamiz
  useEffect(() => { setEditing(false); setCert(false); setOrder(null); setPhotoPreviewOpen(false) }, [s.row])

  const handlePhotoFile = async (file: File | undefined | null) => {
    if (!file || photoBusy) return
    setPhotoBusy(true)
    try {
      const url = await uploadStudentPhotoFile(s, file)
      onPhotoChange?.(s, url)
      notify?.(`${s.ism}: Talaba rasmi saqlandi`)
    } catch (e) {
      notify?.(`Rasm yuklanmadi: ${(e as Error).message}`, 'error')
    } finally {
      setPhotoBusy(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  const handlePhotoDelete = async () => {
    if (!s.photo_url || photoBusy) return
    if (!confirm(`${fullName(s)}ning rasmini o'chirmoqchimisiz?`)) return
    setPhotoBusy(true)
    try {
      await removeStudentPhoto(s)
      onPhotoChange?.(s, undefined)
      setPhotoPreviewOpen(false)
      notify?.(`${s.ism}: Rasm o'chirildi`)
    } catch (e) {
      notify?.(`Rasm o'chirilmadi: ${(e as Error).message}`, 'error')
    } finally {
      setPhotoBusy(false)
    }
  }

  // Sahifa orqada aylanib ketmasin
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (e.key === 'Escape') { if (photoPreviewOpen) setPhotoPreviewOpen(false); else if (order) setOrder(null); else if (cert) setCert(false); else if (editing) setEditing(false); else onClose() }
      else if (cert || order || photoPreviewOpen) return
      else if (!typing && e.key === 'ArrowLeft' && hasPrev) onNav(-1)
      else if (!typing && e.key === 'ArrowRight' && hasNext) onNav(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cert, order, photoPreviewOpen, editing, hasPrev, hasNext, onNav, onClose])

  const dups = useMemo(() => findDuplicates(all, s.pv, s.pinfl, s.row), [all, s.pv, s.pinfl, s.row])

  const del = async () => {
    if (!confirm(`${fullName(s)} (№${s.shnum || '—'}) bazadan butunlay o'chirilsinmi?\n\nBu amal Excel bazadan ham o'chiradi.`)) return
    setDeleting(true)
    try { await onDelete(s) } finally { setDeleting(false) }
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-stretch justify-center bg-ink-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="animate-pop-in flex h-full w-full max-w-[1380px] flex-col overflow-hidden border-line-strong bg-ink-900 shadow-2xl shadow-black/60 sm:h-[92vh] sm:rounded-3xl sm:border" role="dialog" aria-modal="true" aria-label={fullName(s)}>
        <header className="flex flex-wrap items-center gap-3 border-b border-line bg-ink-850/80 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-1">
            <button type="button" className="btn-ghost size-9 p-0" disabled={!hasPrev} onClick={() => onNav(-1)} title="Oldingi (←)"><ChevronLeft size={18} /></button>
            <button type="button" className="btn-ghost size-9 p-0" disabled={!hasNext} onClick={() => onNav(1)} title="Keyingi (→)"><ChevronRight size={18} /></button>
          </div>
          <div className="order-last flex w-full min-w-0 items-center gap-3 sm:order-none sm:w-auto sm:flex-1">
            {/* Talabaning portret rasmi (bosish — kattalashtirish yoki yuklash, tortib tashlash qo'llab-quvvatlanadi) */}
            <div
              className={cx('group/photo relative shrink-0 rounded-full transition-all', photoDrag && 'ring-2 ring-sky ring-offset-2 ring-offset-ink-900')}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setPhotoDrag(true) }}
              onDragLeave={() => setPhotoDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setPhotoDrag(false)
                const dropped = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name))
                if (dropped) void handlePhotoFile(dropped)
              }}
            >
              <StudentAvatar
                student={s}
                size="portrait"
                title={s.photo_url ? "Rasmni kattalashtirish uchun bosing" : "Talaba rasmini yuklash uchun bosing yoki rasmni shu yerga tashlang"}
                onClick={() => {
                  if (photoBusy) return
                  if (s.photo_url) setPhotoPreviewOpen(true)
                  else photoInputRef.current?.click()
                }}
              />
              {photoBusy ? (
                <span className="absolute inset-0 grid place-items-center rounded-full bg-ink-950/75 text-sky">
                  <Loader2 size={18} className="animate-spin" />
                </span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); photoInputRef.current?.click() }}
                  title={s.photo_url ? "Rasmni almashtirish" : "Rasm yuklash"}
                  aria-label={s.photo_url ? "Rasmni almashtirish" : "Rasm yuklash"}
                  className="absolute right-0 bottom-0 grid size-6 place-items-center rounded-full border border-line-strong bg-ink-900 text-sky-soft shadow-sm transition-colors hover:border-sky/60 hover:bg-sky/20"
                >
                  <Camera size={12} />
                </button>
              )}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/*"
                className="hidden"
                onChange={(e) => void handlePhotoFile(e.target.files?.[0])}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h2 className="min-w-0 text-[17px] leading-snug font-extrabold text-fg sm:truncate">{fullName(s)}</h2>
                <CopyBtn value={fullName(s)} label="F.I.Sh." title="F.I.Sh. nusxalash" size={14} onCopied={(m) => notify?.(m)} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted sm:gap-2">
                <GroupBadge group={s.group} asl={s.asl_guruh} from={s.chiqqan_guruh} inline />
                <span className="mono">№{s.shnum || '—'}</span>
                {!isOfficialGroup(s.group) && <span className="text-rose">rasmiy kontingentga kirmaydi</span>}
                {/* Eng ko'p bosiladigan belgi — pastga tushmasdan */}
                <span className="flex items-center gap-1.5">
                  <BazaButton student={s} onToggle={onToggleBaza} compact />
                </span>
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    disabled={photoBusy}
                    onClick={() => photoInputRef.current?.click()}
                    className="chip cursor-pointer border-sky/35 bg-sky/10 text-sky-soft transition-colors hover:bg-sky/20 disabled:opacity-50"
                    title={s.photo_url ? "Talaba rasmini almashtirish" : "Talaba rasmini yuklash"}
                  >
                    <Camera size={11} />
                    <span>{s.photo_url ? 'Rasmni almashtirish' : 'Rasm yuklash'}</span>
                  </button>
                  {s.photo_url && (
                    <button
                      type="button"
                      disabled={photoBusy}
                      onClick={() => void handlePhotoDelete()}
                      className="chip cursor-pointer border-rose/35 bg-rose/10 px-1.5 text-rose transition-colors hover:bg-rose/20 disabled:opacity-50"
                      title="Talaba rasmini o'chirish"
                      aria-label="Talaba rasmini o'chirish"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </span>
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="btn-ghost h-9" onClick={() => setOrder({ student: s })} title="Buyruq tayyorlash (akademik ta'til, safdan chiqarish, guruh almashtirish)"><ScrollText size={15} /><span className="hidden sm:inline">Buyruq</span></button>
            {isOfficialGroup(s.group) && <button type="button" className="btn-ghost h-9" onClick={() => setCert(true)} title="O'qiyotganligi haqida ma'lumotnoma"><FileText size={15} /><span className="hidden sm:inline">Ma'lumotnoma</span></button>}
            {!editing && <button type="button" className="btn-ghost h-9" onClick={() => setEditing(true)}><Pencil size={15} /><span className="hidden sm:inline">Tahrirlash</span></button>}
            <button type="button" className="btn-danger h-9" onClick={del} disabled={deleting} title="Talabani bazadan o'chirish"><Trash2 size={15} /><span className="hidden md:inline">O'chirish</span></button>
            <button type="button" className="grid size-9 place-items-center rounded-xl text-fg-muted hover:bg-ink-700 hover:text-fg" onClick={onClose} title="Yopish (Esc)"><X size={20} /></button>
          </div>
        </header>

        {dups.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-rose/30 bg-rose/10 px-5 py-2.5 text-[12.5px] text-rose">
            <AlertTriangle size={15} />
            <b>Dublikat:</b> pasport yoki JSHSHIR bir xil —
            {dups.map((d) => (
              <button key={d.student.row} type="button" className="chip border-rose/50 bg-rose/15 text-rose hover:bg-rose/25" onClick={() => onOpenRow(d.student.row)}>
                {fullName(d.student)} ({d.student.group || '—'})
              </button>
            ))}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:overflow-hidden">
          <div className="p-4 sm:p-5 lg:overflow-y-auto">
            {editing
              ? <EditForm key={s.row} student={s} all={all} onCancel={() => setEditing(false)} onSave={async (f) => {
                const before: BuyruqHint = { prevGroup: s.group, prevBuyruq: s.buyruq, prevBuyruqSana: s.buyruq_sana }
                await onSave(s, f)
                setEditing(false)
                // Guruh o'zgargan (ta'til, safdan chiqarish, o'tkazish, qaytish) — buyruq tayyor holda ochiladi
                if (f.group !== undefined && f.group !== before.prevGroup) setOrder({ student: { ...s, ...f } as Student, hint: before })
              }} />
              : <ViewInfo s={s} onEdit={() => setEditing(true)} onToggleBaza={onToggleBaza} onCopy={(m) => notify?.(m)} />}
          </div>
          <div className="border-t border-line bg-ink-950/40 p-4 sm:p-5 lg:overflow-y-auto lg:border-t-0 lg:border-l">
            <div className="mb-3 text-[11px] font-bold tracking-wider text-fg-subtle uppercase">Hujjat rasmlari va AI Tahlil</div>
            <DocImages file={s.doc_file} studentRow={s.row} student={s} onApplyFields={async (fields) => {
              // Faqat o'zgargan maydonlar — kartadagi bilan bir xil qiymat qayta saqlanmaydi
              const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) =>
                String(v ?? '').trim() !== String(s[k as keyof Student] ?? '').trim())) as EditFields
              if (fields.doc_file && fields.doc_file !== s.doc_file) {
                s.doc_file = fields.doc_file
              }
              if (Object.keys(changed).length) await onSave(s, changed)
            }} />
          </div>
        </div>
      </div>
      {cert && <MalumotnomaModal student={s} onClose={() => setCert(false)} />}
      {order && <BuyruqModal student={order.student} hint={order.hint} onMove={(fields) => onSave(s, fields)} onClose={() => setOrder(null)} />}
      {photoPreviewOpen && s.photo_url && (
        <Lightbox images={[s.photo_url]} index={0} onIndex={() => {}} onClose={() => setPhotoPreviewOpen(false)} title={fullName(s)} />
      )}
    </div>
  )
}
