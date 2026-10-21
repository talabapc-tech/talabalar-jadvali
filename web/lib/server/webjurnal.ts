import 'server-only'

export interface WebJurnalSyncResult {
  ok: boolean
  message?: string
  dryRun?: boolean
  stats?: {
    totalReceived: number
    validCandidates: number
    added: number
    alreadyExists: number
    unresolvedGroup: number
  }
  added?: Array<{
    id: string | number
    fullName: string
    groupId?: number
    groupName?: string
  }>
  alreadyExists?: string[]
  unresolved?: string[]
  error?: string
}

export interface StudentSyncItem {
  groupName: string
  fullName: string
}

const DEFAULT_SYNC_URL = 'https://webjurnal.vercel.app/api/students/sync'
const DEFAULT_API_KEY = 'lCRKqFGks6_TjfkfDNCPsvi1lL60l6nYH3GCG7mibEA'

export function getWebJurnalConfig() {
  return {
    url: (process.env.WEB_JURNAL_SYNC_URL || DEFAULT_SYNC_URL).trim(),
    apiKey: (process.env.WEB_JURNAL_API_KEY || DEFAULT_API_KEY).trim(),
  }
}

/**
 * Web Jurnal API siga bitta guruh talabalarini sinxronlash (HTTP POST /api/students/sync)
 * 
 * Body:
 * {
 *   "groupName": "<Talabaning guruhi, masalan: '26-02' yoki '26-01'>",
 *   "students": [
 *     "<Talabaning to'liq F.I.O si (Ism, Familiya, Sharif)>"
 *   ]
 * }
 */
export async function syncStudentsToWebJurnal(
  groupName: string,
  students: string[]
): Promise<WebJurnalSyncResult> {
  const cleanGroup = String(groupName || '').trim()
  const cleanStudents = (students || [])
    .map((s) => String(s || '').trim())
    .filter((s) => s.length > 0)

  if (!cleanGroup || cleanStudents.length === 0) {
    return { ok: false, error: "Guruh nomi yoki talabalar ro'yxati bo'sh" }
  }

  const { url, apiKey } = getWebJurnalConfig()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000) // 10 soniya timeout

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        groupName: cleanGroup,
        students: cleanStudents,
      }),
      signal: controller.signal,
      cache: 'no-store',
    })

    clearTimeout(timeout)

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      const errMsg = data?.error || data?.message || `Server ${res.status} qaytardi`
      console.warn(`[WebJurnal Sync] Xato (${res.status}): ${errMsg} (Guruh: ${cleanGroup}, Talabalar: ${cleanStudents.join(', ')})`)
      return { ok: false, error: errMsg }
    }

    console.log(`[WebJurnal Sync] ✅ Muvaffaqiyatli yuborildi: ${cleanGroup} guruhiga ${cleanStudents.length} ta talaba (${data?.stats?.added ?? cleanStudents.length} ta kiritildi)`)
    return { ok: true, ...(data || {}) }
  } catch (err) {
    const msg = (err as Error).message || String(err)
    console.warn(`[WebJurnal Sync] Tarmoq yoki ulanish xatosi: ${msg} (Guruh: ${cleanGroup})`)
    return { ok: false, error: msg }
  }
}

/**
 * Bir nechta talabani (turli guruhlarda bo'lsa ham) guruhlar bo'yicha to'plab,
 * Web Jurnal API siga yuborish
 */
export async function syncBatchStudentsToWebJurnal(
  items: StudentSyncItem[]
): Promise<Record<string, WebJurnalSyncResult>> {
  if (!Array.isArray(items) || items.length === 0) return {}

  // Guruhlar kesimida to'plash
  const grouped: Record<string, string[]> = {}
  for (const it of items) {
    const g = String(it.groupName || '').trim()
    const n = String(it.fullName || '').trim()
    if (!g || !n) continue
    if (!grouped[g]) grouped[g] = []
    if (!grouped[g].includes(n)) grouped[g].push(n)
  }

  const results: Record<string, WebJurnalSyncResult> = {}

  await Promise.allSettled(
    Object.entries(grouped).map(async ([grp, studList]) => {
      try {
        const res = await syncStudentsToWebJurnal(grp, studList)
        results[grp] = res
      } catch (err) {
        results[grp] = { ok: false, error: (err as Error).message }
      }
    })
  )

  return results
}

/**
 * Orqa fonda (background / asynchronous) chaqirish uchun xavfsiz wrapper.
 * Asosiy oqimni hech qachon to'xtatmaydi yoki xato bilan yiqitmaydi.
 */
export function triggerWebJurnalSyncInBackground(
  groupName: string,
  students: string[]
): void {
  void syncStudentsToWebJurnal(groupName, students).catch((err) => {
    console.warn('[WebJurnal Background Sync Exception]', err)
  })
}

/**
 * Talabani Web Jurnalda "Talabalar safidan chiqarilganlar" (ID: 18) guruhiga o'tkazish.
 * MUHIM: Web Jurnalda talabaning barcha baholari va davomatlari to'liq saqlanib qoladi!
 */
export async function withdrawStudentFromWebJurnal(
  fullName: string,
  reason?: string
): Promise<WebJurnalSyncResult> {
  const cleanName = String(fullName || '').trim()
  if (!cleanName) {
    return { ok: false, error: "Talaba F.I.O si bo'sh" }
  }

  const { url, apiKey } = getWebJurnalConfig()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        action: 'withdraw',
        students: [cleanName],
        reason: reason || 'Boshqaruv bazasidan chiqarildi',
      }),
      signal: controller.signal,
      cache: 'no-store',
    })

    clearTimeout(timeout)
    const data = await res.json().catch(() => null)

    if (!res.ok) {
      const errMsg = data?.error || data?.message || `Server ${res.status} qaytardi`
      console.warn(`[WebJurnal Withdraw] Xato (${res.status}): ${errMsg} (Talaba: ${cleanName})`)
      return { ok: false, error: errMsg }
    }

    console.log(`[WebJurnal Withdraw] ✅ Muvaffaqiyatli safdan chiqarildi: ${cleanName}`)
    return { ok: true, ...(data || {}) }
  } catch (err) {
    const msg = (err as Error).message || String(err)
    console.warn(`[WebJurnal Withdraw] Tarmoq xatosi: ${msg} (Talaba: ${cleanName})`)
    return { ok: false, error: msg }
  }
}

/**
 * Orqa fonda safdan chiqarish chaqirig'i (asosiy jarayonni to'xtatmaydi)
 */
export function triggerWebJurnalWithdrawInBackground(
  fullName: string,
  reason?: string
): void {
  void withdrawStudentFromWebJurnal(fullName, reason).catch((err) => {
    console.warn('[WebJurnal Background Withdraw Exception]', err)
  })
}

