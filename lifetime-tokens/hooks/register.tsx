import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { TokenTotals, WrappedCard } from '../types'
import { wrappedSvg } from './card'
import { fmt, hourLabel, money, shortModel, summarize, wrapped } from './stats'
import type { FileRecord, Kinds } from './stats'

export { fmt } from './stats'

// Lifetime token counter, API-price cost meter and Token Wrapped.
//
// Truth comes from Claude Code's own transcripts (~/.claude/projects): a
// scanner script totals every API response in them, per file. Totals are kept
// in the store per file, so transcripts Claude Code later cleans up still
// count. Turns that finish between scans are added live.

type ScanOutput = {
  perFile: Record<string, FileRecord>
  files: number
  bytes: number
  since: number | null
  scannedAt: number
}

const EMPTY: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, responses: 0, cost: 0 }
// Shape tags: a value an earlier version stored reads as the initial value.
const total = atom({ plugin: 'lifetime-tokens', key: 'total' } as const, EMPTY, { shape: 'total-2' })
const card = atom({ plugin: 'lifetime-tokens', key: 'wrapped' } as const, null as WrappedCard | null, { shape: 'wrapped-1' })

const PANE = 'token-wrapped'
const RESCAN_EVERY_MS = 30 * 60 * 1000
let scanning = false

const emptyLive = (): FileRecord => ({ i: 0, o: 0, cr: 0, cw: 0, cw5: 0, cw1: 0, n: 0, m: {} })

async function loadFiles($: EngineInterface): Promise<Record<string, FileRecord>> {
  const files = await $.store.get('files')
  return files && typeof files === 'object' ? (files as Record<string, FileRecord>) : {}
}

async function loadLive($: EngineInterface): Promise<FileRecord> {
  const live = (await $.store.get('live')) as FileRecord | undefined
  if (!live || typeof live !== 'object') return emptyLive()
  // Version 0.1 kept a number per model; those turns are rescanned anyway.
  if (Object.values(live.m ?? {}).some(v => typeof v === 'number')) return emptyLive()
  return live
}

async function compute($: EngineInterface) {
  const files = await loadFiles($)
  const live = await loadLive($)
  const summary = summarize([...Object.values(files), live])
  return { files, live, summary }
}

const allOf = (t: TokenTotals) => t.input + t.output + t.cacheRead + t.cacheWrite

async function publish($: EngineInterface) {
  const { summary: s } = await compute($)
  const totals: TokenTotals = {
    input: s.input,
    output: s.output,
    cacheRead: s.cacheRead,
    cacheWrite: s.cacheWrite,
    responses: s.responses,
    cost: s.cost,
  }
  await update($, total, () => totals)
  $.ui.status(allOf(totals) > 0 ? `🪙 ${fmt(allOf(totals))} lifetime tokens · 💸 ${money(totals.cost)}` : undefined)
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
  // Claude Code writes its prompt cache with the 1-hour lifetime.
  live.i += usage.input_tokens
  live.o += usage.output_tokens
  live.cr += usage.cache_read_input_tokens
  live.cw += usage.cache_creation_input_tokens
  live.cw1 = (live.cw1 ?? 0) + usage.cache_creation_input_tokens
  live.n += 1
  const prev = live.m[usage.model]
  const k: Kinds = typeof prev === 'object' ? prev : { i: 0, o: 0, cr: 0, cw5: 0, cw1: 0, n: 0 }
  k.i += usage.input_tokens
  k.o += usage.output_tokens
  k.cr += usage.cache_read_input_tokens
  k.cw1 += usage.cache_creation_input_tokens
  k.n += 1
  live.m[usage.model] = k
  await $.store.set('live', live)
  await publish($)
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)
const PLAN_NOTE =
  'Estimated at Anthropic API prices. On a Pro or Max plan you pay your subscription, not this.'

async function report($: EngineInterface): Promise<string> {
  const { summary: s } = await compute($)
  const all = s.input + s.output + s.cacheRead + s.cacheWrite
  if (all === 0) return 'No token usage counted yet. Run /tokens rescan to scan your transcripts.'
  const since = (await $.store.get('since')) as number | undefined
  const scannedAt = (await $.store.get('scannedAt')) as number | undefined
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const rows: [string, number][] = [
    ['Cache reads', s.cacheRead],
    ['Cache writes', s.cacheWrite],
    ['Output', s.output],
    ['Input (uncached)', s.input],
  ]
  // A code block keeps the columns lined up in the desktop app too.
  return [
    `🪙 LIFETIME TOKENS: ${fmt(all)} (${all.toLocaleString('en-US')})`,
    `💸 API value: ${money(s.cost)}`,
    '',
    '```',
    ...rows.map(([label, n]) => `  ${pad(label, 18)}${padL(fmt(n), 8)}   ${((n / all) * 100).toFixed(1)}%`),
    '',
    `  ${pad('API responses', 18)}${padL(s.responses.toLocaleString('en-US'), 8)}`,
    '',
    'By model:',
    ...s.byModel.map(m => `  ${pad(m.model, 28)}${padL(fmt(m.tokens), 8)}`),
    '```',
    '',
    `Counted since ${since ? day(since) : 'unknown'} (your oldest kept transcript)` +
      (scannedAt ? `, last scan ${new Date(scannedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''),
    'Fresh tokens (everything but cache reads): ' + fmt(all - s.cacheRead),
    'See what it would cost: /apicost · Your year in tokens: /wrapped',
  ].join('\n')
}

async function costReport($: EngineInterface): Promise<string> {
  const { summary: s } = await compute($)
  if (s.responses === 0) return 'No token usage counted yet. Run /tokens rescan first.'
  const lines = s.byModel.map(m => {
    const c = m.cost === undefined ? '   no price' : padL(money(m.cost), 11)
    return `  ${pad(shortModel(m.model), 24)}${padL(fmt(m.tokens), 8)}${c}`
  })
  return [
    `💸 YOUR CLAUDE CODE USAGE AT API PRICES: ${money(s.cost)}`,
    '',
    '```',
    `  ${pad('model', 24)}${padL('tokens', 8)}${padL('cost', 11)}`,
    ...lines,
    '```',
    s.unpricedTokens > 0 ? `${fmt(s.unpricedTokens)} tokens have no known price and aren't counted.` : '',
    PLAN_NOTE,
  ]
    .filter(Boolean)
    .join('\n')
}

async function buildWrapped($: EngineInterface): Promise<WrappedCard> {
  const { files, live, summary } = await compute($)
  const w = wrapped({ ...files, '__live__': live }, summary)
  const year = new Date(await $.clock.now()).getFullYear()
  const lines = [
    `🎁 YOUR ${year} TOKEN WRAPPED`,
    '',
    `🔥 You burned ${fmt(w.tokens)} tokens across ${w.sessions} sessions`,
    `💸 At API prices that's ${money(w.cost)}`,
    w.topModel ? `🏆 Top model: ${shortModel(w.topModel.model)} (${Math.round(w.topModel.share * 100)}% of your tokens)` : '',
    w.busiestDay ? `📅 Busiest day: ${w.busiestDay.day} with ${fmt(w.busiestDay.tokens)} tokens` : '',
    `⚡ Longest streak: ${w.longestStreak} days in a row (${w.activeDays} days active)`,
    w.peakHour !== null ? `🕒 Peak hour: ${hourLabel(w.peakHour)}` : '',
    w.topProject ? `📁 Top project: ${w.topProject.name} (${fmt(w.topProject.tokens)} tokens)` : '',
    `✨ You're a ${w.persona}`,
  ].filter(Boolean)
  return { svg: wrappedSvg(w, year), lines }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Show every token you have used in Claude Code',
      argumentHint: '[rescan|cost]',
    })
    await $.command.register({ name: 'apicost', description: 'What your Claude Code usage would cost at API prices' })
    await $.command.register({ name: 'wrapped', description: 'Your Token Wrapped: your year in tokens' })
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
    if (e.args.trim() === 'cost') return { text: await costReport($) }
    if (e.args.trim() === 'rescan') {
      const failed = await rescan($)
      if (failed) return { text: failed }
    }
    return { text: await report($) }
  })

  on('command.run', { command: 'apicost' }, async $ => ({ text: await costReport($) }))

  on('command.run', { command: 'wrapped' }, async $ => {
    const built = await buildWrapped($)
    await update($, card, () => built)
    const opened = await $.ui.open({ id: PANE, title: '🎁 Token Wrapped' })
    const tip = opened.isPlaced ? '\n\nThe card is open in the side pane: screenshot it and post it 📸' : ''
    return { text: built.lines.join('\n') + tip }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const c = await read($, card)
    if (e.surface === 'desktop' || e.surface === 'mobile') {
      const { Box, Svg, Text } = $.ui.resolve(e)
      if (!c) return <Text dimColor>Run /wrapped to build your card.</Text>
      return (
        <Box flexDirection="column" alignItems="center">
          <Svg source={c.svg} alt={c.lines.join('. ')} />
        </Box>
      )
    }
    const { Box, Text } = $.ui.resolve(e)
    if (!c) return <Text dimColor>Run /wrapped to build your card.</Text>
    return (
      <Box flexDirection="column">
        {c.lines.map(line => (
          <Text>{line}</Text>
        ))}
      </Box>
    )
  })

  // Desktop and terminal: a label in the prompt footer.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const t = await read($, total)
    const all = allOf(t)
    if (all === 0) return next(e)
    const label = t.cost > 0 ? `🪙 ${fmt(all)} tokens · 💸 ${money(t.cost)}` : `🪙 ${fmt(all)} tokens`
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
  })
}
