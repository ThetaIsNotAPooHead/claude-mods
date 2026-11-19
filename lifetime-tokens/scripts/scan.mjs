// Totals the token usage recorded in every Claude Code transcript under
// <home>/.claude/projects (subagent transcripts included) and prints one JSON
// object. Each API response is counted once: Claude Code writes one line per
// content block, all carrying the same message id and usage.
//
// Usage: node scan.mjs [projectsDir]
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { createInterface } from 'node:readline'

const root = process.argv[2] ?? join(homedir(), '.claude', 'projects')

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield full
  }
}

const byMessage = new Map() // id -> { file, model, input, output, cacheRead, cacheWrite }
let files = 0
let bytes = 0
let oldest = Infinity

for await (const file of walk(root)) {
  files += 1
  try {
    const info = await stat(file)
    bytes += info.size
    oldest = Math.min(oldest, info.birthtimeMs || info.mtimeMs)
  } catch {}
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) {
    // Cheap filter before parsing: only assistant responses carry usage.
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const message = row?.message
    const usage = message?.usage
    if (row.type !== 'assistant' || !usage || !message.id) continue
    if (message.model === '<synthetic>') continue
    // A resumed or forked session copies earlier responses: keep the first
    // file a response was seen in, so it is counted once.
    const seen = byMessage.get(message.id)
    byMessage.set(message.id, {
      file: seen?.file ?? relative(root, file).replaceAll('\\', '/'),
      model: message.model ?? 'unknown',
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
    })
  }
}

// Per file, so a caller can keep the totals of transcripts that are later
// cleaned up: { [file]: { i, o, cr, cw, n, m: { [model]: tokens } } }
const perFile = {}
for (const one of byMessage.values()) {
  const f = (perFile[one.file] ??= { i: 0, o: 0, cr: 0, cw: 0, n: 0, m: {} })
  f.i += one.input
  f.o += one.output
  f.cr += one.cacheRead
  f.cw += one.cacheWrite
  f.n += 1
  f.m[one.model] = (f.m[one.model] ?? 0) + one.input + one.output + one.cacheRead + one.cacheWrite
}

process.stdout.write(
  JSON.stringify({
    perFile,
    files,
    bytes,
    since: Number.isFinite(oldest) ? oldest : null,
    scannedAt: Date.now(),
  }),
)
