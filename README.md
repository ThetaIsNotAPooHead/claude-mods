# claude-mods

Three small [Claude Code mods](https://code.claude.com/docs/en/plugins/mods) that show you what's going on.

| Mod | What you get |
|---|---|
| **lifetime-tokens** | `🪙 14.0B tokens · 💸 $6,472` in the footer. `/tokens` breaks it down by type and model, `/cost` shows what your usage would cost at Anthropic API prices (an estimate: on a Pro or Max plan you pay your subscription), and `/wrapped` opens your **Token Wrapped** card (total, top model, busiest day, streak, peak hour) to screenshot and share. It scans your Claude Code transcripts (`~/.claude/projects`) and keeps counting live; transcripts Claude Code cleans up later still count. Needs Node.js on your PATH for the scan. |
| **usage-limits** | `🟢 5h 23% · resets 2h 10m` and `🟡 week 78% · resets 3d 4h` in the footer, and `/limits` for exact reset times. Shows up on Claude plans after your first reply. |
| **tldr** | A dead-simple one-liner under every long answer: `💡 TL;DR: Claude fixed the login bug and the tests pass now.` Written by Haiku, so each one uses a small amount of your usage. Type `/tldr` any time to sum up the last answer, whatever its length. |

## Install

At the prompt of a terminal session:

```
/plugin install lifetime-tokens --marketplace ThetaIsNotAPooHead/claude-mods
/plugin install usage-limits --marketplace ThetaIsNotAPooHead/claude-mods
/plugin install tldr --marketplace ThetaIsNotAPooHead/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install lifetime-tokens --marketplace ThetaIsNotAPooHead/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `ThetaIsNotAPooHead/claude-mods`, then Add plugin.

Mods run with your permissions inside Claude Code. Run `claude plugin validate <mod folder>` to see what each one hooks and calls before you install it.

## Develop

Each mod has tests: `claude plugin test ./lifetime-tokens`.

## License

MIT