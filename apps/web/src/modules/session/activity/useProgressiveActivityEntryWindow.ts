import {
  useEffect,
  useRef,
  useState
} from "react";

export function useProgressiveActivityEntryWindow({
  enabled,
  entrySignature,
  targetCount
}: {
  enabled: boolean;
  entrySignature: string;
  targetCount: number;
}) {
  const visibleCountRef = useRef(enabled ? 0 : targetCount);
  const [windowState, setWindowState] = useState(() => ({
    entrySignature,
    visibleCount: enabled ? 0 : targetCount
  }));
  const visibleCount =
    windowState.entrySignature === entrySignature
      ? windowState.visibleCount
      : enabled
        ? Math.min(visibleCountRef.current, targetCount)
        : targetCount;

  useEffect(() => {
    if (!enabled) {
      visibleCountRef.current = targetCount;
      setWindowState({ entrySignature, visibleCount: targetCount });
      return;
    }

    let isCancelled = false;
    let animationFrameId: number | null = null;
    let nextVisibleCount = Math.min(visibleCountRef.current, targetCount);

    visibleCountRef.current = nextVisibleCount;
    setWindowState({ entrySignature, visibleCount: nextVisibleCount });

    const renderNextEntry = () => {
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        if (isCancelled) {
          return;
        }

        nextVisibleCount = Math.min(targetCount, nextVisibleCount + 1);
        visibleCountRef.current = nextVisibleCount;
        setWindowState({ entrySignature, visibleCount: nextVisibleCount });

        if (nextVisibleCount < targetCount) {
          renderNextEntry();
        }
      });
    };

    renderNextEntry();

    return () => {
      isCancelled = true;
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [enabled, entrySignature, targetCount]);

  return { visibleCount };
}
