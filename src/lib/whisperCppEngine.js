import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initWhisper } from "@fugood/whisper.node";

const execFileAsync = promisify(execFile);

const HF_MODEL_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export const WHISPER_MODEL_PRESETS = {
  "tiny.en-q5_1": "ggml-tiny.en-q5_1.bin",
  "tiny.en": "ggml-tiny.en.bin",
  "base.en-q5_1": "ggml-base.en-q5_1.bin",
  "base.en": "ggml-base.en.bin",
  "small.en-q5_1": "ggml-small.en-q5_1.bin",
};

const DENTAL_DOMAIN_PROMPT =
  "CEU Dental Clinic Oral Diagnosis Form: caries, mandibular, maxillary, periapical, radiolucency, gingivitis, periodontitis, prophylaxis, amalgam, composite, TMJ, percussion, palpation.";

export const FIELD_DENTAL_PROMPTS = {
  historyOfPresentIllness:
    "Chief complaint onset, pain duration, cold or heat sensitivity, swelling, percussion tenderness, spontaneous pain, analgesic relief.",
  radiographicInterpretation:
    "Periapical radiograph, panoramic film, radiolucency, radiopacity, lamina dura, PDL widening, bone loss, furcation involvement, apex, root canal.",
  ciRemarks:
    "Clinical instructor remarks, case evaluation, cavity preparation, margins, occlusion check, anesthesia, patient cooperation, approved for next step.",
  chairsideProgressNote:
    "Chairside progress note, anesthesia administered, carpule, lidocaine, rubber dam isolation, caries excavation, restoration, composite, temporary filling, hemostasis.",
  handoffSummary:
    "Shift handoff instructions, next visit plan, pending radiograph, complete excavation, permanent restoration, suture removal, recall interval, medical alert precaution.",
};

export function normalizeDentalTranscript(rawText = "") {
  let cleaned = String(rawText || "")
    .replace(/\[(?:BLANK_AUDIO|MUSIC|SILENCE)\]/gi, " ")
    .replace(/\b(tooth)\s+(?:number|no\.?)\s*#?\s*(\d{1,2})\b/gi, (_, word, num) => `${word} #${num}`)
    .replace(/\b(teeth)\s+(?:numbers?|nos?\.?)\s*#?\s*(\d{1,2})\b/gi, (_, word, num) => `${word} #${num}`)
    .replace(/\b(tooth|teeth)\s+#\s+(\d{1,2})\b/gi, (_, word, num) => `${word} #${num}`)
    .replace(/#\s+(\d{1,2})\b/g, "#$1")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  cleaned = cleaned.replace(/^([a-z])/, (_, ch) => ch.toUpperCase());
  cleaned = cleaned.replace(/([.!?]\s+)([a-z])/g, (_, punct, ch) => `${punct}${ch.toUpperCase()}`);
  return cleaned;
}

let contextInstance = null;
let initPromise = null;

function resolveWhisperConfig() {
  const customPath = (process.env.WHISPER_CPP_MODEL_PATH || "").trim();
  const presetKey = (process.env.WHISPER_CPP_MODEL || "base.en-q5_1").trim();
  const fileName =
    WHISPER_MODEL_PRESETS[presetKey] ||
    (presetKey.endsWith(".bin") ? presetKey : `ggml-${presetKey}.bin`);
  const cacheDir =
    (process.env.WHISPER_CPP_CACHE_DIR || "").trim() ||
    path.join(os.homedir(), ".cache", "whisper.cpp");
  const modelPath = customPath || path.join(cacheDir, fileName);
  const useGpu = process.env.WHISPER_CPP_USE_GPU === "true";
  const maxThreads = Math.max(
    1,
    Number(process.env.WHISPER_CPP_THREADS || Math.min(4, os.cpus().length || 2))
  );

  return {
    modelId: customPath ? path.basename(customPath, ".bin") : `ggml-${presetKey}`,
    fileName,
    cacheDir,
    modelPath,
    useGpu,
    maxThreads,
  };
}

async function ensureModelDownloaded(modelPath, fileName) {
  if (fs.existsSync(modelPath)) {
    const stat = await fsp.stat(modelPath);
    if (stat.size > 1024 * 1024) return;
  }

  await fsp.mkdir(path.dirname(modelPath), { recursive: true });
  const url = `${HF_MODEL_BASE}/${fileName}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Whisper model ${fileName} (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const tmpPath = `${modelPath}.part-${Date.now()}`;
  await fsp.writeFile(tmpPath, buffer);
  await fsp.rename(tmpPath, modelPath);
}

/**
 * Lazily initialize and reuse a singleton local whisper.cpp context.
 */
export async function getWhisperContext() {
  if (contextInstance) return contextInstance;

  if (!initPromise) {
    initPromise = (async () => {
      const cfg = resolveWhisperConfig();
      await ensureModelDownloaded(cfg.modelPath, cfg.fileName);
      const ctx = await initWhisper({
        filePath: cfg.modelPath,
        useGpu: cfg.useGpu,
      });
      contextInstance = ctx;
      return ctx;
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }

  return initPromise;
}

export function getWhisperStatus() {
  const cfg = resolveWhisperConfig();
  const cached = fs.existsSync(cfg.modelPath);
  return {
    provider: "whisper.cpp",
    ready: Boolean(contextInstance) || cached,
    initialized: Boolean(contextInstance),
    cached,
    modelId: cfg.modelId,
    modelFile: cfg.fileName,
    useGpu: cfg.useGpu,
    maxThreads: cfg.maxThreads,
  };
}

function guessAudioExt(mimeType = "") {
  const m = mimeType.toLowerCase();
  if (m.includes("webm")) return ".webm";
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("mp4") || m.includes("m4a")) return ".m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  if (m.includes("wav")) return ".wav";
  return ".audio";
}

/**
 * Transcode uploaded audio buffer to 16kHz mono PCM16 WAV via ffmpeg and
 * transcribe locally using whisper.cpp.
 */
export async function runTranscribeWithWhisper(audioBuffer, options = {}) {
  const cfg = resolveWhisperConfig();
  const ctx = await getWhisperContext();

  const tempId = crypto.randomUUID();
  const isWav =
    audioBuffer.length >= 12 &&
    audioBuffer.subarray(0, 4).toString() === "RIFF" &&
    audioBuffer.subarray(8, 12).toString() === "WAVE";

  const wavPath = path.join(os.tmpdir(), `whisper_wav_${tempId}.wav`);
  const inputExt = guessAudioExt(options.mimeType || "");
  const inputPath = path.join(os.tmpdir(), `whisper_in_${tempId}${inputExt}`);

  const fieldSuffix =
    options.field && FIELD_DENTAL_PROMPTS[options.field]
      ? ` ${FIELD_DENTAL_PROMPTS[options.field]}`
      : "";
  const effectivePrompt = options.prompt || `${DENTAL_DOMAIN_PROMPT}${fieldSuffix}`;

  const t0 = Date.now();
  try {
    if (isWav) {
      // Direct pass-through for 16kHz mono WAV generated by browser Web Audio API (no ffmpeg needed!)
      await fsp.writeFile(wavPath, audioBuffer);
    } else {
      await fsp.writeFile(inputPath, audioBuffer);
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wavPath,
      ]);
    }

    const { promise } = ctx.transcribeFile(wavPath, {
      language: options.language || "en",
      maxThreads: cfg.maxThreads,
      beamSize: 1,
      bestOf: 1,
      temperature: 0.0,
      prompt: effectivePrompt,
    });

    const out = await promise;
    const text = normalizeDentalTranscript(out?.result || "");
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

    return {
      provider: "whisper.cpp",
      modelId: cfg.modelId,
      text,
      wordCount,
      segments: Array.isArray(out?.segments) ? out.segments : [],
      language: out?.language || options.language || "en",
      durationMs: Date.now() - t0,
    };
  } finally {
    await Promise.allSettled([
      fsp.unlink(inputPath),
      fsp.unlink(wavPath),
    ]);
  }
}
