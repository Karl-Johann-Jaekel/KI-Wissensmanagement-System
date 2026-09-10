/**
 * Der Mobil-Drawer als Dialog.
 *
 * Gemessen im Browser (390 px): Escape schloss ihn nicht, der Fokus blieb nach
 * dem Öffnen auf `body`, und Tab führte hinter die Verdunklung in die Seite
 * darunter. `components/ui/Modal` konnte das alles längst — der Drawer war
 * daran vorbeigebaut.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import AppShell from './AppShell'

const renderShell = () =>
  render(
    <MemoryRouter initialEntries={['/inbox']}>
      <AppShell />
    </MemoryRouter>,
  )

const oeffnen = () => fireEvent.click(screen.getByLabelText('Menü öffnen'))

afterEach(cleanup)

describe('AppShell — Mobil-Drawer', () => {
  it('ist als Dialog ausgezeichnet', () => {
    renderShell()
    oeffnen()

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Navigation')
  })

  it('meldet am Knopf, ob er offen ist', () => {
    renderShell()
    expect(screen.getByLabelText('Menü öffnen').getAttribute('aria-expanded')).toBe('false')
    oeffnen()
    expect(screen.getByLabelText('Menü öffnen').getAttribute('aria-expanded')).toBe('true')
  })

  it('setzt den Fokus in den Drawer statt ihn auf body zu lassen', () => {
    renderShell()
    oeffnen()

    const dialog = screen.getByRole('dialog')
    expect(document.activeElement).not.toBe(document.body)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('schließt auf Escape', () => {
    renderShell()
    oeffnen()
    expect(screen.queryByRole('dialog')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('gibt den Fokus an den öffnenden Knopf zurück', () => {
    renderShell()
    oeffnen()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.activeElement).toBe(screen.getByLabelText('Menü öffnen'))
  })

  it('lässt Tab nicht aus dem Drawer heraus', () => {
    renderShell()
    oeffnen()

    const dialog = screen.getByRole('dialog')
    const focusable = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
    const last = focusable[focusable.length - 1]
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(focusable[0])
  })
})
