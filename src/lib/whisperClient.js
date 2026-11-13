import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Send recorded audio blob to local whisper.cpp backend endpoint `/api/stt/whisper`.
 */
export async function transcribeAudioWithWhisper(audioBlob, options = {}) {
  const formData = new FormData();
  const ext = audioBlob?.type?.includes("mp4")
    ? "m4a"
    : audioBlob?.type?.includes("ogg")
    ? "ogg"
    : audioBlob?.type?.includes("wav")
    ? "wav"
    : "webm";

  const file =
    audioBlob instanceof File
      ? audioBlob
      : new File([audioBlob], `dictation.${ext}`, {
          type: audioBlob?.type || "audio/webm",
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

function getSupportedRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

/**
 * React hook for local whisper.cpp voice dictation via MediaRecorder.
 */
export function useWhisperDictation({ onTranscript, onStatusChange, onError } = {}) {
  const [recordingField, setRecordingField] = useState(null);
  const [transcribingField, setTranscribingField] = useState(null);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const activeFieldRef = useRef(null);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      cleanupStream();
    };
  }, [cleanupStream]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const toggleFieldDictation = useCallback(
    async (field) => {
      // If currently transcribing, ignore additional clicks until finished
      if (transcribingField) return;

      // Pressing again on the active recording field stops & transcribes it
      if (recordingField === field) {
        stopRecording();
        return;
      }

      // If recording another field, stop it cleanly first
      if (recordingField && recorderRef.current) {
        stopRecording();
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        onError?.("Microphone audio recording is not supported in this browser.");
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

        streamRef.current = stream;
        chunksRef.current = [];
        activeFieldRef.current = field;

        const mimeType = getSupportedRecorderMimeType();
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        recorder.onstop = async () => {
          const targetField = activeFieldRef.current;
          const recordedType = recorder.mimeType || mimeType || "audio/webm";
          const audioBlob = new Blob(chunksRef.current, { type: recordedType });

          setRecordingField(null);
          cleanupStream();

          if (!audioBlob.size || audioBlob.size < 256) {
            onStatusChange?.("No audio captured. Please speak clearly into the microphone.");
            return;
          }

          setTranscribingField(targetField);
          onStatusChange?.("Transcribing locally with OpenAI whisper.cpp...");

          try {
            const result = await transcribeAudioWithWhisper(audioBlob, {
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
        };

        recorderRef.current = recorder;
        recorder.start(250);
        setRecordingField(field);
        onStatusChange?.("🎙️ Recording audio for local whisper.cpp — click Stop when finished.");
      } catch (err) {
        cleanupStream();
        setRecordingField(null);
        onError?.(
          err?.name === "NotAllowedError"
            ? "Microphone permission was denied. Please allow microphone access to dictate."
            : err?.message || "Could not start microphone recording."
        );
      }
    },
    [cleanupStream, onError, onStatusChange, onTranscript, recordingField, stopRecording, transcribingField]
  );

  return {
    recordingField,
    transcribingField,
    toggleFieldDictation,
    stopRecording,
  };
}
