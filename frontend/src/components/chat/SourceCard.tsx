import type { ChatSource } from '../../api'
import SensitivityBadge from '../SensitivityBadge'

export default function SourceCard({ source }: { source: ChatSource }) {
  return (
    <li className="rounded-lg bg-sunken px-2.5 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {source.uri || source.url ? (
          <a
            href={source.uri ?? source.url ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary-700 hover:underline dark:text-primary-300"
          >
            {source.title ?? source.repo}
          </a>
        ) : (
          <span className="font-medium text-ink">{source.title ?? source.repo}</span>
        )}
        {source.section && <span className="text-muted">§ {source.section}</span>}
        <SensitivityBadge value={source.sensitivity} />
      </div>
      {source.preview && <p className="mt-1 line-clamp-2 text-muted">{source.preview}</p>}
    </li>
  )
}
