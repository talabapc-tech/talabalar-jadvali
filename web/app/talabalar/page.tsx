import type { Metadata } from 'next'
import Portal from '@/components/Portal'

export const metadata: Metadata = {
  title: 'Talabalar portali | Shahrisabz Tibbiyot Texnikumi',
  description: "Shahrisabz Tibbiyot Texnikumi talabalar bazasi va shartnomalar tizimi",
}

export default function TalabalarPage() {
  return <Portal initialTab="students" />
}
