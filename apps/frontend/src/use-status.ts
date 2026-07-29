import { useMTP } from "@methanium/status-mtp";
import { useEffect, useState } from "react";

import { parseSnapshot, type Snapshot } from "./status";

export function useStatus() {
  const { contextReady, error: connectionError, send, subscribe } = useMTP();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!contextReady) {
      console.info("[Status] waiting for MTP readiness", {
        connectionError,
      });
      return;
    }

    console.info("[Status] MTP ready; subscribing and requesting snapshot");

    const receive = (message: { data: unknown }) => {
      try {
        const nextSnapshot = parseSnapshot(message);
        console.info("[Status] received snapshot", {
          categories: nextSnapshot.categories.length,
          incidents: nextSnapshot.incidents.length,
          generatedAt: nextSnapshot.generatedAt,
        });
        setSnapshot(nextSnapshot);
        setError(null);
      } catch (cause) {
        const nextError =
          cause instanceof Error ? cause : new Error(String(cause));
        console.error("[Status] failed to parse snapshot", nextError, message);
        setError(nextError);
      }
    };
    const unsubscribe = subscribe("StatusSnapshot", receive);
    void send("GetStatus", {}, { responseType: "StatusSnapshot" })
      .then(receive)
      .catch((cause) => {
        const nextError =
          cause instanceof Error ? cause : new Error(String(cause));
        console.error("[Status] snapshot request failed", nextError);
        setError(nextError);
      });
    return unsubscribe;
  }, [connectionError, contextReady, send, subscribe]);

  return {
    snapshot,
    connected: contextReady,
    error: error ?? connectionError,
  };
}
