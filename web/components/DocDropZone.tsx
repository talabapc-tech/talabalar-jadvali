'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardPaste, FileText, Upload, X, type LucideIcon } from 'lucide-react'
import { getFilesFromClipboard } from '@/lib/ai-doc'
import { cx } from './ui'

const isDocx = (f: File) => /\.docx$/i.test(f.name)
const isImageOrDocx = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|docx)$/i.test(f.name)

interface Props {
  title: string
  icon: LucideIcon
  tone: string
  max: number
  files: File[]
  onChange: (files: File[]) => void
  onMessage?: (msg: string) => void
  disabled?: boolean
  /** Faqat Word (.docx) — shartnoma hujjati */
  docxOnly?: boolean
  hint?: string
}

/**
 * Hujjat rasmlari uchun zona: sudrab tashlash (drag & drop), bosib tanlash yoki
 * Ctrl+V. Ko'pi bilan `max` ta fayl — pasport uchun 2 (old/orqa), diplom uchun 1.
 * max=1 bo'lsa yangi fayl eskisini almashtiradi, aks holda qo'shiladi.
 */
export default function DocDropZone({ title, icon: Icon, tone, max, files, onChange, onMessage, disabled, docxOnly, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const add = (incoming: File[]) => {
    const ok = incoming.filter(docxOnly ? isDocx : isImageOrDocx)
    if (!ok.length) {
      onMessage?.(docxOnly ? 'Bu yerga faqat Word (.docx) fayl qabul qilinadi' : 'Faqat rasm (JPG, PNG) yoki Word (.docx) fayl qabul qilinadi')
      return
    }
    const next = max === 1 ? ok.slice(0, 1) : [...files, ...ok].slice(-max)
    if (max > 1 && files.length + ok.length > max) onMessage?.(`${title}: ko'pi bilan ${max} ta fayl — oxirgi ${max} tasi olindi`)
    onChange(next)
  }

  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')),
    [files],
  )
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews])

  return (
    <div
      className={cx(
        'rounded-xl border border-dashed p-2.5 transition-colors',
        over ? 'border-sky bg-sky/10' : 'border-line-strong bg-ink-950/60',
        disabled && 'pointer-events-none opacity-60',
      )}
      onDragEnter={(e) => { e.preventDefault(); depth.current++; setOver(true) }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
      onDragLeave={() => { if (--depth.current <= 0) { depth.current = 0; setOver(false) } }}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setOver(false)
        add(Array.from(e.dataTransfer.files))
      }}
    >
      <div className={cx('mb-1.5 flex items-center justify-between text-[11.5px] font-bold', tone)}>
        <span className="flex items-center gap-1.5">
          <Icon size={13} /> {title} <span className="font-medium text-fg-subtle">({files.length}/{max})</span>
        </span>
        <button
          type="button"
          className="rounded-md px-1 py-0.5 text-[11px] text-sky hover:underline"
          title="Nusxalangan rasmni qo'yish (Ctrl+V)"
          onClick={async () => {
            const got = await getFilesFromClipboard()
            if (got.length) add(got)
            else onMessage?.('Buferda rasm yoki fayl topilmadi (avval rasmni Ctrl+C qiling)')
          }}
        >
          <ClipboardPaste size={11} className="mr-0.5 inline" /> <span className="sm:hidden">Qo'yish</span><span className="hidden sm:inline">Ctrl+V</span>
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={docxOnly ? '.docx' : 'image/*,.docx'}
        multiple={max > 1}
        className="hidden"
        onChange={(e) => { add(Array.from(e.target.files || [])); e.target.value = '' }}
      />

      {files.length > 0 && (
        <div className="mb-2 flex gap-2">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="group relative h-16 w-20 overflow-hidden rounded-lg border border-line bg-ink-900">
              {previews[i]
                ? <img src={previews[i]} alt={f.name} className="size-full object-cover" />
                : (
                  <div className="flex size-full flex-col items-center justify-center gap-0.5 px-1 text-fg-muted" title={f.name}>
                    <FileText size={18} className="text-sky" />
                    <span className="w-full truncate text-center text-[9px]">{f.name}</span>
                  </div>
                )}
              <button
                type="button"
                title="Olib tashlash"
                className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-md bg-ink-950/85 text-fg-muted hover:text-rose"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="flex w-full flex-col items-center justify-center gap-0.5 rounded-lg py-2.5 text-[12px] text-fg-muted hover:bg-ink-800/60 hover:text-fg sm:py-2 sm:text-[11.5px]"
        onClick={() => inputRef.current?.click()}
      >
        <span className="flex items-center gap-1.5">
          <Upload size={13} className="text-sky" />
          {over ? "Qo'yib yuboring…" : <><span className="sm:hidden">{docxOnly ? 'Faylni tanlash' : 'Rasm tanlash yoki suratga olish'}</span><span className="hidden sm:inline">Shu yerga tashlang yoki bosib tanlang</span></>}
        </span>
        {hint && files.length < max && <span className="text-[10.5px] text-fg-subtle">{hint}</span>}
      </button>
    </div>
  )
}
