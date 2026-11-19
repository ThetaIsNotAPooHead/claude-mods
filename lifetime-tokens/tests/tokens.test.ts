import { expect, mock, test } from 'claude-code/testing'

import { fmt } from '../hooks/register'

test('formats big numbers', async () => {
  expect(fmt(999)).toBe('999')
  expect(fmt(1500)).toBe('1.50K')
  expect(fmt(13_918_904_946)).toBe('13.9B')
  expect(fmt(251_000_000)).toBe('251M')
})

test('a finished turn adds to the lifetime total and /tokens reports it', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'done' }))
  on('command.run', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({
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
  } as never)

  const { text } = await $.command.run({ command: 'tokens', args: '' } as never)
  expect(text).toContain('LIFETIME TOKENS: 1.01M')
  expect(text).toContain('claude-opus-5-5')
})
