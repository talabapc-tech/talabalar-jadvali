import type { Metadata } from 'next'
import Portal from '@/components/Portal'

export const metadata: Metadata = {
  title: "So'rovnomalar | Shahrisabz Tibbiyot Texnikumi",
  description: "Google Forms uslubidagi so'rovnomalar konstruktori, aqlli kiritish va Excel eksport",
}

export default function SorovnomalarPage() {
  return <Portal initialTab="surveys" />
}
