import 'server-only'

export interface PendingData {
  fish?: string
  ism?: string
  ota?: string
  pv?: string
  pinfl?: string
  dob?: string
  pass_ber?: string
  tel?: string
  maktab?: string
  yil?: string
  sh_doc?: string
  doc_tur?: string
  mutaxassislik?: string
  lavozim?: string
  yashash_joyi?: string
  group?: string
  kategoriya?: string
}

export interface PendingDraft {
  id: string
  chatId: string
  mode: 'add_student' | 'add_staff' | 'neutral'
  data: PendingData
  createdAt: number
}

// In-memory store (TTL: 2 soat)
const drafts = new Map<string, PendingDraft>()
const userModes = new Map<string, { mode: 'add_student' | 'add_staff'; timestamp: number }>()

export function savePendingDraft(draft: PendingDraft): void {
  drafts.set(draft.id, draft)
  // Eskirganlarni tozalash (2 soatdan oshgan)
  const now = Date.now()
  for (const [key, item] of drafts.entries()) {
    if (now - item.createdAt > 2 * 3600 * 1000) drafts.delete(key)
  }
}

export function getPendingDraft(id: string): PendingDraft | null {
  return drafts.get(id) || null
}

export function deletePendingDraft(id: string): void {
  drafts.delete(id)
}

export function setUserMode(chatId: string | number, mode: 'add_student' | 'add_staff' | null): void {
  const cid = String(chatId)
  if (!mode) {
    userModes.delete(cid)
  } else {
    userModes.set(cid, { mode, timestamp: Date.now() })
  }
}

export function getUserMode(chatId: string | number): 'add_student' | 'add_staff' | null {
  const cid = String(chatId)
  const val = userModes.get(cid)
  if (!val) return null
  // 30 daqiqadan oshgan bo'lsa bekor qilish
  if (Date.now() - val.timestamp > 30 * 60 * 1000) {
    userModes.delete(cid)
    return null
  }
  return val.mode
}
