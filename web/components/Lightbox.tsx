'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCcw, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react'

/** Hujjat rasmini to'liq ekranda ko'rish: g'ildirak bilan zoom, sichqoncha bilan surish, R — burish */
export default function Lightbox({ images, index, onIndex, onClose, initialRotation = 0 }: {
  images: string[]; index: number; onIndex: (i: number) => void; onClose: () => void; initialRotation?: number
}) {
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(initialRotation)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)

  const reset = useCallback(() => { setZoom(1); setRot(0); setPan({ x: 0, y: 0 }) }, [])
  const go = useCallback((d: number) => {
    if (images.length < 2) return
    onIndex((index + d + images.length) % images.length)
    reset()
  }, [images.length, index, onIndex, reset])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key.toLowerCase() === 'r') setRot((r) => r + 90)
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(5, z + 0.25))
      else if (e.key === '-') setZoom((z) => Math.max(0.4, z - 0.25))
    }
    // capture — modal oynaning strelka tugmalari ishlab ketmasin
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, onClose])

  const tool = 'grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/8 text-white transition-colors hover:bg-white/15 sm:size-10'

  return (
    <div className="animate-fade-in fixed inset-0 z-[70] flex flex-col bg-black/92 select-none">
      <div className="flex items-center justify-between gap-2 p-2.5 sm:gap-3 sm:p-4">
        <span className="shrink-0 rounded-lg border border-white/10 bg-white/8 px-2.5 py-1.5 text-[13px] font-semibold text-white tabular-nums sm:px-3">
          {index + 1} / {images.length}
        </span>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button type="button" className={tool} onClick={() => setZoom((z) => Math.min(5, z + 0.25))} title="Kattalashtirish (+)" aria-label="Kattalashtirish"><ZoomIn size={18} /></button>
          <button type="button" className={tool} onClick={() => setZoom((z) => Math.max(0.4, z - 0.25))} title="Kichraytirish (−)"><ZoomOut size={18} /></button>
          <button type="button" className={tool} onClick={() => setRot((r) => r - 90)} title="Chapga burish"><RotateCcw size={18} /></button>
          <button type="button" className={tool} onClick={() => setRot((r) => r + 90)} title="O'ngga burish (R)"><RotateCw size={18} /></button>
          <button type="button" className={tool + ' sm:w-auto sm:px-3'} onClick={reset} title="Asl holat" aria-label="Asl holat">
            <RefreshCcw size={17} className="sm:hidden" /><span className="hidden text-[12px] font-semibold sm:inline">Asl holat</span>
          </button>
          <button type="button" className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose text-white hover:brightness-110 sm:size-10" onClick={onClose} title="Yopish (Esc)" aria-label="Yopish"><X size={20} /></button>
        </div>
      </div>

      <div
        className="relative flex flex-1 cursor-grab touch-none items-center justify-center overflow-hidden active:cursor-grabbing"
        onWheel={(e) => setZoom((z) => Math.max(0.4, Math.min(5, z + (e.deltaY < 0 ? 0.2 : -0.2))))}
        onPointerDown={(e) => { drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; (e.target as Element).setPointerCapture?.(e.pointerId) }}
        onPointerMove={(e) => { if (drag.current) setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }) }}
        onPointerUp={() => { drag.current = null }}
        onClick={(e) => { if (e.target === e.currentTarget && zoom === 1) onClose() }}
        // Ikki marta bosish (telefonda ikki marta tegish) — kattalashtirish / asl holat
        onDoubleClick={() => { if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }) } else setZoom(2.5) }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[index]}
          alt=""
          draggable={false}
          className="max-h-[86vh] max-w-[92vw] rounded-md object-contain shadow-2xl shadow-black/80 transition-transform duration-150 ease-out"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rot}deg)` }}
        />
        {images.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Oldingi rasm" className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-3 sm:size-12"><ChevronLeft size={26} /></button>
            <button type="button" onClick={() => go(1)} aria-label="Keyingi rasm" className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-3 sm:size-12"><ChevronRight size={26} /></button>
          </>
        )}
      </div>
    </div>
  )
}
