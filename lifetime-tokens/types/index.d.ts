export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  responses: number
  // What the same usage would cost at Anthropic's first-party API prices, USD.
  cost: number
}

// What the /wrapped pane draws: the poster as SVG, and the same stats as text
// for surfaces that can't draw SVG.
export type WrappedCard = { svg: string; lines: string[] }

declare module 'claude-code' {
  interface PluginState {
    'lifetime-tokens': {
      total: Shaped<TokenTotals>
      wrapped: Shaped<WrappedCard | null>
    }
  }
}
