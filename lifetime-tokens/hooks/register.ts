import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { TokenTotals } from '../types'

// Lifetime token counter.
//
// Truth comes from Claude Code's own transcripts (~/.claude/projects): a
// scanner script totals every API response in them, per file. Totals are kept
// in the store per file, so transcripts Claude Code later cleans up still
// count. Turns that finish between scans are added live.

type FileTotals = { i: number; o: number; cr: number; cw: number; n: number; m: Record<string, number> }
type ScanOutput = {
  perFile: Record<string, FileTotals>
  files: number
  bytes: number
  since: number | null
  scannedAt: number
}
type Live = FileTotals

const EMPTY: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, responses: 0 }
const total = atom({ plugin: 'lifetime-tokens', key: 'total' } as const, EMPTY)

const RESCAN_EVERY_MS = 30 * 60 * 1000
let scanning = false

const emptyLive = (): Live => ({ i: 0, o: 0, cr: 0, cw: 0, n: 0, m: {} })

async function loadFiles($: EngineInterface): Promise<Record<string, FileTotals>> {
  const files = await $.store.get('files')
  return files && typeof files === 'object' ? (files as Record<string, FileTotals>) : {}
}

async function loadLive($: EngineInterface): Promise<Live> {
  const live = await $.store.get('live')
  return live && typeof live === 'object' ? (live as Live) : emptyLive()
}

function sum(parts: FileTotals[]) {
  const t = { ...EMPTY }
  const byModel: Record<string, number> = {}
  for (const p of parts) {
    t.input += p.i
    t.output += p.o
    t.cacheRead += p.cr
    t.cacheWrite += p.cw
    t.responses += p.n
    for (const [model, n] of Object.entries(p.m ?? {})) byModel[model] = (byModel[model] ?? 0) + n
  }
  return { totals: t, byModel }
}

async function compute($: EngineInterface) {
  const files = await loadFiles($)
  const live = await loadLive($)
  return sum([...Object.values(files), live])
}

export function fmt(n: number): string {
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [size, unit] of units) {
    if (n >= size) return `${(n / size).toFixed(n >= size * 100 ? 0 : n >= size * 10 ? 1 : 2)}${unit}`
  }
  return String(n)
}

const allOf = (t: TokenTotals) => t.input + t.output + t.cacheRead + t.cacheWrite

async function publish($: EngineInterface) {
  const { totals } = await compute($)
  await update($, total, () => totals)
  $.ui.status(allOf(totals) > 0 ? `🪙 ${fmt(allOf(totals))} lifetime tokens` : undefined)
}

async function rescan($: EngineInterface): Promise<string | undefined> {
  if (scanning) return 'A scan is already running.'
  scanning = true
  try {
    const script = `${$.plugin.root}/scripts/scan.mjs`
    const ran = await $.process.run(['node', script], { timeoutMs: 5 * 60 * 1000 })
    if (ran.exitCode !== 0) return `Scan failed (exit ${ran.exitCode}): ${ran.stderr.slice(0, 300)}`
    const out = JSON.parse(ran.stdout) as ScanOutput
    // Keep files that no longer exist (cleaned-up transcripts); replace the rest.
    const files = { ...(await loadFiles($)), ...out.perFile }
    await $.store.set('files', files)
    await $.store.set('live', emptyLive())
    const firstSince = (await $.store.get('since')) as number | undefined
    if (out.since !== null && (firstSince === undefined || out.since < firstSince)) {
      await $.store.set('since', out.since)
    }
    await $.store.set('scannedAt', out.scannedAt)
    await publish($)
    return undefined
  } catch (err) {
    return `Scan failed: ${String(err).slice(0, 300)}`
  } finally {
    scanning = false
  }
}

async function addLive($: EngineInterface, usage: TurnUsage) {
  const live = await loadLive($)
  live.i += usage.input_tokens
  live.o += usage.output_tokens
  live.cr += usage.cache_read_input_tokens
  live.cw += usage.cache_creation_input_tokens
  live.n += 1
  const turnTotal =
    usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  live.m[usage.model] = (live.m[usage.model] ?? 0) + turnTotal
  await $.store.set('live', live)
  await publish($)
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)

async function report($: EngineInterface): Promise<string> {
  const { totals, byModel } = await compute($)
  const all = allOf(totals)
  if (all === 0) return 'No token usage counted yet. Run /tokens rescan to scan your transcripts.'
  const since = (await $.store.get('since')) as number | undefined
  const scannedAt = (await $.store.get('scannedAt')) as number | undefined
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

  const rows: [string, number][] = [
    ['Cache reads', totals.cacheRead],
    ['Cache writes', totals.cacheWrite],
    ['Output', totals.output],
    ['Input (uncached)', totals.input],
  ]
  const models = Object.entries(byModel).sort((a, b) => b[1] - a[1])

  // A code block keeps the columns lined up in the desktop app too.
  return [
    `🪙 LIFETIME TOKENS: ${fmt(all)} (${all.toLocaleString('en-US')})`,
    '',
    '```',
    ...rows.map(([label, n]) => `  ${pad(label, 18)}${padL(fmt(n), 8)}   ${((n / all) * 100).toFixed(1)}%`),
    '',
    `  ${pad('API responses', 18)}${padL(totals.responses.toLocaleString('en-US'), 8)}`,
    '',
    'By model:',
    ...models.map(([model, n]) => `  ${pad(model, 28)}${padL(fmt(n), 8)}`),
    '```',
    '',
    `Counted since ${since ? day(since) : 'unknown'} (your oldest kept transcript)` +
      (scannedAt ? `, last scan ${new Date(scannedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''),
    'Fresh tokens (everything but cache reads): ' + fmt(all - totals.cacheRead),
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Show every token you have used in Claude Code',
      argumentHint: '[rescan]',
    })
    await publish($)
    $.clock.after(3000, () => {
      void rescan($)
    })
    $.clock.every(RESCAN_EVERY_MS, () => {
      void rescan($)
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.usage) await addLive($, e.usage)
    return result
  })

  on('command.run', { command: 'tokens' }, async ($, e) => {
    if (e.args.trim() === 'rescan') {
      const failed = await rescan($)
      if (failed) return { text: failed }
    }
    return { text: await report($) }
  })

  // Desktop and terminal: a label in the prompt footer.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const t = await read($, total)
    const all = allOf(t)
    if (all === 0) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, `🪙 ${fmt(all)} tokens`] } })
  })
}
