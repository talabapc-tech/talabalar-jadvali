import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { BUYRUQ_TURLARI, buyruqQiymatlari, type BuyruqFields } from '@/lib/buyruq'
import { fillPlaceholders } from '@/lib/server/malumotnoma'

/*
  Buyruqlar — Word shablonlaridan (assets/buyruqlar/*.docx). Shablon Word'da tahrirlanadi;
  unda {{buyruq_raqami}}, {{sanasi}}, {{IFO}}, {{kursi}}, {{guruhi}} ... belgilari qoladi —
  faqat shular almashtiriladi, qolgan hammasi (sarlavha, shrift, imzo) shablondagidek.
*/

const DIR = path.join(process.cwd(), 'assets', 'buyruqlar')
const cache = new Map<string, Promise<Record<string, Uint8Array>>>()

function loadTemplate(file: string) {
  let p = cache.get(file)
  if (!p) {
    p = readFile(path.join(DIR, file))
      .then((buf) => unzipSync(new Uint8Array(buf)))
      .catch((e) => { cache.delete(file); throw e })
    cache.set(file, p)
  }
  return p
}

/** Tayyor buyruq — .docx */
export async function renderBuyruq(fish: string, f: BuyruqFields): Promise<Buffer> {
  const files = { ...(await loadTemplate(BUYRUQ_TURLARI[f.tur].fayl)) }
  const xml = strFromU8(files['word/document.xml'])
  const out = fillPlaceholders(xml, buyruqQiymatlari(fish, f))
  const left = /\{\{[A-Za-z_]+\}\}/.exec(out.replace(/<[^>]+>/g, ''))
  if (left) throw new Error(`Shablonda to'ldirilmagan belgi qoldi: ${left[0]}`)
  files['word/document.xml'] = strToU8(out)
  return Buffer.from(zipSync(files, { level: 6 }))
}
