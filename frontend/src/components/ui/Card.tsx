import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export default function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border border-edge bg-surface p-4 shadow-sm', className)}
      {...rest}
    />
  )
}
