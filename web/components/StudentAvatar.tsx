'use client'

import { memo, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fullName } from '@/lib/student'
import type { Student } from '@/lib/types'
import Lightbox from './Lightbox'
import { cx } from './ui'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'card' | 'portrait'

const SIZE_CLS: Record<AvatarSize, string> = {
  xs: 'size-7 rounded-full text-[10px]',
  sm: 'size-8 rounded-full text-[11px]',
  md: 'size-10 rounded-full text-[12px]',
  card: 'size-14 rounded-full text-[14px]',
  portrait: 'size-[72px] rounded-full text-[18px]',
}

const TONES = [
  'border-sky/30 bg-sky/12 text-sky-soft',
  'border-blue/30 bg-blue/12 text-blue-soft',
  'border-emerald/30 bg-emerald/12 text-emerald-soft',
  'border-violet/30 bg-violet/12 text-violet',
  'border-amber/30 bg-amber/12 text-amber',
] as const

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function toneOf(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return TONES[Math.abs(h) % TONES.length]
}

interface Props {
  student: Pick<Student, 'fish' | 'ism' | 'ota' | 'photo_url'>
  size?: AvatarSize
  className?: string
  title?: string
  onClick?: (e: React.MouseEvent) => void
  /** Rasm ustiga bosilganda to'liq ekranda kattalashtirish (standart: true) */
  zoomable?: boolean
}

function StudentAvatar({ student, size = 'sm', className, title, onClick, zoomable = true }: Props) {
  const name = fullName(student)
  const src = student.photo_url?.trim() || ''
  const [failed, setFailed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    setFailed(false)
    setPreviewOpen(false)
  }, [src])

  const showImg = !!src && !failed
  const canBuiltInZoom = showImg && zoomable && !onClick

  const handleImgClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick(e)
      return
    }
    if (canBuiltInZoom) {
      e.stopPropagation()
      e.preventDefault()
      setPreviewOpen(true)
    }
  }

  if (showImg) {
    return (
      <>
        <span
          role={onClick || canBuiltInZoom ? 'button' : undefined}
          tabIndex={onClick || canBuiltInZoom ? 0 : undefined}
          onClick={onClick || canBuiltInZoom ? handleImgClick : undefined}
          onKeyDown={
            onClick || canBuiltInZoom
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    if (onClick) onClick(e as unknown as React.MouseEvent)
                    else setPreviewOpen(true)
                  }
                }
              : undefined
          }
          title={title || (canBuiltInZoom ? `${name} — kattalashtirish uchun bosing` : name)}
          className={cx(
            'relative inline-flex shrink-0 overflow-hidden border border-line-strong bg-ink-850 select-none',
            SIZE_CLS[size],
            (onClick || canBuiltInZoom) &&
              'cursor-zoom-in transition-transform duration-150 hover:scale-105 hover:ring-2 hover:ring-sky/60',
            className,
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={name}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover object-top"
          />
        </span>
        {previewOpen && typeof document !== 'undefined' &&
          createPortal(
            <Lightbox
              images={[src]}
              index={0}
              onIndex={() => {}}
              onClose={() => setPreviewOpen(false)}
              title={name}
            />,
            document.body,
          )}
      </>
    )
  }

  return (
    <span
      onClick={onClick}
      title={title || name}
      className={cx(
        'inline-flex shrink-0 items-center justify-center border font-bold tracking-tight select-none',
        SIZE_CLS[size],
        toneOf(name),
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

export default memo(StudentAvatar)
