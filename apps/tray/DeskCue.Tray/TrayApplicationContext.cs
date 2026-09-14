using DeskCue.Tray.HostControl;
using DeskCue.Tray.Menu;
using DeskCue.Tray.SystemIntegration;

namespace DeskCue.Tray;

internal sealed class TrayApplicationContext : ApplicationContext
{
    private readonly TrayActionExecutor _actionExecutor;
    private readonly EventWaitHandle _activationRequest;
    private readonly CancellationTokenSource _cancellation = new();
    private readonly ContextMenuStrip _contextMenu = new();
    private readonly IHostControlClient _hostClient;
    private readonly Dictionary<TrayAction, ToolStripMenuItem> _items = [];
    private readonly string _logsDirectory;
    private readonly NotifyIcon _notifyIcon;
    private readonly System.Windows.Forms.Timer _pollTimer = new() { Interval = 100 };
    private readonly EventWaitHandle _shutdownRequest;
    private readonly System.Windows.Forms.Timer _shutdownTimer = new() { Interval = 200 };
    private readonly ISystemLauncher _systemLauncher;
    private readonly Icon _trayIcon;
    private HostStatus? _status;
    private TrayAction? _activeAction;
    private bool _initialHostLaunchAttempted;
    private TrayAction? _lastBlockedAction;
    private IReadOnlyList<HostControlBlocker> _lastBlockers = [];
    private bool _operationInProgress;
    private bool _refreshInProgress;

    public TrayApplicationContext(
        IHostControlClient hostClient,
        IHostProcessLauncher hostLauncher,
        ISystemLauncher systemLauncher,
        string logsDirectory,
        EventWaitHandle activationRequest,
        EventWaitHandle shutdownRequest
    )
    {
        _hostClient = hostClient;
        _actionExecutor = new TrayActionExecutor(hostClient, hostLauncher, systemLauncher);
        _systemLauncher = systemLauncher;
        _logsDirectory = logsDirectory;
        _activationRequest = activationRequest;
        _shutdownRequest = shutdownRequest;
        _trayIcon = TrayIconFactory.Create();

        BuildMenu();
        _notifyIcon = new NotifyIcon
        {
            ContextMenuStrip = _contextMenu,
            Icon = _trayIcon,
            Text = "DeskCue host is unavailable",
            Visible = true
        };
        _notifyIcon.DoubleClick += HandleOpenRequested;
        _contextMenu.Opening += HandleMenuOpening;
        _pollTimer.Tick += HandlePollTimerTick;
        _pollTimer.Start();
        _shutdownTimer.Tick += HandleShutdownTimerTick;
        _shutdownTimer.Start();

        Render();
    }

    protected override void ExitThreadCore()
    {
        _cancellation.Cancel();
        _pollTimer.Stop();
        _pollTimer.Dispose();
        _shutdownTimer.Stop();
        _shutdownTimer.Dispose();
        _contextMenu.Opening -= HandleMenuOpening;
        _notifyIcon.DoubleClick -= HandleOpenRequested;
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        _contextMenu.Dispose();
        _trayIcon.Dispose();
        base.ExitThreadCore();
    }

    private void BuildMenu()
    {
        AddItem(TrayAction.None);
        AddItem(TrayAction.Diagnostic);
        _contextMenu.Items.Add(new ToolStripSeparator());
        AddItem(TrayAction.Open);
        _items[TrayAction.Open].Font = new Font(_contextMenu.Font, FontStyle.Bold);
        _contextMenu.Items.Add(new ToolStripSeparator());
        AddItem(TrayAction.Start);
        AddItem(TrayAction.Restart);
        AddItem(TrayAction.Stop);
        _contextMenu.Items.Add(new ToolStripSeparator());
        AddItem(TrayAction.OpenPhonePairing);
        _contextMenu.Items.Add(new ToolStripSeparator());
        AddItem(TrayAction.CheckForUpdates);
        AddItem(TrayAction.InstallUpdate);
        _contextMenu.Items.Add(new ToolStripSeparator());
        AddItem(TrayAction.ToggleAutostart);
        AddItem(TrayAction.OpenLogs);
        _contextMenu.Items.Add(new ToolStripSeparator());
        AddItem(TrayAction.ExitTray);
    }

    private void AddItem(TrayAction action)
    {
        var item = new ToolStripMenuItem
        {
            Tag = action
        };

        if (action is not (TrayAction.None or TrayAction.Diagnostic))
        {
            item.Click += HandleActionClick;
        }

        _items.Add(action, item);
        _contextMenu.Items.Add(item);
    }

    private async void HandlePollTimerTick(object? sender, EventArgs eventArgs)
    {
        try
        {
            if (!_initialHostLaunchAttempted)
            {
                _initialHostLaunchAttempted = true;
                _pollTimer.Interval = 2_000;
                await _actionExecutor.EnsureHostStartedAsync(_cancellation.Token);
            }

            await RefreshStatusAsync(_cancellation.Token);
        }
        catch (OperationCanceledException) when (_cancellation.IsCancellationRequested)
        {
            return;
        }
        catch (Exception)
        {
            _status = null;
            Render();
        }
    }

    private void HandleShutdownTimerTick(object? sender, EventArgs eventArgs)
    {
        if (_shutdownRequest.WaitOne(0))
        {
            ExitThread();
            return;
        }

        if (_activationRequest.WaitOne(0)) _ = RunActionAsync(TrayAction.Open);
    }

    private async void HandleMenuOpening(object? sender, System.ComponentModel.CancelEventArgs eventArgs)
    {
        await RefreshStatusAsync(
            _cancellation.Token,
            refreshAutostart: _status?.Autostart.Supported == true
        );
    }

    private async void HandleOpenRequested(object? sender, EventArgs eventArgs)
    {
        await RunActionAsync(TrayAction.Open);
    }

    private async void HandleActionClick(object? sender, EventArgs eventArgs)
    {
        if (sender is not ToolStripMenuItem { Tag: TrayAction action }) return;

        await RunActionAsync(action);
    }

    private async Task RunActionAsync(TrayAction action)
    {
        if (TrayActionPolicy.CanRunDuringOperation(action))
        {
            RunConcurrentAction(action);
            return;
        }

        if (_operationInProgress) return;

        _operationInProgress = true;
        _activeAction = action;
        _lastBlockedAction = null;
        _lastBlockers = [];
        Render();

        try
        {
            if (action == TrayAction.InstallUpdate && !ConfirmUpdateInstallation()) return;

            var result = await _actionExecutor.ExecuteAsync(action, _cancellation.Token);

            _status = result.Status;
            if (result.Notice is not null)
            {
                ShowNotice(result.Notice.Message, result.Notice.Icon);
            }
        }
        catch (OperationCanceledException) when (_cancellation.IsCancellationRequested)
        {
            return;
        }
        catch (HostControlException error)
        {
            _lastBlockedAction = action;
            _lastBlockers = error.Blockers;
            ShowNotice(
                TrayActionErrorFormatter.Format(action, error),
                error.Blockers.Count > 0 ? ToolTipIcon.Warning : ToolTipIcon.Error
            );
        }
        catch (Exception)
        {
            ShowNotice(TrayActionErrorFormatter.Format(action), ToolTipIcon.Error);
        }
        finally
        {
            _operationInProgress = false;
            _activeAction = null;

            if (!_cancellation.IsCancellationRequested)
            {
                await RefreshStatusAsync(_cancellation.Token);
            }
        }
    }

    private void RunConcurrentAction(TrayAction action)
    {
        if (action == TrayAction.ExitTray)
        {
            ExitThread();
            return;
        }

        if (action != TrayAction.OpenLogs) return;

        try
        {
            _systemLauncher.OpenDirectory(_logsDirectory);
        }
        catch (Exception)
        {
            ShowNotice(TrayActionErrorFormatter.Format(action), ToolTipIcon.Error);
        }
    }

    private static bool ConfirmUpdateInstallation()
    {
        var decision = MessageBox.Show(
            "DeskCue will restart to install the update. Continue?",
            "Install DeskCue update",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question,
            MessageBoxDefaultButton.Button2
        );

        return decision == DialogResult.Yes;
    }

    private async Task RefreshStatusAsync(
        CancellationToken cancellationToken,
        bool refreshAutostart = false
    )
    {
        if (_refreshInProgress) return;

        if (_operationInProgress) refreshAutostart = false;

        _refreshInProgress = true;

        try
        {
            _status = refreshAutostart
                ? await _hostClient.ExecuteAsync(HostControlMethods.AutostartGet, cancellationToken)
                : await _hostClient.GetStatusAsync(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return;
        }
        catch (Exception)
        {
            _status = refreshAutostart && _status is not null
                ? _status with
                {
                    Autostart = _status.Autostart with { Enabled = null }
                }
                : null;
        }
        finally
        {
            _refreshInProgress = false;
        }

        Render();
    }

    private void Render()
    {
        var model = TrayMenuProjection.Create(new TrayProjectionInput(
            Status: _status,
            OperationInProgress: _operationInProgress,
            OperationAction: _activeAction,
            BlockedAction: _lastBlockedAction,
            Blockers: _lastBlockers
        ));

        foreach (var itemModel in model.Items)
        {
            var item = _items[itemModel.Action];

            item.Text = itemModel.Label;
            item.Enabled = itemModel.Enabled;
            item.Visible = itemModel.Visible;
            item.Checked = itemModel.Checked;
            item.AccessibleName = itemModel.Label;
        }

        _notifyIcon.Text = TruncateTooltip(model.TooltipText);
    }

    private void ShowNotice(string message, ToolTipIcon icon)
    {
        _notifyIcon.BalloonTipTitle = "DeskCue";
        _notifyIcon.BalloonTipText = message;
        _notifyIcon.BalloonTipIcon = icon;
        _notifyIcon.ShowBalloonTip(4_000);
    }

    private static string TruncateTooltip(string value)
    {
        const int maximumLength = 63;

        return value.Length <= maximumLength ? value : value[..maximumLength];
    }
}
