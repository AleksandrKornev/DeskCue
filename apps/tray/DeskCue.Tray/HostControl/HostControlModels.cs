using System.Text.Json.Serialization;

namespace DeskCue.Tray.HostControl;

public static class HostControlProtocol
{
    public const int Version = 2;
    public const int MaximumFrameBytes = 64 * 1024;
    public const string RequestEndMarker = "--deskcue-control-request-end-v1--";
}

public static class HostControlMethods
{
    public const string Status = "status";
    public const string DaemonStart = "daemon.start";
    public const string DaemonStop = "daemon.stop";
    public const string DaemonRestart = "daemon.restart";
    public const string HostShutdown = "host.shutdown";
    public const string UpdateCheck = "update.check";
    public const string UpdateApply = "update.apply";
    public const string AutostartGet = "autostart.get";
    public const string AutostartEnable = "autostart.enable";
    public const string AutostartDisable = "autostart.disable";
}

public static class HostControlTimeoutPolicy
{
    public static TimeSpan ConnectTimeout { get; } = TimeSpan.FromSeconds(4);

    public static TimeSpan GetResponseTimeout(string method)
    {
        return method switch
        {
            HostControlMethods.DaemonStart => TimeSpan.FromSeconds(35),
            HostControlMethods.DaemonStop => TimeSpan.FromSeconds(15),
            HostControlMethods.DaemonRestart => TimeSpan.FromSeconds(45),
            HostControlMethods.UpdateCheck => TimeSpan.FromSeconds(75),
            HostControlMethods.UpdateApply => TimeSpan.FromMinutes(35),
            _ => TimeSpan.FromSeconds(4)
        };
    }
}

public sealed record HostCapability
{
    [JsonPropertyName("allowed")]
    public bool Allowed { get; init; }

    [JsonPropertyName("reason")]
    public string? Reason { get; init; }
}

public sealed record HostControlBlocker
{
    [JsonPropertyName("code")]
    public string Code { get; init; } = "unknown";

    [JsonPropertyName("count")]
    public int Count { get; init; }

    [JsonPropertyName("message")]
    public string Message { get; init; } = string.Empty;
}

public sealed record HostProcessStatus
{
    [JsonPropertyName("state")]
    public string State { get; init; } = "degraded";

    [JsonPropertyName("pid")]
    public int Pid { get; init; }

    [JsonPropertyName("version")]
    public string Version { get; init; } = "unknown";

    [JsonPropertyName("startedAt")]
    public string? StartedAt { get; init; }
}

public sealed record DaemonProcessStatus
{
    [JsonPropertyName("state")]
    public string State { get; init; } = "stopped";

    [JsonPropertyName("pid")]
    public int? Pid { get; init; }

    [JsonPropertyName("generation")]
    public string? Generation { get; init; }

    [JsonPropertyName("version")]
    public string? Version { get; init; }

    [JsonPropertyName("baseUrl")]
    public string? BaseUrl { get; init; }

    [JsonPropertyName("port")]
    public int? Port { get; init; }

    [JsonPropertyName("lastError")]
    public string? LastError { get; init; }

    [JsonPropertyName("restartAttempt")]
    public int RestartAttempt { get; init; }
}

public sealed record HostUpdateStatus
{
    [JsonPropertyName("state")]
    public string State { get; init; } = "idle";

    [JsonPropertyName("availableVersion")]
    public string? AvailableVersion { get; init; }

    [JsonPropertyName("lastError")]
    public string? LastError { get; init; }
}

public sealed record HostAutostartStatus
{
    [JsonPropertyName("supported")]
    public bool Supported { get; init; }

    [JsonPropertyName("enabled")]
    public bool? Enabled { get; init; }
}

public sealed record HostStatus
{
    [JsonPropertyName("host")]
    public HostProcessStatus Host { get; init; } = new();

    [JsonPropertyName("daemon")]
    public DaemonProcessStatus Daemon { get; init; } = new();

    [JsonPropertyName("update")]
    public HostUpdateStatus Update { get; init; } = new();

    [JsonPropertyName("autostart")]
    public HostAutostartStatus Autostart { get; init; } = new();

    [JsonPropertyName("busyReason")]
    public string? BusyReason { get; init; }

    [JsonPropertyName("capabilities")]
    public Dictionary<string, HostCapability> Capabilities { get; init; } = [];
}

public sealed class HostControlException(
    string code,
    string message,
    bool retryable = false,
    IReadOnlyList<HostControlBlocker>? blockers = null,
    Exception? innerException = null
) : Exception(message, innerException)
{
    public string Code { get; } = code;

    public bool Retryable { get; } = retryable;

    public IReadOnlyList<HostControlBlocker> Blockers { get; } = blockers ?? [];
}
