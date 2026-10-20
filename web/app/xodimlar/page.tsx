import type { Metadata } from 'next'
import Portal from '@/components/Portal'

export const metadata: Metadata = {
  title: 'Xodimlar boshqaruvi | Shahrisabz Tibbiyot Texnikumi',
  description: "Shahrisabz Tibbiyot Texnikumi xodimlar va o'qituvchilar boshqaruvi tizimi",
}

export default function XodimlarPage() {
  return <Portal initialTab="staff" />
}
