'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { cx } from './ui'

/**
 * Faqat gorizontal aylanadigan blok: ichki vertikal scroll yo'q, jadval sahifa bilan pastga tushadi.
 * Tashqi konteynerda ikkita parallel surgich ("pastda 2ta surgich") paydo bo'lmasligi uchun
 * gorizontal scroll mavjud bo'lganda ichki scrollbar yashirilib, ekran ostiga yopishgan yagona
 * sinxron surgich ko'rsatiladi.
 */
const XScroll = forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(function XScroll({ children, className }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [w, setW] = useState({ inner: 0, outer: 0 })
  useImperativeHandle(ref, () => box.current!, [])

  const hasXScroll = w.inner > w.outer + 1

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setW({ inner: el.scrollWidth, outer: el.clientWidth })
    measure()
    const ro = new ResizeObserver(measure)
    const observeChild = () => {
      ro.disconnect()
      ro.observe(el)
      if (el.firstElementChild) ro.observe(el.firstElementChild)
    }
    observeChild()
    const mo = new MutationObserver(() => {
      observeChild()
      measure()
    })
    mo.observe(el, { childList: true, subtree: false })
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Jadval sarlavhasi (thead) sahifa aylanganda saytning yuqori header ostida qoladi:
  // x-scroll bloki ichida CSS `sticky top-0` ishlamagani uchun sarlavha transform bilan siljitiladi.
  useEffect(() => {
    const el = box.current
    if (!el) return
    let raf = 0
    const tick = () => {
      raf = 0
      const head = el.querySelector<HTMLElement>(':scope > table > thead')
      if (!head) return
      const hdr = document.querySelector<HTMLElement>('header.sticky')
      const topEdge = hdr ? Math.max(0, hdr.getBoundingClientRect().bottom) : 0
      const r = el.getBoundingClientRect()
      const maxOff = Math.max(0, r.height - head.offsetHeight * 1.5)
      const off = Math.max(0, Math.min(topEdge - r.top, maxOff))
      if (off > 0) {
        head.style.willChange = 'transform'
        head.style.transform = `translateY(${off}px)`
      } else {
        head.style.transform = ''
        head.style.willChange = ''
      }
    }
    const on = () => { if (!raf) raf = requestAnimationFrame(tick) }
    window.addEventListener('scroll', on, { passive: true, capture: true })
    window.addEventListener('resize', on)
    const ro = new ResizeObserver(on)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    on()
    return () => {
      window.removeEventListener('scroll', on, { capture: true })
      window.removeEventListener('resize', on)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
      const head = el.querySelector<HTMLElement>(':scope > table > thead')
      if (head) {
        head.style.transform = ''
        head.style.willChange = ''
      }
    }
  }, [])

  // Ikkala chiziq bir-birini kuzatadi
  useEffect(() => {
    const a = box.current, b = bar.current
    if (!a || !b) return
    b.scrollLeft = a.scrollLeft
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
  }, [hasXScroll])

  return (
    <>
      <div ref={box} className={cx(className ?? 'overflow-x-auto', hasXScroll && 'no-scrollbar')}>
        {children}
      </div>
      {hasXScroll && (
        <div
          ref={bar}
          className="sticky bottom-0 z-[25] overflow-x-auto border-t border-line bg-ink-900/95 py-0.5 backdrop-blur-sm"
          aria-hidden="true"
        >
          <div style={{ width: w.inner, height: 1 }} />
        </div>
      )}
    </>
  )
})

export default XScroll
