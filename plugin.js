/**
 * Splash Studio for Hermes Desktop: customize the empty new-chat screen.
 *
 * - Imagery behind the splash (presets or your own image)
 * - Side widgets: clock + greeting, profile and model, recent chats, starter prompts
 * - The big title: rewrite it, restyle it (font, size, color), or hide it
 *
 * Install: copy this folder to ~/.hermes/desktop-plugins/splash-studio.
 * The app picks it up within a few seconds (fallback: Cmd+K, "Reload desktop plugins").
 * Plain ESM, no build step. Ongoing chats are never touched.
 * v1.0.0 · MIT · https://github.com/BeyondGoodIO/hermes-splash-studio
 */

import {
  Button,
  Input,
  Switch,
  Textarea,
  Tip,
  atom,
  cn,
  haptic,
  host,
  pluginSettingsHref,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'splash-studio'
const NAME = 'Splash Studio'
const STYLE_ID = 'splash-studio-css'
const TITLE_STYLE_ID = 'splash-studio-title-css'
const TITLE_ATTR = 'data-splash-studio'
// Pre-release id; settings saved under it are carried over once.
const LEGACY_ID = 'stagehand'
const MAX_IMAGE_CHARS = 900_000
const MAX_PROMPTS = 3
const INTRO = '[data-slot="aui_intro"]'

const DEFAULT_PROMPTS = [
  "What's the next concrete step?",
  'Look at what I left unfinished and pick one thing.',
  'Sketch a plan before changing anything.'
]

const IMAGERY = [
  { id: 'atelier', label: 'Atelier' },
  { id: 'horizon', label: 'Horizon' },
  { id: 'window', label: 'Window' },
  { id: 'paper', label: 'Paper' },
  { id: 'stars', label: 'Stars' },
  { id: 'custom', label: 'My image' }
]

const DEFAULTS = {
  enabled: true,
  imagery: 'atelier',
  customUrl: '',
  strength: 34,
  widgets: {
    clock: true,
    greeting: true,
    model: true,
    recents: true,
    prompts: true
  },
  prompts: DEFAULT_PROMPTS.slice(),
  title: {
    show: true,
    tagline: true,
    text: '', // '' = the stock title
    family: 'stock', // stock | serif | sans | mono | custom
    customFamily: '',
    size: 0, // px; 0 = auto-fit to the column (stock behavior)
    color: '', // '' = theme color
    glow: false // soft accent-colored glow behind the title area
  }
}

const TITLE_FAMILIES = {
  serif: "'Source Serif Pro', 'Source Serif 4', Charter, 'Iowan Old Style', Georgia, serif",
  sans: "-apple-system, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace"
}

const FAMILY_OPTIONS = [
  { id: 'stock', label: 'Stock' },
  { id: 'serif', label: 'Serif' },
  { id: 'sans', label: 'Sans' },
  { id: 'mono', label: 'Mono' },
  { id: 'custom', label: 'Custom' }
]

let pluginCtx = null
const $prefs = atom({ ...DEFAULTS, widgets: { ...DEFAULTS.widgets }, prompts: DEFAULTS.prompts.slice() })
const $hasImage = atom(false)
const $imageError = atom('')
// Bumped on reset so the settings form remounts with no leftover drafts or notes.
const $resetCount = atom(0)
let legacyTimer = null

const stages = new Map()
let styleEl = null
let titleStyleEl = null
let observer = null
let clockTimer = null
let syncTimer = null
let disposed = false
// The saved local image, read from storage once (it can be ~900 KB).
let localImage = ''
let lastPaletteKey = ''
// Image URLs that failed to load this session; never re-requested until the URL changes.
const failedUrls = new Set()
let sessionsCache = { at: 0, rows: [] }
let sessionsInflight = null

function promptLines(prompts, keepBlank) {
  // While editing (keepBlank) keep lines verbatim, with room to spare, so trailing spaces
  // survive typing and pressing Enter mid-list never deletes a prompt. Display caps at three.
  const lines = (Array.isArray(prompts) ? prompts : DEFAULT_PROMPTS)
    .map(line => String(line ?? '').slice(0, 200))
    .slice(0, 12)
  return keepBlank ? lines : lines.map(line => line.trim()).filter(Boolean).slice(0, MAX_PROMPTS)
}

function clonePrefs(value, keepBlankPrompts = false) {
  const widgets = value && value.widgets && typeof value.widgets === 'object' ? value.widgets : {}

  return {
    enabled: value && value.enabled !== false,
    imagery: IMAGERY.some(item => item.id === value?.imagery) ? value.imagery : DEFAULTS.imagery,
    customUrl: typeof value?.customUrl === 'string' ? value.customUrl : '',
    strength: clampStrength(value?.strength),
    widgets: {
      clock: widgets.clock !== false,
      greeting: widgets.greeting !== false,
      model: widgets.model !== false,
      recents: widgets.recents !== false,
      prompts: widgets.prompts !== false
    },
    prompts: promptLines(value?.prompts, keepBlankPrompts),
    title: cloneTitle(value?.title)
  }
}

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont'])

function sanitizeFamily(value) {
  // Letters, digits, spaces, hyphens, dots and commas only. Anything else (quotes, braces,
  // semicolons, slashes, parentheses) is dropped, so the value can't break out of its rule.
  return String(value || '').replace(/[^\p{L}\p{N} ,.\-]/gu, '').slice(0, 200)
}

// Build a font-family list with each name quoted (generic keywords stay bare).
function familyStack(value) {
  const names = sanitizeFamily(value).split(',').map(name => name.trim().replace(/\s+/g, ' ')).filter(Boolean)
  return names.map(name => (GENERIC_FAMILIES.has(name.toLowerCase()) ? name : `"${name}"`)).join(', ')
}

function sanitizeColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? String(value) : ''
}

function cloneTitle(value) {
  const t = value && typeof value === 'object' ? value : {}
  const d = DEFAULTS.title
  const size = Number(t.size)

  return {
    show: t.show !== false,
    tagline: t.tagline !== false,
    text: typeof t.text === 'string' ? t.text.slice(0, 60) : d.text,
    family: FAMILY_OPTIONS.some(item => item.id === t.family) ? t.family : d.family,
    customFamily: typeof t.customFamily === 'string' ? sanitizeFamily(t.customFamily) : '',
    size: Number.isFinite(size) ? Math.min(240, Math.max(0, Math.round(size))) : 0,
    color: sanitizeColor(t.color),
    glow: t.glow === true
  }
}

function clampStrength(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULTS.strength
  return Math.min(70, Math.max(8, Math.round(number)))
}

function safeImageUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,/i.test(text)) return text
  try {
    const url = new URL(text)
    // https only: no plain-http fetches, no file: or other schemes.
    if (url.protocol === 'https:') return url.href
  } catch {
    return ''
  }
  return ''
}

function token(name) {
  if (typeof getComputedStyle !== 'function') return ''
  // Theme values are interpolated into SVG attributes; keep them attribute-safe.
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim().replace(/["'<>&]/g, '')
}

function palette() {
  return {
    accent: token('--ui-accent') || token('--accent') || 'CanvasText',
    fg: token('--foreground') || token('--ui-text-primary') || 'CanvasText',
    bg: token('--ui-chat-surface-background') || token('--background') || 'Canvas'
  }
}

function svgUrl(markup) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(markup)}`
}

function imageryMarkup(id) {
  const { accent, fg, bg } = palette()
  const common = `xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"`

  if (id === 'horizon') {
    return `<svg ${common}><rect width="1600" height="1000" fill="${bg}"/><rect width="1600" height="1000" fill="${accent}" opacity="0.22"/><path d="M0 760 C 280 680 420 820 720 740 C 980 670 1180 800 1600 700 L 1600 1000 L 0 1000 Z" fill="${bg}" opacity="0.72"/><path d="M0 820 C 240 760 520 880 860 800 C 1120 740 1360 860 1600 790 L 1600 1000 L 0 1000 Z" fill="${fg}" opacity="0.08"/><circle cx="1180" cy="280" r="78" fill="${accent}" opacity="0.55"/></svg>`
  }

  if (id === 'window') {
    return `<svg ${common}><rect width="1600" height="1000" fill="${bg}"/><rect x="180" y="90" width="1240" height="760" rx="18" fill="${accent}" opacity="0.16"/><rect x="220" y="130" width="1160" height="680" fill="${bg}" opacity="0.35"/><path d="M800 130 V 810 M 220 470 H 1380" stroke="${fg}" stroke-width="10" opacity="0.18"/><circle cx="800" cy="390" r="90" fill="${accent}" opacity="0.45"/></svg>`
  }

  if (id === 'paper') {
    return `<svg ${common}><rect width="1600" height="1000" fill="${bg}"/><g stroke="${fg}" stroke-width="1" opacity="0.14">${Array.from({ length: 18 }, (_, i) => `<line x1="80" x2="1520" y1="${120 + i * 42}" y2="${120 + i * 42}"/>`).join('')}</g><circle cx="1320" cy="210" r="54" fill="none" stroke="${accent}" stroke-width="6" opacity="0.7"/><circle cx="1320" cy="210" r="8" fill="${accent}" opacity="0.8"/></svg>`
  }

  if (id === 'stars') {
    const dots = [
      [180, 160], [420, 90], [260, 340], [640, 220], [900, 120], [1100, 280],
      [1380, 160], [1240, 420], [760, 480], [480, 620], [200, 700], [980, 640],
      [1460, 700], [700, 80], [1040, 520]
    ]
    const lines = [[0, 1], [1, 3], [3, 4], [4, 5], [5, 6], [3, 8], [8, 9], [2, 10], [7, 12]]
    return `<svg ${common}><rect width="1600" height="1000" fill="${bg}"/><g stroke="${accent}" stroke-width="1.5" opacity="0.35">${lines.map(([a, b]) => `<line x1="${dots[a][0]}" y1="${dots[a][1]}" x2="${dots[b][0]}" y2="${dots[b][1]}"/>`).join('')}</g><g fill="${fg}">${dots.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 4 === 0 ? 4.5 : 2.4}" opacity="${i % 3 === 0 ? 0.7 : 0.4}"/>`).join('')}</g></svg>`
  }

  return `<svg ${common}><rect width="1600" height="1000" fill="${bg}"/><circle cx="1240" cy="220" r="220" fill="${accent}" opacity="0.28"/><circle cx="1240" cy="220" r="90" fill="${accent}" opacity="0.35"/><path d="M120 860 C 360 640 520 920 860 700 C 1120 540 1280 820 1540 620" fill="none" stroke="${fg}" stroke-width="3" opacity="0.22"/><rect x="96" y="96" width="1408" height="808" fill="none" stroke="${fg}" stroke-width="2" opacity="0.12"/></svg>`
}

function artUrl(prefs) {
  if (prefs.imagery === 'custom') {
    return localImage || safeImageUrl(prefs.customUrl)
  }
  return svgUrl(imageryMarkup(prefs.imagery))
}

function cssUrl(value) {
  return `url("${String(value).replace(/["\\\n\r]/g, '')}")`
}

function greeting(date = new Date()) {
  const hour = date.getHours()
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function clockParts(date = new Date()) {
  return {
    time: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    date: date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
  }
}

function modelLabel() {
  const model = host.state && host.state.model ? String(host.state.model.get() || '') : ''
  const slash = model.lastIndexOf('/')
  return (slash >= 0 ? model.slice(slash + 1) : model) || 'model'
}

function profileLabel() {
  const profile = host.state && host.state.profile ? String(host.state.profile.get() || '') : ''
  return profile || 'profile'
}

function ensureStyle() {
  if (styleEl && styleEl.isConnected) return
  styleEl = document.createElement('style')
  styleEl.id = STYLE_ID
  styleEl.textContent = `
    .sh-art, .sh-widgets { position: absolute; inset: 0; pointer-events: none; }
    .sh-art { z-index: -1; background-position: center; background-size: cover; background-repeat: no-repeat; }
    .sh-art::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse at center, var(--ui-chat-surface-background) 0%, color-mix(in srgb, var(--ui-chat-surface-background) 72%, transparent) 38%, transparent 68%),
        linear-gradient(to top, var(--ui-chat-surface-background), transparent 28%);
    }
    /* .sh-widgets is the size container; the grid lives one level down so the
       container query below can actually restyle it (a container can't query itself). */
    .sh-widgets { z-index: 8; container-type: inline-size; }
    .sh-grid {
      height: 100%;
      box-sizing: border-box;
      display: grid;
      /* Fixed side columns around a flexible middle. Don't size from the app's
         --composer-width: it can be 100%, which pushes the right column off-screen. */
      grid-template-columns: minmax(10rem, 1fr) minmax(0, 44rem) minmax(10rem, 1fr);
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 0.75rem;
      padding: 0.85rem;
      padding-bottom: calc(var(--composer-measured-height, 7.5rem) + 0.85rem);
    }
    .sh-card {
      pointer-events: auto;
      max-width: 16rem;
      border: 1px solid color-mix(in srgb, var(--ui-stroke-secondary) 70%, transparent);
      background: color-mix(in srgb, var(--ui-chat-surface-background) 82%, transparent);
      color: var(--ui-text-secondary);
      border-radius: 0.7rem;
      padding: 0.65rem 0.75rem;
      text-align: left;
    }
    .sh-clock { grid-column: 1; grid-row: 1; justify-self: start; }
    .sh-meta { grid-column: 3; grid-row: 1; justify-self: end; text-align: right; }
    .sh-recents { grid-column: 1; grid-row: 3; justify-self: start; align-self: end; }
    .sh-prompts { grid-column: 3; grid-row: 3; justify-self: end; align-self: end; }
    .sh-kicker { font-size: 0.68rem; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ui-text-tertiary); }
    .sh-time { margin-top: 0.1rem; font-size: 1.35rem; line-height: 1.1; color: var(--ui-text-primary, var(--foreground)); }
    .sh-sub { margin-top: 0.15rem; font-size: 0.75rem; color: var(--ui-text-tertiary); }
    .sh-list { display: flex; flex-direction: column; gap: 0.28rem; margin-top: 0.4rem; }
    .sh-btn {
      pointer-events: auto;
      display: block;
      width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border: 0;
      border-radius: 0.4rem;
      background: transparent;
      color: var(--ui-text-secondary);
      font: inherit;
      font-size: 0.75rem;
      line-height: 1.3;
      text-align: inherit;
      padding: 0.2rem 0.15rem;
      cursor: pointer;
    }
    .sh-btn:hover { color: var(--foreground); background: var(--chrome-action-hover); }
    .sh-link {
      pointer-events: auto;
      margin-top: 0.45rem;
      border: 0;
      background: transparent;
      color: var(--ui-text-tertiary);
      font: inherit;
      font-size: 0.68rem;
      cursor: pointer;
      padding: 0;
    }
    .sh-link:hover { color: var(--foreground); }
    .sh-btn:focus-visible, .sh-link:focus-visible {
      outline: 2px solid var(--ui-accent);
      outline-offset: 1px;
      color: var(--foreground);
    }
    @container (max-width: 860px) {
      .sh-grid { grid-template-columns: 1fr; grid-template-rows: auto auto minmax(0, 1fr) auto; }
      .sh-clock, .sh-meta, .sh-recents, .sh-prompts { grid-column: 1; justify-self: start; text-align: left; }
      .sh-clock { grid-row: 1; }
      .sh-meta { grid-row: 2; }
      .sh-prompts { grid-row: 4; }
      .sh-recents { display: none; }
    }
    @container (max-width: 560px) {
      .sh-meta, .sh-prompts { display: none; }
    }
  `
  document.documentElement.appendChild(styleEl)
}

function removeStyle() {
  styleEl?.remove()
  styleEl = null
}

const TITLE_MARK = "[data-slot='aui_intro'] .wordmark"

function titleCss(t) {
  const html = `html[${TITLE_ATTR}]`
  const mark = `${html} ${TITLE_MARK}`
  const tag = `${html} [data-slot='aui_intro'] p:last-child`
  const out = []

  if (!t.show) {
    out.push(`${mark} { display: none !important; }`)
  } else {
    const rules = []

    if (t.family !== 'stock') {
      const custom = t.family === 'custom' ? familyStack(t.customFamily) : ''
      const stack = t.family === 'custom' ? (custom ? `${custom}, ${TITLE_FAMILIES.serif}` : TITLE_FAMILIES.serif) : TITLE_FAMILIES[t.family]
      rules.push(
        `font-family: ${stack} !important`,
        'font-weight: 600 !important',
        'text-transform: none !important',
        'letter-spacing: -0.01em !important',
        'line-height: 1 !important',
        'mix-blend-mode: normal !important'
      )
    }

    const color = sanitizeColor(t.color)

    if (color) {
      rules.push(`color: ${color} !important`, 'mix-blend-mode: normal !important')
    }

    if (rules.length) {
      out.push(`${mark} { ${rules.join('; ')}; }`)
    }

    if (t.size > 0) {
      out.push(`${mark} > :not([aria-hidden]) > * { font-size: ${t.size}px !important; }`)
    }
  }

  if (!t.tagline) {
    out.push(`${tag} { display: none !important; }`)
  }

  if (t.glow) {
    out.push(`${html} [data-slot='aui_thread-viewport']:has([data-slot='aui_intro']) {
      background:
        radial-gradient(60rem 36rem at 88% -8%, color-mix(in srgb, var(--ui-accent) 28%, transparent), transparent 70%),
        radial-gradient(50rem 30rem at -6% 108%, color-mix(in srgb, var(--ui-accent) 18%, transparent), transparent 70%);
    }`)
  }

  return out.join('\n')
}

// Swap the words by rewriting the wordmark's text nodes in place. React keeps its own
// references to those nodes, so editing nodeValue is safe; the original is remembered
// per node and restored when the field is cleared.
function syncTitleText(text) {
  for (const mark of document.querySelectorAll(TITLE_MARK)) {
    const walker = document.createTreeWalker(mark, NodeFilter.SHOW_TEXT)

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (text) {
        if (n.__shOrig === undefined) n.__shOrig = n.nodeValue
        if (n.nodeValue !== text) n.nodeValue = text
      } else if (n.__shOrig !== undefined) {
        n.nodeValue = n.__shOrig
        delete n.__shOrig
      }
    }

    if (text) {
      if (mark.__shLabel === undefined) mark.__shLabel = mark.getAttribute('aria-label') ?? ''
      mark.setAttribute('aria-label', text)
    } else if (mark.__shLabel !== undefined) {
      mark.setAttribute('aria-label', mark.__shLabel)
      delete mark.__shLabel
    }
  }
}

function syncTitle() {
  const t = $prefs.get().title

  if (!titleStyleEl || !titleStyleEl.isConnected) {
    titleStyleEl = document.createElement('style')
    titleStyleEl.id = TITLE_STYLE_ID
    document.documentElement.appendChild(titleStyleEl)
  }

  const css = titleCss(t)

  if (titleStyleEl.textContent !== css) titleStyleEl.textContent = css
  document.documentElement.setAttribute(TITLE_ATTR, '')
  syncTitleText(t.text)
}

function removeTitle() {
  syncTitleText('')
  titleStyleEl?.remove()
  titleStyleEl = null
  document.documentElement.removeAttribute(TITLE_ATTR)
}

function openSettings() {
  const path = typeof pluginSettingsHref === 'function' ? pluginSettingsHref(ID) : '/settings?tab=plugins'
  if (typeof host.navigate === 'function') host.navigate(path)
}

async function loadSessions() {
  const profile = profileLabel()
  const now = Date.now()
  // The cache belongs to one profile; a profile switch is a cache miss.
  if (sessionsCache.profile === profile && now - sessionsCache.at < 60_000) return sessionsCache.rows
  if (sessionsInflight && sessionsInflight.profile === profile) return sessionsInflight.promise
  if (typeof host.request !== 'function') return null
  const promise = (async () => {
    try {
      // Short explicit timeout: a slow gateway must not leave the card waiting for 30s.
      const result = await host.request('session.list', { limit: 8 }, 5000)
      if (profileLabel() !== profile) return null
      const rows = Array.isArray(result?.sessions) ? result.sessions : []
      sessionsCache = {
        at: Date.now(),
        profile,
        rows: rows.filter(row => row && row.id && (row.message_count == null || row.message_count > 0)).slice(0, 4)
      }
      return sessionsCache.rows
    } catch {
      return null
    } finally {
      if (sessionsInflight?.promise === promise) sessionsInflight = null
    }
  })()
  sessionsInflight = { profile, promise }
  return promise
}

function sessionTitle(row) {
  const title = String(row.title || row.preview || '').trim()
  return title || 'Untitled chat'
}

async function usePrompt(text) {
  haptic?.('tap')
  const composer = host.composer
  if (composer && typeof composer.setDraft === 'function') {
    const ok = await composer.setDraft('new', text)
    if (ok) {
      composer.focus?.('new')
      return
    }
  }
  if (composer && typeof composer.insertText === 'function') {
    // Target the new-chat composer only, never whichever chat happens to be active.
    const ok = await composer.insertText('new', text, { mode: 'block' })
    if (ok) return
  }
  host.notify?.({ kind: 'info', message: 'Could not place that in the composer.' })
}

async function openRecent(id) {
  haptic?.('tap')
  if (typeof host.openSession !== 'function') {
    host.notify?.({ kind: 'info', message: 'Opening chats from here is not available in this build.' })
    return
  }
  try {
    await host.openSession(id)
  } catch (error) {
    host.notify?.({ kind: 'error', message: error && error.message ? error.message : 'Could not open that chat.' })
  }
}

function fillCard(card, prefs, rows) {
  card.replaceChildren()
  // Start hidden; each branch below re-shows its card only if that widget is on.
  card.hidden = true
  const clockOn = prefs.widgets.clock || prefs.widgets.greeting
  if (card.dataset.role === 'clock' && clockOn) {
    const parts = clockParts()
    if (prefs.widgets.greeting) card.append(el('div', 'sh-kicker', greeting()))
    if (prefs.widgets.clock) {
      const time = el('div', 'sh-time', parts.time)
      time.dataset.shClock = 'time'
      card.append(time)
    }
    const date = el('div', 'sh-sub', parts.date)
    date.dataset.shClock = 'date'
    card.append(date)
    const link = el('button', 'sh-link', 'Customize')
    link.type = 'button'
    link.addEventListener('click', openSettings)
    card.append(link)
    card.hidden = false
    return
  }
  if (card.dataset.role === 'meta' && prefs.widgets.model) {
    card.append(el('div', 'sh-kicker', 'New chat'))
    card.append(el('div', 'sh-sub', `${profileLabel()} · ${modelLabel()}`))
    if ($imageError.get()) card.append(el('div', 'sh-sub', $imageError.get()))
    card.hidden = false
    return
  }
  if (card.dataset.role === 'recents' && prefs.widgets.recents) {
    card.append(el('div', 'sh-kicker', 'Jump back in'))
    const list = el('div', 'sh-list')
    if (!rows.length) {
      list.append(el('div', 'sh-sub', 'No recent chats yet.'))
    } else {
      for (const row of rows) {
        const button = el('button', 'sh-btn', sessionTitle(row))
        button.type = 'button'
        button.title = sessionTitle(row)
        button.addEventListener('click', () => { void openRecent(row.id) })
        list.append(button)
      }
    }
    card.append(list)
    card.hidden = false
    return
  }
  const prompts = prefs.prompts.map(line => line.trim()).filter(Boolean).slice(0, MAX_PROMPTS)
  if (card.dataset.role === 'prompts' && prefs.widgets.prompts && prompts.length) {
    card.append(el('div', 'sh-kicker', 'Start with'))
    const list = el('div', 'sh-list')
    for (const prompt of prompts) {
      const button = el('button', 'sh-btn', prompt)
      button.type = 'button'
      button.title = prompt
      button.addEventListener('click', () => { void usePrompt(prompt) })
      list.append(button)
    }
    card.append(list)
    card.hidden = false
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

// Short, stable key for an image URL so a ~900 KB data URL is never copied into the DOM.
function urlKey(url) {
  if (url.length <= 2048) return url
  let hash = 0
  for (let i = 0; i < url.length; i += 97) hash = (hash * 31 + url.charCodeAt(i)) | 0
  return `big:${url.length}:${hash}:${url.slice(-32)}`
}

function paintArt(art, prefs) {
  const picked = artUrl(prefs)
  const broken = Boolean(picked) && failedUrls.has(picked)
  const chosen = broken ? '' : picked
  const url = chosen || svgUrl(imageryMarkup('atelier'))
  const missingCustom = prefs.imagery === 'custom' && !chosen
  const key = urlKey(url)
  art.style.opacity = String(prefs.strength / 100)
  if (art.dataset.shUrl === key && art.dataset.shMissing === String(missingCustom)) return
  art.dataset.shUrl = key
  art.dataset.shMissing = String(missingCustom)
  art.style.backgroundImage = cssUrl(url)
  if (missingCustom) {
    $imageError.set(broken ? 'That image URL did not load.' : `Add an image in ${NAME} settings.`)
    return
  }
  if (prefs.imagery !== 'custom' || !/^https:/i.test(url)) {
    $imageError.set('')
    return
  }
  const probe = new Image()
  probe.onload = () => {
    if (art.dataset.shUrl === key) $imageError.set('')
  }
  probe.onerror = () => {
    // Remember the failure so later syncs don't download the broken URL again.
    failedUrls.add(url)
    if (art.dataset.shUrl !== key) return
    $imageError.set('That image URL did not load.')
    const fallback = svgUrl(imageryMarkup('atelier'))
    art.dataset.shUrl = urlKey(fallback)
    art.style.backgroundImage = cssUrl(fallback)
    for (const record of stages.values()) record.signature = ''
    scheduleSync()
  }
  probe.src = url
}

function ensureStage(bounds) {
  let record = stages.get(bounds)
  if (record) return record
  const art = el('div', 'sh-art')
  art.setAttribute('aria-hidden', 'true')
  const widgets = el('div', 'sh-widgets')
  const grid = el('div', 'sh-grid')
  const clock = el('div', 'sh-card sh-clock')
  const meta = el('div', 'sh-card sh-meta')
  const recents = el('div', 'sh-card sh-recents')
  const prompts = el('div', 'sh-card sh-prompts')
  clock.dataset.role = 'clock'
  meta.dataset.role = 'meta'
  recents.dataset.role = 'recents'
  prompts.dataset.role = 'prompts'
  for (const card of [clock, meta, recents, prompts]) card.hidden = true
  grid.append(clock, meta, recents, prompts)
  widgets.append(grid)
  bounds.prepend(art)
  bounds.append(widgets)
  // A freshly shown new-chat screen should list current chats, not a cached list.
  sessionsCache.at = 0
  record = { art, widgets, clock, meta, recents, prompts, signature: '' }
  stages.set(bounds, record)
  return record
}

function dropStage(bounds) {
  const record = stages.get(bounds)
  if (!record) return
  record.art.remove()
  record.widgets.remove()
  stages.delete(bounds)
}

function widgetSignature(prefs) {
  return JSON.stringify({
    widgets: prefs.widgets,
    prompts: prefs.prompts,
    profile: profileLabel(),
    model: modelLabel(),
    error: $imageError.get()
  })
}

async function refreshStage(bounds, prefs) {
  const record = ensureStage(bounds)
  paintArt(record.art, prefs)
  const signature = widgetSignature(prefs)
  if (signature === record.signature) {
    tickClock(record)
    return
  }
  const generation = (record.generation || 0) + 1
  record.generation = generation
  record.signature = signature
  // Everything except recents fills right away; recents never holds the others back.
  fillCard(record.clock, prefs, [])
  fillCard(record.meta, prefs, [])
  fillCard(record.prompts, prefs, [])
  if (!prefs.widgets.recents) {
    fillCard(record.recents, prefs, [])
    return
  }
  if (sessionsCache.at > 0 && sessionsCache.profile === profileLabel()) fillCard(record.recents, prefs, sessionsCache.rows)
  const rows = await loadSessions()
  // Bail if superseded, disposed, or this record was replaced by a newer stage.
  if (disposed || generation !== record.generation || stages.get(bounds) !== record) return
  if (!bounds.isConnected || !bounds.querySelector(INTRO)) {
    dropStage(bounds)
    return
  }
  if (rows === null) {
    // Couldn't load: hide the card and let the next sync try again.
    record.signature = ''
    if (sessionsCache.profile !== profileLabel()) fillCard(record.recents, { ...prefs, widgets: { ...prefs.widgets, recents: false } }, [])
    return
  }
  fillCard(record.recents, prefs, rows)
}

function tickClock(record) {
  if (!record || !record.clock.isConnected) return
  const parts = clockParts()
  const time = record.clock.querySelector('[data-sh-clock="time"]')
  const date = record.clock.querySelector('[data-sh-clock="date"]')
  if (time) time.textContent = parts.time
  if (date) date.textContent = parts.date
  const kicker = record.clock.querySelector('.sh-kicker')
  if (kicker) kicker.textContent = greeting()
}

function syncStages() {
  if (disposed || !document.body) return
  const prefs = $prefs.get()
  if (!prefs.enabled) {
    // Off means fully off: imagery, widgets and title changes all go away.
    for (const bounds of [...stages.keys()]) dropStage(bounds)
    removeTitle()
    removeStyle()
    $imageError.set('')
    return
  }
  syncTitle()
  ensureStyle()
  const live = new Set()
  for (const intro of document.querySelectorAll(INTRO)) {
    const bounds = intro.closest('[data-slot="composer-bounds"]') || intro.closest('[data-chat-surface]')
    if (!bounds) continue
    live.add(bounds)
    void refreshStage(bounds, prefs)
  }
  for (const bounds of [...stages.keys()]) {
    if (!live.has(bounds) || !bounds.isConnected) dropStage(bounds)
  }
  if (stages.size) lastPaletteKey = paletteKey()
}

function scheduleSync() {
  if (syncTimer) return
  syncTimer = setTimeout(() => {
    syncTimer = null
    syncStages()
  }, 40)
}

function paletteKey() {
  const { accent, fg, bg } = palette()
  return `${accent}|${fg}|${bg}`
}

// Only wake up for changes that can matter to the new-chat screen. Streaming replies in
// ongoing chats mutate the DOM constantly; those batches must cost a few cheap checks, not a resync.
function mutationsMatter(records) {
  for (const record of records) {
    if (record.type === 'attributes') {
      if (record.attributeName !== 'style') return true
      // Root inline style also carries text scale and pane geometry. Only check colors
      // when a stage is actually showing; otherwise the next mount reads fresh colors anyway.
      if (!stages.size) continue
      const key = paletteKey()
      if (key !== lastPaletteKey) {
        lastPaletteKey = key
        return true
      }
      continue
    }
    for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue
      if (node.closest?.('.sh-widgets, .sh-art')) continue
      if (node.matches?.(INTRO) || node.querySelector?.(INTRO)) return true
    }
    if (record.removedNodes.length && stages.size) {
      for (const bounds of stages.keys()) {
        if (!bounds.isConnected || !bounds.querySelector(INTRO)) return true
      }
    }
  }
  return false
}

function installWatcher() {
  if (observer || !document.body) return
  observer = new MutationObserver(records => {
    if (mutationsMatter(records)) scheduleSync()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  const themeRoot = document.documentElement
  observer.observe(themeRoot, { attributes: true, attributeFilter: ['class', 'data-hermes-theme', 'data-hermes-mode', 'style'] })
}

function scheduleClock() {
  clearTimeout(clockTimer)
  if (disposed) return
  const now = new Date()
  const wait = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50
  clockTimer = setTimeout(() => {
    for (const record of stages.values()) tickClock(record)
    scheduleClock()
  }, wait)
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that image.'))
    reader.onload = () => {
      const original = String(reader.result || '')
      if (file.type === 'image/gif' && original.length <= MAX_IMAGE_CHARS) {
        resolve(original)
        return
      }
      const image = new Image()
      image.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height, 1))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('Could not prepare that image.'))
          return
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        let quality = 0.72
        let data = canvas.toDataURL('image/jpeg', quality)
        while (data.length > MAX_IMAGE_CHARS && quality > 0.4) {
          quality -= 0.08
          data = canvas.toDataURL('image/jpeg', quality)
        }
        if (data.length > MAX_IMAGE_CHARS) {
          reject(new Error('That image is still too large after compressing. Try a smaller file or an https URL.'))
          return
        }
        resolve(data)
      }
      image.onerror = () => reject(new Error('That file is not a readable image.'))
      image.src = original
    }
    reader.readAsDataURL(file)
  })
}

function updatePrefs(patch) {
  const next = clonePrefs(
    {
      ...$prefs.get(),
      ...patch,
      title: { ...$prefs.get().title, ...(patch.title || {}) },
      widgets: { ...$prefs.get().widgets, ...(patch.widgets || {}) }
    },
    Object.hasOwn(patch, 'prompts')
  )
  $prefs.set(next)
  pluginCtx?.storage.set('prefs', next)
  for (const record of stages.values()) record.signature = ''
  scheduleSync()
}

function SettingsPanel() {
  const prefs = useValue($prefs)
  const hasImage = useValue($hasImage)
  const imageError = useValue($imageError)
  const resetCount = useValue($resetCount)

  const pickFile = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
    input.onchange = () => {
      const file = input.files && input.files[0]
      if (!file || !pluginCtx) return
      compressImage(file)
        .then(dataUrl => {
          if (!pluginCtx) return
          pluginCtx.storage.set('image', dataUrl)
          // Storage can silently drop a write when it's full; confirm it actually saved.
          if (pluginCtx.storage.get('image', '') !== dataUrl) {
            host.notify?.({ kind: 'error', message: 'Not enough room to save that image. Try a smaller one or an https URL.' })
            return
          }
          localImage = safeImageUrl(dataUrl)
          $hasImage.set(Boolean(localImage))
          updatePrefs({ imagery: 'custom' })
          host.notify?.({ kind: 'info', message: 'Background image saved for new chats.' })
        })
        .catch(error => {
          host.notify?.({ kind: 'error', message: error.message || 'Could not save that image.' })
        })
    }
    input.click()
  }

  const clearImage = () => {
    pluginCtx?.storage.remove('image')
    localImage = ''
    $hasImage.set(false)
    for (const record of stages.values()) record.art.dataset.shUrl = ''
    // Fall back to a saved https URL if there is one; otherwise to a preset.
    const keepCustom = prefs.imagery === 'custom' && Boolean(safeImageUrl(prefs.customUrl))
    updatePrefs({ imagery: prefs.imagery === 'custom' && !keepCustom ? 'atelier' : prefs.imagery })
  }

  return jsxs('div', {
    className: 'flex flex-col gap-4 text-sm text-(--ui-text-secondary)',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-3',
        children: [
          jsxs('div', {
            children: [
              jsx('div', { className: 'text-(--ui-text-primary)', children: 'Show on new chats' }),
              jsx('p', { className: 'm-0 mt-1 text-xs text-(--ui-text-tertiary)', children: 'Imagery, widgets and title changes appear only on the empty new-chat screen. Ongoing chats stay plain. Turning this off puts everything back to stock.' })
            ]
          }),
          jsx(Switch, { checked: prefs.enabled, onCheckedChange: enabled => updatePrefs({ enabled }) })
        ]
      }),
      jsxs('div', {
        className: 'flex flex-col gap-2',
        children: [
          jsx('div', { className: 'text-(--ui-text-primary)', children: 'Imagery' }),
          jsx('div', {
            className: 'flex flex-wrap gap-1.5',
            children: IMAGERY.map(item => jsx(Button, {
              type: 'button',
              variant: prefs.imagery === item.id ? 'default' : 'secondary',
              onClick: () => updatePrefs({ imagery: item.id }),
              children: item.label
            }, item.id))
          }),
          jsxs('label', {
            className: 'mt-1 flex flex-col gap-1 text-xs text-(--ui-text-tertiary)',
            children: [
              `Strength ${prefs.strength}%`,
              jsx('input', {
                type: 'range',
                min: 8,
                max: 70,
                value: prefs.strength,
                onChange: event => updatePrefs({ strength: Number(event.target.value) }),
                style: { accentColor: 'var(--ui-accent)' }
              })
            ]
          })
        ]
      }),
      jsxs('div', {
        className: 'flex flex-col gap-2',
        children: [
          jsx('div', { className: 'text-(--ui-text-primary)', children: 'Your image' }),
          jsx('p', { className: 'm-0 text-xs text-(--ui-text-tertiary)', children: hasImage ? 'A local image is saved on this Mac.' : 'No local image saved yet. A URL is used only while My image is selected.' }),
          jsxs('div', {
            className: 'flex flex-wrap gap-2',
            children: [
              jsx(Button, { type: 'button', variant: 'secondary', onClick: pickFile, children: 'Choose image' }),
              jsx(Button, { type: 'button', variant: 'ghost', onClick: clearImage, disabled: !hasImage, children: 'Clear saved image' })
            ]
          }),
          jsx(ImageUrlField, { value: prefs.customUrl }, `url-${resetCount}`),
          imageError ? jsx('p', { className: 'm-0 text-xs text-(--ui-text-tertiary)', children: imageError }) : null
        ]
      }),
      jsx(TitleSection, { prefs }),
      jsxs('div', {
        className: 'flex flex-col gap-2',
        children: [
          jsx('div', { className: 'text-(--ui-text-primary)', children: 'Widgets' }),
          jsx(WidgetToggle, { label: 'Clock and date', checked: prefs.widgets.clock, onChange: clock => updatePrefs({ widgets: { clock } }) }),
          jsx(WidgetToggle, { label: 'Greeting', checked: prefs.widgets.greeting, onChange: greetingOn => updatePrefs({ widgets: { greeting: greetingOn } }) }),
          jsx(WidgetToggle, { label: 'Profile and model', checked: prefs.widgets.model, onChange: model => updatePrefs({ widgets: { model } }) }),
          jsx(WidgetToggle, { label: 'Recent chats', checked: prefs.widgets.recents, onChange: recents => updatePrefs({ widgets: { recents } }) }),
          jsx(WidgetToggle, { label: 'Starter prompts', checked: prefs.widgets.prompts, onChange: prompts => updatePrefs({ widgets: { prompts } }) }),
          jsx(Textarea, {
            rows: 4,
            value: prefs.prompts.join('\n'),
            onChange: event => updatePrefs({ prompts: event.target.value.split(/\n/) })
          }),
          jsx('p', { className: 'm-0 text-xs text-(--ui-text-tertiary)', children: 'Up to three starter prompts, one per line. Clicking one fills the new-chat composer. It does not send.' })
        ]
      }),
      jsx(Button, {
        type: 'button',
        variant: 'secondary',
        onClick: () => {
          if (host.settings && typeof host.settings.set === 'function') {
            host.settings.set('intro-splash.v1', true)
            host.notify?.({ kind: 'info', message: 'Intro splash is on. Open a new chat to see it.' })
          } else {
            host.notify?.({ kind: 'info', message: 'This Hermes version cannot change that from a plugin. Check Settings > Appearance.' })
          }
        },
        children: 'Make sure the new-chat splash is on'
      }),
      jsx(ResetButton, {})
    ]
  })
}

// The URL is applied only when you finish typing (Enter or leaving the field), so a
// half-typed address never switches imagery or triggers a network request.
function ImageUrlField({ value }) {
  const [draft, setDraft] = useState(value)
  const [note, setNote] = useState('')

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = () => {
    const text = draft.trim()
    if (text === value) return
    if (!text) {
      setNote('')
      updatePrefs({ customUrl: '' })
      return
    }
    const safe = safeImageUrl(text)
    if (!safe || safe.startsWith('data:')) {
      setNote('Use an https:// image address.')
      return
    }
    setNote('')
    updatePrefs({ customUrl: safe, imagery: 'custom' })
  }

  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsx(Input, {
        placeholder: 'https://… image URL (press Enter to use it)',
        value: draft,
        onChange: event => {
          setDraft(event.target.value)
          if (note) setNote('')
        },
        onBlur: commit,
        onKeyDown: event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }
      }),
      jsx('p', {
        className: 'm-0 text-xs text-(--ui-text-tertiary)',
        children: note || 'A URL image is downloaded from that site each time a new chat opens. A saved local image is used first if you have one.'
      })
    ]
  })
}

function TitleSection({ prefs }) {
  const t = prefs.title
  const set = patch => updatePrefs({ title: patch })

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsx('div', { className: 'text-(--ui-text-primary)', children: 'Title' }),
      jsx(WidgetToggle, { label: 'Show the big title', checked: t.show, onChange: show => set({ show }) }),
      jsx(WidgetToggle, { label: 'Show the line underneath', checked: t.tagline, onChange: tagline => set({ tagline }) }),
      jsx(WidgetToggle, { label: 'Soft accent glow', checked: t.glow, onChange: glow => set({ glow }) }),
      jsx(Input, {
        placeholder: 'Title text (blank = Hermes Agent)',
        maxLength: 60,
        value: t.text,
        onChange: event => set({ text: event.target.value })
      }),
      jsx('div', {
        className: 'flex flex-wrap gap-1.5',
        children: FAMILY_OPTIONS.map(item => jsx(Button, {
          type: 'button',
          variant: t.family === item.id ? 'default' : 'secondary',
          onClick: () => set({ family: item.id }),
          children: item.label
        }, item.id))
      }),
      t.family === 'custom'
        ? jsx(Input, {
            placeholder: 'Any installed font, e.g. Avenir Next',
            value: t.customFamily,
            onChange: event => set({ customFamily: event.target.value })
          })
        : null,
      jsxs('label', {
        className: 'flex flex-col gap-1 text-xs text-(--ui-text-tertiary)',
        children: [
          t.size > 0 ? `Size ${t.size}px` : 'Size: auto (fits the column)',
          jsx('input', {
            type: 'range',
            min: 0,
            max: 240,
            step: 4,
            value: t.size,
            onChange: event => set({ size: Number(event.target.value) }),
            style: { accentColor: 'var(--ui-accent)' }
          })
        ]
      }),
      jsxs('div', {
        className: 'flex items-center gap-2 text-xs text-(--ui-text-tertiary)',
        children: [
          'Color',
          jsx('input', {
            type: 'color',
            'aria-label': 'Title color',
            value: t.color || '#ffffff',
            onChange: event => set({ color: event.target.value })
          }),
          jsx(Button, { type: 'button', variant: 'ghost', onClick: () => set({ color: '' }), disabled: !t.color, children: 'Reset' })
        ]
      })
    ]
  })
}

function WidgetToggle({ label, checked, onChange }) {
  return jsxs('label', {
    className: 'flex items-center justify-between gap-3 text-xs',
    children: [
      jsx('span', { children: label }),
      jsx(Switch, { checked, onCheckedChange: onChange })
    ]
  })
}

function StatusChip() {
  const prefs = useValue($prefs)
  return jsx(Tip, {
    label: prefs.enabled ? `${NAME} is on. Click to hide it. Right-click for settings.` : `${NAME} is off. Click to show it.`,
    children: jsx('button', {
      type: 'button',
      className: cn(
        'inline-flex h-full items-center px-1.5 text-[0.6875rem]',
        prefs.enabled ? 'text-(--ui-text-secondary)' : 'text-(--ui-text-tertiary)'
      ),
      onClick: () => {
        haptic?.('tap')
        updatePrefs({ enabled: !prefs.enabled })
      },
      onContextMenu: event => {
        event.preventDefault()
        openSettings()
      },
      children: 'splash'
    })
  })
}

// One-time carry-over of settings saved under the pre-release id. Each key is handled on
// its own: the new copy is written and verified before the old one is removed, so a full
// storage never loses the image, and a failed or unreadable key never blocks the other.
// The image goes first because it's the large one most likely to hit the storage quota.
function migrateLegacy(ctx) {
  let store = null
  try {
    store = window.localStorage
  } catch {
    return
  }
  if (!store) return
  const base = `hermes.plugin.${LEGACY_ID}.`
  let movedImage = false
  let hadOldPrefs = false

  for (const key of ['image', 'prefs']) {
    try {
      const raw = store.getItem(base + key)
      if (raw === null) continue
      if (key === 'prefs') hadOldPrefs = true
      // Already set under the new id: the old copy is redundant.
      if (ctx.storage.get(key, undefined) !== undefined) {
        store.removeItem(base + key)
        continue
      }
      let value
      try {
        value = JSON.parse(raw)
      } catch {
        store.removeItem(base + key)
        continue
      }
      ctx.storage.set(key, value)
      if (JSON.stringify(ctx.storage.get(key, null)) === JSON.stringify(value)) {
        store.removeItem(base + key)
        if (key === 'image') movedImage = true
      }
      // Otherwise the write didn't stick (storage full); leave the old copy for next time.
    } catch {
      // Storage unavailable for this key; try again on the next start.
    }
  }

  // An image with no saved settings should still show up.
  if (movedImage && !hadOldPrefs && ctx.storage.get('prefs', undefined) === undefined) {
    ctx.storage.set('prefs', { imagery: 'custom' })
  }
}

// The pre-release build drawing on the same screen would fight with this one.
function warnIfLegacyRunning() {
  if (disposed) return
  if (document.getElementById(`${LEGACY_ID}-css`) || document.documentElement.hasAttribute(`data-${LEGACY_ID}`)) {
    host.notify?.({
      kind: 'info',
      message: `An older copy of this plugin (Stagehand) is still installed. Delete ~/.hermes/desktop-plugins/${LEGACY_ID} so the two don't overlap.`
    })
  }
}

function resetPrefs() {
  updatePrefs({
    ...DEFAULTS,
    widgets: { ...DEFAULTS.widgets },
    prompts: DEFAULTS.prompts.slice(),
    title: { ...DEFAULTS.title }
  })
  failedUrls.clear()
  $imageError.set('')
  $resetCount.set($resetCount.get() + 1)
}

function ResetButton() {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return undefined
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])

  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsx(Button, {
        type: 'button',
        variant: 'ghost',
        onClick: () => {
          if (!armed) {
            setArmed(true)
            return
          }
          setArmed(false)
          resetPrefs()
          host.notify?.({ kind: 'info', message: `${NAME} settings are back to defaults.` })
        },
        children: armed ? 'Click again to reset' : 'Reset settings to defaults'
      }),
      jsx('p', { className: 'm-0 text-xs text-(--ui-text-tertiary)', children: 'Keeps your saved image. Use Clear saved image to remove it.' })
    ]
  })
}

export default {
  id: ID,
  name: NAME,
  register(ctx) {
    pluginCtx = ctx
    disposed = false
    sessionsCache = { at: 0, rows: [] }
    migrateLegacy(ctx)
    const stored = ctx.storage.get('prefs', {})
    $prefs.set(clonePrefs(stored && typeof stored === 'object' ? stored : {}))
    localImage = safeImageUrl(ctx.storage.get('image', ''))
    $hasImage.set(Boolean(localImage))
    lastPaletteKey = paletteKey()

    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 140,
      render: () => jsx(StatusChip, {})
    })

    ctx.register({
      id: 'customize',
      area: 'palette',
      data: {
        id: `${ID}.customize`,
        label: `Customize ${NAME}`,
        keywords: ['background', 'wallpaper', 'widgets', 'new chat', 'imagery', 'splash', 'title'],
        run: openSettings
      }
    })

    ctx.register({
      id: 'toggle',
      area: 'palette',
      data: {
        id: `${ID}.toggle`,
        label: `Toggle ${NAME}`,
        keywords: ['background', 'hide', 'show', 'splash'],
        run: () => updatePrefs({ enabled: !$prefs.get().enabled })
      }
    })

    if (typeof ctx.registerSettingsPage === 'function') {
      ctx.registerSettingsPage({
        id: 'settings',
        title: NAME,
        icon: 'symbol-color',
        render: () => jsx(SettingsPanel, {})
      })
    }

    const unsub = $prefs.subscribe(() => scheduleSync())
    // Keep the profile/model card current when either changes on the new-chat screen.
    const stateUnsubs = ['model', 'profile']
      .map(key => host.state?.[key])
      .filter(value => value && typeof value.subscribe === 'function')
      .map(value => value.subscribe(() => scheduleSync()))
    ctx.onDispose(() => {
      disposed = true
      unsub()
      for (const off of stateUnsubs) {
        if (typeof off === 'function') off()
      }
      observer?.disconnect()
      observer = null
      clearTimeout(syncTimer)
      clearTimeout(clockTimer)
      clearTimeout(legacyTimer)
      legacyTimer = null
      syncTimer = null
      clockTimer = null
      for (const bounds of [...stages.keys()]) dropStage(bounds)
      removeStyle()
      removeTitle()
      pluginCtx = null
    })

    installWatcher()
    scheduleSync()
    scheduleClock()
    clearTimeout(legacyTimer)
    legacyTimer = setTimeout(warnIfLegacyRunning, 3000)
  }
}
