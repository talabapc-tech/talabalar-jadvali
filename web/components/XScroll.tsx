'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

/**
 * Faqat gorizontal aylanadigan blok: ichki vertikal scroll yo'q, jadval sahifa bilan pastga tushadi.
 * Keng jadvalning pastki scroll chizig'i ekran ostida qolib ketmasligi uchun
 * ekranning pastki chetiga yopishgan nusxa chiziq (sinxron) ko'rsatiladi.
 */
const XScroll = forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(function XScroll({ children, className }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [w, setW] = useState({ inner: 0, outer: 0 })
  useImperativeHandle(ref, () => box.current!, [])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setW({ inner: el.scrollWidth, outer: el.clientWidth })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [])

  // Jadval sarlavhasi (thead) sahifa aylanganda ekran tepasida qoladi: x-scroll bloki ichida
  // `sticky top-0` ishlamaydi, shuning uchun sarlavha jadval chegarasida siljitiladi
  useEffect(() => {
    const el = box.current
    if (!el) return
    let raf = 0
    const tick = () => {
      raf = 0
      const head = el.querySelector<HTMLElement>(':scope > table > thead')
      if (!head) return
      const r = el.getBoundingClientRect()
      const off = Math.max(0, Math.min(-r.top, r.height - head.offsetHeight * 2))
      head.style.transform = off > 0 ? `translateY(${off}px)` : ''
    }
    const on = () => { if (!raf) raf = requestAnimationFrame(tick) }
    window.addEventListener('scroll', on, { passive: true, capture: true })
    window.addEventListener('resize', on)
    const ro = new ResizeObserver(on)
    ro.observe(el)
    on()
    return () => {
      window.removeEventListener('scroll', on, { capture: true })
      window.removeEventListener('resize', on)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  // Ikkala chiziq bir-birini kuzatadi
  useEffect(() => {
    const a = box.current, b = bar.current
    if (!a || !b) return
    let lock = false
    const sync = (from: HTMLElement, to: HTMLElement) => () => {
      if (lock) return
      lock = true
      to.scrollLeft = from.scrollLeft
      requestAnimationFrame(() => { lock = false })
    }
    const ab = sync(a, b), ba = sync(b, a)
    a.addEventListener('scroll', ab, { passive: true })
    b.addEventListener('scroll', ba, { passive: true })
    return () => { a.removeEventListener('scroll', ab); b.removeEventListener('scroll', ba) }
  }, [w.inner > w.outer])

  return (
    <>
      <div ref={box} className={className ?? 'overflow-x-auto'}>{children}</div>
      {w.inner > w.outer + 1 && (
        <div ref={bar} className="sticky bottom-0 z-30 overflow-x-auto border-t border-line bg-ink-900/95 backdrop-blur-sm" aria-hidden="true">
          <div style={{ width: w.inner, height: 1 }} />
        </div>
      )}
    </>
  )
})

export default XScroll
