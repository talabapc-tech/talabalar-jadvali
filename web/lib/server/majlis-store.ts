import 'server-only'
import { readRepoFile, saveRepoJsonFile } from '@/lib/server/source'
import { sanitizeDb, sanitizeMajlis, sanitizeOqituvchilar, sanaUz, type Majlis, type MajlisDb } from '@/lib/majlis'

/*
  data/majlislar.json — kompyuterda diskka yoziladi (Python xizmati GitHub'ga yuboradi),
  internetda GitHub'dagi fayl to'g'ridan-to'g'ri yangilanadi (saveRepoJsonFile).
  Har saqlash: fayl qayta o'qiladi, faqat o'zgargan majlis almashtiriladi — boshqa qurilmadan
  kiritilgan majlislar yo'qolmaydi.
*/

const DB_PATH = 'data/majlislar.json'

export async function loadMajlisDb(): Promise<MajlisDb> {
  const buf = await readRepoFile([DB_PATH])
  if (!buf) return { oqituvchilar: [], majlislar: [] }
  return sanitizeDb(JSON.parse(buf.toString('utf-8')))
}

async function save(db: MajlisDb, msg: string) {
  await saveRepoJsonFile(DB_PATH, db, msg)
}

export async function saveMajlis(raw: unknown): Promise<Majlis> {
  const m = sanitizeMajlis(raw)
  if (!m) throw new Error("Majlis ma'lumoti noto'g'ri (sana kerak)")
  m.yangilangan = new Date().toISOString()
  const db = await loadMajlisDb()
  const known = new Set(db.oqituvchilar.map((o) => o.id))
  m.tarkib = m.tarkib.filter((id) => known.has(id))
  db.majlislar = sanitizeDb({ ...db, majlislar: [m, ...db.majlislar.filter((x) => x.id !== m.id)] }).majlislar
  await save(db, `Majlis davomati: ${sanaUz(m.sana)}`)
  return m
}

export async function deleteMajlis(id: string): Promise<void> {
  const db = await loadMajlisDb()
  const m = db.majlislar.find((x) => x.id === id)
  if (!m) return
  db.majlislar = db.majlislar.filter((x) => x.id !== id)
  await save(db, `Majlis o'chirildi: ${sanaUz(m.sana)}`)
}

/** O'qituvchilar ro'yxatini almashtirish. Majlislarda qatnashgan o'qituvchi o'chirilmaydi — nofaol bo'ladi. */
export async function saveOqituvchilar(raw: unknown): Promise<MajlisDb> {
  const list = sanitizeOqituvchilar(raw)
  const db = await loadMajlisDb()
  const keep = new Set(list.map((o) => o.id))
  const used = new Set(db.majlislar.flatMap((m) => m.tarkib))
  for (const o of db.oqituvchilar) {
    if (!keep.has(o.id) && used.has(o.id)) list.push({ ...o, faol: false })
  }
  db.oqituvchilar = list
  await save(db, "O'qituvchilar ro'yxati yangilandi")
  return db
}
