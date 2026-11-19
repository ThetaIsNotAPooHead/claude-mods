import { expect, mock, test } from 'claude-code/testing'

import { fmt } from '../hooks/register'
import { costOf, money, priceFor, summarize, wrapped } from '../hooks/stats'
import type { FileRecord } from '../hooks/stats'

test('formats big numbers and money', async () => {
  expect(fmt(999)).toBe('999')
  expect(fmt(1500)).toBe('1.50K')
  expect(fmt(13_918_904_946)).toBe('13.9B')
  expect(fmt(251_000_000)).toBe('251M')
  expect(money(0.28)).toBe('$0.28')
  expect(money(6471.9)).toBe('$6,472')
  expect(money(38_200)).toBe('$38.2k')
})

test('prices match models, date-suffixed ids included', async () => {
  expect(priceFor('claude-opus-5-5')?.cr).toBe(0.2)
  expect(priceFor('claude-haiku-4-5-20251001')?.i).toBe(1)
  expect(priceFor('claude-opus-5')?.i).toBe(5) // not opus-5-5
  expect(priceFor('some-other-model')).toBeUndefined()
  // 1M cache reads + 1M output on Opus 5.5 = $0.20 + $20
  expect(costOf('claude-opus-5-5', { i: 0, o: 1e6, cr: 1e6, cw5: 0, cw1: 0, n: 1 })).toBe(20.2)
})

const turn = {
  turnId: 't1',
  reason: 'answer',
  answer: 'hi',
  durationMs: 10,
  isAborted: false,
  usage: {
    model: 'claude-opus-5-5',
    input_tokens: 100,
    output_tokens: 2000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 5000,
  },
} as never

function engine(on: Parameters<Parameters<typeof test>[1]>[1]) {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-11-19T15:00:00Z') })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'done' }))
  on('command.run', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

test('a finished turn adds to the total, /tokens and /cost report it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(turn)

  const tokens = await $.command.run({ command: 'tokens', args: '' } as never)
  expect(tokens.text).toContain('LIFETIME TOKENS: 1.01M')
  expect(tokens.text).toContain('claude-opus-5-5')
  // 100*4 + 2000*20 + 1M*0.2 + 5000*8 (1-hour cache write) = $0.2804
  expect(tokens.text).toContain('API value: $0.28')

  const cost = await $.command.run({ command: 'apicost', args: '' } as never)
  expect(cost.text).toContain('AT API PRICES: $0.28')
  expect(cost.text).toContain('opus-5-5')
})

test('/wrapped builds the card and the pane draws it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(turn)
  const r = await $.command.run({ command: 'wrapped', args: '' } as never)
  expect(r.text).toContain('TOKEN WRAPPED')
  expect(r.text).toContain('Top model: opus-5-5')

  const PANE = {
    plugin: 'lifetime-tokens',
    component: 'Pane',
    requestId: 'token-wrapped',
    props: { title: 'x', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect(await desk.find({ type: 'Svg' } as never)).toBeDefined()
  await desk.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  expect((await term.find({ type: 'Text', text: /burned/ }))?.text).toContain('1.01M')
  await term.unmount()
})

test('wrapped stats: streaks, busiest day, persona', async () => {
  const rec = (d: Record<string, number>, h: number): FileRecord => ({
    i: 0, o: 0, cr: Object.values(d).reduce((a, b) => a + b, 0), cw: 0, n: 1,
    m: { 'claude-opus-5-5': { i: 0, o: 0, cr: Object.values(d).reduce((a, b) => a + b, 0), cw5: 0, cw1: 0, n: 1 } },
    d, h: Array.from({ length: 24 }, (_, i) => (i === h ? 5 : 0)), project: 'game',
  })
  const files = {
    'a/1.jsonl': rec({ '2026-11-01': 10, '2026-11-02': 50, '2026-11-03': 5 }, 23),
    'a/2.jsonl': rec({ '2026-11-10': 7 }, 23),
    'a/2/subagents/x.jsonl': rec({ '2026-11-10': 1 }, 2),
  }
  const w = wrapped(files, summarize(Object.values(files)))
  expect(w.longestStreak).toBe(3)
  expect(w.activeDays).toBe(4)
  expect(w.busiestDay?.day).toBe('2026-11-02')
  expect(w.sessions).toBe(2)
  expect(w.peakHour).toBe(23)
  expect(w.persona).toContain('Night Owl')
  expect(w.topProject?.name).toBe('game')
})
