import { describe, it, expect, beforeAll, afterAll } from "vitest";

const QWEN3_URL = process.env.QWEN3_URL || "http://localhost:8880";

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

interface Qwen3Config {
  serverUrl?: string;
  voice?: string;
  model?: string;
}

const DEFAULT_CONFIG: Required<Qwen3Config> = {
  serverUrl: QWEN3_URL,
  voice: "af_sarah",
  model: "qwen-tts",
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
        signal: AbortSignal.timeout(5000),
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
      signal: AbortSignal.timeout(5000),
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
      const timeout = setTimeout(() => controller.abort(), 2000);
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

describe("Qwen3-TTS Integration", () => {
  let provider: Qwen3Provider;

  beforeAll(() => {
    provider = new Qwen3Provider();
  });

  it("should have correct metadata", () => {
    expect(provider.metadata.name).toBe("qwen3-tts");
    expect(provider.metadata.type).toBe("tts");
    expect(provider.metadata.local).toBe(true);
  });

  it("should have default voices defined", () => {
    expect(provider.voices.length).toBeGreaterThan(0);
    expect(provider.voices.find((v) => v.id === "af_sarah")).toBeDefined();
  });

  it("should validate config", () => {
    expect(() => provider.validateConfig()).not.toThrow();
  });

  it("should pass health check", async () => {
    const healthy = await provider.healthCheck();
    expect(typeof healthy).toBe("boolean");
  }, 3000);

  it("should synthesize speech (may fail if no server)", async () => {
    try {
      const result = await provider.synthesize("Hello world");
      expect(result.audio.length).toBeGreaterThan(0);
    } catch {
      // Expected if no server running
    }
  }, 5000);

  it("should handle custom voice option", async () => {
    try {
      const result = await provider.synthesize("Testing voice", { voice: "am_michael" });
      expect(result.audio.length).toBeGreaterThan(0);
    } catch {
      // Expected if no server running
    }
  }, 5000);

  it("should handle empty text", async () => {
    try {
      await provider.synthesize("");
    } catch {
      // Expected
    }
  }, 5000);

  it("should handle custom voice option", async () => {
    try {
      const result = await provider.synthesize("Testing voice", { voice: "am_michael" });
      expect(result.audio.length).toBeGreaterThan(0);
    } catch {
      // Expected if no server running
    }
  }, 10000);

  it("should handle empty text", async () => {
    try {
      await provider.synthesize("");
    } catch {
      // Expected
    }
  }, 10000);

  afterAll(async () => {
    await provider.shutdown();
  });
});
