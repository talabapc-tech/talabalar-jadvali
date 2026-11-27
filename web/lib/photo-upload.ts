'use client'

import { fullName } from './student'
import type { Student } from './types'

const MAX_DIM = 640
const QUALITY = 0.86

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Rasm faylini o'qib bo'lmadi"))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
}

/**
 * Talaba rasmini brauzerning o'zida siqib va o'lchamini moslab (max 640px, WebP/JPEG) tayyorlash.
 * 3-5 MB telefon rasmlari ~35-60 KB gacha kichrayadi, yuklash juda tezlashadi.
 */
export async function prepareStudentPhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    throw new Error('Faqat rasm fayli (JPG, PNG, WebP) tanlang')
  }
  const img = await loadImage(file)
  const srcW = img.naturalWidth || img.width
  const srcH = img.naturalHeight || img.height
  if (!srcW || !srcH) throw new Error("Rasm o'lchami noto'g'ri")

  const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return file

  // Shaffof PNG rasmlar uchun toza oq fon
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)

  let blob = await canvasToBlob(canvas, 'image/webp', QUALITY)
  let ext = 'webp'
  if (!blob || blob.type !== 'image/webp') {
    blob = await canvasToBlob(canvas, 'image/jpeg', QUALITY)
    ext = 'jpg'
  }
  if (!blob) return file

  return new File([blob], `photo.${ext}`, { type: blob.type })
}

export async function uploadStudentPhotoFile(
  student: Pick<Student, 'row' | 'pinfl' | 'fish' | 'ism' | 'ota'>,
  rawFile: File,
): Promise<string> {
  const prepared = await prepareStudentPhoto(rawFile)
  const fd = new FormData()
  fd.append('file', prepared)
  if (student.row) fd.append('row', String(student.row))
  if (student.pinfl) fd.append('pinfl', String(student.pinfl).replace(/\s/g, ''))
  fd.append('fish', fullName(student))

  const res = await fetch('/api/student-photo', { method: 'POST', body: fd })
  if (res.status === 401) {
    window.location.replace('/login')
    throw new Error('Kirish talab qilinadi')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.ok || !body.photo_url) {
    throw new Error(body.error || `Server ${res.status} qaytardi`)
  }
  return String(body.photo_url)
}

export async function removeStudentPhoto(
  student: Pick<Student, 'row' | 'pinfl' | 'fish' | 'ism' | 'ota'>,
): Promise<void> {
  const res = await fetch('/api/student-photo', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      row: student.row,
      pinfl: String(student.pinfl || '').replace(/\s/g, ''),
      fish: fullName(student),
    }),
  })
  if (res.status === 401) {
    window.location.replace('/login')
    throw new Error('Kirish talab qilinadi')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.ok) {
    throw new Error(body.error || `Server ${res.status} qaytardi`)
  }
}
