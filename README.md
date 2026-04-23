# Voxmire

Voxmire is a local-first desktop transcription app for long audio files. The first release targets desktop through Electron, with local Whisper-based transcription, no subscription requirement, and no enforced upload of user audio.

The project is designed desktop-first, but not desktop-only. Shared product logic lives in packages so future web or mobile apps can reuse contracts, transcript formats, export rules, job states, and engine behavior.

## Product Goals

- Transcribe very long audio files, including 3 hour plus recordings.
- Run locally as much as possible.
- Avoid subscription-gated transcription limits.
- Support different machines through CPU and GPU-capable Whisper backends.
- Keep transcripts searchable, exportable, resumable, and recoverable.
- Keep the app architecture maintainable as the product grows.

## Final Stack

- Desktop shell: Electron
- Frontend: React, TypeScript, Vite
- Local engine: whisper.cpp sidecar binaries
- Audio conversion: bundled ffmpeg
- Storage: SQLite
- Monorepo: pnpm workspace
- Shared validation/contracts: Zod
- Packaging target: electron-builder

## Repository Layout

```txt
apps/
  desktop/        Electron desktop app
  web/            Future placeholder
  mobile/         Future placeholder

packages/
  core/           Pure product logic
  contracts/      Shared schemas and types
  engine/         Whisper and ffmpeg orchestration
  storage/        SQLite repositories
  exporters/      TXT, SRT, VTT, JSON, and future exporters

resources/
  engines/        Packaged whisper.cpp binaries
  ffmpeg/         Packaged ffmpeg binaries
  models/         Local model storage or bundled model metadata

docs/             Product, architecture, and technical documentation
```

## Architecture Rule

Electron is the platform shell. It should not become the whole product.

Reusable behavior belongs in `packages/*`. Desktop-specific behavior belongs in `apps/desktop`.
