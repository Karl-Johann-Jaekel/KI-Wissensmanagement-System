/**
 * Die Suche als adressierbarer Zustand.
 *
 * Vorher lebte die Anfrage nur im Komponenten-State: nicht teilbar, nach einem
 * Reload weg, und kein Ziel, auf das eine andere Ansicht hätte verlinken können.
 * Genau das braucht der „Neu"-Feed der Einstiegsseite.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postSearch } from '../api'
import SearchPage from './SearchPage'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  postSearch: vi.fn(async () => []),
}))

const HIT = {
  chunk_id: 'c1',
  document_id: 'd1',
  title: 'Attention Is All You Need',
  uri: null,
  content: 'Transformer …',
  scores: { vector: 0.9 },
}

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SearchPage />
    </MemoryRouter>,
  )

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('SearchPage', () => {
  it('sucht beim Aufruf mit ?q= von selbst', async () => {
    vi.mocked(postSearch).mockResolvedValue([HIT])
    renderAt('/suche?q=Attention%20Is%20All%20You%20Need')

    await waitFor(() => expect(postSearch).toHaveBeenCalledTimes(1))
    expect(vi.mocked(postSearch).mock.calls[0][0]).toBe('Attention Is All You Need')
    expect((screen.getByLabelText('Suchbegriff') as HTMLInputElement).value).toBe(
      'Attention Is All You Need',
    )
  })

  it('sucht auch, wenn die Anfrage getippt statt verlinkt wurde', async () => {
    renderAt('/suche')
    fireEvent.change(screen.getByLabelText('Suchbegriff'), { target: { value: 'RAG' } })
    fireEvent.click(screen.getByLabelText('Suchen'))

    // Der Klick setzt `?q=`, der Effekt darauf sucht — genau einmal.
    await waitFor(() => expect(postSearch).toHaveBeenCalledTimes(1))
    expect(vi.mocked(postSearch).mock.calls[0][0]).toBe('RAG')
  })

  it('schickt eine leere Anfrage gar nicht erst ab', () => {
    renderAt('/suche')
    fireEvent.click(screen.getByLabelText('Suchen'))

    expect(postSearch).not.toHaveBeenCalled()
  })

  it('begrenzt die Eingabe auf das, was der Server annimmt', () => {
    renderAt('/suche')
    const input = screen.getByLabelText('Suchbegriff') as HTMLInputElement
    // 2000 = SearchRequest.query max_length; darüber gab es HTTP 422.
    expect(input.maxLength).toBe(2000)
  })

  it('sagt die Trefferzahl an', async () => {
    vi.mocked(postSearch).mockResolvedValue([HIT])
    renderAt('/suche?q=RAG')

    await waitFor(() => expect(screen.getByText('1 Treffer')).toBeTruthy())
    expect(screen.getByText('1 Treffer').getAttribute('aria-live')).toBe('polite')
  })

  it('startet keine zweite Suche, während eine läuft', async () => {
    vi.mocked(postSearch).mockReturnValue(new Promise(() => {}))
    renderAt('/suche?q=RAG')

    await waitFor(() => expect(postSearch).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByLabelText('Suchen'))
    expect(postSearch).toHaveBeenCalledTimes(1)
  })
})
