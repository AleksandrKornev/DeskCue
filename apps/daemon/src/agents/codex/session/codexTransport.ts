import { getCodexSessionRuntimeContext } from "#agents/codex/codexFacade";
import type { CodexSessionRuntimeContext } from "#agents/codex/codexFacade";

import { buildCodexResumeInvocation } from "./codexResumeInvocation.ts";
import {
  resolvePreferredCodexExecutable,
  resolvePreferredCodexModel
} from "../discovery/codexCli.ts";

type BuildCodexResumeTransportInput = {
  prompt?: string;
  runtimeContext?: CodexSessionRuntimeContext | null;
  sourceSessionId: string;
};

export async function buildCodexResumeTransport({
  prompt,
  runtimeContext: providedRuntimeContext,
  sourceSessionId
}: BuildCodexResumeTransportInput) {
  const codexExecutable = await resolvePreferredCodexExecutable();
  const runtimeContext =
    providedRuntimeContext === undefined
      ? await getCodexSessionRuntimeContext(sourceSessionId)
      : providedRuntimeContext;
  const codexModel = await resolvePreferredCodexModel(runtimeContext?.model ?? null);
  const { command, args } = buildCodexResumeInvocation({
    sessionId: sourceSessionId,
    prompt,
    executable: codexExecutable,
    model: codexModel,
    runtimeContext
  });

  return {
    command,
    spawnSpec: {
      closeStdin: Boolean(prompt?.trim()),
      file: codexExecutable,
      args,
      surviveParentExit: Boolean(prompt?.trim()),
      transport: prompt?.trim() ? ("pipe" as const) : ("pty" as const)
    }
  };
}
