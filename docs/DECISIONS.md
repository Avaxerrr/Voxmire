# Product And Technical Decisions

## Final Name

Voxmire

## Desktop First

The first product target is desktop. Web and mobile are future targets, but they should not control the V1 architecture.

## Electron Is Final

Electron is the desktop shell. Memory use should be controlled through architecture:

- Keep transcription outside the renderer.
- Spawn local sidecar binaries.
- Stream progress and segments.
- Avoid loading full transcripts into memory when not needed.
- Use virtualized transcript rendering.

## whisper.cpp Is The Default Engine

whisper.cpp is the best default for a local desktop product because it can run on CPU and has multiple hardware acceleration options.

## faster-whisper Is Optional Later

faster-whisper is useful, especially for NVIDIA users, but it should not be the default V1 backend because Python, CUDA, CTranslate2, and packaging compatibility increase support risk.

## SQLite For Local State

SQLite is the right default because jobs, transcript segments, settings, and model metadata all need durable local state.

## Packages Keep The Product Reusable

The project should avoid Electron-specific logic inside reusable packages. That is what keeps a future web or mobile app possible.
