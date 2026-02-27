/**
 * WOPR Voice Plugin: Qwen3-TTS
 *
 * Connects to Qwen3-TTS server via OpenAI-compatible HTTP API.
 * Supports voice cloning, voice design, and multilingual synthesis.
 *
 * Docker: groxaxo/qwen3-tts-openai-fastapi
 */

import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";

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
	/** Server URL (e.g., http://qwen3-tts:8880) */
	serverUrl?: string;
	/** Default voice name */
	voice?: string;
	/** Playback speed (0.25-4.0) */
	speed?: number;
	/** Default language code */
	language?: string;
	/** Response format: mp3, wav, pcm, opus, aac, flac */
	responseFormat?: string;
}

const DEFAULT_CONFIG: Required<Qwen3Config> = {
	serverUrl: process.env.QWEN3_TTS_URL || "http://qwen3-tts:8880",
	voice: process.env.QWEN3_TTS_VOICE || "Vivian",
	speed: 1.0,
	language: "en",
	responseFormat: "wav",
};

export function parseWavSampleRate(buffer: Buffer): number {
	if (buffer.length < 28) return 24000;
	if (buffer.toString("ascii", 0, 4) !== "RIFF") return 24000;
	return buffer.readUInt32LE(24);
}

export function wavToPcm(wavBuffer: Buffer): {
	pcm: Buffer;
	sampleRate: number;
} {
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

export class Qwen3Provider implements TTSProvider {
	readonly metadata: VoicePluginMetadata = {
		name: "qwen3-tts",
		version: "1.0.0",
		type: "tts",
		description:
			"Qwen3-TTS with voice cloning, voice design, and multilingual support",
		capabilities: [
			"voice-selection",
			"voice-cloning",
			"voice-design",
			"multilingual",
			"streaming",
		],
		local: true,
		emoji: "🗣️",
	};

	readonly voices: Voice[] = [
		{
			id: "Vivian",
			name: "Vivian",
			language: "zh",
			gender: "female",
			description: "Bright, slightly edgy young female",
		},
		{
			id: "Serena",
			name: "Serena",
			language: "zh",
			gender: "female",
			description: "Warm, gentle young female",
		},
		{
			id: "Ryan",
			name: "Ryan",
			language: "en",
			gender: "male",
			description: "Dynamic male with strong rhythmic drive",
		},
		{
			id: "Aiden",
			name: "Aiden",
			language: "en",
			gender: "male",
			description: "Sunny American male with clear midrange",
		},
		{
			id: "Dylan",
			name: "Dylan",
			language: "zh",
			gender: "male",
			description: "Youthful Beijing male, clear natural timbre",
		},
		{
			id: "Eric",
			name: "Eric",
			language: "zh",
			gender: "male",
			description: "Lively Chengdu male, slightly husky",
		},
		{
			id: "Uncle_Fu",
			name: "Uncle Fu",
			language: "zh",
			gender: "male",
			description: "Seasoned male, low mellow timbre",
		},
		{
			id: "Ono_Anna",
			name: "Ono Anna",
			language: "ja",
			gender: "female",
			description: "Playful Japanese female, light nimble timbre",
		},
		{
			id: "Sohee",
			name: "Sohee",
			language: "ko",
			gender: "female",
			description: "Warm Korean female with rich emotion",
		},
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
					this.dynamicVoices = data.map((v: unknown) => {
						const voice = v as Record<string, string>;
						return {
							id: voice.voice_id || voice.id || voice.name || String(v),
							name: voice.name || voice.voice_id || voice.id || String(v),
							language: voice.language || "en",
							gender:
								(voice.gender as "male" | "female" | "neutral") || "neutral",
							description: voice.description,
						};
					});
					// Merge dynamic voices with static defaults (deduplicate by id)
					const dynamicIds = new Set(this.dynamicVoices.map((v) => v.id));
					const merged = [
						...this.voices.filter((v) => !dynamicIds.has(v.id)),
						...this.dynamicVoices,
					];
					(this.voices as Voice[]) = merged;
				}
			}
		} catch {
			// Voice fetch failed, use defaults
		}
	}

	async synthesize(
		text: string,
		options?: TTSOptions,
	): Promise<TTSSynthesisResult> {
		const startTime = Date.now();
		const voice = options?.voice || this.config.voice;

		const speed = options?.speed ?? this.config.speed;
		const lang = this.config.language;
		const model = lang && lang !== "en" ? `tts-1-hd-${lang}` : "tts-1-hd";

		const requestBody = {
			input: text,
			voice: voice,
			model: model,
			response_format: this.config.responseFormat,
			speed: speed,
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

let ctx: WOPRPluginContext | null = null;
let provider: Qwen3Provider | null = null;
const cleanups: Array<() => void> = [];

const plugin: WOPRPlugin = {
	name: "voice-qwen3-tts",
	version: "1.0.0",
	description: "Qwen3-TTS by Alibaba Cloud",

	async init(context: WOPRPluginContext) {
		ctx = context;
		const config = ctx.getConfig<Qwen3Config>();
		provider = new Qwen3Provider(config);

		// Register config schema
		ctx.registerConfigSchema("voice-qwen3-tts", {
			title: "Qwen3-TTS Configuration",
			description: "Configure the Qwen3-TTS server connection",
			fields: [
				{
					name: "serverUrl",
					type: "text",
					label: "Server URL",
					placeholder: "http://qwen3-tts:8880",
					default: "http://qwen3-tts:8880",
					description: "URL of your Qwen3-TTS server",
				},
				{
					name: "voice",
					type: "text",
					label: "Default Voice",
					placeholder: "Vivian",
					default: "Vivian",
					description: "Default voice ID (e.g. Vivian, Ryan, Serena)",
				},
				{
					name: "language",
					type: "text",
					label: "Language",
					placeholder: "en",
					default: "en",
					description: "Language code (e.g. en, zh, ja, ko)",
				},
				{
					name: "speed",
					type: "text",
					label: "Speed",
					placeholder: "1.0",
					default: "1.0",
					description: "Playback speed (0.25-4.0)",
				},
			],
		});
		cleanups.push(() => ctx?.unregisterConfigSchema("voice-qwen3-tts"));

		try {
			provider.validateConfig();
			const healthy = await provider.healthCheck();
			if (healthy) {
				await provider.fetchVoices();
				ctx.registerExtension("tts", provider);
				cleanups.push(() => ctx?.unregisterExtension("tts"));
				ctx.log.info(
					`Qwen3 TTS registered (${config.serverUrl ?? DEFAULT_CONFIG.serverUrl})`,
				);
			} else {
				ctx.log.warn(
					`Qwen3 server not reachable at ${config.serverUrl ?? DEFAULT_CONFIG.serverUrl}`,
				);
			}
		} catch (error: unknown) {
			ctx.log.error(`Failed to init Qwen3 TTS: ${error}`);
		}
	},

	async shutdown() {
		for (const cleanup of cleanups.reverse()) {
			try {
				cleanup();
			} catch {
				// Ignore cleanup errors during shutdown
			}
		}
		cleanups.length = 0;
		if (provider) {
			await provider.shutdown();
			provider = null;
		}
		ctx = null;
	},
};

export default plugin;
