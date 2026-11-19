// Pure functions: totals, API-price cost estimates and Wrapped stats from the
// per-file records the scanner produces. No `$` here, so tests can call them.

export type Kinds = { i: number; o: number; cr: number; cw5: number; cw1: number; n: number }
export type FileRecord = {
  i: number
  o: number
  cr: number
  cw: number
  cw5?: number
  cw1?: number
  n: number
  // New shape: per-model kinds. Records saved by version 0.1 hold a number.
  m: Record<string, Kinds | number>
  d?: Record<string, number>
  h?: number[]
  first?: number | null
  last?: number | null
  project?: string | null
}

// First-party API prices, USD per million tokens (Anthropic's published rates,
// Nov 2026). cw5 = 5-minute cache write, cw1 = 1-hour cache write.
type Price = { i: number; o: number; cw5: number; cw1: number; cr: number }
const p = (i: number, o: number, cr: number, cw5 = i * 1.25, cw1 = i * 2): Price => ({ i, o, cr, cw5, cw1 })
export const PRICES: Record<string, Price> = {
  'claude-fable-5-2': p(8, 40, 0.2, 10, 16),
  'claude-fable-5-1': p(10, 50, 0.25),
  'claude-fable-5': p(10, 50, 1),
  'claude-opus-5-5': p(4, 20, 0.2, 5, 8),
  'claude-opus-5': p(5, 25, 0.5),
  'claude-opus-4-8': p(5, 25, 0.5),
  'claude-opus-4-7': p(5, 25, 0.5),
  'claude-opus-4-6': p(5, 25, 0.5),
  'claude-sonnet-5-5': p(2, 10, 0.1),
  'claude-sonnet-5': p(2, 10, 0.2),
  'claude-sonnet-4-6': p(3, 15, 0.3),
  'claude-haiku-5-5': p(0.1, 0.5, 0.01),
  'claude-haiku-4-5': p(1, 5, 0.1),
}

export function priceFor(model: string): Price | undefined {
  // Ids in transcripts can carry a date suffix (claude-haiku-4-5-20251001).
  let best: string | undefined
  for (const key of Object.keys(PRICES)) {
    if ((model === key || model.startsWith(key + '-')) && (!best || key.length > best.length)) best = key
  }
  return best ? PRICES[best] : undefined
}

export function costOf(model: string, k: Kinds): number | undefined {
  const pr = priceFor(model)
  if (!pr) return undefined
  return (k.i * pr.i + k.o * pr.o + k.cr * pr.cr + k.cw5 * pr.cw5 + k.cw1 * pr.cw1) / 1e6
}

export const tokensOf = (k: { i: number; o: number; cr: number; cw5: number; cw1: number }) => k.i + k.o + k.cr + k.cw5 + k.cw1

export type Summary = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  responses: number
  cost: number
  unpricedTokens: number
  byModel: { model: string; tokens: number; cost: number | undefined; responses: number }[]
}

export function summarize(records: FileRecord[]): Summary {
  const s: Summary = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, responses: 0, cost: 0, unpricedTokens: 0, byModel: [] }
  const models = new Map<string, Kinds & { old: number }>()
  for (const r of records) {
    s.input += r.i
    s.output += r.o
    s.cacheRead += r.cr
    s.cacheWrite += r.cw
    s.responses += r.n
    for (const [model, v] of Object.entries(r.m ?? {})) {
      const acc = models.get(model) ?? { i: 0, o: 0, cr: 0, cw5: 0, cw1: 0, n: 0, old: 0 }
      if (typeof v === 'number') acc.old += v
      else {
        acc.i += v.i
        acc.o += v.o
        acc.cr += v.cr
        acc.cw5 += v.cw5
        acc.cw1 += v.cw1
        acc.n += v.n
      }
      models.set(model, acc)
    }
  }
  for (const [model, k] of models) {
    // Records from version 0.1 (k.old) have no token kinds, so they can't be priced.
    const c = costOf(model, k)
    if (c === undefined) s.unpricedTokens += tokensOf(k)
    else s.cost += c
    s.unpricedTokens += k.old
    s.byModel.push({ model, tokens: tokensOf(k) + k.old, cost: c, responses: k.n })
  }
  s.byModel.sort((a, b) => b.tokens - a.tokens)
  return s
}

export type Wrapped = {
  tokens: number
  cost: number
  responses: number
  sessions: number
  activeDays: number
  longestStreak: number
  busiestDay: { day: string; tokens: number } | null
  topModel: { model: string; share: number } | null
  topProject: { name: string; tokens: number } | null
  peakHour: number | null
  persona: string
  since: string | null
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const t = new Date(y, m - 1, d + n)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

function persona(hour: number | null): string {
  if (hour === null) return 'Mystery Coder'
  if (hour < 5) return 'Midnight Goblin 🦇'
  if (hour < 9) return 'Dawn Grinder 🌅'
  if (hour < 13) return 'Morning Shipper ☀️'
  if (hour < 18) return 'Afternoon Builder 🛠️'
  if (hour < 22) return 'Evening Hacker 🌆'
  return 'Night Owl 🦉'
}

export function wrapped(files: Record<string, FileRecord>, summary: Summary): Wrapped {
  const days: Record<string, number> = {}
  const hours = Array(24).fill(0) as number[]
  const projects: Record<string, number> = {}
  let sessions = 0
  for (const [path, r] of Object.entries(files)) {
    if (!path.includes('/subagents/')) sessions += 1
    for (const [day, n] of Object.entries(r.d ?? {})) days[day] = (days[day] ?? 0) + n
    ;(r.h ?? []).forEach((n, i) => (hours[i] = (hours[i] ?? 0) + n))
    if (r.project) projects[r.project] = (projects[r.project] ?? 0) + (r.i + r.o + r.cr + r.cw)
  }
  const dayList = Object.keys(days).sort()
  let longest = 0
  let run = 0
  let prev: string | null = null
  for (const day of dayList) {
    run = prev !== null && addDays(prev, 1) === day ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = day
  }
  const busiest = Object.entries(days).sort((a, b) => b[1] - a[1])[0]
  const topP = Object.entries(projects).sort((a, b) => b[1] - a[1])[0]
  const maxHour = Math.max(...hours)
  const peakHour = maxHour > 0 ? hours.indexOf(maxHour) : null
  const tokens = summary.input + summary.output + summary.cacheRead + summary.cacheWrite
  const top = summary.byModel[0]
  return {
    tokens,
    cost: summary.cost,
    responses: summary.responses,
    sessions,
    activeDays: dayList.length,
    longestStreak: longest,
    busiestDay: busiest ? { day: busiest[0], tokens: busiest[1] } : null,
    topModel: top && tokens > 0 ? { model: top.model, share: top.tokens / tokens } : null,
    topProject: topP ? { name: topP[0], tokens: topP[1] } : null,
    peakHour,
    persona: persona(peakHour),
    since: dayList[0] ?? null,
  }
}

export function fmt(n: number): string {
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [size, unit] of units) {
    if (n >= size) return `${(n / size).toFixed(n >= size * 100 ? 0 : n >= size * 10 ? 1 : 2)}${unit}`
  }
  return String(Math.round(n))
}

export function money(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e4) return `$${(n / 1e3).toFixed(1)}k`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 2, minimumFractionDigits: n >= 100 ? 0 : 2 })}`
}

export const shortModel = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '')

export function hourLabel(h: number): string {
  const suffix = h < 12 ? 'AM' : 'PM'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh} ${suffix}`
}
