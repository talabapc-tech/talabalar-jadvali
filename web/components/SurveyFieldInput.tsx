'use client'

import { useEffect, useState } from 'react'
import { Calendar, CheckCircle2, Star, X } from 'lucide-react'
import {
  dateToIsoInput,
  extractUzPhoneDigits,
  formatCardInput,
  formatDateInput,
  formatPassportInput,
  formatPinflInput,
  formatUzPhoneLocal,
  normalizeUzPhone,
  officialGroupOptions,
  QASHQADARYO_TUMANLARI,
  validateCard,
  validateDate,
  validatePassport,
  validatePinfl,
  type OfficialGroupOption,
  type SurveyQuestion,
} from '@/lib/sorovnoma'
import { decodePinfl } from '@/lib/student'
import { cx } from './ui'

interface Props {
  question: SurveyQuestion
  value: unknown
  onChange: (val: string | string[] | number) => void
  error?: string
  disabled?: boolean
  groupOptions?: OfficialGroupOption[]
}

const RATING_LABELS = ['', 'Juda past', 'Qoniqarsiz', "O'rtacha", 'Yaxshi', "A'lo"]

function deleteCleanCharAtCursor(
  nextRaw: string,
  prevDisplay: string,
  prevClean: string,
  extractClean: (raw: string) => string,
  cursorEnd: number | null,
): string {
  const cleanNext = extractClean(nextRaw)
  if (nextRaw.length < prevDisplay.length && cleanNext === prevClean && prevClean.length > 0) {
    if (typeof cursorEnd === 'number' && cursorEnd >= 0) {
      const beforeDigits = nextRaw.slice(0, cursorEnd).replace(/\D/g, '').length
      if (beforeDigits > 0 && beforeDigits <= prevClean.length) {
        return prevClean.slice(0, beforeDigits - 1) + prevClean.slice(beforeDigits)
      }
    }
    return prevClean.slice(0, -1)
  }
  return cleanNext
}

export default function SurveyFieldInput({ question: q, value, onChange, error, disabled, groupOptions }: Props) {
  const strVal = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  const arrVal = Array.isArray(value) ? value.map(String) : []

  const options = q.options ?? []
  const resolvedGroups = groupOptions && groupOptions.length > 0 ? groupOptions : officialGroupOptions()
  const groupInList = resolvedGroups.some((g) => g.code === strVal)
  const tumanInList = QASHQADARYO_TUMANLARI.includes(strVal as (typeof QASHQADARYO_TUMANLARI)[number])
  const radioInOptions = options.includes(strVal)

  const [customTumanMode, setCustomTumanMode] = useState(() => Boolean(strVal && !tumanInList))
  const [customGroupMode, setCustomGroupMode] = useState(() => Boolean(strVal && !groupInList))
  const [radioOtherMode, setRadioOtherMode] = useState(() => Boolean(q.allowOther && strVal && !radioInOptions))

  const knownCheckSet = new Set(options)
  const existingOtherCheck = arrVal.find((v) => !knownCheckSet.has(v)) ?? ''
  const [checkOtherMode, setCheckOtherMode] = useState(() => Boolean(q.allowOther && existingOtherCheck))
  const [checkOtherText, setCheckOtherText] = useState(existingOtherCheck)

  useEffect(() => {
    setCustomTumanMode(Boolean(strVal && !tumanInList))
    setCustomGroupMode(Boolean(strVal && !groupInList))
    setRadioOtherMode(Boolean(q.allowOther && strVal && !radioInOptions))
    setCheckOtherMode(Boolean(q.allowOther && existingOtherCheck))
    setCheckOtherText(existingOtherCheck)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id, q.type])

  if (q.type === 'phone') {
    const digits = extractUzPhoneDigits(strVal)
    const displayLocal = formatUzPhoneLocal(digits)
    const check = digits.length === 9 ? normalizeUzPhone(`+998${digits}`) : null

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextDigits = deleteCleanCharAtCursor(
        e.target.value,
        displayLocal,
        digits,
        extractUzPhoneDigits,
        e.target.selectionEnd,
      )
      onChange(nextDigits ? formatUzPhoneLocal(nextDigits) : '')
    }

    return (
      <div className="space-y-1.5">
        <div
          className={cx(
            'flex items-stretch overflow-hidden rounded-lg border bg-ink-950/60 transition-all duration-150 focus-within:border-sky/70 focus-within:bg-ink-950 focus-within:ring-3 focus-within:ring-sky/15',
            error ? 'border-rose/60' : check?.ok ? 'border-emerald/50' : 'border-line hover:border-line-strong',
          )}
        >
          <span className="flex shrink-0 select-none items-center border-r border-line bg-ink-800/75 px-3 font-mono text-[14px] font-bold text-sky-soft">
            +998
          </span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            disabled={disabled}
            placeholder="88 123-45-67"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-base font-semibold tracking-wide text-fg placeholder:text-fg-subtle outline-none sm:text-[14.5px]"
            value={displayLocal}
            onChange={handlePhoneChange}
          />
          <div className="flex shrink-0 items-center gap-1 pr-2.5 text-[11px] font-semibold tabular-nums text-fg-subtle">
            {digits.length > 0 && !disabled && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="grid size-6 place-items-center rounded text-fg-subtle hover:bg-ink-800 hover:text-fg cursor-pointer"
                title="Tozalash"
                aria-label="Telefon raqamini tozalash"
              >
                <X size={13} />
              </button>
            )}
            {check?.ok ? (
              <CheckCircle2 size={16} className="animate-pop-check text-emerald-soft" />
            ) : (
              <span className="pr-0.5">{digits.length}/9</span>
            )}
          </div>
        </div>
        {digits.length > 0 && digits.length < 9 && !error && (
          <p className="text-[11.5px] text-fg-subtle">Yana {9 - digits.length} ta raqam kiriting</p>
        )}
        {check && !check.ok && !error && <p className="text-[11.5px] text-amber">{check.error}</p>}
        {check?.ok && (
          <p className="animate-fade-in text-[11.5px] text-emerald-soft">
            Saqlanadigan ko&apos;rinish: <span className="mono font-semibold">{check.value}</span>
          </p>
        )}
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'pinfl') {
    const clean = formatPinflInput(strVal)
    const res = clean.length === 14 ? validatePinfl(clean) : null
    const decoded = clean.length === 14 ? decodePinfl(clean) : null

    return (
      <div className="space-y-1.5">
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            disabled={disabled}
            placeholder="14 ta raqam (masalan: 51505075590012)"
            maxLength={14}
            className={cx(
              'field h-11 pr-20 font-mono tracking-wider',
              error && 'border-rose/60',
              res?.ok && !error && 'border-emerald/50',
            )}
            value={clean}
            onChange={(e) => onChange(formatPinflInput(e.target.value))}
          />
          <div className="absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1">
            {clean.length > 0 && !disabled && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="grid size-6 place-items-center rounded text-fg-subtle hover:bg-ink-800 hover:text-fg cursor-pointer"
                title="Tozalash"
              >
                <X size={13} />
              </button>
            )}
            <span
              className={cx(
                'pointer-events-none rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
                res?.ok ? 'animate-pop-check bg-emerald/15 text-emerald-soft' : 'bg-ink-800 text-fg-subtle',
              )}
            >
              {clean.length}/14
            </span>
          </div>
        </div>
        {res?.ok && decoded && (
          <p className="animate-fade-in text-[11.5px] text-emerald-soft">
            ✓ {decoded.sana} · {decoded.jins}
            {res.warning && <span className="ml-2 text-amber">({res.warning})</span>}
          </p>
        )}
        {res && !res.ok && !error && <p className="text-[11.5px] text-amber">{res.error}</p>}
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'passport') {
    const formatted = formatPassportInput(strVal)
    const check = formatted.length >= 10 ? validatePassport(formatted) : null

    const handlePassport = (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextRaw = e.target.value
      let next = formatPassportInput(nextRaw)
      if (nextRaw.length < formatted.length && next === formatted && formatted.length > 0) {
        next = formatPassportInput(formatted.slice(0, -1))
      }
      onChange(next)
    }

    return (
      <div className="space-y-1.5">
        <div className="relative">
          <input
            type="text"
            disabled={disabled}
            placeholder="AD 1234567"
            maxLength={10}
            className={cx(
              'field h-11 pr-14 font-mono uppercase tracking-wider',
              error && 'border-rose/60',
              check?.ok && !error && 'border-emerald/50',
            )}
            value={formatted}
            onChange={handlePassport}
          />
          <div className="absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1">
            {formatted.length > 0 && !disabled && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="grid size-6 place-items-center rounded text-fg-subtle hover:bg-ink-800 hover:text-fg cursor-pointer"
                title="Tozalash"
              >
                <X size={13} />
              </button>
            )}
            {check?.ok && <CheckCircle2 size={16} className="animate-pop-check text-emerald-soft" />}
          </div>
        </div>
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'card') {
    const formatted = formatCardInput(strVal)
    const prevDigits = formatted.replace(/\D/g, '')
    const check = prevDigits.length === 16 ? validateCard(formatted) : null
    const prefix4 = formatted.slice(0, 4)
    const cardBrand =
      prefix4 === '9860'
        ? 'Humo'
        : prefix4 === '8600' || prefix4 === '5614'
          ? 'Uzcard'
          : formatted.startsWith('4')
            ? 'Visa'
            : ''

    const handleCard = (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextDigits = deleteCleanCharAtCursor(
        e.target.value,
        formatted,
        prevDigits,
        (s) => s.replace(/\D/g, '').slice(0, 16),
        e.target.selectionEnd,
      )
      onChange(formatCardInput(nextDigits))
    }

    return (
      <div className="space-y-1.5">
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            disabled={disabled}
            placeholder="9860 0000 0000 0000"
            maxLength={19}
            className={cx(
              'field h-11 pr-28 font-mono tracking-wider',
              error && 'border-rose/60',
              check?.ok && !error && 'border-emerald/50',
            )}
            value={formatted}
            onChange={handleCard}
          />
          <div className="absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1">
            {prevDigits.length > 0 && !disabled && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="grid size-6 place-items-center rounded text-fg-subtle hover:bg-ink-800 hover:text-fg cursor-pointer"
                title="Tozalash"
              >
                <X size={13} />
              </button>
            )}
            <span
              className={cx(
                'pointer-events-none rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
                check?.ok ? 'animate-pop-check bg-emerald/15 text-emerald-soft' : 'bg-ink-800 text-fg-subtle',
              )}
            >
              {cardBrand ? `${cardBrand} · ` : ''}
              {prevDigits.length}/16
            </span>
          </div>
        </div>
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'date') {
    const formatted = formatDateInput(strVal)
    const prevDigits = formatted.replace(/\D/g, '')
    const isoVal = dateToIsoInput(formatted)
    const check = formatted.length === 10 ? validateDate(formatted) : null

    const handleDateText = (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextDigits = deleteCleanCharAtCursor(
        e.target.value,
        formatted,
        prevDigits,
        (s) => s.replace(/\D/g, '').slice(0, 8),
        e.target.selectionEnd,
      )
      onChange(formatDateInput(nextDigits))
    }

    return (
      <div className="space-y-1.5">
        <div className="flex items-stretch gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              inputMode="numeric"
              disabled={disabled}
              placeholder="KK.OO.YYYY (masalan: 15.05.2007)"
              maxLength={10}
              className={cx(
                'field h-11 pr-9 font-mono tracking-wider',
                error && 'border-rose/60',
                check?.ok && !error && 'border-emerald/50',
              )}
              value={formatted}
              onChange={handleDateText}
            />
            {prevDigits.length > 0 && !disabled && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="absolute top-1/2 right-2.5 grid size-6 -translate-y-1/2 place-items-center rounded text-fg-subtle hover:bg-ink-800 hover:text-fg cursor-pointer"
                title="Tozalash"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <label
            className="btn-ghost relative h-11 w-11 shrink-0 cursor-pointer px-0"
            title="Kalendardan tanlash"
          >
            <Calendar size={16} className="text-sky-soft" />
            <input
              type="date"
              disabled={disabled}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value={isoVal}
              onChange={(e) => onChange(formatDateInput(e.target.value))}
            />
          </label>
        </div>
        {check && !check.ok && !error && <p className="text-[11.5px] text-amber">{check.error}</p>}
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'group') {
    const byCourse = [1, 2, 3].map((k) => ({
      kurs: k,
      items: resolvedGroups.filter((g) => g.kurs === k),
    }))
    const selectVal = customGroupMode ? '__OTHER__' : groupInList ? strVal : ''
    return (
      <div className="space-y-2">
        <select
          disabled={disabled}
          className={cx('field h-11 font-semibold', error && 'border-rose/60')}
          value={selectVal}
          onChange={(e) => {
            const v = e.target.value
            if (v === '__OTHER__') {
              setCustomGroupMode(true)
              if (groupInList) onChange('')
            } else {
              setCustomGroupMode(false)
              onChange(v)
            }
          }}
        >
          <option value="">Guruhni tanlang…</option>
          {byCourse.map(
            (c) =>
              c.items.length > 0 && (
                <optgroup key={c.kurs} label={`${c.kurs}-kurs`}>
                  {c.items.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.code} — {g.title}
                    </option>
                  ))}
                </optgroup>
              ),
          )}
          <option value="__OTHER__">Boshqa guruh…</option>
        </select>
        {customGroupMode && (
          <input
            type="text"
            disabled={disabled}
            placeholder="Guruh nomini yozing (masalan: 26-08)…"
            className={cx('field animate-fade-in h-10', error && 'border-rose/60')}
            value={groupInList ? '' : strVal}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'tuman') {
    const selectVal = customTumanMode ? '__OTHER__' : tumanInList ? strVal : ''
    return (
      <div className="space-y-2">
        <select
          disabled={disabled}
          className={cx('field h-11', error && 'border-rose/60')}
          value={selectVal}
          onChange={(e) => {
            const v = e.target.value
            if (v === '__OTHER__') {
              setCustomTumanMode(true)
              if (tumanInList) onChange('')
            } else {
              setCustomTumanMode(false)
              onChange(v)
            }
          }}
        >
          <option value="">Tuman / shaharni tanlang…</option>
          {QASHQADARYO_TUMANLARI.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value="__OTHER__">Boshqa viloyat / tuman…</option>
        </select>
        {customTumanMode && (
          <input
            type="text"
            disabled={disabled}
            placeholder="Viloyat va tuman nomini yozing…"
            className={cx('field animate-fade-in h-10', error && 'border-rose/60')}
            value={tumanInList ? '' : strVal}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'select') {
    return (
      <div className="space-y-1.5">
        <select
          disabled={disabled}
          className={cx('field h-11', error && 'border-rose/60')}
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Variantni tanlang…</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'radio') {
    return (
      <div className="space-y-2">
        <div className="grid gap-2">
          {options.map((opt) => {
            const active = !radioOtherMode && strVal === opt
            return (
              <button
                key={opt}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setRadioOtherMode(false)
                  onChange(opt)
                }}
                className={cx(
                  'flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-[13.5px] font-medium transition-all duration-150 active:scale-[0.985] cursor-pointer',
                  active
                    ? 'border-sky/60 bg-sky/12 text-fg shadow-xs'
                    : 'border-line bg-ink-950/40 text-fg-muted hover:border-line-strong hover:text-fg',
                )}
              >
                <span
                  className={cx(
                    'grid size-4 shrink-0 place-items-center rounded-full border transition-colors',
                    active ? 'border-sky bg-sky' : 'border-line-strong bg-ink-900',
                  )}
                >
                  {active && <span className="animate-pop-check size-1.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0 flex-1">{opt}</span>
              </button>
            )
          })}
          {q.allowOther && (
            <div className="space-y-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setRadioOtherMode(true)
                  if (radioInOptions) onChange('')
                }}
                className={cx(
                  'flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-[13.5px] font-medium transition-all duration-150 active:scale-[0.985] cursor-pointer',
                  radioOtherMode
                    ? 'border-sky/60 bg-sky/12 text-fg'
                    : 'border-line bg-ink-950/40 text-fg-muted hover:border-line-strong hover:text-fg',
                )}
              >
                <span
                  className={cx(
                    'grid size-4 shrink-0 place-items-center rounded-full border',
                    radioOtherMode ? 'border-sky bg-sky' : 'border-line-strong bg-ink-900',
                  )}
                >
                  {radioOtherMode && <span className="animate-pop-check size-1.5 rounded-full bg-white" />}
                </span>
                <span>Boshqa javob…</span>
              </button>
              {radioOtherMode && (
                <input
                  type="text"
                  disabled={disabled}
                  placeholder="O'z javobingizni yozing…"
                  className="field animate-fade-in h-10"
                  value={radioInOptions ? '' : strVal}
                  onChange={(e) => onChange(e.target.value)}
                />
              )}
            </div>
          )}
        </div>
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'checkbox') {
    const toggleOpt = (opt: string) => {
      const next = arrVal.includes(opt) ? arrVal.filter((x) => x !== opt) : [...arrVal, opt]
      onChange(next)
    }

    const updateOther = (text: string) => {
      setCheckOtherText(text)
      const base = arrVal.filter((x) => knownCheckSet.has(x))
      const clean = text.trim()
      onChange(clean ? [...base, clean] : base)
    }

    return (
      <div className="space-y-2">
        <div className="grid gap-2">
          {options.map((opt) => {
            const active = arrVal.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                disabled={disabled}
                onClick={() => toggleOpt(opt)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-[13.5px] font-medium transition-all duration-150 active:scale-[0.985] cursor-pointer',
                  active
                    ? 'border-sky/60 bg-sky/12 text-fg shadow-xs'
                    : 'border-line bg-ink-950/40 text-fg-muted hover:border-line-strong hover:text-fg',
                )}
              >
                <span
                  className={cx(
                    'grid size-4 shrink-0 place-items-center rounded border text-[11px] font-bold transition-colors',
                    active ? 'border-sky bg-sky text-white' : 'border-line-strong bg-ink-900',
                  )}
                >
                  {active && <span className="animate-pop-check">✓</span>}
                </span>
                <span className="min-w-0 flex-1">{opt}</span>
              </button>
            )
          })}
          {q.allowOther && (
            <div className="space-y-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  const nextMode = !checkOtherMode
                  setCheckOtherMode(nextMode)
                  if (!nextMode) {
                    setCheckOtherText('')
                    onChange(arrVal.filter((x) => knownCheckSet.has(x)))
                  }
                }}
                className={cx(
                  'flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-[13.5px] font-medium transition-all duration-150 active:scale-[0.985] cursor-pointer',
                  checkOtherMode
                    ? 'border-sky/60 bg-sky/12 text-fg'
                    : 'border-line bg-ink-950/40 text-fg-muted hover:border-line-strong hover:text-fg',
                )}
              >
                <span
                  className={cx(
                    'grid size-4 shrink-0 place-items-center rounded border text-[11px] font-bold',
                    checkOtherMode ? 'border-sky bg-sky text-white' : 'border-line-strong bg-ink-900',
                  )}
                >
                  {checkOtherMode && <span className="animate-pop-check">✓</span>}
                </span>
                <span>Boshqa javob…</span>
              </button>
              {checkOtherMode && (
                <input
                  type="text"
                  disabled={disabled}
                  placeholder="Qo'shimcha javob yozing…"
                  className="field animate-fade-in h-10"
                  value={checkOtherText}
                  onChange={(e) => updateOther(e.target.value)}
                />
              )}
            </div>
          )}
        </div>
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'yes_no') {
    return (
      <div className="space-y-1.5">
        <div className="grid grid-cols-2 gap-2.5">
          {(['Ha', "Yo'q"] as const).map((opt) => {
            const active = strVal === opt
            return (
              <button
                key={opt}
                type="button"
                disabled={disabled}
                onClick={() => onChange(opt)}
                className={cx(
                  'h-11 rounded-lg border text-[14px] font-bold transition-all duration-150 active:scale-[0.97] cursor-pointer',
                  active && opt === 'Ha'
                    ? 'border-emerald/60 bg-emerald/15 text-emerald-soft shadow-xs'
                    : active && opt === "Yo'q"
                      ? 'border-rose/60 bg-rose/15 text-rose shadow-xs'
                      : 'border-line bg-ink-950/40 text-fg-muted hover:border-line-strong hover:text-fg',
                )}
              >
                {opt}
              </button>
            )
          })}
        </div>
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'rating') {
    const cur = Number(strVal) || 0
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => {
            const filled = cur >= star
            return (
              <button
                key={star}
                type="button"
                disabled={disabled}
                onClick={() => onChange(star)}
                className={cx(
                  'flex h-11 min-w-[52px] flex-1 items-center justify-center gap-1.5 rounded-lg border text-[14px] font-bold transition-all duration-150 active:scale-95 cursor-pointer',
                  filled
                    ? 'border-amber/60 bg-amber/15 text-amber-soft shadow-xs'
                    : 'border-line bg-ink-950/40 text-fg-subtle hover:border-line-strong hover:text-fg',
                )}
              >
                <Star size={16} className={cx('transition-transform duration-150', filled && 'scale-110 fill-amber text-amber')} />
                <span>{star}</span>
              </button>
            )
          })}
        </div>
        {cur > 0 && <p className="animate-fade-in text-[12px] font-medium text-amber-soft">{cur} / 5 — {RATING_LABELS[cur]}</p>}
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'number') {
    const hasBounds = (q.min !== null && q.min !== undefined) || (q.max !== null && q.max !== undefined)
    return (
      <div className="space-y-1.5">
        <div className="flex items-stretch gap-2">
          <input
            type="text"
            inputMode="decimal"
            disabled={disabled}
            placeholder={q.placeholder || 'Raqam kiriting…'}
            className={cx('field h-11 flex-1 font-mono', error && 'border-rose/60')}
            value={strVal}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^\d.,-]/g, '')
              onChange(cleaned)
            }}
          />
          {q.unit && (
            <span className="flex shrink-0 items-center rounded-lg border border-line bg-ink-850 px-3 text-[13px] font-semibold text-fg-muted">
              {q.unit}
            </span>
          )}
        </div>
        {hasBounds && (
          <p className="text-[11px] text-fg-subtle">
            Cheklov: {q.min !== null && q.min !== undefined ? `kamida ${q.min}` : ''}
            {q.min != null && q.max != null ? ' · ' : ''}
            {q.max !== null && q.max !== undefined ? `ko'pi bilan ${q.max}` : ''}
          </p>
        )}
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  if (q.type === 'long_text') {
    return (
      <div className="space-y-1.5">
        <textarea
          rows={3}
          disabled={disabled}
          placeholder={q.placeholder || 'Batafsil javobingizni yozing…'}
          className={cx('field min-h-[88px] resize-y py-2.5', error && 'border-rose/60')}
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
        />
        {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <input
        type="text"
        disabled={disabled}
        placeholder={q.placeholder || 'Javobingizni yozing…'}
        className={cx('field h-11', error && 'border-rose/60')}
        value={strVal}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p className="text-[12px] font-medium text-rose">{error}</p>}
    </div>
  )
}
