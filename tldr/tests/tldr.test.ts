import { expect, test } from 'claude-code/testing'

const turn = (answer: string) =>
  ({ turnId: 't', reason: 'answer', answer, durationMs: 1, isAborted: false }) as never

test('a long answer gets a simple TL;DR line', async ($, on) => {
  on('turn.complete', () => ({ text: '' }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: 'TL;DR: Claude fixed the bug and the tests pass now.', usage: {} },
  }) as never)
  const r = await $.turn.complete(turn('x'.repeat(2000)))
  expect(r.text).toBe('💡 TL;DR: Claude fixed the bug and the tests pass now.')
})

test('a short answer is left alone', async ($, on) => {
  let asked = false
  on('turn.complete', () => ({ text: '' }))
  on('model.complete', () => {
    asked = true
    return { value: { isAnswered: true, text: 'nope', usage: {} } } as never
  })
  const r = await $.turn.complete(turn('short'))
  expect(asked).toBe(false)
  expect(r.text).toBe('')
})