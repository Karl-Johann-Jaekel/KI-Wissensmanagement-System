/**
 * Der „Neu"-Feed darf nicht behaupten, es gäbe nichts, solange er noch lädt.
 *
 * Die leere Liste war zugleich Anfangs- und Ergebniszustand: bis die Antwort da
 * war, stand auf der Einstiegsseite „Keine neuen Fakten in 7 Tagen" — und kippte
 * dann ins Gegenteil. Dazu geprüft: jeder Eintrag führt irgendwohin.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchChangelog } from '../../api'
import ChangelogFeed from './ChangelogFeed'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  fetchChangelog: vi.fn(),
}))

const ITEM = {
  id: 'a1',
  kind: 'paper',
  name: 'Attention Is All You Need',
  first_seen: '2026-09-07T04:04:48.932162+00:00',
}

const renderFeed = () =>
  render(
    <MemoryRouter>
      <ChangelogFeed days={7} />
    </MemoryRouter>,
  )

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('ChangelogFeed', () => {
  it('meldet nicht „keine Fakten", solange die Antwort aussteht', () => {
    vi.mocked(fetchChangelog).mockReturnValue(new Promise(() => {}))
    renderFeed()

    expect(screen.queryByText(/Keine neuen Fakten/)).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Lade')
  })

  it('meldet die Leere erst, wenn die Antwort leer war', async () => {
    vi.mocked(fetchChangelog).mockResolvedValue([])
    renderFeed()

    await waitFor(() => expect(screen.getByText(/Keine neuen Fakten in 7 Tagen/)).toBeTruthy())
  })

  it('führt von jedem Eintrag in die Suche nach seinem Namen', async () => {
    vi.mocked(fetchChangelog).mockResolvedValue([ITEM])
    renderFeed()

    const link = await screen.findByRole('link', { name: /Attention Is All You Need/ })
    expect(link.getAttribute('href')).toBe('/suche?q=Attention%20Is%20All%20You%20Need')
    // Der volle Titel bleibt lesbar, obwohl die Zeile ihn abschneidet.
    expect(link.getAttribute('title')).toBe(ITEM.name)
  })

  it('zeigt einen Fehler statt einer stillen Leere', async () => {
    vi.mocked(fetchChangelog).mockRejectedValue(new Error('Die Neuigkeiten sind nicht erreichbar.'))
    renderFeed()

    await waitFor(() =>
      expect(screen.getByText('Die Neuigkeiten sind nicht erreichbar.')).toBeTruthy(),
    )
    expect(screen.queryByText(/Keine neuen Fakten/)).toBeNull()
  })
})
