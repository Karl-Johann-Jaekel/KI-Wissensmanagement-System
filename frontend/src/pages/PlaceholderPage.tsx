import type { LucideIcon } from 'lucide-react'
import EmptyState from '../components/ui/EmptyState'

interface PlaceholderPageProps {
  title: string
  icon: LucideIcon
  hint: string
}

/** Übergangs-Seite, bis der jeweilige Bereich ausgebaut ist. */
export default function PlaceholderPage({ title, icon, hint }: PlaceholderPageProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        <h1 className="mb-4 text-lg font-semibold">{title}</h1>
        <EmptyState icon={icon} title={`${title} kommt in Kürze`} hint={hint} />
      </div>
    </div>
  )
}
