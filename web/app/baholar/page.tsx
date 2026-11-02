import type { Metadata } from 'next'
import Portal from '@/components/Portal'

export const metadata: Metadata = {
  title: 'Baholar | Shahrisabz Tibbiyot Texnikumi',
  description: "Talabalar baholari: joriy, oraliq, yakuniy, R-semestr va malakaviy amaliyot",
}

export default function BaholarPage() {
  return <Portal initialTab="grades" />
}
