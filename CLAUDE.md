# wopr-plugin-voice-qwen3-tts

TTS plugin for Qwen3-TTS — a self-hosted, OpenAI-compatible TTS server by Alibaba Cloud.

## Commands

```bash
npm run build     # tsc
npm run check     # biome check + tsc --noEmit (run before committing)
npm run format    # biome format --write src/
npm test          # vitest run
```

## Key Details

- Implements the `tts` capability provider from `@wopr-network/plugin-types`
- Qwen3-TTS is OpenAI-compatible — uses the `/v1/audio/speech` endpoint
- Self-hosted: user runs Qwen3-TTS locally or on their own server. No API key required by default.
- Config: `serverUrl` (e.g. `http://localhost:8880`), `voice`, `model`
- Features: voice cloning (3-second ref), voice design, multilingual (10+ languages), ultra-low latency (97ms)
- **Use case**: Free/local TTS alternative to ElevenLabs

## Docker

```bash
# Run Qwen3-TTS server
docker run -d --gpus all -p 8880:8880 groxaxo/qwen3-tts-openai-fastapi:latest
```

## Plugin Contract

Imports only from `@wopr-network/plugin-types`. Never import from `@wopr-network/wopr` core.

## Issue Tracking

All issues in **Linear** (team: WOPR). Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-voice-qwen3-tts`.

## Session Memory

At the start of every WOPR session, **read `~/.wopr-memory.md` if it exists.** It contains recent session context: which repos were active, what branches are in flight, and how many uncommitted changes exist. Use it to orient quickly without re-investigating.

The `Stop` hook writes to this file automatically at session end. Only non-main branches are recorded — if everything is on `main`, nothing is written for that repo.