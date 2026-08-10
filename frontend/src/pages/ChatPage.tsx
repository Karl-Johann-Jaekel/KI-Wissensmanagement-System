import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { FolderKanban } from 'lucide-react'
import { streamChat } from '../api'
import { useAdminKey } from '../app/AdminKeyContext'
import ChatInput from '../components/chat/ChatInput'
import MessageList from '../components/chat/MessageList'
import { useToast } from '../components/ui/Toast'
import {
  chatTitleFrom,
  createChat,
  DEFAULT_TOP_K,
  getChatMessages,
  getChatMeta,
  getProject,
  saveChat,
  type ChatMeta,
  type StoredMessage,
} from '../lib/storage'

/** Router-State, mit dem andere Seiten einen Chat vorbereiten können. */
interface ChatNavState {
  prefill?: string
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
  const [topK, setTopK] = useState(DEFAULT_TOP_K)
  const [rerank, setRerank] = useState(false)
  const metaRef = useRef<ChatMeta | null>(null)


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
      setTopK(meta.topK ?? DEFAULT_TOP_K)
      setRerank(meta.rerank ?? false)
      setInput('')
    } else {
      metaRef.current = null
      setMessages([])
      setTopK(DEFAULT_TOP_K)
      setRerank(false)
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
        topK,
        rerank,
        projectId: navState.projectId ?? null,
      })
      metaRef.current = meta
      navigate(`/chat/${meta.id}`, { replace: true })
    } else {
      meta = { ...meta, topK, rerank }
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

    const body: Record<string, unknown> = { query, top_k: topK }
    // false = Server-Default (RERANK_ENABLED) belassen, true = erzwingen.
    if (rerank) body.rerank = true

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
        onSources: (sources, modelFromServer) => {
          Object.assign(last(), { sources, model: modelFromServer })
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
      </header>

      <MessageList
        messages={messages}
        busy={busy}
        emptyHint='Frag das Neurale Gedächtnis — z. B. „Was ist Retrieval-Augmented Generation?" Antworten kommen mit Quellenbelegen.'
      />

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={send}
        busy={busy}
        topK={topK}
        onTopKChange={setTopK}
        rerank={rerank}
        onRerankChange={setRerank}
        placeholder="Frage an das Neurale Gedächtnis … (DE/EN)"
      />
    </div>
  )
}
