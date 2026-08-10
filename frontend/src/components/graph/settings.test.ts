import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, loadPrefs, normalizeSettings, savePrefs } from './settings'

describe('normalizeSettings', () => {
  it('füllt fehlende Werte mit den Defaults', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ layout: 'ring' }).layout).toBe('ring')
  })

  it('verwirft unbekannte Layouts und begrenzt Regler', () => {
    const s = normalizeSettings({
      layout: 'hyperwürfel',
      nodeSize: 99,
      clusterGap: -5,
      detail: 4.4,
      motion: 'ja',
    })
    expect(s.layout).toBe(DEFAULT_SETTINGS.layout)
    expect(s.nodeSize).toBe(2)
    expect(s.clusterGap).toBe(0)
    expect(s.detail).toBe(4)
    expect(s.motion).toBe(DEFAULT_SETTINGS.motion)
  })
})

describe('Persistenz', () => {
  beforeEach(() => localStorage.clear())

  it('speichert Einstellungen und Menü-Position und liest sie zurück', () => {
    expect(loadPrefs()).toEqual({ settings: DEFAULT_SETTINGS, panel: null })
    savePrefs({ settings: { ...DEFAULT_SETTINGS, layout: 'globe' }, panel: { x: 40, y: 12 } })
    const loaded = loadPrefs()
    expect(loaded.settings.layout).toBe('globe')
    expect(loaded.panel).toEqual({ x: 40, y: 12 })
  })

  it('überlebt kaputte Stände im Storage', () => {
    localStorage.setItem('kwms.v1.graph.prefs', '{"settings":{"nodeSize":"groß"},"panel":"oben"}')
    const loaded = loadPrefs()
    expect(loaded.settings.nodeSize).toBe(DEFAULT_SETTINGS.nodeSize)
    expect(loaded.panel).toBeNull()
  })
})
