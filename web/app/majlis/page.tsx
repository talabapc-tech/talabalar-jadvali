import type { Metadata } from 'next'
import MajlisApp from '@/components/majlis/MajlisApp'

export const metadata: Metadata = {
  title: 'Majlislar davomati',
  robots: { index: false, follow: false },
}

export default function Page() {
  return <MajlisApp />
}
