import type { Metadata } from 'next'
import Portal from '@/components/Portal'

export const metadata: Metadata = {
  title: "O'quv rejalari va fanlar | Shahrisabz Tibbiyot Texnikumi",
  description: "Har bir o'quv yili bo'yicha yo'nalishlar, fanlar va guruhlarga biriktirilgan o'quv rejalari tizimi",
}

export default function OquvRejaPage() {
  return <Portal initialTab="curriculum" />
}
