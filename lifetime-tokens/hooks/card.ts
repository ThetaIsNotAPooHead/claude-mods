// The /wrapped card as an SVG: a tall gradient poster made to screenshot.
import { fmt, hourLabel, money, shortModel } from './stats'
import type { Wrapped } from './stats'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function niceDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function wrappedSvg(w: Wrapped, year: number): string {
  const W = 720
  const H = 1180
  const tiles: [string, string, string][] = [
    ['TOP MODEL', w.topModel ? shortModel(w.topModel.model) : '—', w.topModel ? `${Math.round(w.topModel.share * 100)}% of your tokens` : ''],
    ['BUSIEST DAY', w.busiestDay ? niceDay(w.busiestDay.day) : '—', w.busiestDay ? `${fmt(w.busiestDay.tokens)} tokens` : ''],
    ['LONGEST STREAK', `${w.longestStreak} days`, `${w.activeDays} days active`],
    ['PEAK HOUR', w.peakHour === null ? '—' : hourLabel(w.peakHour), `${w.sessions} sessions`],
  ]
  let tileSvg = ''
  tiles.forEach(([label, big, small], i) => {
    const x = 40 + (i % 2) * 330
    const y = 640 + Math.floor(i / 2) * 200
    tileSvg += `<g>
      <rect x="${x}" y="${y}" width="310" height="180" rx="26" fill="#ffffff" fill-opacity="0.13" stroke="#ffffff" stroke-opacity="0.25"/>
      <text x="${x + 26}" y="${y + 44}" font-size="20" font-weight="800" letter-spacing="3" fill="#ffd9b8">${esc(label)}</text>
      <text x="${x + 26}" y="${y + 104}" font-size="${big.length > 12 ? 34 : 44}" font-weight="900" fill="#ffffff">${esc(big)}</text>
      <text x="${x + 26}" y="${y + 148}" font-size="21" fill="#ffe8d6">${esc(small)}</text>
    </g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, -apple-system, Helvetica, Arial, sans-serif">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2b0a4a"/>
    <stop offset="0.5" stop-color="#b3264f"/>
    <stop offset="1" stop-color="#ff8a3d"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.8" cy="0.15" r="0.6">
    <stop offset="0" stop-color="#ffd166" stop-opacity="0.55"/>
    <stop offset="1" stop-color="#ffd166" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="${W}" height="${H}" rx="40" fill="url(#bg)"/>
<rect width="${W}" height="${H}" rx="40" fill="url(#glow)"/>
<circle cx="640" cy="120" r="150" fill="#ffffff" fill-opacity="0.06"/>
<circle cx="80" cy="1080" r="200" fill="#000000" fill-opacity="0.08"/>
<text x="40" y="90" font-size="24" font-weight="800" letter-spacing="6" fill="#ffd9b8">YOUR ${year}</text>
<text x="40" y="150" font-size="60" font-weight="900" fill="#ffffff">Token Wrapped 🎁</text>
<text x="40" y="260" font-size="26" font-weight="700" fill="#ffe8d6">You burned</text>
<text x="36" y="390" font-size="150" font-weight="900" letter-spacing="-6" fill="#ffffff">${esc(fmt(w.tokens))}</text>
<text x="40" y="440" font-size="34" font-weight="700" fill="#ffffff">tokens in Claude Code</text>
<rect x="40" y="480" width="${W - 80}" height="120" rx="26" fill="#000000" fill-opacity="0.25"/>
<text x="70" y="530" font-size="22" font-weight="800" letter-spacing="3" fill="#ffd166">💸 AT API PRICES THAT'S</text>
<text x="70" y="580" font-size="46" font-weight="900" fill="#ffd166">${esc(money(w.cost))}</text>
${tileSvg}
<rect x="40" y="1050" width="${W - 80}" height="80" rx="40" fill="#ffffff" fill-opacity="0.92"/>
<text x="${W / 2}" y="1100" text-anchor="middle" font-size="28" font-weight="900" fill="#2b0a4a">${esc(w.persona)}</text>
</svg>`
}
