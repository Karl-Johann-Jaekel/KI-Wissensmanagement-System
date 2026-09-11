/**
 * Accessibility-Gate: axe-core gegen die gebaute Seite, in einem echten Browser.
 *
 * Warum ein Browser und nicht jsdom: die haeufigste Fundklasse war Kontrast, und
 * den kann axe nur pruefen, wo wirklich gezeichnet wird. In jsdom ueberspringt
 * die Regel still — ein Gate, das genau den Fehler nicht sieht, den es
 * verhindern soll. Zwoelf Verstoesse (achtmal derselbe Knopf) lagen deshalb
 * monatelang unbemerkt in Produktion.
 *
 * Warum kein Playwright: es braucht einen Browser-Download je Lauf. Chrome liegt
 * auf jedem GitHub-Runner und lokal ohnehin; ueber das DevTools-Protokoll reicht
 * Nodes eingebautes WebSocket. Damit bleibt es bei einer Abhaengigkeit — axe-core.
 *
 *   node a11y/axe-run.mjs                     # gegen http://localhost:4173
 *   BASE=https://wissen.jaekel.dev node a11y/axe-run.mjs
 *
 * Exit 1, sobald eine Regel bricht.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const BASE = process.env.BASE || 'http://localhost:4173'
const PORT = Number(process.env.CDP_PORT || 9222)

/**
 * Geprueft werden die Ansichten, die ohne Backend vollstaendig rendern.
 *
 * `/wissen` fehlt bewusst: ohne `/graph`-Antwort steht dort ein Spinner, und ein
 * Spinner hat keine Ueberschriftenordnung. Diese Seite deckt der manuelle Lauf
 * gegen die echte Instanz ab.
 */
const ROUTES = ['/inbox', '/suche', '/chat', '/skills', '/projekte', '/gibtsnicht']
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false, dpr: 1 },
  { name: 'mobil', width: 390, height: 844, mobile: true, dpr: 2 },
]

function chromePfad() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const kandidaten =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']
  const treffer = kandidaten.find((p) => fs.existsSync(p))
  if (!treffer) throw new Error('Kein Chrome gefunden — CHROME_PATH setzen.')
  return treffer
}

async function starteChrome() {
  const proc = spawn(
    chromePfad(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${path.join(os.tmpdir(), 'axe-profile-' + PORT)}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return proc
    } catch {
      /* Chrome ist noch nicht oben */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Chrome startete nicht')
}

/** Eine CDP-Sitzung auf einem frischen Tab. */
async function sitzung() {
  const ziel = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  ).json()
  const ws = new WebSocket(ziel.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let id = 0
  const offen = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    const wartend = offen.get(msg.id)
    if (!wartend) return
    offen.delete(msg.id)
    if (msg.error) wartend.rej(new Error(JSON.stringify(msg.error)))
    else wartend.res(msg.result)
  }
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const eigene = ++id
      offen.set(eigene, { res, rej })
      ws.send(JSON.stringify({ id: eigene, method, params }))
      setTimeout(() => {
        if (offen.delete(eigene)) rej(new Error('Zeitablauf: ' + method))
      }, 60_000)
    })
  const auswerten = async (ausdruck) => {
    const r = await send('Runtime.evaluate', {
      expression: ausdruck,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'Fehler')
    return r.result.value
  }
  const schliessen = async () => {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${ziel.id}`).catch(() => {})
    ws.close()
  }
  return { send, auswerten, schliessen }
}

const chrome = await starteChrome()
let verstoesse = 0
let fehler = 0

try {
  for (const route of ROUTES) {
    for (const vp of VIEWPORTS) {
      const s = await sitzung()
      await s.send('Page.enable')
      await s.send('Runtime.enable')
      await s.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.dpr,
        mobile: vp.mobile,
      })
      await s.send('Page.navigate', { url: BASE + route })
      await new Promise((r) => setTimeout(r, 3000))

      await s.auswerten(AXE + '; 1')
      const treffer = await s.auswerten(
        `axe.run(document, { resultTypes: ['violations'] }).then((r) =>
           r.violations.map((v) => ({
             id: v.id, impact: v.impact, hilfe: v.help, n: v.nodes.length,
             wo: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
           })))`,
      )

      if (treffer.length === 0) {
        console.log(`  ok    ${route} [${vp.name}]`)
      } else {
        fehler++
        verstoesse += treffer.length
        console.log(`  FEHLER ${route} [${vp.name}]`)
        for (const v of treffer) {
          console.log(`         ${v.id} [${v.impact}] ${v.n}x — ${v.hilfe}`)
          for (const wo of v.wo) console.log(`           ${wo}`)
        }
      }
      await s.schliessen()
    }
  }
} finally {
  chrome.kill()
}

console.log('')
if (fehler > 0) {
  console.log(`axe: ${verstoesse} Verstoss/Verstoesse auf ${fehler} Seite(n) — Gate ROT.`)
  process.exit(1)
}
console.log(`axe: 0 Verstoesse auf ${ROUTES.length * VIEWPORTS.length} Seiten — Gate GRUEN.`)
