using DeskCue.Tray.HostControl;
using DeskCue.Tray.Menu;
using DeskCue.Tray.SystemIntegration;

namespace DeskCue.Tray;

internal sealed record TrayActionExecutionResult(HostStatus Status, TrayActionNotice? Notice = null);

internal sealed record TrayActionNotice(string Message, ToolTipIcon Icon);

internal sealed class TrayActionExecutor
{
    private static readonly TimeSpan HostStartupTimeout = TimeSpan.FromSeconds(12);
    private readonly IHostControlClient _hostClient;
    private readonly IHostProcessLauncher _hostLauncher;
    private readonly ISystemLauncher _systemLauncher;

    public TrayActionExecutor(
        IHostControlClient hostClient,
        IHostProcessLauncher hostLauncher,
        ISystemLauncher systemLauncher
    )
    {
        _hostClient = hostClient;
        _hostLauncher = hostLauncher;
        _systemLauncher = systemLauncher;
    }

    public async Task<TrayActionExecutionResult> ExecuteAsync(
        TrayAction action,
        CancellationToken cancellationToken
    )
    {
        return action switch
        {
            TrayAction.Open => new(await OpenDeskCueAsync(cancellationToken)),
            TrayAction.Start => new(await ExecuteHostCommandAsync(
                HostControlMethods.DaemonStart,
                cancellationToken
            )),
            TrayAction.Stop => new(await ExecuteHostCommandAsync(
                HostControlMethods.DaemonStop,
                cancellationToken
            )),
            TrayAction.Restart => new(await ExecuteHostCommandAsync(
                HostControlMethods.DaemonRestart,
                cancellationToken
            )),
            TrayAction.OpenPhonePairing => new(await OpenPhonePairingAsync(cancellationToken)),
            TrayAction.CheckForUpdates => CreateUpdateCheckResult(
                await ExecuteHostCommandAsync(HostControlMethods.UpdateCheck, cancellationToken)
            ),
            TrayAction.InstallUpdate => new(await ExecuteHostCommandAsync(
                HostControlMethods.UpdateApply,
                cancellationToken
            )),
            TrayAction.ToggleAutostart => await ToggleAutostartAsync(cancellationToken),
            _ => throw new InvalidOperationException($"Tray action {action} is not executable.")
        };
    }

    public async Task<HostStatus> EnsureHostStartedAsync(CancellationToken cancellationToken)
    {
        try
        {
            return await _hostClient.GetStatusAsync(cancellationToken);
        }
        catch (HostControlException error) when (error.Code is "host_unavailable" or "host_timeout")
        {
            _hostLauncher.EnsureStarted();
        }

        var deadline = DateTimeOffset.UtcNow + HostStartupTimeout;

        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await Task.Delay(250, cancellationToken);

            try
            {
                return await _hostClient.GetStatusAsync(cancellationToken);
            }
            catch (HostControlException error) when (error.Code is "host_unavailable" or "host_timeout")
            {
                // The host creates the token and pipe during startup. Keep the
                // tray responsive while waiting for the bounded deadline.
            }
        }

        throw new HostControlException(
            "host_timeout",
            "DeskCue Host did not become ready in time.",
            retryable: true
        );
    }

    private async Task<HostStatus> OpenDeskCueAsync(CancellationToken cancellationToken)
    {
        var status = await EnsureHostStartedAsync(cancellationToken);

        if (status.Daemon.State != "running")
        {
            status = await _hostClient.ExecuteAsync(HostControlMethods.DaemonStart, cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(status.Daemon.BaseUrl))
        {
            throw new InvalidOperationException("DeskCue has not published its dashboard address.");
        }

        _systemLauncher.OpenWebUrl(status.Daemon.BaseUrl);

        return status;
    }

    private async Task<HostStatus> ExecuteHostCommandAsync(
        string method,
        CancellationToken cancellationToken
    )
    {
        await EnsureHostStartedAsync(cancellationToken);

        return await _hostClient.ExecuteAsync(method, cancellationToken);
    }

    private async Task<HostStatus> OpenPhonePairingAsync(CancellationToken cancellationToken)
    {
        var status = await _hostClient.GetStatusAsync(cancellationToken);

        if (status.Daemon.State != "running" || string.IsNullOrWhiteSpace(status.Daemon.BaseUrl))
        {
            throw new InvalidOperationException("DeskCue is not running.");
        }

        _systemLauncher.OpenWebUrl(PhonePairingRoute.Build(status.Daemon.BaseUrl));

        return status;
    }

    private async Task<TrayActionExecutionResult> ToggleAutostartAsync(
        CancellationToken cancellationToken
    )
    {
        await EnsureHostStartedAsync(cancellationToken);
        var status = await _hostClient.ExecuteAsync(HostControlMethods.AutostartGet, cancellationToken);

        if (!status.Autostart.Supported || !status.Autostart.Enabled.HasValue)
        {
            throw new InvalidOperationException("DeskCue autostart status is unavailable.");
        }

        var enable = !status.Autostart.Enabled.Value;
        var method = enable
            ? HostControlMethods.AutostartEnable
            : HostControlMethods.AutostartDisable;
        var updatedStatus = await _hostClient.ExecuteAsync(method, cancellationToken);
        var message = enable
            ? "DeskCue will start when you sign in."
            : "DeskCue will no longer start when you sign in.";

        return new(updatedStatus, new TrayActionNotice(message, ToolTipIcon.Info));
    }

    private static TrayActionExecutionResult CreateUpdateCheckResult(HostStatus status)
    {
        var message = status.Update.State switch
        {
            "available" or "staged" => $"DeskCue{FormatVersionSuffix(status.Update.AvailableVersion)} is available.",
            "idle" => "DeskCue is up to date.",
            "checking" => "DeskCue is checking for updates.",
            "downloading" => "DeskCue is downloading an update.",
            _ => throw new InvalidOperationException("DeskCue could not check for updates.")
        };

        return new(status, new TrayActionNotice(message, ToolTipIcon.Info));
    }

    private static string FormatVersionSuffix(string? version)
    {
        if (string.IsNullOrWhiteSpace(version)) return string.Empty;

        var trimmed = version.Trim();
        var bounded = trimmed.Length <= 32 ? trimmed : trimmed[..32];

        return $" {bounded}";
    }
}

internal static class TrayActionErrorFormatter
{
    public static string Format(TrayAction action)
    {
        return action switch
        {
            TrayAction.Open => "DeskCue could not be opened.",
            TrayAction.Start => "DeskCue could not be started.",
            TrayAction.Stop => "DeskCue could not be stopped right now.",
            TrayAction.Restart => "DeskCue could not be restarted right now.",
            TrayAction.OpenPhonePairing => "DeskCue could not open phone pairing.",
            TrayAction.CheckForUpdates => "DeskCue could not check for updates.",
            TrayAction.InstallUpdate => "DeskCue could not install the update.",
            TrayAction.ToggleAutostart => "DeskCue startup preference could not be changed.",
            TrayAction.OpenLogs => "DeskCue has not created its logs folder yet.",
            _ => "DeskCue could not complete that action."
        };
    }

    public static string Format(TrayAction action, HostControlException error)
    {
        var message = Format(action);

        if (error.Blockers.Count > 0)
        {
            return $"{message} {Capitalize(HostControlBlockerFormatter.Format(error.Blockers))}. " +
                "Open logs for details.";
        }

        var reason = DiagnosticText.FormatReason(error.Message, maximumLength: 120);

        return reason is null
            ? $"{message} Open logs for details."
            : $"{message} Reason: {reason}. Open logs for details.";
    }

    private static string Capitalize(string value)
    {
        if (value.Length == 0) return value;

        return char.ToUpperInvariant(value[0]) + value[1..];
    }
}
