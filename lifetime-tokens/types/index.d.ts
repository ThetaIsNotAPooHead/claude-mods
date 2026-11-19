export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  responses: number
}

declare module 'claude-code' {
  interface PluginState {
    'lifetime-tokens': { total: TokenTotals }
  }
}