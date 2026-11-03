import 'server-only'
import { readRepoFile, saveRepoJsonFile } from '@/lib/server/source'

export interface BahoShareLink {
  id: string
  token: string
  guruh: string
  semestr: number
  fan: string
  teacherName?: string
  hiddenPinfls: string[]
  active: boolean
  createdAt: string
  updatedAt: string
}

const SHARES_PATH = 'data/baholar_shares.json'
const ORDERS_PATH = 'data/student_orders.json'

/* ---------------------------- O'qituvchi ulashish havolalari ---------------------------- */

export async function loadShares(): Promise<BahoShareLink[]> {
  try {
    const buf = await readRepoFile([SHARES_PATH])
    if (!buf) return []
    const parsed = JSON.parse(buf.toString('utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function saveShares(shares: BahoShareLink[]): Promise<void> {
  await saveRepoJsonFile(SHARES_PATH, shares, "Baholar ulashish havolalari yangilandi")
}

export async function getShareByToken(token: string): Promise<BahoShareLink | null> {
  if (!token) return null
  const shares = await loadShares()
  const found = shares.find((s) => s.token === token && s.active !== false)
  return found || null
}

export async function createShare(params: {
  guruh: string
  semestr: number
  fan: string
  teacherName?: string
  hiddenPinfls: string[]
}): Promise<BahoShareLink> {
  const shares = await loadShares()
  const token = `sh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  const newShare: BahoShareLink = {
    id: `share_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    token,
    guruh: params.guruh.trim(),
    semestr: params.semestr,
    fan: params.fan.trim(),
    teacherName: (params.teacherName || '').trim(),
    hiddenPinfls: Array.isArray(params.hiddenPinfls) ? params.hiddenPinfls : [],
    active: true,
    createdAt: now,
    updatedAt: now,
  }
  shares.unshift(newShare)
  await saveShares(shares)
  return newShare
}

export async function updateShare(
  id: string,
  updates: Partial<Pick<BahoShareLink, 'teacherName' | 'hiddenPinfls' | 'active' | 'fan'>>,
): Promise<BahoShareLink | null> {
  const shares = await loadShares()
  const idx = shares.findIndex((s) => s.id === id)
  if (idx === -1) return null
  const now = new Date().toISOString()
  shares[idx] = {
    ...shares[idx],
    ...updates,
    updatedAt: now,
  }
  await saveShares(shares)
  return shares[idx]
}

export async function deleteShare(id: string): Promise<boolean> {
  const shares = await loadShares()
  const next = shares.filter((s) => s.id !== id)
  if (next.length === shares.length) return false
  await saveShares(next)
  return true
}

/* ---------------------------- Talabalar maxsus tartibi ---------------------------- */

export async function loadStudentOrders(): Promise<Record<string, string[]>> {
  try {
    const buf = await readRepoFile([ORDERS_PATH])
    if (!buf) return {}
    const parsed = JSON.parse(buf.toString('utf-8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export async function saveStudentOrder(guruh: string, order: string[]): Promise<void> {
  if (!guruh || !Array.isArray(order)) return
  const current = await loadStudentOrders()
  const key = guruh.trim()
  const prev = current[key] || []
  // O'zgarish bo'lmasa GitHub'ga keraksiz commit qilinmaydi
  if (prev.length === order.length && prev.every((p, i) => p === order[i])) return
  if (order.length) current[key] = order
  else delete current[key]
  await saveRepoJsonFile(ORDERS_PATH, current, `${guruh} guruhi talabalar tartibi yangilandi`)
}
