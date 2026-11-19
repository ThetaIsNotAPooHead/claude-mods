import type { EngineInterface, Register } from 'claude-code'

// Under every long answer, one dead-simple line saying what happened,
// written by Haiku so it costs very little. /tldr does it on demand for
// Claude's last answer, whatever its length.

const MIN_LENGTH = 700 // characters; short answers don't need a TL;DR

export const SYSTEM =
  'You write a TL;DR for a message. Use plain, simple words a 10 year old understands. ' +
  'One sentence, at most 15 words. No jargon, no file paths, no code, no emojis, no quotes. ' +
  'Reply with the sentence only.'

async function summarize($: EngineInterface, text: string): Promise<string | undefined> {
  const r = await $.model.complete({
    model: 'haiku',
    system: SYSTEM,
    prompt: text.slice(0, 12000),
    maxTokens: 60,
    effort: 'low',
    timeoutMs: 15_000,
  })
  if (!r.isAnswered) return undefined
  const line = r.text.trim().replace(/^tl;?dr:?\s*/i, '').split('\n')[0]?.trim()
  return line ? `💡 TL;DR: ${line}` : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tldr', description: "Sum up Claude's last answer in one simple line" })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Main conversation only, real answers only, long ones only.
    if (e.agentId || e.reason !== 'answer' || e.answer.length < MIN_LENGTH) return result
    const line = await summarize($, e.answer)
    return line ? { ...result, text: line } : result
  })

  on('command.run', { command: 'tldr' }, async $ => {
    const messages = await $.session.messages()
    if ('deny' in messages) return { text: "Couldn't read this conversation." }
    const last = [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim() !== '')
    if (!last) return { text: 'Nothing to sum up yet.' }
    const line = await summarize($, last.text)
    return { text: line ?? "Couldn't make a TL;DR right now, try again in a sec." }
  })
}
