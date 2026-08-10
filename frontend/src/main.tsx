import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AdminKeyProvider } from './app/AdminKeyContext'
import AppShell from './app/AppShell'
import { ToastProvider } from './components/ui/Toast'
import { applyTheme, resolveTheme } from './lib/theme'
import ChatPage from './pages/ChatPage'
import DocumentPage from './pages/DocumentPage'
import InboxPage from './pages/InboxPage'
import LandingPage from './pages/LandingPage'
import ProjektDetailPage from './pages/ProjektDetailPage'
import ProjektePage from './pages/ProjektePage'
import SearchPage from './pages/SearchPage'
import SkillsPage from './pages/SkillsPage'
import WissenPage from './pages/WissenPage'
import './index.css'

applyTheme(resolveTheme())

const router = createBrowserRouter([
  // Öffentliche Startseite ohne App-Shell.
  { path: '/', element: <LandingPage /> },
  {
    element: <AppShell />,
    children: [
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
    <AdminKeyProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AdminKeyProvider>
  </React.StrictMode>,
)
