import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Downsample Float32Array audio samples to target sample rate (16kHz for whisper.cpp).
 */
function downsamplePCM(buffer, fromSampleRate, toSampleRate = 16000) {
  if (toSampleRate === fromSampleRate || !fromSampleRate) {
    return buffer;
  }
  const sampleRateRatio = fromSampleRate / toSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

/**
 * Encode raw Float32 audio samples into a standard 16-bit mono PCM WAV blob.
 * This directly matches what whisper.cpp expects (16kHz mono 16-bit PCM),
 * eliminating the need for server-side FFmpeg installation.
 */
function encodeWavBlob(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /* RIFF identifier */
  writeString(0, "RIFF");
  /* file length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(8, "WAVE");
  /* format chunk identifier */
  writeString(12, "fmt ");
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM = 1) */
  view.setUint16(20, 1, true);
  /* channel count (mono = 1) */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(36, "data");
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Send recorded audio blob to local whisper.cpp backend endpoint `/api/stt/whisper`.
 */
export async function transcribeAudioWithWhisper(audioBlob, options = {}) {
  const formData = new FormData();
  const ext = audioBlob?.type?.includes("wav")
    ? "wav"
    : audioBlob?.type?.includes("mp4")
    ? "m4a"
    : audioBlob?.type?.includes("ogg")
    ? "ogg"
    : "webm";

  const file =
    audioBlob instanceof File
      ? audioBlob
      : new File([audioBlob], `dictation.${ext}`, {
          type: audioBlob?.type || "audio/wav",
        });

  formData.append("audio", file);
  if (options.language) formData.append("language", options.language);
  if (options.field) formData.append("field", options.field);
  if (options.prompt) formData.append("prompt", options.prompt);

  const response = await fetch("/api/stt/whisper", {
    method: "POST",
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Whisper.cpp transcription failed (HTTP ${response.status})`);
  }

  return payload;
}

/**
 * React hook for local whisper.cpp voice dictation.
 * Records audio directly in 16kHz mono 16-bit PCM WAV using the Web Audio API,
 * allowing whisper.cpp to transcribe immediately without requiring FFmpeg on the server.
 */
export function useWhisperDictation({ onTranscript, onStatusChange, onError } = {}) {
  const [recordingField, setRecordingField] = useState(null);
  const [transcribingField, setTranscribingField] = useState(null);

  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const muteRef = useRef(null);
  const pcmChunksRef = useRef([]);
  const actualSampleRateRef = useRef(16000);
  const activeFieldRef = useRef(null);
  const isRecordingRef = useRef(false);

  const cleanupAudio = useCallback(() => {
    isRecordingRef.current = false;

    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (processorRef.current) {
      try {
        processorRef.current.onaudioprocess = null;
        processorRef.current.disconnect();
      } catch { /* ignore */ }
      processorRef.current = null;
    }
    if (muteRef.current) {
      try { muteRef.current.disconnect(); } catch { /* ignore */ }
      muteRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      try { audioCtxRef.current.close(); } catch { /* ignore */ }
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch { /* ignore */ }
      streamRef.current = null;
    }
    pcmChunksRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  const finishRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    const targetField = activeFieldRef.current;
    const capturedChunks = [...pcmChunksRef.current];
    const sourceSampleRate = actualSampleRateRef.current || 16000;

    cleanupAudio();
    setRecordingField(null);

    let totalSamples = 0;
    for (const chunk of capturedChunks) {
      totalSamples += chunk.length;
    }

    // Require at least ~0.3s of audio (e.g. 4800 samples at 16kHz)
    if (totalSamples < 4800) {
      onStatusChange?.("No speech detected. Please speak clearly into the microphone.");
      return;
    }

    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of capturedChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Downsample to 16kHz if necessary
    const pcm16k = downsamplePCM(merged, sourceSampleRate, 16000);
    const wavBlob = encodeWavBlob(pcm16k, 16000);

    setTranscribingField(targetField);
    onStatusChange?.("Transcribing locally with OpenAI whisper.cpp...");

    try {
      const result = await transcribeAudioWithWhisper(wavBlob, {
        field: targetField,
        language: "en",
      });
      const transcript = (result?.text || "").trim();
      if (transcript) {
        onTranscript?.(targetField, transcript, result);
        onStatusChange?.(
          `✓ Transcribed locally via whisper.cpp (${result.modelId || "base.en-q5_1"}, ${
            result.durationMs || 0
          }ms)`
        );
      } else {
        onStatusChange?.("No speech detected in recording.");
      }
    } catch (err) {
      const msg = err?.message || "whisper.cpp transcription failed.";
      onError?.(msg);
    } finally {
      setTranscribingField(null);
    }
  }, [cleanupAudio, onError, onStatusChange, onTranscript]);

  const stopRecording = useCallback(() => {
    if (isRecordingRef.current) {
      finishRecording();
    }
  }, [finishRecording]);

  const toggleFieldDictation = useCallback(
    async (field) => {
      // If currently transcribing, ignore clicks until finished
      if (transcribingField) return;

      // Pressing again on the active field stops & transcribes it
      if (recordingField === field && isRecordingRef.current) {
        finishRecording();
        return;
      }

      // If recording another field, stop cleanly first
      if (isRecordingRef.current) {
        await finishRecording();
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        onError?.("Microphone access is not supported in this browser.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
          onError?.("Web Audio API is not supported in this browser.");
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        let audioCtx;
        try {
          audioCtx = new AudioContextClass({ sampleRate: 16000 });
        } catch {
          audioCtx = new AudioContextClass();
        }

        actualSampleRateRef.current = audioCtx.sampleRate || 16000;
        audioCtxRef.current = audioCtx;
        streamRef.current = stream;
        pcmChunksRef.current = [];
        activeFieldRef.current = field;

        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;

        // Buffer size 4096 gives smooth streaming of PCM frames
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (!isRecordingRef.current) return;
          const inputData = e.inputBuffer.getChannelData(0);
          pcmChunksRef.current.push(new Float32Array(inputData));
        };

        // Mute node to prevent microphone audio from playing through speakers (no echo/feedback)
        const muteNode = audioCtx.createGain();
        muteNode.gain.value = 0;
        muteRef.current = muteNode;

        source.connect(processor);
        processor.connect(muteNode);
        muteNode.connect(audioCtx.destination);

        isRecordingRef.current = true;
        setRecordingField(field);
        onStatusChange?.("🎙️ Recording audio for local whisper.cpp — click Stop when finished.");
      } catch (err) {
        cleanupAudio();
        setRecordingField(null);
        onError?.(
          err?.name === "NotAllowedError"
            ? "Microphone permission was denied. Please allow microphone access to dictate."
            : err?.message || "Could not start microphone recording."
        );
      }
    },
    [cleanupAudio, finishRecording, onError, onStatusChange, recordingField, transcribingField]
  );

  return {
    recordingField,
    transcribingField,
    toggleFieldDictation,
    stopRecording,
  };
}
