import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { FolderKanban, Library, Search, Sparkles } from 'lucide-react'
import { AdminKeyProvider } from './app/AdminKeyContext'
import AppShell from './app/AppShell'
import { ToastProvider } from './components/ui/Toast'
import { applyTheme, resolveTheme } from './lib/theme'
import ChatPage from './pages/ChatPage'
import InboxPage from './pages/InboxPage'
import PlaceholderPage from './pages/PlaceholderPage'
import WissenPage from './pages/WissenPage'
import './index.css'

applyTheme(resolveTheme())

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Navigate to="/chat" replace /> },
      { path: '/chat', element: <ChatPage /> },
      { path: '/chat/:chatId', element: <ChatPage /> },
      {
        path: '/suche',
        element: (
          <PlaceholderPage
            title="Suche"
            icon={Search}
            hint="Hybrid-Suche mit Scores über den gesamten Korpus."
          />
        ),
      },
      { path: '/inbox', element: <InboxPage /> },
      { path: '/wissen', element: <WissenPage /> },
      {
        path: '/skills',
        element: (
          <PlaceholderPage
            title="Skills"
            icon={Sparkles}
            hint="Wiederverwendbare Prompt-Vorlagen für den Chat."
          />
        ),
      },
      {
        path: '/bibliothek',
        element: (
          <PlaceholderPage
            title="Bibliothek"
            icon={Library}
            hint="Privater Wissensspeicher (confidential) mit lokalem Ollama-Modell."
          />
        ),
      },
      {
        path: '/projekte',
        element: (
          <PlaceholderPage
            title="Projekte"
            icon={FolderKanban}
            hint="Arbeitsbereiche, die Chats und Dokumente bündeln."
          />
        ),
      },
      { path: '*', element: <Navigate to="/chat" replace /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AdminKeyProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AdminKeyProvider>
  </React.StrictMode>,
)
