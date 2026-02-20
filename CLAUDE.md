# wopr-plugin-voice-vibevoice

TTS plugin for Microsoft VibeVoice — a self-hosted, OpenAI-compatible TTS server.

## Commands

```bash
npm run build     # tsc
npm run check     # biome check + tsc --noEmit (run before committing)
npm run format    # biome format --write src/
npm test          # vitest run
```

## Key Details

- Implements the `tts` capability provider from `@wopr-network/plugin-types`
- VibeVoice is OpenAI-compatible — uses the `/v1/audio/speech` endpoint
- Self-hosted: user runs VibeVoice locally or on their own server. No API key required by default.
- Config: `serverUrl` (e.g. `http://localhost:8881`), `voice`, `model`, `speed`
- Available voices: alloy, echo, fable, onyx, nova, shimmer
- Available models: tts-1, tts-1-hd
- **Use case**: Free/local TTS alternative to hosted providers

## Plugin Contract

Imports only from `@wopr-network/plugin-types`. Never import from `@wopr-network/wopr` core.

## Issue Tracking

All issues in **Linear** (team: WOPR). Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-voice-vibevoice`.
