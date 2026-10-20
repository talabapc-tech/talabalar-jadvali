'use client'

import { useEffect, useState } from 'react'
import { Award, FileImage, FileText, IdCard, ImageOff, Loader2, Maximize2, QrCode, RotateCw, Sparkles, Upload } from 'lucide-react'
import { AI_MODELS, analyzeAndUploadDocs, fieldsFromQr, getSavedAiModel, scanQrCodes, setSavedAiModel } from '@/lib/ai-doc'
import { getActiveAllowedModels } from '@/lib/settings'
import type { EditFields, Student } from '@/lib/types'
import DocDropZone from './DocDropZone'
import InlineZoomImage from './InlineZoomImage'
import Lightbox from './Lightbox'
import { cx } from './ui'

type Kind = 'passport' | 'diploma'
interface Img { src: string; kind: Kind }

const cache = new Map<string, string[]>()

/** Rasmning o'lchamiga qarab turini aniqlash: eni kattaroq — pasport/ID, bo'yi kattaroq — A4 diplom/shahodatnoma */
function classify(src: string): Promise<Kind> {
  return new Promise((resolve) => {
    const im = new Image()
    im.onload = () => resolve(im.naturalHeight > im.naturalWidth * 1.05 ? 'diploma' : 'passport')
    im.onerror = () => resolve('passport')
    im.src = src
  })
}

interface Props {
  file: string
  studentRow?: number
  student?: Pick<Student, 'ism' | 'ota' | 'group'>
  onApplyFields?: (fields: Partial<EditFields>) => Promise<void> | void
}

export default function DocImages({ file, studentRow, student, onApplyFields }: Props) {
  const [images, setImages] = useState<Img[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [rot, setRot] = useState<Record<number, number>>({})
  const [zoom, setZoom] = useState<Record<number, number>>({})
  const [zoomReset, setZoomReset] = useState<Record<number, number>>({})

  const [showUpload, setShowUpload] = useState(() => !file)
  const [passFiles, setPassFiles] = useState<File[]>([])
  const [certFiles, setCertFiles] = useState<File[]>([])
  const [docxFiles, setDocxFiles] = useState<File[]>([])
  const [allowedModels, setAllowedModels] = useState<[string, string][]>(() => getActiveAllowedModels())
  const [model, setModel] = useState<string>(() => {
    const saved = getSavedAiModel()
    const active = getActiveAllowedModels()
    if (active.some(([id]) => id === saved)) return saved
    return active[0]?.[0] || saved
  })
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [extracted, setExtracted] = useState<Partial<EditFields> | null>(null)
  const [qrResult, setQrResult] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setImages(null)
    setError('')
    setRot({})
    setZoom({})
    setExtracted(null)
    setQrResult(null)
    setStatusMsg('')
    setPassFiles([])
    setCertFiles([])
    setDocxFiles([])
    if (!file) { setImages([]); return }

    const load = async () => {
      let srcs = cache.get(file)
      if (!srcs) {
        const res = await fetch(`/api/doc-preview?file=${encodeURIComponent(file)}`)
        const body = await res.json()
        srcs = (body.images as string[]) ?? []
        if (!srcs.length && body.error) throw new Error(body.error)
        cache.set(file, srcs)
      }
      const kinds = await Promise.all(srcs.map(classify))
      if (alive) setImages(srcs.map((src, i) => ({ src, kind: kinds[i] })))
    }
    load().catch((e) => { if (alive) { setError((e as Error).message); setImages([]) } })
    return () => { alive = false }
  }, [file, studentRow])

  const handleRunAi = async () => {
    setBusy(true)
    setStatusMsg('AI va QR tahlil bajarilmoqda…')
    try {
      const res = await analyzeAndUploadDocs({
        row: studentRow,
        student,
        docFile: file,
        docxFile: docxFiles[0],
        passFiles,
        certFiles,
        existingImages: images?.map((i) => i.src) ?? [],
        model,
      })
      if (res.qrFound) setQrResult(res.qrFound)
      if (res.images.length) {
        const kinds = await Promise.all(res.images.map(classify))
        setImages(res.images.map((src, i) => ({ src, kind: kinds[i] })))
        if (file) cache.delete(file)
        if (res.docFile) cache.set(res.docFile, res.images)
      }
      // Eski portaldagidek: o'qilgan ma'lumot darhol kartaga yoziladi. Ism va otasining
      // ismi — foydalanuvchining o'z ro'yxati, bor bo'lsa AI ularni almashtirmaydi.
      const fields: Partial<EditFields> = { ...res.fields }
      delete (fields as { sh_qr?: string }).sh_qr
      if (student?.ism && !res.namesFromDoc) delete fields.ism
      if (student?.ota && !res.namesFromDoc) delete fields.ota
      if (res.docFile) {
        fields.doc_file = res.docFile
      }
      if (Object.keys(fields).length && onApplyFields) {
        await onApplyFields(fields)
        setPassFiles([])
        setCertFiles([])
        setDocxFiles([])
      }
      setExtracted(Object.keys(res.fields).length ? res.fields : null)
      setStatusMsg(res.message)
    } catch (e) {
      setStatusMsg(`Tahlil xatosi: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleScanQrOnly = async () => {
    setBusy(true)
    setStatusMsg('QR kod qidirilmoqda…')
    try {
      const srcs = images?.map((i) => i.src) ?? []
      const qr = fieldsFromQr(await scanQrCodes(srcs))
      if (qr.sh_qr) setQrResult(qr.sh_qr)
      if (qr.pinfl) {
        // ID-karta QR'idagi MRZ — aniq ma'lumot, AI tahlilidagidek kartaga darhol yoziladi
        const fields: Partial<EditFields> = { pv: qr.pv, pinfl: qr.pinfl, ...(qr.dob ? { dob: qr.dob } : {}) }
        if (onApplyFields) await onApplyFields(fields)
        setExtracted(fields)
        setStatusMsg(`ID-karta QR'i o'qildi: ${qr.pv}, JSHSHIR ${qr.pinfl}${qr.dob ? `, ${qr.dob}` : ''}${qr.sh_qr ? ` · shahodatnoma QR: ${qr.sh_qr}` : ''}`)
      } else if (qr.sh_qr) {
        setStatusMsg(`QR kod topildi: ${qr.sh_qr}`)
      } else {
        setStatusMsg("Rasmlardan QR kod topilmadi (yoki AI Tahlil tugmasini bosing)")
      }
    } finally {
      setBusy(false)
    }
  }

  const hasBoth = (images ?? []).some((i) => i.kind === 'passport') && (images ?? []).some((i) => i.kind === 'diploma')
  const label = (img: Img, i: number) => {
    const kind = hasBoth ? img.kind : i === 0 ? 'passport' : 'diploma'
    return kind === 'passport' ? { icon: IdCard, text: 'Pasport / ID-karta', tone: 'text-blue-soft' } : { icon: Award, text: 'Shahodatnoma / Diplom', tone: 'text-emerald-soft' }
  }

  return (
    <div className="space-y-3">
      {/* Compact AI / QR / Upload toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-ink-900/80 p-2">
        <select
          value={model}
          onChange={(e) => { const m = e.target.value; setModel(m); setSavedAiModel(m) }}
          className="field h-8 w-auto min-w-[165px] py-1 pr-7 pl-2.5 text-[11.5px]"
          title="AI Tahlil modeli (Sozlamalar bo'limidan boshqariladi)"
        >
          {allowedModels.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>

        <button
          type="button"
          className="btn-ghost h-8 px-2.5 text-[11.5px]"
          onClick={() => void handleScanQrOnly()}
          disabled={busy || !images?.length}
          title="Hujjat rasmlaridan QR kodni skanerlash"
        >
          <QrCode size={13} className="text-emerald-soft" /> QR Skaner
        </button>

        <button
          type="button"
          className={cx('btn-ghost ml-auto h-8 px-2.5 text-[11.5px]', showUpload && 'border-sky/50 text-sky-soft')}
          onClick={() => setShowUpload((v) => !v)}
        >
          <Upload size={13} className="text-sky" /> {showUpload ? 'Yopish' : 'Fayl / AI Tahlil'}
        </button>
      </div>

      {showUpload && (
        <div className="animate-pop-in space-y-3 rounded-2xl border border-sky/35 bg-ink-900/90 p-3.5">
          <DocDropZone
            title="Shartnoma hujjati (.docx)"
            icon={FileText}
            tone="text-sky-soft"
            max={1}
            docxOnly
            hint="Talabaga biriktiriladi — ichidagi pasport va shahodatnoma o'qiladi"
            files={docxFiles}
            onChange={setDocxFiles}
            onMessage={setStatusMsg}
            disabled={busy}
          />
          <div className="text-center text-[11px] text-fg-subtle">yoki hujjat rasmlarini alohida qo'ying</div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <DocDropZone title="Pasport / ID-karta" icon={IdCard} tone="text-blue-soft" max={2} hint="2 tagacha rasm (old va orqa tomoni)" files={passFiles} onChange={setPassFiles} onMessage={setStatusMsg} disabled={busy} />
            <DocDropZone title="Shahodatnoma / Diplom" icon={Award} tone="text-emerald-soft" max={1} files={certFiles} onChange={setCertFiles} onMessage={setStatusMsg} disabled={busy} />
          </div>

          <button
            type="button"
            className="btn-primary h-9 w-full justify-center text-[12.5px]"
            disabled={busy}
            onClick={() => void handleRunAi()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {busy ? 'Tahlil qilinmoqda…' : docxFiles.length ? 'Shartnomani biriktirish va AI + QR Tahlil qilish' : passFiles.length || certFiles.length ? 'Yuklash va AI + QR Tahlil qilish' : 'Mavjud hujjatni AI + QR Tahlil qilish'}
          </button>
        </div>
      )}

      {(statusMsg || qrResult) && (
        <div className="rounded-xl border border-line bg-ink-900/80 px-3 py-2 text-[12px] text-fg-muted">
          {statusMsg && <div>{statusMsg}</div>}
          {qrResult && (
            <div className="mt-1 flex items-center gap-2 text-emerald-soft">
              <QrCode size={13} />
              <a href={qrResult} target="_blank" rel="noreferrer" className="truncate underline hover:text-emerald">{qrResult}</a>
            </div>
          )}
        </div>
      )}

      {extracted && Object.keys(extracted).length > 0 && (
        <div className="animate-pop-in space-y-2 rounded-2xl border border-emerald/45 bg-emerald/10 p-3 text-[12px]">
          <div className="font-bold text-emerald-soft">AI o'qigan ma'lumotlar (kartaga saqlandi):</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-fg">
            {([
              ['Ism', extracted.ism], ['Otasi', extracted.ota], ['Pasport', extracted.pv], ['JSHSHIR', extracted.pinfl],
              ["Tug'ilgan", extracted.dob], ['Berilgan', extracted.ber], ['Hujjat №', extracted.sh_doc], ['Turi', extracted.doc_tur],
              ['Maktab', extracted.mak], ['Yil', extracted.yil],
            ] as const).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="truncate"><span className="text-fg-muted">{k}:</span> <b>{v}</b></div>
            ))}
          </div>
        </div>
      )}

      {images === null ? (
        <div className="grid gap-3">
          {[0, 1].map((i) => <div key={i} className="h-56 animate-pulse rounded-2xl border border-line bg-ink-850" />)}
        </div>
      ) : !images.length ? (
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const dropped = Array.from(e.dataTransfer.files)
            if (!dropped.length) return
            const docx = dropped.filter((f) => f.name.toLowerCase().endsWith('.docx'))
            const imgs = dropped.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name))
            if (docx.length) setDocxFiles(docx.slice(0, 1))
            if (imgs.length >= 2) {
              setPassFiles(imgs.slice(0, 1))
              setCertFiles(imgs.slice(1, 2))
            } else if (imgs.length === 1) {
              setPassFiles(imgs)
            }
            setShowUpload(true)
          }}
          className="grid place-items-center gap-3 rounded-2xl border-2 border-dashed border-sky/35 bg-ink-950/40 px-6 py-10 text-center transition hover:border-sky/60"
        >
          <div className="grid size-13 place-items-center rounded-2xl bg-sky/10 text-sky-soft">
            <Upload size={24} />
          </div>
          <div>
            <div className="text-[14px] font-bold text-fg">{file ? "Hujjat rasmlari topilmadi" : 'Hujjat fayli biriktirilmagan'}</div>
            <div className="mt-1 text-[12px] text-fg-muted max-w-sm">
              {file
                ? `«${file}» nomli fayl topilmadi. Pasport va diplom rasmlarini qayta biriktirishingiz mumkin.`
                : "Talabaning pasport / ID-karta va diplom / shahodatnoma rasmlarini bu yerga tashlang yoki pastdagi tugmani bosing."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowUpload((v) => !v)}
            className="btn-primary mt-1 h-9 px-4 text-[12.5px]"
          >
            <Upload size={14} />
            {showUpload ? 'Biriktirish panelini yashirish' : 'Fayl / Rasmlarni biriktirish'}
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {images.map((img, i) => {
            const l = label(img, i)
            const Icon = l.icon
            const r = rot[i] ?? 0
            const sideways = Math.abs(r % 180) === 90
            return (
              <figure key={i} className="overflow-hidden rounded-2xl border border-line bg-ink-950/60">
                <figcaption className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] font-semibold">
                  <Icon size={14} className={l.tone} />
                  <span className="text-fg">{l.text}</span>
                  <span className="ml-auto flex items-center gap-1">
                    {(zoom[i] ?? 1) > 1 ? (
                      <button type="button" className="chip mono h-7 border-sky/40 bg-sky/10 px-2 text-sky-soft hover:bg-sky/20" title="Asl holatga qaytarish" onClick={() => setZoomReset((x) => ({ ...x, [i]: (x[i] ?? 0) + 1 }))}>
                        {Math.round((zoom[i] ?? 1) * 100)}% ✕
                      </button>
                    ) : (
                      <span className="hidden text-[10.5px] font-normal text-fg-subtle sm:inline">Shift + g'ildirak — zoom</span>
                    )}
                    <button type="button" className="grid size-7 place-items-center rounded-lg text-fg-muted hover:bg-ink-700 hover:text-fg" title="Burish" onClick={() => setRot((x) => ({ ...x, [i]: r + 90 }))}>
                      <RotateCw size={14} />
                    </button>
                    <button type="button" className="grid size-7 place-items-center rounded-lg text-fg-muted hover:bg-ink-700 hover:text-fg" title="To'liq ekranda" onClick={() => setOpen(i)}>
                      <Maximize2 size={14} />
                    </button>
                  </span>
                </figcaption>
                <InlineZoomImage
                  src={img.src}
                  alt={l.text}
                  rotation={r}
                  resetKey={zoomReset[i] ?? 0}
                  onOpen={() => setOpen(i)}
                  onZoomChange={(z) => setZoom((x) => (x[i] === z ? x : { ...x, [i]: z }))}
                  imgClassName={cx('mx-auto rounded-lg object-contain transition-transform duration-200', sideways ? 'max-h-[300px]' : 'max-h-[440px]')}
                />
              </figure>
            )
          })}
          {file && <div className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle"><FileImage size={13} /> {file}</div>}
          {open !== null && (
            <Lightbox images={images.map((i) => i.src)} index={open} onIndex={setOpen} onClose={() => setOpen(null)} initialRotation={rot[open] ?? 0} />
          )}
        </div>
      )}
    </div>
  )
}
