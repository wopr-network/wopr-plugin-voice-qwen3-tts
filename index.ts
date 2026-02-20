/**
 * WOPR Voice Plugin: Qwen3-TTS
 *
 * Connects to Qwen3-TTS server via OpenAI-compatible HTTP API.
 * Supports voice cloning, voice design, and multilingual synthesis.
 *
 * Docker: groxaxo/qwen3-tts-openai-fastapi
 */

interface TTSSynthesisResult {
  audio: Buffer;
  format: "pcm_s16le" | "mp3" | "wav" | "opus";
  sampleRate: number;
  durationMs: number;
}

interface TTSOptions {
  voice?: string;
  speed?: number;
  sampleRate?: number;
}

interface Voice {
  id: string;
  name: string;
  language?: string;
  gender?: "male" | "female" | "neutral";
  description?: string;
}

interface VoicePluginMetadata {
  name: string;
  version: string;
  type: "stt" | "tts";
  description: string;
  capabilities?: string[];
  local?: boolean;
  emoji?: string;
}

interface TTSProvider {
  readonly metadata: VoicePluginMetadata;
  readonly voices: Voice[];
  synthesize(text: string, options?: TTSOptions): Promise<TTSSynthesisResult>;
  healthCheck?(): Promise<boolean>;
  shutdown?(): Promise<void>;
  validateConfig(): void;
}

interface WOPRPlugin {
  name: string;
  version: string;
  description?: string;
  init?: (ctx: WOPRPluginContext) => Promise<void>;
  shutdown?: () => Promise<void>;
}

interface WOPRPluginContext {
  log: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    warn: (msg: string) => void;
    debug: (msg: string) => void;
  };
  getConfig: <T>() => T;
  registerTTSProvider: (provider: TTSProvider) => void;
}

interface Qwen3Config {
  serverUrl?: string;
  voice?: string;
  model?: string;
}

const DEFAULT_CONFIG: Required<Qwen3Config> = {
  serverUrl: process.env.QWEN3_URL || "http://qwen3-tts:8880",
  voice: process.env.QWEN3_VOICE || "af_sarah",
  model: process.env.QWEN3_MODEL || "qwen-tts",
};

function parseWavSampleRate(buffer: Buffer): number {
  if (buffer.length < 28) return 24000;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return 24000;
  return buffer.readUInt32LE(24);
}

function wavToPcm(wavBuffer: Buffer): { pcm: Buffer; sampleRate: number } {
  let offset = 12;
  let sampleRate = 24000;

  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      sampleRate = wavBuffer.readUInt32LE(offset + 12);
    } else if (chunkId === "data") {
      const pcm = wavBuffer.subarray(offset + 8, offset + 8 + chunkSize);
      return { pcm, sampleRate };
    }

    offset += 8 + chunkSize;
  }

  return {
    pcm: wavBuffer.subarray(44),
    sampleRate: parseWavSampleRate(wavBuffer),
  };
}

class Qwen3Provider implements TTSProvider {
  readonly metadata: VoicePluginMetadata = {
    name: "qwen3-tts",
    version: "1.0.0",
    type: "tts",
    description: "Qwen3-TTS by Alibaba Cloud",
    capabilities: ["voice-selection", "voice-cloning", "voice-design", "multilingual"],
    local: true,
    emoji: "🧠",
  };

  readonly voices: Voice[] = [
    { id: "af_sarah", name: "Sarah", language: "en", gender: "female" },
    { id: "am_michael", name: "Michael", language: "en", gender: "male" },
    { id: "bf_emma", name: "Emma", language: "en", gender: "female" },
    { id: "bm_daniel", name: "Daniel", language: "en", gender: "male" },
  ];

  private config: Required<Qwen3Config>;
  private dynamicVoices: Voice[] = [];

  constructor(config: Qwen3Config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  validateConfig(): void {
    if (!this.config.serverUrl) {
      throw new Error("serverUrl is required");
    }
  }

  async fetchVoices(): Promise<void> {
    try {
      const response = await fetch(`${this.config.serverUrl}/v1/voices`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          this.dynamicVoices = data.map((v: any) => ({
            id: v.voice_id || v.id || v.name || v,
            name: v.name || v.voice_id || v.id || v,
            language: v.language || "en",
            gender: v.gender || "neutral",
            description: v.description,
          }));
        }
      }
    } catch {
      // Voice fetch failed, use defaults
    }
  }

  async synthesize(text: string, options?: TTSOptions): Promise<TTSSynthesisResult> {
    const startTime = Date.now();
    const voice = options?.voice || this.config.voice;

    const requestBody = {
      input: text,
      voice: voice,
      model: this.config.model,
      response_format: "wav",
    };

    const response = await fetch(`${this.config.serverUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Qwen3 TTS error: ${response.status} - ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const wavBuffer = Buffer.from(arrayBuffer);

    const { pcm, sampleRate } = wavToPcm(wavBuffer);

    return {
      audio: pcm,
      format: "pcm_s16le",
      sampleRate,
      durationMs: Date.now() - startTime,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const response = await fetch(`${this.config.serverUrl}/v1/models`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    // No cleanup needed
  }
}

let provider: Qwen3Provider | null = null;

const plugin: WOPRPlugin = {
  name: "voice-qwen3-tts",
  version: "1.0.0",
  description: "Qwen3-TTS by Alibaba Cloud",

  async init(ctx: WOPRPluginContext) {
    const config = ctx.getConfig<Qwen3Config>();
    provider = new Qwen3Provider(config);

    try {
      provider.validateConfig();
      const healthy = await provider.healthCheck();
      if (healthy) {
        await provider.fetchVoices();
        ctx.registerTTSProvider(provider);
        ctx.log.info(`Qwen3 TTS registered (${provider["config"].serverUrl})`);
      } else {
        ctx.log.warn(`Qwen3 server not reachable at ${provider["config"].serverUrl}`);
      }
    } catch (err) {
      ctx.log.error(`Failed to init Qwen3 TTS: ${err}`);
    }
  },

  async shutdown() {
    if (provider) {
      await provider.shutdown();
      provider = null;
    }
  },
};

export default plugin;
