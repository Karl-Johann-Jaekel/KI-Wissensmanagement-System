import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { StoredMessage } from '../../lib/storage'
import SourceCard from './SourceCard'

interface MessageListProps {
  messages: StoredMessage[]
  busy: boolean
  emptyHint: string
}

export default function MessageList({ messages, busy, emptyHint }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {messages.length === 0 && (
        <div className="mx-auto mt-16 max-w-md text-center text-sm text-muted">{emptyHint}</div>
      )}
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {messages.map((msg, i) => (
          <div key={i} className={msg.role === 'user' ? 'max-w-[85%] self-end' : 'w-full self-start'}>
            {msg.role === 'user' ? (
              <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary-600 px-4 py-2 text-sm text-white">
                {msg.text}
              </div>
            ) : (
              <div className="rounded-2xl rounded-bl-sm border border-edge bg-surface px-4 py-3">
                {msg.text ? (
                  <div className="prose-md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="text-sm text-muted">
                    {busy && i === messages.length - 1 ? '…' : ''}
                  </div>
                )}
                {msg.error && <div className="mt-2 text-xs text-rose-500">Fehler: {msg.error}</div>}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 border-t border-edge pt-2">
                    <div className="mb-1.5 text-xs font-semibold text-muted">
                      Quellen{' '}
                      {msg.model && <span className="font-normal">(Modell: {msg.model})</span>}
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {msg.sources.map((s, j) => (
                        <SourceCard key={j} source={s} />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
