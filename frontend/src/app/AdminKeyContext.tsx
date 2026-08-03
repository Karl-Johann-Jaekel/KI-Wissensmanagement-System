import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { getAdminKey, setAdminKey as persistAdminKey } from '../lib/storage'

interface AdminKeyValue {
  adminKey: string | null
  setAdminKey: (key: string | null) => void
}

const AdminKeyContext = createContext<AdminKeyValue>({ adminKey: null, setAdminKey: () => {} })

export function useAdminKey(): AdminKeyValue {
  return useContext(AdminKeyContext)
}

export function AdminKeyProvider({ children }: { children: ReactNode }) {
  const [adminKey, setKeyState] = useState<string | null>(() => getAdminKey())

  const setAdminKey = useCallback((key: string | null) => {
    persistAdminKey(key)
    setKeyState(key)
  }, [])

  return (
    <AdminKeyContext.Provider value={{ adminKey, setAdminKey }}>
      {children}
    </AdminKeyContext.Provider>
  )
}
