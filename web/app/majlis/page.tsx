import type { Metadata } from 'next'
import MajlisApp from '@/components/majlis/MajlisApp'
import VersionBadge from '@/components/VersionBadge'

export const metadata: Metadata = {
  title: 'Majlislar davomati',
  robots: { index: false, follow: false },
}

export default function Page() {
  return (
    <>
      <MajlisApp />
      <VersionBadge />
    </>
  )
}
