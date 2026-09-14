using DeskCue.Tray.HostControl;
using System.Text;
using System.Text.RegularExpressions;

namespace DeskCue.Tray.Menu;

public enum TrayAction
{
    None,
    Diagnostic,
    Open,
    Start,
    Stop,
    Restart,
    OpenPhonePairing,
    CheckForUpdates,
    InstallUpdate,
    ToggleAutostart,
    OpenLogs,
    ExitTray
}

public sealed record TrayMenuItemModel(
    TrayAction Action,
    string Label,
    bool Enabled = true,
    bool Visible = true,
    bool Checked = false,
    bool IsDefault = false
);

public sealed record TrayMenuModel(
    string StatusText,
    string TooltipText,
    IReadOnlyList<TrayMenuItemModel> Items
);

public sealed record TrayProjectionInput(
    HostStatus? Status,
    bool OperationInProgress = false,
    TrayAction? OperationAction = null,
    TrayAction? BlockedAction = null,
    IReadOnlyList<HostControlBlocker>? Blockers = null
);

public static partial class DiagnosticText
{
    private const int MenuReasonLength = 72;
    private const int TooltipLength = 63;

    public static string? FormatReason(string? value, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value) || maximumLength < 2) return null;

        var normalized = NormalizeWhitespace(value);
        var redacted = AuthorizationPattern().Replace(normalized, "authorization=[redacted]");

        redacted = BearerPattern().Replace(redacted, "Bearer [redacted]");
        redacted = SecretPattern().Replace(redacted, "$1=[redacted]");
        var bounded = redacted.Length <= maximumLength
            ? redacted
            : $"{redacted[..(maximumLength - 1)].TrimEnd()}…";

        return bounded.TrimEnd('.', ';', ':');
    }

    public static string? GetStatusReason(HostStatus? status)
    {
        var updateReason = status?.Update.LastError;
        var rawReason = !string.IsNullOrWhiteSpace(updateReason)
            ? updateReason
            : status?.Daemon.LastError;

        return FormatReason(rawReason, MenuReasonLength);
    }

    public static string GetTooltip(string statusText, string? reason)
    {
        if (reason is null)
        {
            return statusText.Length <= TooltipLength
                ? statusText
                : $"{statusText[..(TooltipLength - 1)].TrimEnd()}…";
        }

        var combined = $"{statusText}: {reason}";

        return FormatReason(combined, TooltipLength) ?? statusText;
    }

    private static string NormalizeWhitespace(string value)
    {
        var output = new StringBuilder(value.Length);
        var pendingSpace = false;

        foreach (var character in value)
        {
            if (char.IsWhiteSpace(character) || char.IsControl(character))
            {
                pendingSpace = output.Length > 0;
                continue;
            }

            if (pendingSpace)
            {
                output.Append(' ');
                pendingSpace = false;
            }

            output.Append(character);
        }

        return output.ToString().Trim();
    }

    [GeneratedRegex(@"(?i)\bauthorization\b[""']?\s*[:=]\s*(?:(?:bearer|basic)\s+)?[^\s&,;]+")]
    private static partial Regex AuthorizationPattern();

    [GeneratedRegex(
        @"(?i)[""']?\b(token|password|secret|api[_-]?key|access[_-]?token|" +
        @"pair(?:ing)?(?:code)?|devicecode)\b[""']?\s*[:=]\s*[""']?[^\s&,;}""']+[""']?"
    )]
    private static partial Regex SecretPattern();

    [GeneratedRegex(@"(?i)\bbearer\s+[^\s,;]+")]
    private static partial Regex BearerPattern();
}

public static class TrayActionPolicy
{
    public static bool CanRunDuringOperation(TrayAction action)
    {
        return action is TrayAction.ExitTray or TrayAction.OpenLogs;
    }
}

public static class HostControlBlockerFormatter
{
    public static string Format(IReadOnlyList<HostControlBlocker> blockers)
    {
        var parts = blockers
            .Where(blocker => blocker.Count > 0)
            .Take(2)
            .Select(FormatBlocker)
            .ToArray();

        if (parts.Length == 0) return "active work must finish first";
        if (parts.Length == 1) return $"{parts[0]} must finish first";

        return $"{parts[0]} and {parts[1]} must finish first";
    }

    private static string FormatBlocker(HostControlBlocker blocker)
    {
        var noun = blocker.Code switch
        {
            "managed_session_running" => blocker.Count == 1 ? "managed session" : "managed sessions",
            "source_agent_turn_active" => blocker.Count == 1 ? "agent turn" : "agent turns",
            "local_llm_generation_active" => blocker.Count == 1
                ? "local model response"
                : "local model responses",
            "manual_command_active" => blocker.Count == 1 ? "manual command" : "manual commands",
            "lm_studio_operation_active" => blocker.Count == 1
                ? "LM Studio operation"
                : "LM Studio operations",
            _ => blocker.Count == 1 ? "active operation" : "active operations"
        };

        return $"{blocker.Count} {noun}";
    }
}

public static class TrayMenuProjection
{
    public static TrayMenuModel Create(TrayProjectionInput input)
    {
        var statusText = GetStatusText(input);
        var diagnosticReason = DiagnosticText.GetStatusReason(input.Status);
        var daemonState = input.Status?.Daemon.State;
        var isRunning = daemonState == "running";
        var isStopped = daemonState is "stopped" or "degraded" || input.Status is null;
        var transitionInProgress = daemonState is "starting" or "stopping" ||
            input.Status?.Update.State is "downloading" or "applying" ||
            input.OperationInProgress;
        var canRecover = input.Status is null || IsAllowed(input.Status, HostControlMethods.DaemonStart);
        var canOpen = isRunning || (isStopped && canRecover && !transitionInProgress);
        var items = new List<TrayMenuItemModel>
        {
            new(TrayAction.None, statusText, Enabled: false),
            new(
                TrayAction.Diagnostic,
                diagnosticReason is null ? string.Empty : $"Issue: {diagnosticReason}",
                Enabled: false,
                Visible: diagnosticReason is not null
            ),
            new(TrayAction.Open, "Open DeskCue", Enabled: canOpen, IsDefault: true),
            new(
                TrayAction.Start,
                "Start DeskCue",
                Enabled: isStopped && !transitionInProgress &&
                    (input.Status is null || IsAllowed(input.Status, HostControlMethods.DaemonStart)),
                Visible: !isRunning
            ),
            new(
                TrayAction.Restart,
                WithBusySuffix(input.Status, HostControlMethods.DaemonRestart, "Restart DeskCue"),
                Enabled: isRunning && !transitionInProgress &&
                    IsAllowed(input.Status, HostControlMethods.DaemonRestart),
                Visible: isRunning
            ),
            new(
                TrayAction.Stop,
                WithBusySuffix(input.Status, HostControlMethods.DaemonStop, "Stop DeskCue"),
                Enabled: isRunning && !transitionInProgress &&
                    IsAllowed(input.Status, HostControlMethods.DaemonStop),
                Visible: isRunning
            ),
            new(
                TrayAction.OpenPhonePairing,
                "Pair a phone...",
                Enabled: isRunning && !transitionInProgress
            ),
            CreateUpdateCheckItem(input, transitionInProgress),
            CreateInstallUpdateItem(input, transitionInProgress),
            CreateAutostartItem(input),
            new(
                TrayAction.OpenLogs,
                diagnosticReason is null ? "Open logs" : "Open logs for details"
            ),
            new(TrayAction.ExitTray, "Exit tray")
        };

        return new TrayMenuModel(
            statusText,
            DiagnosticText.GetTooltip(statusText, diagnosticReason),
            items
        );
    }

    private static TrayMenuItemModel CreateUpdateCheckItem(
        TrayProjectionInput input,
        bool transitionInProgress
    )
    {
        var updateState = input.Status?.Update.State;
        var checking = updateState == "checking";

        return new TrayMenuItemModel(
            TrayAction.CheckForUpdates,
            checking ? "Checking for updates..." : "Check for updates",
            Enabled: !checking && !transitionInProgress && IsAllowed(input.Status, HostControlMethods.UpdateCheck)
        );
    }

    private static TrayMenuItemModel CreateInstallUpdateItem(
        TrayProjectionInput input,
        bool transitionInProgress
    )
    {
        var update = input.Status?.Update;
        var visible = update?.State is "available" or "staged";
        var versionSuffix = FormatVersionSuffix(update?.AvailableVersion);
        var label = update?.State == "staged"
            ? $"Restart and install{versionSuffix}..."
            : $"Install update{versionSuffix}...";

        return new TrayMenuItemModel(
            TrayAction.InstallUpdate,
            WithUnavailableSuffix(
                input,
                TrayAction.InstallUpdate,
                HostControlMethods.UpdateApply,
                label
            ),
            Enabled: visible && !transitionInProgress && IsAllowed(input.Status, HostControlMethods.UpdateApply),
            Visible: visible
        );
    }

    private static TrayMenuItemModel CreateAutostartItem(TrayProjectionInput input)
    {
        var autostart = input.Status?.Autostart;
        var enabled = autostart?.Enabled;
        var method = enabled == true
            ? HostControlMethods.AutostartDisable
            : HostControlMethods.AutostartEnable;
        var known = enabled.HasValue;

        return new TrayMenuItemModel(
            TrayAction.ToggleAutostart,
            known
                ? "Start DeskCue when I sign in"
                : "Start DeskCue when I sign in (status unavailable)",
            Enabled: autostart?.Supported == true && known && !input.OperationInProgress &&
                IsAllowed(input.Status, method),
            Checked: enabled == true
        );
    }

    private static string GetStatusText(TrayProjectionInput input)
    {
        if (input.Status?.Update.State == "checking") return "DeskCue is checking for updates...";
        if (input.Status?.Update.State == "downloading") return "DeskCue is downloading an update...";
        if (input.Status?.Update.State == "applying") return "DeskCue is updating...";
        if (input.Status?.Update.State == "failed") return "DeskCue update needs attention";
        if (input.OperationInProgress) return GetOperationStatusText(input.OperationAction);
        if (input.Status is null) return "DeskCue host is unavailable";
        if (input.Status.Host.State == "degraded") return "DeskCue needs attention";

        return input.Status.Daemon.State switch
        {
            "starting" => "DeskCue is starting...",
            "running" => "DeskCue is running",
            "stopping" => "DeskCue is stopping...",
            "stopped" => "DeskCue is stopped",
            "degraded" => "DeskCue needs attention",
            _ => "DeskCue status is unavailable"
        };
    }

    private static string GetOperationStatusText(TrayAction? action)
    {
        return action switch
        {
            TrayAction.Open => "DeskCue is opening...",
            TrayAction.Start => "DeskCue is starting...",
            TrayAction.Stop => "DeskCue is stopping...",
            TrayAction.Restart => "DeskCue is restarting...",
            TrayAction.OpenPhonePairing => "DeskCue is opening phone pairing...",
            TrayAction.CheckForUpdates => "DeskCue is checking for updates...",
            TrayAction.InstallUpdate => "DeskCue is preparing the update...",
            TrayAction.ToggleAutostart => "DeskCue is changing its startup preference...",
            _ => "DeskCue is working..."
        };
    }

    private static bool IsAllowed(HostStatus? status, string method)
    {
        return status?.Capabilities.TryGetValue(method, out var capability) == true && capability.Allowed;
    }

    private static string WithBusySuffix(HostStatus? status, string method, string label)
    {
        if (string.IsNullOrWhiteSpace(status?.BusyReason)) return label;
        if (IsAllowed(status, method)) return label;

        return $"{label} (active work is running)";
    }

    private static string WithUnavailableSuffix(
        TrayProjectionInput input,
        TrayAction action,
        string method,
        string label
    )
    {
        if (input.BlockedAction == action && input.Blockers is { Count: > 0 })
        {
            return $"{label} ({HostControlBlockerFormatter.Format(input.Blockers)})";
        }

        return WithBusySuffix(input.Status, method, label);
    }

    private static string FormatVersionSuffix(string? version)
    {
        if (string.IsNullOrWhiteSpace(version)) return string.Empty;

        var trimmed = version.Trim();
        var bounded = trimmed.Length <= 32 ? trimmed : trimmed[..32];

        return $" {bounded}";
    }
}
