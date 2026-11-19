import { expect, mock, test } from 'claude-code/testing'

import { label, until } from '../hooks/register'

test('countdown and label', async () => {
  const now = Date.parse('2026-11-19T12:00:00Z')
  expect(until('2026-11-19T12:30:00Z', now)).toBe('30m')
  expect(until('2026-11-19T15:10:00Z', now)).toBe('3h 10m')
  expect(until('2026-11-23T07:00:00Z', now)).toBe('3d 19h')
  expect(label({ kind: 'seven_day', percentUsed: 93.2, resetsAt: '2026-11-23T07:00:00Z' }, now)).toBe('🔴 week 93% · resets 3d 19h')
  expect(label({ kind: 'five_hour', percentUsed: 12 }, now)).toBe('🟢 5h 12%')
})

test('/limits lists the windows the engine reports', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-11-19T12:00:00Z') })
  on('command.register', () => ({ value: { command: 'limits' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {},
      rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: '2026-11-19T14:00:00Z' }],
    },
  }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const { text } = await $.command.run({ command: 'limits', args: '' } as never)
  expect(text).toContain('🟢 5h 40% · resets 2h 0m')
})