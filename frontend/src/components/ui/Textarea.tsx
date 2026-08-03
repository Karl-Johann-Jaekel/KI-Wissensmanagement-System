import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink',
          'placeholder:text-muted focus:border-primary-500 focus:outline-none',
          'focus-visible:ring-2 focus-visible:ring-primary-500/30',
          className,
        )}
        {...rest}
      />
    )
  },
)

export default Textarea
