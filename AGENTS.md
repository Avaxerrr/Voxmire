# AGENTS.md

## Project Context

This repo is for Voxmire, a local-first desktop transcription app for long audio files.

Read these docs before making architectural decisions:

- `docs/PRODUCT.md`
- `docs/TECH_STACK.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/ROADMAP.md`

For resource packaging or runtime distribution work, also read:

- `docs/RESOURCES.md`
- `docs/RUNTIME_PIPELINE.md`

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

## Separation of Concerns

- Do not keep adding feature logic to large orchestration files just because it is faster.
- Keep React route/view shells focused on composition. Move stateful workflows into hooks and UI subtrees into focused components.
- Keep runtime orchestration thin. Move engine selection, chunk execution, persistence, progress reporting, and recovery into focused modules when they grow beyond simple glue code.
- Keep Electron main-process IPC handlers narrow. Validate input, call a service/runtime function, and return typed results.
- Keep dev tooling scripts usable from one command, but extract reusable release, packaging, upload, manifest, and prompt logic once a script becomes hard to scan.
- When a touched file is already large or gains a second responsibility, prefer extracting the new responsibility instead of growing the file.
- Before finishing substantial work, call out any file that became a refactor candidate and either refactor it immediately when low risk or document the follow-up.

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
