import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'rounded-lg border border-edge bg-surface px-2 py-1.5 text-sm text-ink',
          'focus:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30',
          className,
        )}
        {...rest}
      />
    )
  },
)

export default Select
