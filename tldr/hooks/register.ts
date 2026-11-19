import type { Register } from 'claude-code'

// Under every long answer, one dead-simple line saying what happened,
// written by Haiku so it costs very little.

const MIN_LENGTH = 700 // characters; short answers don't need a TL;DR

export const SYSTEM =
  'You write a TL;DR for a message. Use plain, simple words a 10 year old understands. ' +
  'One sentence, at most 15 words. No jargon, no file paths, no code, no emojis, no quotes. ' +
  'Reply with the sentence only.'

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Main conversation only, real answers only, long ones only.
    if (e.agentId || e.reason !== 'answer' || e.answer.length < MIN_LENGTH) return result

    const r = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: e.answer.slice(0, 12000),
      maxTokens: 60,
      effort: 'low',
      timeoutMs: 15_000,
    })
    if (!r.isAnswered) return result
    const line = r.text.trim().replace(/^tl;?dr:?\s*/i, '').split('\n')[0]?.trim()
    if (!line) return result
    return { ...result, text: `💡 TL;DR: ${line}` }
  })
}