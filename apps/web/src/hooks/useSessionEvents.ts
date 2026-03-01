import { useEffect, useRef } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function useSessionEvents(sessionId: string | null, callbacks: {
  onArtifactReady?: (kind: string, ids: string[]) => void;
  onJobFailed?: (error: string) => void;
}) {
  const { onArtifactReady, onJobFailed } = callbacks;
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
    const url = `${base}/api/sessions/${sessionId}/events`;
    
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "artifact_ready") {
          onArtifactReady?.(payload.kind, payload.artifact_ids);
        } else if (payload.type === "job_failed") {
          onJobFailed?.(payload.error);
        }
      } catch (error) {
        console.error("Failed to parse SSE message:", error);
      }
    };

    eventSource.addEventListener("connected", (event: any) => {
       console.log("SSE Connected:", event.data);
    });

    eventSource.onerror = (error) => {
      console.error("SSE Error:", error);
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [sessionId, onArtifactReady, onJobFailed]);
}
