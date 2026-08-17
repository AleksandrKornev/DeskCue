import { useEffect, useRef, useState } from "react";

import type { PreviewCandidate, SessionDetail } from "@deskcue/protocol";
import { previewApi } from "@api/endpoint/preview/endpoints";
import { resolvePreviewOwnerIdentity } from "@models/sessionPreview";

export function usePreviewCandidates(session: SessionDetail | null, enabled: boolean) {
  const [candidates, setCandidates] = useState<PreviewCandidate[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const operationRef = useRef(0);
  const owner = resolvePreviewOwnerIdentity(session);
  const ownerId = owner?.ownerId ?? "";
  const ownerKind = owner?.kind ?? null;

  useEffect(() => {
    if (!enabled || !ownerKind || !ownerId) {
      operationRef.current += 1;
      setCandidates([]);
      setError("");
      setLoading(false);
      return;
    }

    const operation = ++operationRef.current;
    const controller = new AbortController();
    setCandidates([]);
    setError("");
    setLoading(true);
    void previewApi.discoverCandidates(
      { kind: ownerKind, ownerId },
      controller.signal
    ).then((result) => {
      if (operationRef.current === operation) setCandidates(result.candidates);
    }).catch((loadError: unknown) => {
      if (controller.signal.aborted || operationRef.current !== operation) return;
      setError(loadError instanceof Error ? loadError.message : "Failed to find local preview apps");
    }).finally(() => {
      if (operationRef.current === operation) setLoading(false);
    });

    return () => controller.abort();
  }, [enabled, ownerId, ownerKind]);

  return { candidates, error, loading };
}
