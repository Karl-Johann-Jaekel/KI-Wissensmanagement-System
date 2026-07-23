import { useEffect, useRef, useState } from 'react'
import { streamChat, type ChatSource } from '../api'
import SensitivityBadge from './SensitivityBadge'

interface Message {
  role: 'user' | 'assistant'
  text: string
  sources?: ChatSource[]
  zone?: string
  error?: string
}

interface Props {
  endpoint: string // '/chat' | '/portfolio/chat'
  placeholder: string
  adminKey: string | null
  allowConfidential?: boolean
  prefill?: string
  emptyHint: string
}

export default function ChatPanel({
  endpoint,
  placeholder,
  adminKey,
  allowConfidential = false,
  prefill,
  emptyHint,
}: Props) {
  const [input, setInput] = useState(prefill ?? '')
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [confidential, setConfidential] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (prefill) setInput(prefill)
  }, [prefill])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const query = input.trim()
    if (!query || busy) return
    setInput('')
    setBusy(true)
    setMessages((m) => [...m, { role: 'user', text: query }, { role: 'assistant', text: '' }])

    const body: Record<string, unknown> = { query }
    if (allowConfidential && confidential && adminKey) body.max_sensitivity = 'confidential'

    const patchLast = (fn: (msg: Message) => Message) =>
      setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? fn(msg) : msg)))

    await streamChat(
      endpoint,
      body,
      {
        onToken: (t) => patchLast((msg) => ({ ...msg, text: msg.text + t })),
        onSources: (sources, zone) => patchLast((msg) => ({ ...msg, sources, zone })),
        onDone: () => setBusy(false),
        onError: (e) => {
          patchLast((msg) => ({ ...msg, error: e }))
          setBusy(false)
        },
      },
      adminKey,
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mt-16 text-center text-sm text-slate-500">{emptyHint}</div>
        )}
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((msg, i) => (
            <div key={i} className={msg.role === 'user' ? 'self-end' : 'self-start w-full'}>
              {msg.role === 'user' ? (
                <div className="rounded-2xl rounded-br-sm bg-sky-700/70 px-4 py-2 text-sm">
                  {msg.text}
                </div>
              ) : (
                <div className="rounded-2xl rounded-bl-sm border border-slate-800 bg-slate-900/70 px-4 py-3">
                  <div className="whitespace-pre-wrap text-sm text-slate-100">
                    {msg.text || (busy && i === messages.length - 1 ? '…' : '')}
                  </div>
                  {msg.error && (
                    <div className="mt-2 text-xs text-rose-300">Fehler: {msg.error}</div>
                  )}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 border-t border-slate-800 pt-2">
                      <div className="mb-1.5 text-xs font-semibold text-slate-400">
                        Quellen {msg.zone && <span className="font-normal">(Zone: {msg.zone})</span>}
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {msg.sources.map((s, j) => (
                          <li key={j} className="rounded-lg bg-slate-800/60 px-2.5 py-1.5 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              {s.uri || s.url ? (
                                <a
                                  href={s.uri ?? s.url ?? '#'}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium text-sky-300 hover:underline"
                                >
                                  {s.title ?? s.repo}
                                </a>
                              ) : (
                                <span className="font-medium">{s.title ?? s.repo}</span>
                              )}
                              {s.section && <span className="text-slate-400">§ {s.section}</span>}
                              <SensitivityBadge value={s.sensitivity} />
                            </div>
                            {s.preview && (
                              <p className="mt-1 line-clamp-2 text-slate-400">{s.preview}</p>
                            )}
                          </li>
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

      <div className="border-t border-slate-800 bg-slate-900/70 p-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          {allowConfidential && adminKey && (
            <label
              className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400"
              title="Auch vertrauliche (lokale) Dokumente durchsuchen — Antwort kommt dann garantiert vom lokalen Modell"
            >
              <input
                type="checkbox"
                checked={confidential}
                onChange={(e) => setConfidential(e.target.checked)}
              />
              confidential
            </label>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={placeholder}
            maxLength={2000}
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="shrink-0 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {busy ? '…' : 'Senden'}
          </button>
        </div>
      </div>
    </div>
  )
}
