/**
 * Kamera-Einpassung gegen die freie Fläche.
 *
 * Der Auslöser: in der Ebenenansicht lag die rechte Spalte („Konzepte")
 * vollständig unter dem Bedienmenü. Am Graphen war nichts falsch — die
 * Einpassung rechnete gegen die volle Breite statt gegen den sichtbaren Teil.
 */
import { describe, expect, it } from 'vitest'
import { boundsOf, fitTransform, type Bounds } from './viewport'

const VIEW = { width: 1000, height: 600 }
/** Breite Spaltenreihe, wie sie die Ebenenansicht erzeugt. */
const BREIT: Bounds = { minX: -500, maxX: 500, minY: -50, maxY: 50 }

/** Bildpunkt-Position eines Weltpunkts bei gegebener Kamera. */
/** Bildpunkt-Position eines Weltpunktes auf der senkrechten Achse. */
function toScreenY(worldY: number, cam: { k: number; y: number }, height: number): number {
  return (worldY - cam.y) * cam.k + height / 2
}

function toScreen(worldX: number, cam: { k: number; x: number }, width: number): number {
  return width / 2 + (worldX - cam.x) * cam.k
}

describe('boundsOf', () => {
  it('umschliesst alle platzierten Knoten', () => {
    const b = boundsOf([
      { x: -3, y: 2 },
      { x: 5, y: -7 },
      { x: 1, y: 1 },
    ])
    expect(b).toEqual({ minX: -3, maxX: 5, minY: -7, maxY: 2 })
  })

  it('uebergeht Knoten ohne Position', () => {
    expect(boundsOf([{ x: 4, y: 4 }, {}, { x: undefined, y: 1 }])).toEqual({
      minX: 4,
      maxX: 4,
      minY: 4,
      maxY: 4,
    })
  })

  it('liefert null, solange die Simulation nichts platziert hat', () => {
    expect(boundsOf([])).toBeNull()
    expect(boundsOf([{}, {}])).toBeNull()
  })
})

describe('fitTransform', () => {
  it('haelt den rechten Rand des Inhalts links vom Menue', () => {
    const inset = 264
    const cam = fitTransform(BREIT, { ...VIEW, insetRight: inset })
    const rechterRand = toScreen(BREIT.maxX, cam, VIEW.width)
    expect(rechterRand).toBeLessThanOrEqual(VIEW.width - inset)
  })

  it('laesst auch den linken Rand im Bild', () => {
    const cam = fitTransform(BREIT, { ...VIEW, insetRight: 264 })
    expect(toScreen(BREIT.minX, cam, VIEW.width)).toBeGreaterThanOrEqual(0)
  })

  it('zentriert ohne Menue wieder mittig', () => {
    const cam = fitTransform(BREIT, VIEW)
    expect(cam.x).toBeCloseTo(0, 5)
    expect(cam.y).toBeCloseTo(0, 5)
  })

  it('zoomt bei belegtem Rand weiter heraus als ohne', () => {
    const ohne = fitTransform(BREIT, VIEW)
    const mit = fitTransform(BREIT, { ...VIEW, insetRight: 264 })
    expect(mit.k).toBeLessThan(ohne.k)
  })

  it('teilt bei einem einzelnen Knoten nicht durch null', () => {
    const punkt: Bounds = { minX: 7, maxX: 7, minY: 7, maxY: 7 }
    const cam = fitTransform(punkt, VIEW)
    expect(Number.isFinite(cam.k)).toBe(true)
    expect(cam.k).toBeLessThanOrEqual(8)
  })

  it('bleibt bei einer Flaeche kleiner als die Polsterung gueltig', () => {
    const cam = fitTransform(BREIT, { width: 40, height: 30, insetRight: 264 })
    expect(Number.isFinite(cam.k)).toBe(true)
    expect(cam.k).toBeGreaterThan(0)
  })
})

describe('fitTransform mit Blatt am unteren Rand', () => {
  // Auf dem Handy liegt das Bedienmenue als Blatt unten statt rechts.
  const HOCH: Bounds = { minX: -50, maxX: 50, minY: -400, maxY: 400 }
  const PHONE = { width: 390, height: 800 }

  it('haelt den Inhalt ueber dem Blatt', () => {
    const inset = 220
    const cam = fitTransform(HOCH, { ...PHONE, insetBottom: inset })
    const unten = toScreenY(HOCH.maxY, cam, PHONE.height)
    expect(unten).toBeLessThanOrEqual(PHONE.height - inset)
  })

  it('zentriert im freien Teil, nicht in der ganzen Flaeche', () => {
    const inset = 220
    const cam = fitTransform(HOCH, { ...PHONE, insetBottom: inset })
    const mitte = toScreenY((HOCH.minY + HOCH.maxY) / 2, cam, PHONE.height)
    expect(mitte).toBeCloseTo((PHONE.height - inset) / 2, 0)
  })

  it('ohne Blatt bleibt alles wie zuvor', () => {
    const ohne = fitTransform(HOCH, PHONE)
    const explizit = fitTransform(HOCH, { ...PHONE, insetBottom: 0 })
    expect(ohne).toEqual(explizit)
  })

  it('zoomt weiter heraus, je mehr das Blatt verdeckt', () => {
    const frei = fitTransform(HOCH, PHONE)
    const belegt = fitTransform(HOCH, { ...PHONE, insetBottom: 300 })
    expect(belegt.k).toBeLessThan(frei.k)
  })
})
