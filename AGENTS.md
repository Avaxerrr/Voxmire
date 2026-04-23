# AGENTS.md

## Project Context

This repo is for Voxmire, a local-first desktop transcription app for long audio files.

Read `docs/HANDOFF.md` before making architectural decisions. Then check:

- `docs/PRODUCT.md`
- `docs/TECH_STACK.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/ROADMAP.md`

## Fixed Decisions

- Product name: Voxmire.
- Desktop shell: Electron.
- UI: React + TypeScript + Vite.
- Package manager: pnpm workspace via Corepack.
- Default transcription engine: whisper.cpp sidecar binaries.
- Audio tooling: bundled ffmpeg.
- Storage: SQLite.
- Desktop is the first real target.
- Web and mobile are future targets only.

## Architecture Rules

- `apps/*` contains platform-specific applications.
- `packages/*` contains reusable product logic.
- Keep Electron-specific code inside `apps/desktop`.
- Do not put filesystem, SQLite, ffmpeg, or Whisper calls in the renderer.
- Use the preload layer as a narrow typed bridge.
- Keep transcription work outside the renderer process.
- Store long-running job state durably so transcription can resume.

## Commands

Use:

```bash
corepack pnpm install
npm run typecheck
```

Root scripts should call `corepack pnpm` so the repo does not depend on a global pnpm shim.

## Guardrails

- Do not add cloud transcription unless explicitly requested.
- Do not build web or mobile implementations unless explicitly requested.
- Do not commit large model files or platform binaries casually.
- Do not expose every Whisper flag in the UI; prefer practical presets.
- Prioritize long-audio reliability over feature breadth.

## Verification

After code or structure changes, run:

```bash
npm run typecheck
```

Add more checks once linting, tests, and the Electron app scaffold exist.
