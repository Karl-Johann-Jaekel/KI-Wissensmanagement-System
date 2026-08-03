import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type BadgeTone = 'neutral' | 'green' | 'amber' | 'rose' | 'sky' | 'violet'

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-edge bg-sunken text-muted',
  green:
    'border-emerald-500/40 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  amber:
    'border-amber-500/40 bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  rose: 'border-rose-500/40 bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
  sky: 'border-sky-500/40 bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  violet:
    'border-violet-500/40 bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

export default function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  )
}
