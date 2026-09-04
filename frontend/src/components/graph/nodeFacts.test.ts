import { describe, expect, it } from 'vitest'
import { isGraphNodeId, kindText } from './nodeFacts'

describe('isGraphNodeId', () => {
  it('erkennt eine Knoten-Id aus der Datenbank', () => {
    expect(isGraphNodeId('3f1a0c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b')).toBe(true)
    expect(isGraphNodeId('3F1A0C2E-4B5D-4E6F-8A9B-0C1D2E3F4A5B')).toBe(true)
  })

  it('weist die erfundenen Knoten der Szene ab', () => {
    // Kern, Dienste und Projekte entstehen in `scene.ts`, nicht in der Datenbank.
    for (const id of ['sys:kern', 'svc:arxiv', 'project:abc', 'cluster:p1', '']) {
      expect(isGraphNodeId(id)).toBe(false)
    }
  })
})

describe('kindText', () => {
  it('kennt die Arten des Graphen', () => {
    expect(kindText('paper')).toContain('Forschungsarbeit')
    expect(kindText('service')).toContain('Dienst')
  })

  it('sagt bei Unbekanntem wenigstens etwas Wahres', () => {
    expect(kindText('irgendwas')).toBe('Ein Datenpunkt dieses Wissensgraphen.')
  })
})
