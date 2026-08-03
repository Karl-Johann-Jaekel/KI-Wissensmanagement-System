import ChatPanel from '../components/ChatPanel'
import { useAdminKey } from '../app/AdminKeyContext'

export default function ChatPage() {
  const { adminKey } = useAdminKey()
  return (
    <ChatPanel
      endpoint="/chat"
      placeholder="Frage an den KI-Forschungskorpus … (DE/EN)"
      adminKey={adminKey}
      allowConfidential
      emptyHint='Frag den Korpus — z. B. „Was ist Retrieval-Augmented Generation?" Antworten kommen mit Quellenbelegen.'
    />
  )
}
