using DeskCue.Tray.HostControl;
using DeskCue.Tray.Menu;
using Xunit;

namespace DeskCue.Tray.Tests;

public sealed class TrayMenuProjectionTests
{
    [Theory]
    [InlineData("starting", "idle", "DeskCue is starting...")]
    [InlineData("stopping", "idle", "DeskCue is stopping...")]
    [InlineData("degraded", "idle", "DeskCue needs attention")]
    [InlineData("running", "checking", "DeskCue is checking for updates...")]
    [InlineData("running", "downloading", "DeskCue is downloading an update...")]
    [InlineData("running", "applying", "DeskCue is updating...")]
    [InlineData("running", "failed", "DeskCue update needs attention")]
    public void ProjectsEveryTransitionalStateAsText(
        string daemonState,
        string updateState,
        string expected
    )
    {
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus(daemonState, updateState)
        ));

        Assert.Equal(expected, model.StatusText);
        Assert.Equal(expected, model.TooltipText);
    }

    [Fact]
    public void RunningStatusOffersRuntimeActionsWithoutAStartAction()
    {
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus("running", updateState: "idle", autostartEnabled: true)
        ));

        Assert.Equal("DeskCue is running", model.StatusText);
        Assert.False(GetItem(model, TrayAction.Start).Visible);
        Assert.True(GetItem(model, TrayAction.Restart).Enabled);
        Assert.True(GetItem(model, TrayAction.Stop).Enabled);
        var phonePairing = GetItem(model, TrayAction.OpenPhonePairing);

        Assert.True(phonePairing.Enabled);
        Assert.Equal("Pair a phone...", phonePairing.Label);
        Assert.True(GetItem(model, TrayAction.ToggleAutostart).Checked);
    }

    [Fact]
    public void StoppedStatusOffersStartAndDisablesPairing()
    {
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus("stopped", updateState: "idle")
        ));

        Assert.Equal("DeskCue is stopped", model.StatusText);
        Assert.True(GetItem(model, TrayAction.Start).Visible);
        Assert.True(GetItem(model, TrayAction.Start).Enabled);
        Assert.False(GetItem(model, TrayAction.Restart).Visible);
        Assert.False(GetItem(model, TrayAction.Stop).Visible);
        Assert.False(GetItem(model, TrayAction.OpenPhonePairing).Enabled);
    }

    [Fact]
    public void MissingCapabilitiesFailClosedForMutatingActions()
    {
        var status = CreateStatus("running", updateState: "available") with
        {
            Capabilities = []
        };
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            status
        ));

        Assert.False(GetItem(model, TrayAction.Stop).Enabled);
        Assert.False(GetItem(model, TrayAction.Restart).Enabled);
        Assert.False(GetItem(model, TrayAction.CheckForUpdates).Enabled);
        Assert.False(GetItem(model, TrayAction.InstallUpdate).Enabled);
    }

    [Fact]
    public void StagedUpdateUsesAnExplicitRestartLabel()
    {
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus("running", updateState: "staged", availableVersion: "0.2.0")
        ));

        var install = GetItem(model, TrayAction.InstallUpdate);

        Assert.True(install.Visible);
        Assert.True(install.Enabled);
        Assert.Equal("Restart and install 0.2.0...", install.Label);
    }

    [Fact]
    public void BusyStatusExplainsWhyDestructiveActionsAreDisabled()
    {
        var status = CreateStatus("running", updateState: "available", availableVersion: "0.2.0") with
        {
            BusyReason = "A managed session is running.",
            Capabilities = new Dictionary<string, HostCapability>
            {
                [HostControlMethods.DaemonStop] = new() { Allowed = false },
                [HostControlMethods.DaemonRestart] = new() { Allowed = false },
                [HostControlMethods.UpdateApply] = new() { Allowed = false },
                [HostControlMethods.UpdateCheck] = new() { Allowed = true }
            }
        };
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            status
        ));

        Assert.Equal(
            "Stop DeskCue (active work is running)",
            GetItem(model, TrayAction.Stop).Label
        );
        Assert.Equal(
            "Install update 0.2.0... (active work is running)",
            GetItem(model, TrayAction.InstallUpdate).Label
        );
    }

    [Fact]
    public void UnknownAutostartStateIsPreservedAsDisabledText()
    {
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus("running", updateState: "idle", autostartEnabled: null)
        ));
        var autostart = GetItem(model, TrayAction.ToggleAutostart);

        Assert.False(autostart.Enabled);
        Assert.False(autostart.Checked);
        Assert.Equal("Start DeskCue when I sign in (status unavailable)", autostart.Label);
    }

    [Fact]
    public void KnownAutostartStateUsesTheMatchingHostCapability()
    {
        var enabledModel = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus("running", updateState: "idle", autostartEnabled: true)
        ));
        var disabledModel = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus("running", updateState: "idle", autostartEnabled: false)
        ));

        Assert.True(GetItem(enabledModel, TrayAction.ToggleAutostart).Enabled);
        Assert.True(GetItem(enabledModel, TrayAction.ToggleAutostart).Checked);
        Assert.True(GetItem(disabledModel, TrayAction.ToggleAutostart).Enabled);
        Assert.False(GetItem(disabledModel, TrayAction.ToggleAutostart).Checked);
    }

    [Fact]
    public void TypedUpdateBlockersRemainVisibleOnTheInstallAction()
    {
        var blockers = new HostControlBlocker[]
        {
            new() { Code = "source_agent_turn_active", Count = 2 },
            new() { Code = "manual_command_active", Count = 1 }
        };
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus("running", updateState: "available", availableVersion: "0.2.0"),
            BlockedAction: TrayAction.InstallUpdate,
            Blockers: blockers
        ));

        Assert.Equal(
            "Install update 0.2.0... (2 agent turns and 1 manual command must finish first)",
            GetItem(model, TrayAction.InstallUpdate).Label
        );
    }

    [Fact]
    public void LongRunningActionHasTextualProgressBeforeTheHostStateChanges()
    {
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus("running", updateState: "available", availableVersion: "0.2.0"),
            OperationInProgress: true,
            OperationAction: TrayAction.InstallUpdate
        ));

        Assert.Equal("DeskCue is preparing the update...", model.StatusText);
    }

    [Fact]
    public void PolledUpdateProgressOverridesTheInitialOperationText()
    {
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus("running", updateState: "downloading", availableVersion: "0.2.0"),
            OperationInProgress: true,
            OperationAction: TrayAction.InstallUpdate
        ));

        Assert.Equal("DeskCue is downloading an update...", model.StatusText);
    }

    [Fact]
    public void ExitAndLogsRemainEnabledDuringALongRunningOperation()
    {
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus("running", updateState: "downloading", availableVersion: "0.2.0"),
            OperationInProgress: true,
            OperationAction: TrayAction.InstallUpdate
        ));

        Assert.True(TrayActionPolicy.CanRunDuringOperation(TrayAction.ExitTray));
        Assert.True(TrayActionPolicy.CanRunDuringOperation(TrayAction.OpenLogs));
        Assert.False(TrayActionPolicy.CanRunDuringOperation(TrayAction.Start));
        Assert.True(GetItem(model, TrayAction.ExitTray).Enabled);
        Assert.True(GetItem(model, TrayAction.OpenLogs).Enabled);
    }

    [Fact]
    public void PersistedFailureShowsABoundedSafeReasonAndLogsNextStep()
    {
        var status = CreateStatus("degraded", updateState: "idle") with
        {
            Daemon = new DaemonProcessStatus
            {
                State = "degraded",
                LastError = $"Connection failed\r\ntoken=private-value " +
                    $"\"access_token\":\"json-secret\" {new string('x', 200)}"
            }
        };
        var model = TrayMenuProjection.Create(new TrayProjectionInput(status));
        var diagnostic = GetItem(model, TrayAction.Diagnostic);

        Assert.True(diagnostic.Visible);
        Assert.StartsWith("Issue: Connection failed token=[redacted]", diagnostic.Label);
        Assert.DoesNotContain("private-value", diagnostic.Label, StringComparison.Ordinal);
        Assert.DoesNotContain("json-secret", diagnostic.Label, StringComparison.Ordinal);
        Assert.DoesNotContain('\r', diagnostic.Label);
        Assert.DoesNotContain('\n', diagnostic.Label);
        Assert.InRange(diagnostic.Label.Length, 1, 79);
        Assert.InRange(model.TooltipText.Length, 1, 63);
        Assert.Equal("Open logs for details", GetItem(model, TrayAction.OpenLogs).Label);
    }

    [Fact]
    public void HostDiagnosticReasonRedactsBearerCredentialsAndBoundsText()
    {
        var reason = DiagnosticText.FormatReason(
            $"Authorization failure: Bearer abc.def.ghi {new string('z', 300)}",
            maximumLength: 80
        );

        Assert.NotNull(reason);
        Assert.DoesNotContain("abc.def.ghi", reason, StringComparison.Ordinal);
        Assert.Contains("Bearer [redacted]", reason, StringComparison.Ordinal);
        Assert.InRange(reason.Length, 1, 80);
    }

    [Fact]
    public void NonfatalPersistedUpdateReasonRemainsVisibleInAnActionablePhase()
    {
        var status = CreateStatus("running", updateState: "available", availableVersion: "0.2.0") with
        {
            Update = new HostUpdateStatus
            {
                State = "available",
                AvailableVersion = "0.2.0",
                LastError = "Previous download was interrupted. Retry when ready."
            }
        };
        var model = TrayMenuProjection.Create(new TrayProjectionInput(status));

        Assert.Equal("DeskCue is running", model.StatusText);
        Assert.Contains(
            "Previous download was interrupted",
            GetItem(model, TrayAction.Diagnostic).Label,
            StringComparison.Ordinal
        );
        Assert.True(GetItem(model, TrayAction.InstallUpdate).Enabled);
    }

    [Fact]
    public void ExitTrayRemainsDistinctFromStoppingDeskCue()
    {
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            CreateStatus("running", updateState: "idle")
        ));

        Assert.Equal(TrayAction.Stop, GetItem(model, TrayAction.Stop).Action);
        Assert.Equal(TrayAction.ExitTray, GetItem(model, TrayAction.ExitTray).Action);
        Assert.Equal("Exit tray", GetItem(model, TrayAction.ExitTray).Label);
    }

    [Fact]
    public void UnavailableHostIsTextualAndKeepsRecoveryActionsReachable()
    {
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            Status: null
        ));

        Assert.Equal("DeskCue host is unavailable", model.TooltipText);
        Assert.True(GetItem(model, TrayAction.Open).Enabled);
        Assert.True(GetItem(model, TrayAction.Start).Enabled);
        Assert.True(GetItem(model, TrayAction.OpenLogs).Enabled);
        Assert.True(GetItem(model, TrayAction.ExitTray).Enabled);
    }

    private static TrayMenuItemModel GetItem(TrayMenuModel model, TrayAction action)
    {
        return Assert.Single(model.Items, item => item.Action == action);
    }

    private static HostStatus CreateStatus(
        string daemonState,
        string updateState,
        string? availableVersion = null,
        bool? autostartEnabled = false
    )
    {
        return new HostStatus
        {
            Host = new HostProcessStatus
            {
                State = "running",
                Pid = 42,
                Version = "0.1.1"
            },
            Daemon = new DaemonProcessStatus
            {
                State = daemonState,
                BaseUrl = daemonState == "running" ? "http://127.0.0.1:4100" : null
            },
            Update = new HostUpdateStatus
            {
                State = updateState,
                AvailableVersion = availableVersion
            },
            Autostart = new HostAutostartStatus
            {
                Supported = true,
                Enabled = autostartEnabled
            },
            Capabilities = new Dictionary<string, HostCapability>
            {
                [HostControlMethods.DaemonStart] = new() { Allowed = true },
                [HostControlMethods.DaemonStop] = new() { Allowed = true },
                [HostControlMethods.DaemonRestart] = new() { Allowed = true },
                [HostControlMethods.UpdateCheck] = new() { Allowed = true },
                [HostControlMethods.UpdateApply] = new() { Allowed = true },
                [HostControlMethods.AutostartEnable] = new() { Allowed = true },
                [HostControlMethods.AutostartDisable] = new() { Allowed = true }
            }
        };
    }
}
