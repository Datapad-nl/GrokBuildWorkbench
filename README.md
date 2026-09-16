# Grok Build Workbench

Unofficial desktop for [Grok Build](https://grok.com/build). Projects in a sidebar, multiple chats at once.
Thought process window, Browser window, Git Window. Talk to Grok with local voice.

Not affiliated with, endorsed by, or sponsored by SpaceXAI / xAI. “Grok” and “Grok Build” are their marks.

![Grok Build Workbench](docs/screenshot.png)

## Run

1. Install the [Grok Build CLI](https://x.ai/news/grok-build-cli) and sign in: `grok login` (SuperGrok).
2. `npm install`
3. `npm run dev`

Chats are real Grok Build sessions. Sessions already on disk for a folder show up in that project.

`npm run typecheck` is the compile gate. `npm run build` emits the Electron bundle to `out/`.

## What works now

**Desktop**

- Native window; size and pane layout persist
- Projects in a sidebar, each with an optional local folder, color, and rename

**Voice**

- Talk to Grok on this machine. Listening uses a local Whisper model; replies use your system voice. Audio never leaves the computer
- Conversation mode: a live loop — listen, send as you talk, speak replies, interrupt
- Speak replies, send when you stop talking, and keep listening after replies
- Mic, voice, and speed in Settings. Turn on Voice, then use the Conversation button in the chat

**Chats**

- Multiple chats per project
- Concurrent streams: switch tabs without cancelling
- Real Grok Build sessions — sessions already on disk for a folder show up in that project
- Ask / Auto / Plan permission modes, including plan cards you can approve, revise, or abandon
- Isolated git worktrees so concurrent chats on the same repo do not clobber each other
- Checkpoints and rewind of files plus later messages
- First-run project briefing, Codegraph index status, and an orientation card

**Panes**

- Thought process: live tool and activity stream
- Browser: in-app webview the agent can drive; pick and annotate a page element; screenshots; YouTube captions; clear cookies
- Git: branch, ahead/behind, commit graph, diffs, stage / unstage / discard, commit, checkout, new branch
- Knowledge: Obsidian-compatible `knowledge/` vault with a graph pane and generated maps

**Composer**

- Markdown replies, `@file` / folder mentions, pasted screenshots and attachments
- Slash-command palette: `/new`, `/rewind`, `/plan`, `/ask`, `/always-approve`, `/commit`, `/review`, `/compact`, `/model`, `/settings`, `/usage`, `/transcribe`, `/imagine`, `/btw`, `/memory`, workflows, and more
- Steer a running task, or `/btw` a side question without dropping it

**Settings**

- Sign in with `grok login` (SuperGrok); optional API-key fallback
- Model picker (Grok 4.6 by default)
- Appearance: built-in themes plus import and export of custom themes
- Usage snapshot in the status bar

## License

[MIT](LICENSE)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).
