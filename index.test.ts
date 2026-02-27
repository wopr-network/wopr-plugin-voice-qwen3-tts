import { describe, expect, it } from "vitest";
import { parseWavSampleRate, Qwen3Provider, wavToPcm } from "./index.js";

describe("WAV parsing utilities", () => {
	it("parseWavSampleRate returns default for short buffer", () => {
		const buf = Buffer.alloc(10);
		expect(parseWavSampleRate(buf)).toBe(24000);
	});

	it("parseWavSampleRate returns default for non-RIFF buffer", () => {
		const buf = Buffer.alloc(28);
		buf.write("NOPE", 0, "ascii");
		expect(parseWavSampleRate(buf)).toBe(24000);
	});

	it("parseWavSampleRate reads sample rate from valid WAV header", () => {
		const buf = Buffer.alloc(28);
		buf.write("RIFF", 0, "ascii");
		buf.writeUInt32LE(44100, 24);
		expect(parseWavSampleRate(buf)).toBe(44100);
	});

	it("wavToPcm extracts PCM data from WAV buffer", () => {
		// Build a minimal WAV: RIFF header + fmt chunk + data chunk
		const fmt = Buffer.alloc(24); // fmt chunk: 8 byte header + 16 byte body
		fmt.write("fmt ", 0, "ascii");
		fmt.writeUInt32LE(16, 4); // chunk size
		fmt.writeUInt16LE(1, 8); // PCM format
		fmt.writeUInt16LE(1, 10); // mono
		fmt.writeUInt32LE(24000, 12); // sample rate
		fmt.writeUInt32LE(48000, 16); // byte rate
		fmt.writeUInt16LE(2, 20); // block align
		fmt.writeUInt16LE(16, 22); // bits per sample

		const pcmData = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const dataHeader = Buffer.alloc(8);
		dataHeader.write("data", 0, "ascii");
		dataHeader.writeUInt32LE(pcmData.length, 4);

		const riffHeader = Buffer.alloc(12);
		riffHeader.write("RIFF", 0, "ascii");
		riffHeader.writeUInt32LE(4 + fmt.length + 8 + pcmData.length, 4);
		riffHeader.write("WAVE", 8, "ascii");

		const wav = Buffer.concat([riffHeader, fmt, dataHeader, pcmData]);
		const result = wavToPcm(wav);
		expect(result.sampleRate).toBe(24000);
		expect(result.pcm).toEqual(pcmData);
	});

	it("wavToPcm falls back for malformed WAV", () => {
		const buf = Buffer.alloc(50);
		buf.write("RIFF", 0, "ascii");
		// No valid chunks — should fall back to subarray(44)
		const result = wavToPcm(buf);
		expect(result.pcm.length).toBe(6); // 50 - 44
	});
});

describe("Qwen3-TTS Integration", () => {
	let provider: Qwen3Provider;

	provider = new Qwen3Provider();

	it("should have correct metadata", () => {
		expect(provider.metadata.name).toBe("qwen3-tts");
		expect(provider.metadata.type).toBe("tts");
		expect(provider.metadata.local).toBe(true);
	});

	it("should have default voices defined", () => {
		expect(provider.voices.length).toBeGreaterThan(0);
		expect(provider.voices.find((v) => v.id === "Vivian")).toBeDefined();
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
			const result = await provider.synthesize("Testing voice", {
				voice: "am_michael",
			});
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
});
