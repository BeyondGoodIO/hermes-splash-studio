// Headless tests for Splash Studio: jsdom + real React, with a stubbed Hermes plugin SDK.
// Run with `npm test` (Node 20.19+, 22.13+ or 24+). The plugin itself has no dependencies; these are dev-only.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(repoRoot, 'package.json'))
const { JSDOM } = require('jsdom')
const work = mkdtempSync(join(tmpdir(), 'splash-studio-test-'))
const url = name => pathToFileURL(join(work, name)).href

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
const w = dom.window
for (const k of ['window', 'document', 'MutationObserver', 'Node', 'NodeFilter', 'getComputedStyle', 'Image', 'FileReader', 'HTMLElement', 'Event', 'KeyboardEvent', 'FocusEvent']) {
  globalThis[k] = k === 'window' ? w : w[k]
}
Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// React's act() warnings are noise for a DOM-level harness.
const consoleError = console.error
console.error = (...args) => { if (!String(args[0]).includes('not wrapped in act')) consoleError(...args) }

// React is CommonJS; expose it to the ESM plugin through tiny shims.
const shim = `import { createRequire } from 'node:module'; const r = createRequire(${JSON.stringify(join(repoRoot, 'package.json'))});`
writeFileSync(join(work, 'react.mjs'), `${shim} const R = r('react'); export default R; export const { useEffect, useState, createElement, useSyncExternalStore } = R;`)
writeFileSync(join(work, 'jsx.mjs'), `${shim} const J = r('react/jsx-runtime'); export const { jsx, jsxs } = J;`)

// Minimal stand-in for '@hermes/plugin-sdk'.
writeFileSync(join(work, 'sdk.mjs'), `
import { createElement, useSyncExternalStore } from '${url('react.mjs')}'
export function atom(v) { const subs = new Set(); return { get: () => v, set: n => { v = n; subs.forEach(f => f(v)) }, subscribe: f => { subs.add(f); return () => subs.delete(f) } } }
export function useValue(a) { return useSyncExternalStore(a.subscribe, a.get) }
export const cn = (...a) => a.filter(Boolean).join(' ')
export const haptic = () => {}
export const pluginSettingsHref = id => '/settings?plugin=' + id
const el = tag => ({ children, onCheckedChange, checked, variant, ...p }) => tag === 'switch'
  ? createElement('input', { type: 'checkbox', checked: !!checked, onChange: e => onCheckedChange?.(e.target.checked), 'data-switch': '1' })
  : createElement(tag, p, children)
export const Button = el('button'), Input = el('input'), Textarea = el('textarea'), Switch = el('switch')
export const Tip = ({ children }) => children
export const host = globalThis.__host
`)

const sessions = [{ id: 's1', title: 'First chat', message_count: 3 }, { id: 's2', title: '', preview: 'preview two', message_count: 1 }, { id: 's3', title: 'empty', message_count: 0 }]
let requests = 0
const model = (() => { let v = 'anthropic/claude-opus'; const subs = new Set(); return { get: () => v, set: n => { v = n; subs.forEach(f => f(v)) }, subscribe: f => { subs.add(f); f(v); return () => subs.delete(f) } } })()
const makeAtom = v => { const subs = new Set(); return { get: () => v, set: n => { v = n; subs.forEach(f => f(v)) }, subscribe: f => { subs.add(f); f(v); return () => subs.delete(f) } } }
const profile = makeAtom('default')
let roster = []
globalThis.__host = {
  state: { model, profile },
  request: async method => { requests++; return method === 'profiles.list' ? { profiles: roster } : { sessions } },
  notify: () => {},
  navigate: () => {},
  settings: { set: () => {} },
  composer: { setDraft: async () => true, focus: () => {} },
  openSession: async () => {}
}

const code = readFileSync(join(repoRoot, 'plugin.js'), 'utf8')
  .replace("'@hermes/plugin-sdk'", `'${url('sdk.mjs')}'`)
  .replace("from 'react'", `from '${url('react.mjs')}'`)
  .replace("from 'react/jsx-runtime'", `from '${url('jsx.mjs')}'`)
writeFileSync(join(work, 'plugin.mjs'), code)

const tick = (ms = 80) => new Promise(r => setTimeout(r, ms))
// Same key scheme as the Hermes host: hermes.plugin.<id>.<key>, JSON values in localStorage.
const scoped = (id, k) => `hermes.plugin.${id}.${k}`
const pluginStorage = id => ({
  get: (k, d) => { const raw = w.localStorage.getItem(scoped(id, k)); if (raw === null) return d; try { return JSON.parse(raw) } catch { return d } },
  set: (k, v) => w.localStorage.setItem(scoped(id, k), JSON.stringify(v)),
  remove: k => w.localStorage.removeItem(scoped(id, k))
})
const storage = pluginStorage('splash-studio')
const regs = []
let disposeFn = null
const ctx = {
  storage,
  register: r => regs.push(r),
  registerSettingsPage: r => regs.push({ ...r, area: 'settings' }),
  onDispose: f => { disposeFn = f }
}

// Settings saved under the pre-release id should carry over once.
w.localStorage.setItem(scoped('stagehand', 'prefs'), JSON.stringify({ strength: 50 }))

function mountIntro() {
  const bounds = document.createElement('div')
  bounds.setAttribute('data-slot', 'composer-bounds')
  bounds.innerHTML = `<div data-slot="aui_intro"><div><p aria-label="HERMES AGENT" class="wordmark fit-text"><span><span>HERMES AGENT</span></span><span aria-hidden="true">HERMES AGENT</span></p><p>tagline</p></div></div>`
  document.body.append(bounds)
  return bounds
}

const results = []
async function test(name, fn) {
  try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name, e.message]); process.exitCode = 1 }
}

const plugin = (await import(url('plugin.mjs'))).default
const bounds = mountIntro()
plugin.register(ctx)
await tick(150)

await test('settings from the pre-release id carry over once', async () => {
  assert.equal(storage.get('prefs').strength, 50)
  assert.equal(w.localStorage.getItem(scoped('stagehand', 'prefs')), null)
})

await test('stage mounts on new-chat screen', async () => {
  assert.ok(bounds.querySelector('.sh-art'), 'art missing')
  assert.ok(bounds.querySelector('.sh-widgets > .sh-grid'), 'widget grid missing')
  assert.ok(document.getElementById('splash-studio-css'))
})

await test('recents exclude empty chats, show preview fallback', async () => {
  const btns = [...bounds.querySelectorAll('.sh-recents .sh-btn')].map(b => b.textContent)
  assert.deepEqual(btns, ['First chat', 'preview two'])
})

await test('prompts card shows default prompts', async () => {
  assert.equal(bounds.querySelectorAll('.sh-prompts .sh-btn').length, 3)
})

await test('streaming mutations elsewhere do not resync', async () => {
  const thread = document.createElement('div')
  document.body.append(thread)
  let qsa = 0
  const orig = document.querySelectorAll.bind(document)
  document.querySelectorAll = sel => { qsa++; return orig(sel) }
  for (let i = 0; i < 300; i++) { const s = document.createElement('span'); s.textContent = 'tok' + i; thread.append(s); if (i % 30 === 0) await tick(5) }
  await tick(120)
  document.querySelectorAll = orig
  assert.equal(qsa, 0, `syncStages ran ${qsa} times during streaming`)
})

const settings = regs.find(r => r.area === 'settings')
const { createRoot } = require('react-dom/client')
const { act } = require('react')
const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)

await test('settings panel renders without errors', async () => {
  await act(async () => { root.render(settings.render()) })
  assert.ok(host.textContent.includes('Show on new chats'))
  assert.ok(host.textContent.includes('Make the new-chat screen your own.'), 'settings intro missing')
  assert.match(plugin.description, /new-chat screen/, 'plugin description missing')
})

await test('URL field does not apply while typing, applies on Enter (https only)', async () => {
  const input = [...host.querySelectorAll('input')].find(i => (i.placeholder || '').startsWith('https://'))
  assert.ok(input, 'url input missing')
  const setVal = v => { const d = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value'); d.set.call(input, v); input.dispatchEvent(new w.Event('input', { bubbles: true })) }
  await act(async () => { setVal('https://ex') })
  assert.equal(JSON.parse(JSON.stringify(storage.get('prefs') || {})).customUrl || '', '', 'applied mid-typing')
  await act(async () => { setVal('http://example.com/a.png') })
  await act(async () => { input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  assert.equal(storage.get('prefs')?.customUrl || '', '', 'http accepted')
  assert.ok(host.textContent.includes('Use an https:// image address.'))
  await act(async () => { setVal('https://example.com/a.png') })
  await act(async () => { input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  assert.equal(storage.get('prefs').customUrl, 'https://example.com/a.png')
  assert.equal(storage.get('prefs').imagery, 'custom')
})

await test('prompt editing keeps trailing spaces and caps at three', async () => {
  const ta = host.querySelector('textarea')
  const d = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value')
  await act(async () => { d.set.call(ta, 'Plan the '); ta.dispatchEvent(new w.Event('input', { bubbles: true })) })
  assert.equal(storage.get('prefs').prompts[0], 'Plan the ')
  await act(async () => { d.set.call(ta, 'a\nb\nc\nd'); ta.dispatchEvent(new w.Event('input', { bubbles: true })) })
  assert.deepEqual(storage.get('prefs').prompts, ['a', 'b', 'c', 'd'], 'edit buffer must not drop lines')
  await tick(120)
  assert.deepEqual([...document.querySelectorAll('.sh-prompts .sh-btn')].map(b => b.textContent), ['a', 'b', 'c'])
})

await test('model card updates when the model changes', async () => {
  model.set('openai/gpt-new')
  await tick(120)
  assert.ok(document.querySelector('.sh-meta').textContent.includes('gpt-new'))
})

await test('custom font name cannot break out of the rule', async () => {
  const famBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Custom')
  await act(async () => { famBtn.click() })
  const fi = [...host.querySelectorAll('input')].find(i => (i.placeholder || '').startsWith('Any installed font'))
  const d = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')
  await act(async () => { d.set.call(fi, 'Avenir /* "x"; } body { display:none } url(evil)'); fi.dispatchEvent(new w.Event('input', { bubbles: true })) })
  await tick(120)
  const css = document.getElementById('splash-studio-title-css').textContent
  assert.ok(!/[{}]/.test(css.split('{')[1].split('}')[0]), 'brace inside rule: ' + css)
  assert.ok(!css.includes('/*') && !css.includes('url('), css)
  const sheet = new w.CSSStyleSheet(); sheet.replaceSync ? sheet.replaceSync(css) : null
  await act(async () => { d.set.call(fi, ''); fi.dispatchEvent(new w.Event('input', { bubbles: true })) })
  const stock = [...host.querySelectorAll('button')].find(b => b.textContent === 'Stock')
  await act(async () => { stock.click() })
})

await test('title text rewrite hits visible text and width twin, restores on clear', async () => {
  const titleInput = [...host.querySelectorAll('input')].find(i => (i.placeholder || '').startsWith('Title text'))
  const d = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')
  await act(async () => { d.set.call(titleInput, 'BEYOND GOOD'); titleInput.dispatchEvent(new w.Event('input', { bubbles: true })) })
  await tick(120)
  const mark = bounds.querySelector('.wordmark')
  assert.equal(mark.textContent, 'BEYOND GOODBEYOND GOOD')
  assert.equal(mark.getAttribute('aria-label'), 'BEYOND GOOD')
  await act(async () => { d.set.call(titleInput, ''); titleInput.dispatchEvent(new w.Event('input', { bubbles: true })) })
  await tick(120)
  assert.equal(mark.textContent, 'HERMES AGENTHERMES AGENT')
  assert.equal(mark.getAttribute('aria-label'), 'HERMES AGENT')
})

const setInput = async (placeholderStart, value) => {
  const input = [...host.querySelectorAll('input')].find(i => (i.placeholder || '').startsWith(placeholderStart))
  assert.ok(input, `input "${placeholderStart}" missing`)
  const d = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')
  await act(async () => { d.set.call(input, value); input.dispatchEvent(new w.Event('input', { bubbles: true })) })
  await tick(120)
}

await test('blank title shows the profile display name; unnamed default keeps stock', async () => {
  const mark = () => bounds.querySelector('.wordmark')
  assert.equal(mark().textContent, 'HERMES AGENTHERMES AGENT', 'unnamed default should stay stock')
  roster = [{ name: 'default', is_default: true, display_name: 'devin' }, { name: 'work', display_name: '' }]
  profile.set('default')
  await tick(150)
  assert.equal(mark().textContent, 'DEVINDEVIN')
  assert.equal(mark().getAttribute('aria-label'), 'DEVIN')
  assert.ok(document.querySelector('.sh-meta').textContent.includes('devin'), 'side card should use display name')
  profile.set('work')
  await tick(150)
  assert.equal(mark().textContent, 'WORKWORK', 'falls back to the profile name')
  await setInput('Title text', 'Mine')
  assert.equal(mark().textContent, 'MineMine', 'typed title wins')
  await setInput('Title text', '')
  const toggle = [...host.querySelectorAll('label')].find(l => l.textContent.includes('show the profile name')).querySelector('input')
  await act(async () => { toggle.click() })
  await tick(120)
  assert.equal(mark().textContent, 'HERMES AGENTHERMES AGENT', 'toggle off restores stock')
  await act(async () => { toggle.click() })
  profile.set('default')
  await tick(150)
  assert.equal(storage.get('profileNames').default, 'devin', 'names remembered for next launch')
})

await test('line underneath can be rewritten, survives the app changing it, and restores', async () => {
  const line = () => bounds.querySelector('[data-slot="aui_intro"] p:last-child')
  await setInput('Line underneath', 'Ready when you are.')
  assert.equal(line().textContent, 'Ready when you are.')
  assert.equal(bounds.querySelector('.wordmark').textContent, 'DEVINDEVIN', 'title untouched')
  // The app swaps its own line (e.g. a locale change) while ours is active.
  line().firstChild.nodeValue = 'app line two'
  await tick(150)
  assert.equal(line().textContent, 'Ready when you are.', 'custom line re-applied')
  await setInput('Line underneath', '')
  assert.equal(line().textContent, 'app line two', "restores the app's latest line")
})

await test('turning off removes stage AND title changes', async () => {
  const titleInput = [...host.querySelectorAll('input')].find(i => (i.placeholder || '').startsWith('Title text'))
  const d = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')
  await act(async () => { d.set.call(titleInput, 'CUSTOM'); titleInput.dispatchEvent(new w.Event('input', { bubbles: true })) })
  await tick(120)
  const toggle = regs.find(r => r.data?.id === 'splash-studio.toggle')
  toggle.data.run()
  await tick(120)
  assert.equal(bounds.querySelector('.sh-art'), null)
  assert.equal(bounds.querySelector('.wordmark').textContent, 'HERMES AGENTHERMES AGENT')
  assert.equal(document.getElementById('splash-studio-title-css'), null)
  assert.equal(document.documentElement.hasAttribute('data-splash-studio'), false)
  toggle.data.run()
  await tick(150)
  assert.ok(bounds.querySelector('.sh-art'))
  assert.equal(bounds.querySelector('.wordmark').getAttribute('aria-label'), 'CUSTOM')
})

await test('stage drops when the intro goes away (first message sent)', async () => {
  bounds.querySelector('[data-slot="aui_intro"]').remove()
  await tick(150)
  assert.equal(bounds.querySelector('.sh-art'), null)
  assert.equal(bounds.querySelector('.sh-widgets'), null)
})

await test('stage returns on a new new-chat screen', async () => {
  const b2 = mountIntro()
  await tick(150)
  assert.ok(b2.querySelector('.sh-art'))
})

await test('reset needs two clicks and restores defaults', async () => {
  await act(async () => { root.render(settings.render()) })
  const reset = () => [...host.querySelectorAll('button')].find(b => /reset/i.test(b.textContent) && !/^Reset$/.test(b.textContent))
  await act(async () => { reset().click() })
  assert.equal(storage.get('prefs').strength, 50, 'reset after one click')
  assert.equal(reset().textContent, 'Click again to reset')
  await act(async () => { reset().click() })
  assert.equal(storage.get('prefs').strength, 34)
  assert.deepEqual(storage.get('prefs').prompts.length, 3)
  assert.deepEqual(storage.get('prefs').title, { show: true, tagline: true, text: '', profileName: true, taglineText: '', family: 'stock', customFamily: '', size: 0, color: '', glow: false })
  const urlInput = [...host.querySelectorAll('input')].find(i => (i.placeholder || '').startsWith('https://'))
  assert.equal(urlInput.value, '')
  assert.ok(!host.textContent.includes('Use an https:// image address.'))
})

await test('dispose cleans everything', async () => {
  await act(async () => { root.unmount() })
  disposeFn()
  await tick(150)
  assert.equal(document.querySelector('.sh-art, .sh-widgets'), null)
  assert.equal(document.getElementById('splash-studio-css'), null)
  assert.equal(document.getElementById('splash-studio-title-css'), null)
  for (const m of document.querySelectorAll('.wordmark')) assert.ok(m.textContent.startsWith('HERMES AGENT'))
  const b3 = mountIntro()
  await tick(150)
  assert.equal(b3.querySelector('.sh-art'), null, 'stage came back after dispose')
})

// Migration edge cases, each with a fresh register() of the same module.
async function freshRegister(storageImpl) {
  regs.length = 0
  const c = { ...ctx, storage: storageImpl }
  let dispose = null
  c.onDispose = f => { dispose = f }
  plugin.register(c)
  await tick(60)
  dispose()
}
const tinyImage = 'data:image/png;base64,iVBORw0KGgo='

await test('migration: image-only moves and shows; unreadable old prefs do not block it', async () => {
  w.localStorage.clear()
  w.localStorage.setItem(scoped('stagehand', 'image'), JSON.stringify(tinyImage))
  w.localStorage.setItem(scoped('stagehand', 'prefs'), '{not json')
  await freshRegister(storage)
  assert.equal(storage.get('image'), tinyImage)
  assert.equal(w.localStorage.getItem(scoped('stagehand', 'image')), null)
  assert.equal(w.localStorage.getItem(scoped('stagehand', 'prefs')), null, 'unreadable prefs left behind')
})

await test('migration: image-only with no old prefs selects My image', async () => {
  w.localStorage.clear()
  w.localStorage.setItem(scoped('stagehand', 'image'), JSON.stringify(tinyImage))
  await freshRegister(storage)
  assert.equal(storage.get('prefs').imagery, 'custom')
})

await test('migration: a failed image write keeps the old copy and retries next start', async () => {
  w.localStorage.clear()
  w.localStorage.setItem(scoped('stagehand', 'image'), JSON.stringify(tinyImage))
  w.localStorage.setItem(scoped('stagehand', 'prefs'), JSON.stringify({ strength: 40 }))
  const full = { ...storage, set: (k, v) => { if (k !== 'image') storage.set(k, v) } }
  await freshRegister(full)
  assert.ok(w.localStorage.getItem(scoped('stagehand', 'image')), 'old image deleted after failed copy')
  assert.equal(storage.get('prefs').strength, 40)
  await freshRegister(storage)
  assert.equal(storage.get('image'), tinyImage, 'image not moved on retry')
  assert.equal(w.localStorage.getItem(scoped('stagehand', 'image')), null)
  assert.equal(storage.get('prefs').strength, 40)
})

for (const r of results) console.log(r.join(' | '))
rmSync(work, { recursive: true, force: true })
console.log(`\n${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`)
process.exit(process.exitCode || 0)
