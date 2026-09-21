# Grok Build Workbench

Unofficial desktop for [Grok Build](https://grok.com/build). Projects in a sidebar, multiple chats at once.
Thought process window, Browser window, Git Window. Talk to Grok with local voice.

Not affiliated with, endorsed by, or sponsored by SpaceXAI / xAI. “Grok” and “Grok Build” are their marks.

![Grok Build Workbench](docs/screenshot.png)

## Run

This repository is the source for a desktop Electron app. There is no packaged Mac `.dmg` or standalone `.app` to download. `npm run dev` opens a development window.

1. Clone this repository.
2. Install [Node.js 22](https://nodejs.org/).
3. Install the [Grok Build CLI](https://x.ai/news/grok-build-cli) and sign in: `grok login` (SuperGrok).
4. `npm install`
5. `npm run dev`

Optional: copy `.env.example` to `.env` and set `XAI_API_KEY` if you want an API key instead of `grok login`.

On macOS, `npm install` and `npm run dev` register a signed Electron shell at `~/Applications/Grok Build Workbench.app` (and try `/Applications`) so the microphone permission prompt uses this app’s name. That is not a standalone Workbench build — start the app with `npm run dev`. On Windows and Linux the register script exits without doing anything.

Chats are real Grok Build sessions. Sessions already on disk for a folder show up in that project.

`npm run typecheck` is the compile gate. `npm run build` emits the Electron bundle to `out/`. It does not produce a distributable Mac app.

## Index your code

Workbench uses the [Codegraph](https://github.com/colbymchenry/codegraph) CLI to index a project folder (file count, symbols, orientation card). Install it once on your machine.

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex
```

Or, if you already have Node: `npm i -g @colbymchenry/codegraph`

Open a new terminal after install so `codegraph` is on your PATH, then restart Workbench. If the binary is not on PATH, set `CODEGRAPH_BIN` in `.env` to its full path.

You do not need `codegraph install` — that wires other agents. Attach a folder to a project; Workbench runs `codegraph init` itself. If the CLI is missing, it will try the install script, then the npm package.

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
