"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type VoiceErrorCode =
  | "unsupported"
  | "denied"
  | "capture"
  | "no-speech"
  | "network"
  | "aborted"
  | "unknown";

export type VoiceError = {
  code: VoiceErrorCode;
  message: string;
};

type UseVoiceTranscriptResult = {
  isSupported: boolean | null;
  isRecording: boolean;
  transcript: string;
  interimTranscript: string;
  fullTranscript: string;
  error: VoiceError | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  clearTranscript: () => void;
};

function mapRecognitionError(error: string): VoiceError {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return {
        code: "denied",
        message: "Microphone permission denied. Allow microphone access and try again."
      };
    case "audio-capture":
      return {
        code: "capture",
        message: "No microphone input detected. Check your device and browser mic settings."
      };
    case "no-speech":
      return {
        code: "no-speech",
        message: "No speech detected. Try speaking louder or closer to the microphone."
      };
    case "network":
      return {
        code: "network",
        message: "Speech recognition network error. Please retry."
      };
    case "aborted":
      return {
        code: "aborted",
        message: "Recording stopped before transcription completed."
      };
    default:
      return {
        code: "unknown",
        message: "Voice capture failed due to an unknown browser error."
      };
  }
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function useVoiceTranscript(): UseVoiceTranscriptResult {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptRef = useRef("");

  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<VoiceError | null>(null);

  useEffect(() => {
    setIsSupported(getRecognitionConstructor() !== null);
  }, []);

  const clearTranscript = useCallback(() => {
    finalTranscriptRef.current = "";
    setTranscript("");
    setInterimTranscript("");
  }, []);

  const startRecording = useCallback(async () => {
    const Recognition = getRecognitionConstructor();

    if (!Recognition) {
      setError({
        code: "unsupported",
        message:
          "Speech recognition is unavailable in this browser. Use Chromium-based browsers for voice input."
      });
      return;
    }

    if (isRecording) {
      return;
    }

    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setError({
        code: "denied",
        message: "Microphone permission denied. Allow microphone access and try again."
      });
      return;
    }

    const recognition = recognitionRef.current ?? new Recognition();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsRecording(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let interim = "";
      let finalValue = finalTranscriptRef.current;

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const piece = event.results[index][0]?.transcript ?? "";
        if (event.results[index].isFinal) {
          finalValue = `${finalValue} ${piece}`.trim();
        } else {
          interim = `${interim} ${piece}`.trim();
        }
      }

      finalTranscriptRef.current = finalValue;
      setTranscript(finalValue);
      setInterimTranscript(interim);
    };

    recognition.onerror = (event) => {
      setIsRecording(false);
      setError(mapRecognitionError(event.error));
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.start();
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  const fullTranscript = useMemo(() => {
    if (!interimTranscript) {
      return transcript;
    }

    return `${transcript} ${interimTranscript}`.trim();
  }, [interimTranscript, transcript]);

  return {
    isSupported,
    isRecording,
    transcript,
    interimTranscript,
    fullTranscript,
    error,
    startRecording,
    stopRecording,
    clearTranscript
  };
}
