# Synchronized Audio Playback Plan

## Summary

Add a real audio player that stays synchronized with transcript segments. The first version should use native browser audio in the renderer and a narrow Electron main/preload bridge for safe local media access.

No new playback dependency is needed for the first pass.

## Current Status

- Done: Phase 1 safe media bridge.
- Done: Phase 2 real audio deck.
- Done: Phase 3 transcript sync first pass.
- In progress: Phase 4 long-audio polish. Byte-range media streaming, volume controls, deck placement, and backend-generated waveform peaks are implemented. Remaining work is manual-scroll follow behavior, waveform persistence, and broader media-container edge cases.

## Goals

- Play the original imported audio or prepared audio from the transcript editor.
- Keep playback state synchronized with transcript timestamps.
- Highlight the active transcript segment while audio is playing.
- Allow clicking a segment to seek audio to that segment.
- Keep renderer filesystem access blocked.
- Keep long-audio behavior reliable for multi-hour recordings.

## Non-Goals For First Pass

- No waveform generation dependency.
- No advanced audio editing.
- No region selection or clipping.
- No cloud media URLs.
- No loading entire audio files into renderer memory.

## Architecture

Renderer:

- Owns the visual player controls and transcript sync UI.
- Uses a native `HTMLAudioElement`.
- Receives a safe media URL from the preload API.
- Never reads local file paths directly.

Preload:

- Exposes a narrow method for media playback:
  - `window.voxmire.media.getSourceUrl(jobId)`

Electron Main:

- Resolves `jobId` to the stored source file or prepared audio file.
- Registers a custom protocol such as `voxmire-media://source/<sourceFileId>`.
- Streams media from disk with validation.
- Prevents arbitrary file access from renderer-supplied paths.

Storage/Runtime:

- Reuse existing `source_files.path` and job/source relationships.
- Prefer app-prepared audio when available if it is more playback-compatible.
- Do not duplicate media metadata unless playback needs a specific prepared-media reference.

## UX Behavior

Transcript header:

- Keep the compact icon-only header.
- The bottom deck becomes the real audio player.

Audio deck:

- Play/pause.
- Skip back and skip forward.
- Current time and total duration.
- Seek bar.
- Playback rate display can stay at `1.0x` for the first pass.

Transcript list:

- Active segment is highlighted based on `audio.currentTime`.
- Clicking a segment seeks to `segment.startSeconds`.
- While playing, auto-scroll to the active segment.
- If the user manually scrolls, temporarily stop auto-follow until playback seeks or the user re-enables follow behavior.

Empty and edge states:

- Disable player if there is no selected job, no segments, or no playable media URL.
- Show a concise player error if media cannot be loaded.
- Keep transcript export and import unaffected.

## Implementation Phases

### Phase 1: Safe Media Bridge - Done

- Add contract/preload/main API for `media.getSourceUrl(jobId)`.
- Register `voxmire-media://` protocol in Electron main.
- Resolve job ID through runtime/storage, not renderer paths.
- Stream the media file from disk.
- Validate missing file and unsupported file errors.

Acceptance:

- Renderer can receive a safe URL for a selected job.
- Browser devtools never exposes direct arbitrary filesystem reads.
- Missing media returns a controlled error.

### Phase 2: Real Audio Deck - Done

- Replace synthetic playback state with a real `<audio>` element.
- Track `currentTime`, `duration`, `paused`, and media errors.
- Wire play, pause, skip, and seek controls.
- Keep the current deck styling but use real playback time.

Acceptance:

- Play/pause works for an imported transcript.
- Seek updates the actual audio position.
- Time display is based on audio playback, not transcription progress.

### Phase 3: Transcript Sync - Done For First Pass

- Compute active segment from `currentTime`.
- Pass `activeSegmentId` and seek handlers into the virtualized segment list.
- Highlight the active segment.
- Clicking a row seeks to that segment.
- Auto-scroll to active row while playback is following.

Acceptance:

- Playback advances the highlighted segment.
- Clicking a transcript row seeks the player.
- Sync works with virtualized long transcripts.

### Phase 4: Long-Audio Polish - In Progress

- Add follow-mode behavior so user scrolling does not fight auto-scroll.
- Add keyboard shortcuts only if they do not conflict with text editing later.
- Improve loading/error states.
- Add volume and mute controls. - Done.
- Generate lightweight waveform peak data in main and render it as SVG in the renderer. - Done for first pass.
- Add optional playback rate control after basic sync is stable.

Acceptance:

- Multi-hour seeded transcript remains responsive.
- User can scroll manually without the app constantly pulling them back.
- Active segment resumes following after seek/play interaction.

## Test Plan

Automated:

- `npm run typecheck`
- `corepack pnpm --filter @voxmire/desktop build`
- 2026-04-25: both checks passed for the first implementation slice.
- 2026-04-25: typecheck and desktop build passed after byte-range streaming, volume, and waveform updates.
- Unit-test active segment lookup with fixed segment fixtures.
- Test media URL creation rejects unknown job IDs.

Manual:

- Import a small WAV/MP3 and transcribe it.
- Open transcript and play audio.
- Confirm time display advances.
- Confirm active transcript row changes as playback moves.
- Click several transcript rows and confirm audio seeks correctly.
- Test skip back/forward.
- Test a long seeded transcript to verify virtualized sync stays responsive.
- Test missing source file behavior.

Agent/CLI Support:

- Keep CLI/MCP unchanged for first pass.
- Later, add a CLI/MCP command to validate that a job has playable media if debugging needs it.

## Risks

- Electron custom protocol streaming must be carefully scoped to prevent arbitrary file access.
- Some video containers may not play natively even if ffmpeg can transcribe them.
- Prepared WAV chunks may not represent the full original media as a single playable file.
- Auto-scroll can feel aggressive if not balanced with manual user scrolling.

## Recommended First Implementation

Start with original-source playback through `voxmire-media://source/<sourceFileId>` and native `HTMLAudioElement`. If native playback fails for common imported video/audio formats, add a later prepared-playback file generated by ffmpeg.
