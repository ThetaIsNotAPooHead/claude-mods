// Totals the token usage recorded in every Claude Code transcript under
// <home>/.claude/projects (subagent transcripts included) and prints one JSON
// object. Each API response is counted once: Claude Code writes one line per
// content block, all carrying the same message id and usage.
//
// Per file it reports token types per model (so cost can be priced per
// model), cache writes split into 5-minute and 1-hour, tokens per local day,
// responses per local hour, the first and last response time and the
// project folder name, for /wrapped.
//
// Usage: node scan.mjs [projectsDir]
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, relative } from 'node:path'
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

const localDay = ms => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const byMessage = new Map()
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
    const cw = usage.cache_creation_input_tokens ?? 0
    const cw1 = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
    const at = Date.parse(row.timestamp ?? '')
    // A resumed or forked session copies earlier responses: keep the first
    // file a response was seen in, so it is counted once.
    const seen = byMessage.get(message.id)
    byMessage.set(message.id, {
      file: seen?.file ?? relative(root, file).replaceAll('\\', '/'),
      project: seen?.project ?? (row.cwd ? basename(row.cwd) : null),
      at: seen?.at ?? (Number.isFinite(at) ? at : null),
      model: message.model ?? 'unknown',
      i: usage.input_tokens ?? 0,
      o: usage.output_tokens ?? 0,
      cr: usage.cache_read_input_tokens ?? 0,
      cw1: Math.min(cw1, cw),
      cw5: cw - Math.min(cw1, cw),
    })
  }
}

const perFile = {}
for (const r of byMessage.values()) {
  const f = (perFile[r.file] ??= {
    i: 0, o: 0, cr: 0, cw: 0, cw5: 0, cw1: 0, n: 0,
    m: {}, d: {}, h: Array(24).fill(0), first: null, last: null, project: null,
  })
  const all = r.i + r.o + r.cr + r.cw5 + r.cw1
  f.i += r.i
  f.o += r.o
  f.cr += r.cr
  f.cw5 += r.cw5
  f.cw1 += r.cw1
  f.cw += r.cw5 + r.cw1
  f.n += 1
  const m = (f.m[r.model] ??= { i: 0, o: 0, cr: 0, cw5: 0, cw1: 0, n: 0 })
  m.i += r.i
  m.o += r.o
  m.cr += r.cr
  m.cw5 += r.cw5
  m.cw1 += r.cw1
  m.n += 1
  if (r.at !== null) {
    const day = localDay(r.at)
    f.d[day] = (f.d[day] ?? 0) + all
    f.h[new Date(r.at).getHours()] += 1
    f.first = f.first === null ? r.at : Math.min(f.first, r.at)
    f.last = f.last === null ? r.at : Math.max(f.last, r.at)
  }
  if (!f.project && r.project) f.project = r.project
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
