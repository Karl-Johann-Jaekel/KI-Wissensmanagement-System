import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { FolderKanban, Lock } from 'lucide-react'
import { fetchModels, streamChat } from '../api'
import { useAdminKey } from '../app/AdminKeyContext'
import ChatInput from '../components/chat/ChatInput'
import MessageList from '../components/chat/MessageList'
import { useToast } from '../components/ui/Toast'
import {
  chatTitleFrom,
  createChat,
  getChatMessages,
  getChatMeta,
  getProject,
  saveChat,
  type ChatMeta,
  type StoredMessage,
  type Zone,
} from '../lib/storage'

/** Router-State, mit dem andere Seiten einen Chat vorbereiten können. */
interface ChatNavState {
  prefill?: string
  zone?: Zone
  model?: string | null
  projectId?: string | null
}

export default function ChatPage() {
  const { chatId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const navState = (location.state ?? {}) as ChatNavState
  const { adminKey } = useAdminKey()
  const toast = useToast()

  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [zone, setZone] = useState<Zone>('public')
  const [model, setModel] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<string[] | null>(null)
  const metaRef = useRef<ChatMeta | null>(null)

  // Lokale Ollama-Modelle für den Picker (nur Admin).
  useEffect(() => {
    if (!adminKey) {
      setAvailableModels(null)
      return
    }
    let cancelled = false
    fetchModels(adminKey)
      .then((info) => !cancelled && setAvailableModels(info.available ? info.models.map((m) => m.name) : null))
      .catch(() => !cancelled && setAvailableModels(null))
    return () => {
      cancelled = true
    }
  }, [adminKey])

  // Chat laden bzw. für „Neuer Chat" zurücksetzen.
  useEffect(() => {
    if (chatId) {
      if (metaRef.current?.id === chatId) return // gerade selbst erzeugt (erster Send)
      const meta = getChatMeta(chatId)
      if (!meta) {
        navigate('/chat', { replace: true })
        return
      }
      metaRef.current = meta
      setMessages(getChatMessages(chatId))
      setZone(meta.zone)
      setModel(meta.model)
      setInput('')
    } else {
      metaRef.current = null
      setMessages([])
      setZone(navState.zone ?? 'public')
      setModel(navState.model ?? null)
      setInput(navState.prefill ?? '')
    }
    // navState bewusst nicht als Dependency: nur beim Routenwechsel anwenden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  const send = async () => {
    const query = input.trim()
    if (!query || busy) return
    setInput('')
    setBusy(true)

    let meta = metaRef.current
    if (!meta) {
      meta = createChat({
        title: chatTitleFrom(query),
        zone,
        model,
        projectId: navState.projectId ?? null,
      })
      metaRef.current = meta
      navigate(`/chat/${meta.id}`, { replace: true })
    } else {
      meta = { ...meta, zone, model }
      metaRef.current = meta
    }
    const chatRef = meta.id

    // Closure-Kopie der Konversation: Save hängt nicht am React-State.
    const conv: StoredMessage[] = [...messages, { role: 'user', text: query }, { role: 'assistant', text: '' }]
    const sync = () => {
      if (metaRef.current?.id === chatRef) setMessages([...conv])
    }
    const last = () => conv[conv.length - 1]
    sync()

    const body: Record<string, unknown> = { query }
    if (zone === 'confidential' && adminKey) body.max_sensitivity = 'confidential'
    if (model) body.model = model

    const persist = () => {
      if (!saveChat(meta, conv)) {
        toast('error', 'Speicher voll — bitte alte Chats löschen.')
      }
    }

    await streamChat(
      '/chat',
      body,
      {
        onToken: (t) => {
          last().text += t
          sync()
        },
        onSources: (sources, zoneFromServer, modelFromServer) => {
          Object.assign(last(), { sources, zone: zoneFromServer, model: modelFromServer })
          sync()
        },
        onDone: () => {
          setBusy(false)
          persist()
        },
        onError: (e) => {
          last().error = e
          sync()
          setBusy(false)
          persist()
        },
      },
      adminKey,
    )
  }

  const title = chatId ? metaRef.current?.title : 'Neuer Chat'
  const projectId = metaRef.current?.projectId ?? navState.projectId ?? null
  const project = projectId ? getProject(projectId) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-edge bg-surface px-4 py-2.5">
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title ?? 'Chat'}</h1>
        {project && (
          <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-sunken px-2 py-0.5 text-[10px] text-muted">
            <FolderKanban className="h-3 w-3" /> {project.name}
          </span>
        )}
        {zone === 'confidential' && (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-rose-800 dark:bg-rose-900/60 dark:text-rose-200">
            <Lock className="h-3 w-3" /> confidential
          </span>
        )}
        {model && <span className="text-xs text-muted">{model}</span>}
      </header>

      <MessageList
        messages={messages}
        busy={busy}
        emptyHint={
          zone === 'confidential'
            ? 'Privater Chat über die Bibliothek — Antworten kommen ausschließlich vom lokalen Modell.'
            : 'Frag den Korpus — z. B. „Was ist Retrieval-Augmented Generation?" Antworten kommen mit Quellenbelegen.'
        }
      />

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={send}
        busy={busy}
        zone={zone}
        onZoneChange={setZone}
        model={model}
        onModelChange={setModel}
        models={availableModels}
        placeholder="Frage an den KI-Forschungskorpus … (DE/EN)"
      />
    </div>
  )
}
