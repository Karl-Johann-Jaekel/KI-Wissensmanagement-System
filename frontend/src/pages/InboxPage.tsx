import { Inbox, Sparkles } from 'lucide-react'
import { useAdminKey } from '../app/AdminKeyContext'
import ChangelogFeed from '../components/inbox/ChangelogFeed'
import ReviewList from '../components/inbox/ReviewList'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'

export default function InboxPage() {
  const { adminKey } = useAdminKey()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
        <h1 className="text-lg font-semibold">Inbox</h1>

        <Card>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Inbox className="h-4 w-4 text-primary-600 dark:text-primary-400" />
            Review-Queue
          </h2>
          {adminKey ? (
            <ReviewList adminKey={adminKey} />
          ) : (
            <EmptyState
              icon={Inbox}
              title="Review nur im Admin-Modus"
              hint="Hinterlege den Admin-Key unten links in der Sidebar, um pending-Fakten zu prüfen."
              className="border-0 py-8"
            />
          )}
        </Card>

        <Card>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary-600 dark:text-primary-400" />
            Neu (7 Tage)
          </h2>
          <ChangelogFeed days={7} />
        </Card>
      </div>
    </div>
  )
}
