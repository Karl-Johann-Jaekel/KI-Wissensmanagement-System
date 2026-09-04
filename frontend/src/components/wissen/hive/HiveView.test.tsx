/**
 * Rauchtest der Wabenansicht: von der `/graph`-Antwort bis zum geöffneten
 * Sektor-Popup und den Knotendetails.
 *
 * Die Rechnung selbst prüft `hive.test.ts`. Hier geht es um die Kette darum —
 * dass die Waben aus den Daten entstehen, ein Klick das Popup öffnet und ein
 * Knoten aus dem Popup in der rechten Spalte landet. Genau diese Kette bricht,
 * wenn jemand die Sektor-Ids in `hive.ts` und die Ansicht auseinanderlaufen
 * lässt.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentRow } from '../../../api'
import type { GraphData } from '../../../types'
import HiveView from './HiveView'

const graph: GraphData = {
  nodes: [
    {
      id: 'p1',
      kind: 'paper',
      name: 'Attention Is All You Need',
      status: 'verified',
      first_seen: '2026-01-01T00:00:00+00:00',
      val: 4,
      meta: { arxiv: '1706.03762', source_document_ids: ['doc-1'] },
    },
    {
      id: 'c1',
      kind: 'concept',
      name: 'Self-Attention',
      status: 'verified',
      first_seen: '2026-01-01T00:00:00+00:00',
      val: 3,
      meta: {},
    },
    {
      id: 'd1',
      kind: 'dataset',
      name: 'WMT 2014',
      status: 'verified',
      first_seen: '2026-01-01T00:00:00+00:00',
      val: 1,
      meta: {},
    },
  ],
  links: [
    { source: 'p1', target: 'c1', relation: 'INTRODUCES', weight: 1, status: 'verified' },
    { source: 'p1', target: 'd1', relation: 'EVALUATES_ON', weight: 1, status: 'verified' },
  ],
}

const documents: DocumentRow[] = [
  { id: 'doc-1', title: 'Attention Is All You Need', source_type: 'pdf', lang: 'en', uri: null, chunks: 12 },
]

vi.mock('../../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api')>()),
  fetchGraph: vi.fn(async () => graph),
}))

function renderView() {
  return render(
    <MemoryRouter>
      <HiveView documents={documents} onOpenGraph={() => {}} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

/** Die Wabe selbst — Sektornamen stehen auch in Legende und Filter. */
const comb = () => screen.getByRole('group', { name: 'Wabenstruktur der Wissensbasis' })

describe('HiveView', () => {
  it('zeichnet je belegtem Sektor eine Wabe — leere bleiben weg', async () => {
    renderView()
    await screen.findByRole('group', { name: 'Wabenstruktur der Wissensbasis' })
    expect(within(comb()).getByText('Papers')).toBeTruthy()
    expect(within(comb()).getByText('Konzepte')).toBeTruthy()
    expect(within(comb()).getByText('Datasets')).toBeTruthy()
    // Ohne `task`-Knoten gibt es auch keine Aufgaben-Wabe …
    expect(within(comb()).queryByText('Aufgaben')).toBeNull()
    // … die Infrastruktur-Wabe steht dagegen immer.
    expect(within(comb()).getByText('Infrastruktur')).toBeTruthy()
  })

  it('trägt die Kennzahlen der geladenen Antwort in den Kern', async () => {
    renderView()
    await screen.findByRole('group', { name: 'Wabenstruktur der Wissensbasis' })
    expect(within(comb()).getByText('Wissensbasis')).toBeTruthy()
    expect(within(comb()).getByText('3 Knoten')).toBeTruthy()
    // Papers, Konzepte und Datasets tragen je einen Knoten.
    expect(within(comb()).getAllByText('1 Knoten')).toHaveLength(3)
  })

  it('öffnet auf Klick das Sektor-Popup mit seinen Reitern', async () => {
    renderView()
    await screen.findByRole('group', { name: 'Wabenstruktur der Wissensbasis' })
    fireEvent.click(screen.getByLabelText(/^Papers — 1 Knoten/))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Übersicht')).toBeTruthy()
    expect(within(dialog).getByText('Knoten (1)')).toBeTruthy()
    expect(within(dialog).getByText('Dokumente (1)')).toBeTruthy()
  })

  it('führt vom Popup in die Knotendetails', async () => {
    renderView()
    await screen.findByRole('group', { name: 'Wabenstruktur der Wissensbasis' })
    fireEvent.click(screen.getByLabelText(/^Papers — 1 Knoten/))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getAllByText('Attention Is All You Need')[0])

    // Popup schließt, die rechte Spalte übernimmt.
    expect(screen.queryByRole('dialog')).toBeNull()
    const rail = screen.getByRole('complementary', {
      name: 'Details zum Knoten Attention Is All You Need',
    })
    // Beziehungen aus Sicht des Papers, nicht des Gegenübers.
    expect(within(rail).getByText('führt ein')).toBeTruthy()
    expect(within(rail).getByText('evaluiert auf')).toBeTruthy()
    expect(within(rail).getByText('Self-Attention')).toBeTruthy()
  })

  it('findet einen Knoten über die Suche', async () => {
    renderView()
    await screen.findByRole('group', { name: 'Wabenstruktur der Wissensbasis' })
    fireEvent.change(screen.getByLabelText('Suche in der Wissensbasis'), {
      target: { value: 'self-att' },
    })
    fireEvent.click(screen.getByText('Self-Attention'))
    expect(
      screen.getByRole('complementary', { name: 'Details zum Knoten Self-Attention' }),
    ).toBeTruthy()
  })
})
