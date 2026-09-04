/**
 * Der Chat am Knoten fragt knotengebunden — und für erfundene Knoten gar nicht.
 *
 * Die Themenbindung selbst sitzt im Backend (`generation/node_chat.py`); hier
 * wird geprüft, dass das Frontend den Weg dorthin nimmt und nicht den offenen
 * `/chat`-Endpunkt, an dem der Knotenname nur ein Präfix wäre.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { streamChat } from '../../api'
import NodeChat from './NodeChat'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  streamChat: vi.fn(async () => {}),
}))

const NODE = { id: '3f1a0c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b', name: 'Ape-X' }

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('NodeChat', () => {
  it('schickt die Frage an den knotengebundenen Endpunkt', () => {
    render(<NodeChat node={NODE} />)
    fireEvent.change(screen.getByLabelText('Frage zu Ape-X'), {
      target: { value: 'Wofür wird das benutzt?' },
    })
    fireEvent.click(screen.getByLabelText('Frage senden'))

    expect(streamChat).toHaveBeenCalledTimes(1)
    const [path, body] = vi.mocked(streamChat).mock.calls[0]
    expect(path).toBe('/chat/node')
    expect(body).toEqual({ node_id: NODE.id, question: 'Wofür wird das benutzt?', top_k: 5 })
  })

  it('schickt keinen Knotennamen mit — das Thema kommt aus der Datenbank', () => {
    render(<NodeChat node={NODE} />)
    fireEvent.change(screen.getByLabelText('Frage zu Ape-X'), { target: { value: 'Was ist das?' } })
    fireEvent.click(screen.getByLabelText('Frage senden'))

    const [, body] = vi.mocked(streamChat).mock.calls[0]
    expect(JSON.stringify(body)).not.toContain('Ape-X')
  })

  it('kappt überlange Eingaben schon im Feld', () => {
    render(<NodeChat node={NODE} />)
    const field = screen.getByLabelText('Frage zu Ape-X') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: 'a'.repeat(5000) } })
    expect(field.value).toHaveLength(300)
  })

  it('bleibt bei erfundenen Knoten weg', () => {
    // Kern, Dienste und Projekte stehen nicht in `graph_nodes`; eine Frage
    // dorthin könnte der Server nur mit 404 beantworten.
    const { container } = render(<NodeChat node={{ id: 'svc:arxiv', name: 'arXiv' }} />)
    expect(container.innerHTML).toBe('')
  })

  it('sendet nichts bei leerer Frage', () => {
    render(<NodeChat node={NODE} />)
    fireEvent.click(screen.getByLabelText('Frage senden'))
    expect(streamChat).not.toHaveBeenCalled()
  })
})
