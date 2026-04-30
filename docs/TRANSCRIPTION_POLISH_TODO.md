# Transcription Polish Todo

Last updated: 2026-04-30

## Context

A 1 hour transcription test completed successfully with the current whisper.cpp runtime fallback work. Runtime and model downloads are implemented for the current plan; the remaining items here are product polish and release validation.

## Runtime And Model Distribution Status

Implemented:

- CUDA runtime is not bundled with the app installer.
- Vulkan, BLAS CPU, and plain CPU runtimes are bundled.
- Settings can show CUDA as missing/downloadable.
- The app downloads CUDA from the runtime manifest URL.
- The app bundles `small-q8_0` as the starter model.
- The app downloads `large-v3-turbo` and `large-v3` from the model manifest URLs.
- Runtime and model downloads are SHA256 verified before install.
- Downloads use temporary folders and clean stale leftovers on app startup.
- Installed downloads go to user app data, not the app install directory.
- Runtime fallback remains CUDA, Vulkan, BLAS CPU, then plain CPU.

Validation checklist before calling this release-ready:

- Fresh Windows user profile with no user-installed CUDA runtime folder.
- Open Settings, confirm CUDA shows as downloadable.
- Download CUDA from the app.
- Restart the app and confirm CUDA is installed/available.
- Run a short transcription and confirm progress UI reports the CUDA runtime.
- Temporarily remove or break CUDA and confirm fallback still reaches Vulkan or CPU.
- Delete user-installed larger models and confirm the bundled starter model still works.
- Download `large-v3-turbo` from Settings and run a short transcription with it.

## Transcription Job Stats Todo

Goal: make long jobs explain what happened after transcription completes.

Add persisted metrics:

- Job processing started timestamp.
- Job processing completed timestamp.
- Active processing duration, excluding time spent paused if possible.
- Chunk count.
- Per-chunk started timestamp.
- Per-chunk completed timestamp.
- Per-chunk runtime id used.
- Per-chunk processing duration.
- Average chunk processing time.

Recommended display:

- In project/job details: `Processed in 12m 34s`.
- In project/job details: `7 chunks`.
- In project/job details: `Avg chunk 1m 47s`.
- Optional later: fastest chunk, slowest chunk, runtime fallback count.

Implementation notes:

- Do not derive processing time only from `createdAt` and `completedAt`; that includes queue time and pause time.
- Prefer adding explicit chunk `startedAt`/`completedAt` fields or a small job metrics table.
- If a chunk is retried with a fallback engine, only count the successful attempt in user-facing average time; log failed attempts separately.
- Keep renderer display read-only and derived from main/runtime/storage data.

## Progress Bar Todo

Problem: for a one-chunk job, the current progress bar can appear pinned near the initial transcription floor, so the user cannot see meaningful movement.

Desired behavior:

- Preparation/ffmpeg work: 0-10%.
- Transcription work: 10-99%.
- Completion: 100%.
- Single-chunk jobs should still move visibly from 10% toward 99%.
- Multi-chunk jobs should show total job progress based on chunk index plus current chunk progress.

Implementation notes:

- Pass `--print-progress` to `whisper-cli` so whisper.cpp emits progress lines consistently.
- Keep parsing whisper.cpp progress in the engine layer.
- For one chunk, map current chunk progress directly into the 10-99% transcription range.
- For many chunks, use `(completedChunks + currentChunkProgress) / totalChunks` mapped into the 10-99% range.
- Progress should reset only within the chunk internally; the displayed job progress should remain monotonic unless the job is explicitly restarted.

## Timestamp Field Width Todo

Problem: hour-scale timestamps can exceed the current compact text field width.

Desired behavior:

- Timestamp inputs should comfortably fit `HH:MM:SS.mmm`.
- Long jobs should not clip timestamps or force awkward horizontal scrolling.
- Mobile/narrow layouts should preserve readable timestamp editing without overlapping transcript text.

Implementation notes:

- Set a stable minimum width for timestamp fields based on the longest expected display format.
- Consider a responsive two-line segment header on narrow widths.
- Avoid changing transcript text sizing just to make timestamp fields fit.

## References

- Hugging Face ggml model repo: https://huggingface.co/ggerganov/whisper.cpp
- whisper.cpp README and model memory table: https://github.com/ggml-org/whisper.cpp/blob/master/README.md
- OpenAI `whisper-large-v3-turbo` model card: https://huggingface.co/openai/whisper-large-v3-turbo
