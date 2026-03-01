/**
 * @fileoverview Custom React Hook for Voice-to-Text Transcription.
 *
 * Problem: We want users to be able to "speak" to the AI. This requires
 * connecting to the browser's Microphone and using a Speech Recognition API.
 *
 * Solution: This hook wraps the standard Web Speech API (SpeechRecognition).
 * It handles starting/stopping the microphone, processing "interim" results
 * (words the AI is still guessing), and "final" results (confirmed words).
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Error categories for better UI messages
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

/**
 * The data structure returned by this hook to the UI component.
 */
type UseVoiceTranscriptResult = {
  isSupported: boolean | null; // Does this browser support Speech API?
  isRecording: boolean;        // Is the microphone currently active?
  transcript: string;          // Confirmed (final) words
  interimTranscript: string;   // Guessing (in-progress) words
  fullTranscript: string;      // Combination of both
  error: VoiceError | null;    // Any errors that occurred
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  clearTranscript: () => void;
};

/**
 * Problem: Browser error messages are often technical and confusing.
 * Solution: Map browser errors to user-friendly messages.
 */
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

/**
 * Helper: Find the correct SpeechRecognition object (handling browser differences).
 */
function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  // Chrome uses webkitSpeechRecognition, others use SpeechRecognition
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * The useVoiceTranscript Hook
 */
export function useVoiceTranscript(): UseVoiceTranscriptResult {
  // Use a 'ref' to store the SpeechRecognition instance so it persists
  // without triggering re-renders unless we want them.
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptRef = useRef("");

  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<VoiceError | null>(null);

  /**
   * Effect: Check for browser support on initial load.
   */
  useEffect(() => {
    setIsSupported(getRecognitionConstructor() !== null);
  }, []);

  /**
   * Action: Reset the transcript state.
   */
  const clearTranscript = useCallback(() => {
    finalTranscriptRef.current = "";
    setTranscript("");
    setInterimTranscript("");
  }, []);

  /**
   * Action: Activate the microphone and start transcribing.
   */
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

    // Initial check: Does the user even allow microphone access?
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the test stream immediately after checking permission
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setError({
        code: "denied",
        message: "Microphone permission denied. Allow microphone access and try again."
      });
      return;
    }

    // Reuse or create the recognition object
    const recognition = recognitionRef.current ?? new Recognition();
    recognitionRef.current = recognition;

    // Configure recognition
    recognition.continuous = true;      // Keep listening until we manually stop
    recognition.interimResults = true;  // Show "guessing" words in real-time
    recognition.lang = "en-US";         // Set language to English

    // Define Event Handlers
    recognition.onstart = () => {
      setIsRecording(true);
      setError(null);
    };

    /**
     * Event: The browser has processed some speech.
     * Problem: Results come in pieces (final and interim).
     * Solution: Loop through all results and combine them correctly.
     */
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

      // Update state so the UI shows the new text
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

    // Actually start listening!
    recognition.start();
  }, [isRecording]);

  /**
   * Action: Turn off the microphone.
   */
  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  /**
   * Computed Value: Combine confirmed and guessing words for the UI.
   */
  const fullTranscript = useMemo(() => {
    if (!interimTranscript) {
      return transcript;
    }

    return `${transcript} ${interimTranscript}`.trim();
  }, [interimTranscript, transcript]);

  // Return everything the UI component needs
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
