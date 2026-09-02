import { describe, expect, it } from 'vitest'
import { safeHref } from './safeHref'

describe('safeHref', () => {
  it('lässt http und https durch', () => {
    expect(safeHref('https://arxiv.org/abs/1706.03762')).toBe('https://arxiv.org/abs/1706.03762')
    expect(safeHref('http://example.org/x')).toBe('http://example.org/x')
  })

  it('blockt ausführbare Schemata aus Fremddaten', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('JavaScript:alert(1)')).toBeUndefined()
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined()
  })

  it('behandelt Leerwerte als kein Ziel', () => {
    expect(safeHref(null)).toBeUndefined()
    expect(safeHref(undefined)).toBeUndefined()
    expect(safeHref('')).toBeUndefined()
  })

  it('löst relative Angaben gegen die eigene Herkunft auf', () => {
    expect(safeHref('/wissen')).toBe(`${window.location.origin}/wissen`)
  })
})
