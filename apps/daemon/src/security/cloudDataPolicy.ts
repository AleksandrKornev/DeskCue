export type CloudDataPayloadKind =
  | "artifact"
  | "code"
  | "diff"
  | "event-cursor"
  | "metadata"
  | "source-version"
  | "transcript";

export type CloudDataScope = {
  agentSessionId?: string | null;
  deviceId?: string | null;
  sessionId?: string | null;
  workspaceId?: string | null;
  workspacePath?: string | null;
};

export type CloudDataPolicyInput = {
  kind: CloudDataPayloadKind;
  optIn: boolean;
  redactionApplied: boolean;
  scope: CloudDataScope;
};

export type CloudDataPolicyDecision = {
  allowed: boolean;
  reason: string | null;
  requiresOptIn: boolean;
  requiresRedaction: boolean;
};

const heavyPayloadKinds = new Set<CloudDataPayloadKind>([
  "artifact",
  "code",
  "diff",
  "transcript"
]);

function deny(
  reason: string,
  requirements: Pick<CloudDataPolicyDecision, "requiresOptIn" | "requiresRedaction">
): CloudDataPolicyDecision {
  return {
    allowed: false,
    reason,
    ...requirements
  };
}

function hasDeviceScope(scope: CloudDataScope) {
  return Boolean(scope.deviceId);
}

function hasWorkspaceScope(scope: CloudDataScope) {
  return Boolean(scope.workspaceId || scope.workspacePath);
}

function hasSessionScope(scope: CloudDataScope) {
  return Boolean(scope.sessionId || scope.agentSessionId);
}

export function decideCloudDataTransfer({
  kind,
  optIn,
  redactionApplied,
  scope
}: CloudDataPolicyInput): CloudDataPolicyDecision {
  const requiresOptIn = heavyPayloadKinds.has(kind);
  const requiresRedaction = heavyPayloadKinds.has(kind);

  if (!hasDeviceScope(scope)) {
    return deny("Cloud data transfer must be scoped to a device.", {
      requiresOptIn,
      requiresRedaction
    });
  }

  if (!hasWorkspaceScope(scope)) {
    return deny("Cloud data transfer must be scoped to a workspace.", {
      requiresOptIn,
      requiresRedaction
    });
  }

  if (requiresOptIn && !hasSessionScope(scope)) {
    return deny("Heavy cloud data transfer must be scoped to a session.", {
      requiresOptIn,
      requiresRedaction
    });
  }

  if (requiresOptIn && !optIn) {
    return deny("Heavy cloud data transfer requires explicit opt-in.", {
      requiresOptIn,
      requiresRedaction
    });
  }

  if (requiresRedaction && !redactionApplied) {
    return deny("Heavy cloud data transfer requires local redaction first.", {
      requiresOptIn,
      requiresRedaction
    });
  }

  return {
    allowed: true,
    reason: null,
    requiresOptIn,
    requiresRedaction
  };
}

function isCloudMetricSensitiveKey(key: string) {
  return /(code|diff|prompt|token|transcript|secret|body|content)/i.test(key);
}

export function sanitizeCloudMetricContext(context: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (isCloudMetricSensitiveKey(key)) {
      sanitized[key] = "[redacted]";
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}
