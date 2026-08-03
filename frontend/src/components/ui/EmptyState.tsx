import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
  className?: string
}

export default function EmptyState({ icon: Icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-edge px-6 py-12 text-center',
        className,
      )}
    >
      {Icon && (
        <div className="mb-1 rounded-xl bg-primary-100 p-3 text-primary-700 dark:bg-primary-950 dark:text-primary-300">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
