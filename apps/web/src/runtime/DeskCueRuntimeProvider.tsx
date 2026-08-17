import {
  useLayoutEffect,
  useRef,
  useState
} from "react";
import type { ReactNode } from "react";

import {
  activateDeskCueRuntime,
  releaseDeskCueRuntime
} from "./config";
import { DeskCueRuntimeContext } from "./DeskCueRuntimeContext";
import type { DeskCueRuntime } from "./types";

export function DeskCueRuntimeProvider({
  children,
  runtime
}: {
  children: ReactNode;
  runtime: DeskCueRuntime;
}) {
  const ownerRef = useRef<symbol>(undefined);
  const [activeRuntime, setActiveRuntime] = useState<DeskCueRuntime | null>(null);
  ownerRef.current ??= Symbol("deskcue-runtime-provider");

  useLayoutEffect(() => {
    const owner = ownerRef.current;
    if (owner) {
      activateDeskCueRuntime(owner, runtime);
      setActiveRuntime(runtime);
    }
    return () => {
      if (owner) {
        releaseDeskCueRuntime(owner);
      }
    };
  }, [runtime]);

  return (
    <DeskCueRuntimeContext.Provider value={runtime}>
      {/* Keep Context and imperative consumers on the same committed runtime. */}
      {activeRuntime === runtime ? children : null}
    </DeskCueRuntimeContext.Provider>
  );
}
