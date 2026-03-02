/**
 * @fileoverview Custom React Hook for Voice-to-Text Transcription using Mistral Voxtral.
 *
 * Problem: The browser's built-in SpeechRecognition is often inaccurate for technical
 * discussions (e.g., system design).
 *
 * Solution: Record the user's voice as high-quality audio using MediaRecorder and
 * send the resulting blob to our Mistral-powered transcription API.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeVoice } from "../lib/api";

// Error categories for better UI messages
export type VoiceErrorCode =
  | "unsupported"
  | "denied"
  | "capture"
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
  isSupported: boolean | null;  // Does this browser support recording?
  isRecording: boolean;         // Is the microphone currently active?
  isTranscribing: boolean;      // Is the API currently processing the audio?
  transcript: string;           // Final transcribed text from Mistral
  interimTranscript: string;    // Temporary status (e.g., "Transcribing...")
  fullTranscript: string;       // Combined view for the UI
  error: VoiceError | null;     // Any errors that occurred
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  clearTranscript: () => void;
};

/**
 * The useVoiceTranscript Hook
 */
export function useVoiceTranscript(): UseVoiceTranscriptResult {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<VoiceError | null>(null);

  /**
   * Effect: Check for browser support on initial load.
   */
  useEffect(() => {
    setIsSupported(typeof window !== "undefined" && !!window.navigator?.mediaDevices?.getUserMedia);
  }, []);

  /**
   * Action: Reset the transcript state.
   */
  const clearTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setError(null);
  }, []);

  /**
   * Action: Activate the microphone and start recording.
   */
  const startRecording = useCallback(async () => {
    if (isRecording || isTranscribing) return;

    setError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Prefer high-quality audio formats if available
      const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? { mimeType: "audio/webm;codecs=opus" }
        : {};

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        
        // Final cleanup of the stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        if (audioBlob.size < 100) {
          // Ignore very short/empty recordings
          setIsTranscribing(false);
          setInterimTranscript("");
          return;
        }

        // Start transcription phase
        setIsTranscribing(true);
        setInterimTranscript("Transcribing with Mistral...");

        try {
          const result = await transcribeVoice(audioBlob, "recording.webm");
          setTranscript(result.text);
          setInterimTranscript("");
        } catch (err) {
          console.error("Transcription failed:", err);
          setError({
            code: "network",
            message: err instanceof Error ? err.message : "Mistral transcription failed. Please try again."
          });
          setInterimTranscript("");
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access failed:", err);
      setError({
        code: "denied",
        message: "Microphone permission denied or unavailable. Please check browser settings."
      });
    }
  }, [isRecording, isTranscribing]);

  /**
   * Action: Turn off the microphone and trigger transcription.
   */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  // Combined transcript for the UI
  const fullTranscript = interimTranscript || transcript;

  return {
    isSupported,
    isRecording,
    isTranscribing,
    transcript,
    interimTranscript,
    fullTranscript,
    error,
    startRecording,
    stopRecording,
    clearTranscript
  };
}
