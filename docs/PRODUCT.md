# Product Brief

## Name

Voxmire

## Purpose

Voxmire helps users transcribe long audio files locally without relying on subscription-based transcription limits. It is intended for recordings such as interviews, meetings, lectures, calls, podcasts, voice notes, and multi-hour sessions.

## Core Value

The app should make long-form transcription practical on a personal machine:

- Import an audio or video file.
- Choose a model and performance mode.
- Transcribe locally.
- Resume safely if interrupted.
- Review, search, edit, and export the transcript.

## Target User

Voxmire is for users who have long recordings and want ownership of the transcription process:

- Creators
- Researchers
- Students
- Professionals
- Teams handling private audio
- Users who do not want ongoing transcription subscriptions

## Product Principles

- Local-first by default.
- Desktop-first, but not desktop-locked.
- Clear progress for long-running jobs.
- No hidden cloud dependency for transcription.
- Recoverable jobs and durable transcript state.
- Practical quality controls instead of exposing every engine flag.

## Initial Scope

V1 should focus on reliable file transcription:

- Audio/video import
- Model selection
- CPU transcription
- GPU engine detection later
- Long audio chunking
- Job progress
- Pause, resume, cancel
- Transcript viewer
- TXT, SRT, VTT, and JSON export

## Out Of Scope For V1

- Full mobile app
- Web app
- Cloud transcription
- Real-time meeting bot
- Collaboration features
- Heavy transcript editing suite
- Speaker diarization unless the selected local engine supports it reliably enough
