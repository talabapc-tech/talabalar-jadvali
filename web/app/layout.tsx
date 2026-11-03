import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin', 'latin-ext'], variable: '--font-jakarta', display: 'swap' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' })

export const metadata: Metadata = {
  title: 'Talabalar portali',
  description: "Shahrisabz Tibbiyot Texnikumi — talabalar shartnomalari va akademik guruhlar",
}

export const viewport: Viewport = {
  themeColor: '#040b14',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" className={`${jakarta.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        {/* Saqlangan rejimni (yorug'/to'q) sahifa chizilishidan oldin qo'llash — yangilanganda yo'qolmasin, miltillamasin */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('portal_theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
