import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LimitWindow } from '../types'

// Shows your plan's rate-limit windows (5-hour and weekly) in the prompt
// footer, with how long until each resets. /limits prints the details.

const windows = atom({ plugin: 'usage-limits', key: 'windows' } as const, [] as LimitWindow[])

const NAMES: Record<string, string> = { five_hour: '5h', seven_day: 'week', spend_limit: 'spend' }

export function until(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function label(w: LimitWindow, now: number): string {
  const name = NAMES[w.kind] ?? w.kind
  const left = until(w.resetsAt, now)
  const icon = w.percentUsed >= 90 ? '🔴' : w.percentUsed >= 70 ? '🟡' : '🟢'
  return `${icon} ${name} ${Math.round(w.percentUsed)}%${left ? ` · resets ${left}` : ''}`
}

async function refresh($: EngineInterface) {
  const usage = await $.session.usage()
  const list = usage.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
  await update($, windows, () => list)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'limits', description: 'Show your usage limits and when they reset' })
    void refresh($)
    // Keep the countdown fresh.
    $.clock.every(60_000, () => {
      $.ui.invalidate('ui.render')
    })
    return next(e)
  })

  // The engine pushes new figures after each turn and when a window moves.
  on('session.measure', async ($, e, next) => {
    const list = e.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
    await update($, windows, () => list)
    return next(e)
  })

  on('command.run', { command: 'limits' }, async $ => {
    await refresh($)
    const list = await read($, windows)
    if (list.length === 0) return { text: 'No usage limits reported yet (they show up after your first reply on a Claude plan).' }
    const now = await $.clock.now()
    const lines = list.map(w => {
      const at = w.resetsAt ? ` (${new Date(w.resetsAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })})` : ''
      return `${label(w, now)}${at}`
    })
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const list = await read($, windows)
    if (list.length === 0) return next(e)
    const now = await $.clock.now()
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, ...list.map(w => label(w, now))] } })
  })
}