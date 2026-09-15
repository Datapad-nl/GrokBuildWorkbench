# Contributing

Unofficial desktop for Grok Build. Not affiliated with SpaceXAI / xAI.

## Setup

1. Install [Node.js 22](https://nodejs.org/)
2. Install the [Grok Build CLI](https://x.ai/news/grok-build-cli) and run `grok login`
3. `npm install`
4. `npm run dev`

Optional: copy `.env.example` to `.env` if you want an `XAI_API_KEY` instead of `grok login`.

## Before a PR

1. `npm run typecheck`
2. Run the app and click the path you changed
3. Keep the diff to the request — no drive-by refactors

## Rules

- Match the style already in the file
- Do not commit `.env`, `.codegraph/`, or `userData`
- Do not rename `window.grokcode`, `userData/grokcode`, or `grokcode/` worktree refs without a migration
- User-facing name is **Grok Build Workbench**
- Open web pages in the in-app BrowserPane (`browser` MCP `navigate`), not an external browser

## Layout

- Main process: `src/main`
- Preload: `src/preload`
- UI: `src/renderer/src`
- Shared types: `src/shared`
