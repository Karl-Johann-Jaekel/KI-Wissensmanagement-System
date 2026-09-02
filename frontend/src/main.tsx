import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import AppShell from './app/AppShell'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/ui/Toast'
import { applyTheme } from './lib/theme'
import ChatPage from './pages/ChatPage'
import DocumentPage from './pages/DocumentPage'
import InboxPage from './pages/InboxPage'
import ProjektDetailPage from './pages/ProjektDetailPage'
import ProjektePage from './pages/ProjektePage'
import SearchPage from './pages/SearchPage'
import SkillsPage from './pages/SkillsPage'
import WissenPage from './pages/WissenPage'
import './index.css'

applyTheme()

const router = createBrowserRouter([
  {
    // Ohne errorElement zeigt der Router bei einem Fehler seine eigene,
    // nackte Seite — und ein Render-Fehler nahm bisher die ganze App mit.
    errorElement: (
      <ErrorBoundary area="Diese Seite">
        <AppShell />
      </ErrorBoundary>
    ),
    element: <AppShell />,
    children: [
      // Die Inbox ist der Einstieg: sie ordnet ein, was das System tut, und der
      // Changelog zeigt, was zuletzt dazugekommen ist. Zuvor fuehrte "/" direkt
      // auf die Wissenskarte — ein Bild ohne Erklaerung.
      { path: '/', element: <Navigate to="/inbox" replace /> },
      { path: '/chat', element: <ChatPage /> },
      { path: '/chat/:chatId', element: <ChatPage /> },
      { path: '/suche', element: <SearchPage /> },
      { path: '/inbox', element: <InboxPage /> },
      { path: '/wissen', element: <WissenPage /> },
      { path: '/wissen/doc/:docId', element: <DocumentPage /> },
      { path: '/skills', element: <SkillsPage /> },
      { path: '/projekte', element: <ProjektePage /> },
      { path: '/projekte/:projectId', element: <ProjektDetailPage /> },
      { path: '*', element: <Navigate to="/chat" replace /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </React.StrictMode>,
)
