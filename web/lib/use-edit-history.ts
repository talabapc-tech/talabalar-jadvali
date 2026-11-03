'use client'

import { useCallback, useState } from 'react'

/*
  Jadval tahrirlari uchun Undo (Ctrl+Z) / Redo (Ctrl+Y) tarixi.
  Hamma narsa bitta state ichida va faqat sof (pure) yangilanishlar bilan — React StrictMode
  updater'ni ikki marta chaqirsa ham tarix ikki baravar yozilmaydi, eski (stale) holat qaytmaydi.
*/

export type Edits = Record<string, string>

interface State {
  edits: Edits
  past: Edits[]
  future: Edits[]
}

const LIMIT = 100
const EMPTY: State = { edits: {}, past: [], future: [] }

const sameEdits = (a: Edits, b: Edits) => {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => b[k] === a[k])
}

export function useEditHistory() {
  const [state, setState] = useState<State>(EMPTY)

  /** Tahrirni qo'llash va oldingi holatni tarixga yozish. fn yangi obyekt qaytarishi kerak. */
  const apply = useCallback((fn: (prev: Edits) => Edits) => {
    setState((s) => {
      const next = fn(s.edits)
      if (next === s.edits || sameEdits(next, s.edits)) return s
      return { edits: next, past: [...s.past.slice(-(LIMIT - 1)), s.edits], future: [] }
    })
  }, [])

  /** Tarixsiz almashtirish (serverdan yuklangach, saqlangach) */
  const reset = useCallback((edits: Edits = {}) => setState({ edits, past: [], future: [] }), [])

  const undo = useCallback(() => {
    setState((s) => {
      if (!s.past.length) return s
      return { edits: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [...s.future, s.edits] }
    })
  }, [])

  const redo = useCallback(() => {
    setState((s) => {
      if (!s.future.length) return s
      return { edits: s.future[s.future.length - 1], past: [...s.past, s.edits], future: s.future.slice(0, -1) }
    })
  }, [])

  return {
    edits: state.edits,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    apply,
    reset,
    undo,
    redo,
  }
}

/** Excel/Google Sheets'dan nusxalangan matnni jadvalga aylantirish (qatorlar × ustunlar) */
export function parseClipboardGrid(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  // Excel oxirida bo'sh qator qo'shadi
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.map((l) => l.split('\t'))
}
