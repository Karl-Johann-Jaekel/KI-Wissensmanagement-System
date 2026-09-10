import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink',
        'min-h-11 pointer-fine:min-h-0',
        'placeholder:text-muted focus:border-primary-500 focus:outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary-500/30',
        className,
      )}
      {...rest}
    />
  )
})

export default Input
