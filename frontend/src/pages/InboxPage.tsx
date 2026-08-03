import { Inbox } from 'lucide-react'
import { useAdminKey } from '../app/AdminKeyContext'
import ReviewView from '../components/ReviewView'
import EmptyState from '../components/ui/EmptyState'

export default function InboxPage() {
  const { adminKey } = useAdminKey()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        <h1 className="mb-4 text-lg font-semibold">Inbox</h1>
        {adminKey ? (
          <ReviewView adminKey={adminKey} onChanged={() => {}} />
        ) : (
          <EmptyState
            icon={Inbox}
            title="Review-Queue nur im Admin-Modus"
            hint="Hinterlege den Admin-Key unten links in der Sidebar, um pending-Fakten zu prüfen."
          />
        )}
      </div>
    </div>
  )
}
