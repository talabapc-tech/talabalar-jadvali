'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'

/*
  Telegram uslubidagi tartiblash (profil/chat papkalarini sudrab joylashtirishdek):
   - ushlagichdan (grip) ushlab sudraladi — sichqoncha ham, barmoq (touch) ham bir xil ishlaydi;
   - sudralgan qator barmoq ortidan yuradi, qolganlari silliq surilib unga joy bo'shatadi;
   - qo'yib yuborilganda qator yangi joyiga yumshoq "o'tiradi", sakrash/miltillash bo'lmaydi;
   - ro'yxat chetiga yaqinlashganda o'zi aylantiriladi (auto-scroll).
  useFlip — tugma (yuqoriga/pastga, alifbo tiklash) bilan tartib o'zgarganda qatorlarni eski
  joyidan yangisiga silliq ko'chiradi (FLIP texnikasi).
  Animatsiyalar faqat transform bilan (GPU), React qayta chizmaydi; "prefers-reduced-motion"
  yoqilgan bo'lsa animatsiya o'chadi.
  Elementlar: konteyner ichidagi [data-sort-key] lar, DOM tartibi = ro'yxat tartibi.
*/

const EASE = 'cubic-bezier(0.2, 0, 0, 1)'
const SHIFT_MS = 200
const SETTLE_MS = 180
const FLIP_MS = 260

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const sortItems = (container: HTMLElement | null): HTMLElement[] =>
  container ? Array.from(container.querySelectorAll<HTMLElement>('[data-sort-key]')) : []

const clearStyles = (el: HTMLElement) => {
  el.style.transition = ''
  el.style.transform = ''
  el.style.willChange = ''
  el.style.position = ''
  el.style.zIndex = ''
}

/* ------------------------------------------------------------------ FLIP */

export function useFlip(containerRef: RefObject<HTMLElement | null>, orderKey: string) {
  const first = useRef<Map<string, number> | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  /** Tartib o'zgarishidan OLDIN chaqiriladi — hozirgi joylarni eslab qoladi */
  const capture = useCallback(() => {
    const m = new Map<string, number>()
    for (const el of sortItems(containerRef.current)) m.set(el.dataset.sortKey!, el.getBoundingClientRect().top)
    first.current = m.size ? m : null
  }, [containerRef])

  useLayoutEffect(() => {
    const prev = first.current
    first.current = null
    if (!prev || reducedMotion()) return
    const moved: HTMLElement[] = []
    for (const el of sortItems(containerRef.current)) {
      const was = prev.get(el.dataset.sortKey!)
      if (was === undefined) continue
      const dy = was - el.getBoundingClientRect().top
      if (Math.abs(dy) < 1) continue
      el.style.transition = 'none'
      el.style.transform = `translateY(${dy}px)`
      moved.push(el)
    }
    if (!moved.length) return
    void containerRef.current?.offsetHeight // eski joyni chizdirish (reflow)
    for (const el of moved) {
      el.style.transition = `transform ${FLIP_MS}ms ${EASE}`
      el.style.transform = ''
    }
    timers.current.push(setTimeout(() => moved.forEach((el) => (el.style.transition = '')), FLIP_MS + 40))
  }, [orderKey, containerRef])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  return capture
}

/* ------------------------------------------------------------------ Sudrash */

interface DragState {
  key: string
  from: number
  to: number
  list: HTMLElement[]
  rects: DOMRect[]
  slot: number
  shifts: number[]
  startY: number
  y: number
  startScroll: number
  raf: number
}

export function useSortable({
  containerRef,
  scrollRef,
  onMove,
}: {
  containerRef: RefObject<HTMLElement | null>
  /** Aylantiriladigan blok (auto-scroll uchun). Bo'lmasa — containerRef */
  scrollRef?: RefObject<HTMLElement | null>
  /** Qo'yib yuborilganda: from → to (ro'yxatdagi indekslar) */
  onMove: (from: number, to: number) => void
}) {
  const [dragKey, setDragKey] = useState<string | null>(null)
  const st = useRef<DragState | null>(null)
  const settling = useRef(false)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  const scroller = () => scrollRef?.current ?? containerRef.current

  /** Sudralayotgan qatorni joylash va qolganlarini surish */
  const layout = useCallback(() => {
    const s = st.current
    if (!s) return
    const sc = scrollRef?.current ?? containerRef.current
    const r = s.rects[s.from]
    let dy = s.y - s.startY + ((sc?.scrollTop ?? 0) - s.startScroll)
    // Ro'yxat chegarasidan chiqib ketmasin
    dy = Math.max(s.rects[0].top - r.top, Math.min(s.rects[s.rects.length - 1].bottom - r.bottom, dy))
    s.list[s.from].style.transform = `translateY(${dy}px)`

    const center = r.top + r.height / 2 + dy
    let to = s.from
    for (let i = 0; i < s.list.length; i++) {
      if (i === s.from) continue
      const mid = s.rects[i].top + s.rects[i].height / 2
      let shift = 0
      if (i > s.from && center > mid) {
        shift = -s.slot
        to = Math.max(to, i)
      } else if (i < s.from && center < mid) {
        shift = s.slot
        to = Math.min(to, i)
      }
      if (shift !== s.shifts[i]) {
        s.shifts[i] = shift
        s.list[i].style.transform = shift ? `translateY(${shift}px)` : ''
      }
    }
    s.to = to
  }, [containerRef, scrollRef])

  const finish = useCallback(
    (commit: boolean) => {
      const s = st.current
      if (!s) return
      cancelAnimationFrame(s.raf)
      st.current = null
      const dragged = s.list[s.from]
      const r = s.rects[s.from]
      const to = commit ? s.to : s.from
      if (!commit) s.list.forEach((el, i) => i !== s.from && (el.style.transform = ''))
      // Qator yangi joyiga yumshoq "o'tiradi"
      const final = to > s.from ? s.rects[to].bottom - r.bottom : to < s.from ? s.rects[to].top - r.top : 0
      settling.current = true
      const done = () => {
        if (to !== s.from) flushSync(() => onMoveRef.current(s.from, to))
        s.list.forEach(clearStyles)
        settling.current = false
        setDragKey(null)
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (reducedMotion()) return done()
      dragged.style.transition = `transform ${SETTLE_MS}ms ${EASE}, scale ${SETTLE_MS}ms ${EASE}, box-shadow ${SETTLE_MS}ms`
      dragged.style.transform = `translateY(${final}px)`
      setTimeout(done, SETTLE_MS)
    },
    [],
  )

  /** Ushlagichga beriladi: onPointerDown={(e) => startDrag(e, key)} */
  const startDrag = useCallback(
    (e: React.PointerEvent, key: string) => {
      if (st.current || settling.current || (e.pointerType === 'mouse' && e.button !== 0)) return
      const list = sortItems(containerRef.current)
      const from = list.findIndex((el) => el.dataset.sortKey === key)
      if (from < 0 || list.length < 2) return
      e.preventDefault()
      const rects = list.map((el) => el.getBoundingClientRect())
      // Qatorlar orasidagi bo'shliq (masalan space-y) ham hisobga olinadi
      const gap = Math.max(0, rects[1].top - rects[0].bottom)
      const fast = reducedMotion()
      list.forEach((el, i) => {
        el.style.willChange = 'transform'
        el.style.transition = i === from ? (fast ? 'none' : `scale 150ms ${EASE}, box-shadow 150ms`) : fast ? 'none' : `transform ${SHIFT_MS}ms ${EASE}`
      })
      list[from].style.position = 'relative'
      list[from].style.zIndex = '15'
      st.current = {
        key,
        from,
        to: from,
        list,
        rects,
        slot: rects[from].height + gap,
        shifts: list.map(() => 0),
        startY: e.clientY,
        y: e.clientY,
        startScroll: scroller()?.scrollTop ?? 0,
        raf: 0,
      }
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      setDragKey(key)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [containerRef, scrollRef],
  )

  // Sudrash davomida: kursor/barmoq kuzatuvi va chetda avtomatik aylantirish
  useEffect(() => {
    if (!dragKey) return
    const move = (e: PointerEvent) => {
      const s = st.current
      if (!s) return
      e.preventDefault()
      s.y = e.clientY
      layout()
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && finish(false)
    const tick = () => {
      const s = st.current
      const sc = scrollRef?.current ?? containerRef.current
      if (!s || !sc) return
      const box = sc.getBoundingClientRect()
      const edge = Math.min(56, box.height / 4)
      let v = 0
      if (s.y < box.top + edge) v = -Math.ceil(((box.top + edge - s.y) / edge) * 14)
      else if (s.y > box.bottom - edge) v = Math.ceil(((s.y - (box.bottom - edge)) / edge) * 14)
      if (v) {
        const before = sc.scrollTop
        sc.scrollTop += v
        if (sc.scrollTop !== before) layout()
      }
      s.raf = requestAnimationFrame(tick)
    }
    if (st.current) st.current.raf = requestAnimationFrame(tick)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [dragKey, layout, finish, containerRef, scrollRef])

  return { dragKey, startDrag }
}
