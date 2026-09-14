using DeskCue.Tray.HostControl;
using DeskCue.Tray.SystemIntegration;

namespace DeskCue.Tray;

internal static class Program
{
    private const string SingleInstanceMutexName = @"Local\DeskCue.Tray";
    private const string ActivationEventName = @"Local\DeskCue.Tray.Activate";
    private const string ShutdownEventName = @"Local\DeskCue.Tray.Shutdown";
    private const string ShutdownForUpdateArgument = "--shutdown-for-update";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Any(argument => string.Equals(
            argument,
            ShutdownForUpdateArgument,
            StringComparison.OrdinalIgnoreCase
        )))
        {
            return SignalExistingTrayToExit();
        }

        using var singleInstance = new Mutex(
            initiallyOwned: true,
            name: SingleInstanceMutexName,
            createdNew: out var ownsMutex
        );

        if (!ownsMutex) return SignalExistingTrayToActivate();

        using var activationRequest = new EventWaitHandle(
            initialState: false,
            mode: EventResetMode.AutoReset,
            name: ActivationEventName
        );
        using var shutdownRequest = new EventWaitHandle(
            initialState: false,
            mode: EventResetMode.AutoReset,
            name: ShutdownEventName
        );

        ApplicationConfiguration.Initialize();
        var runtimePaths = DeskCueRuntimePathsResolver.ResolveCurrent();
        using var context = new TrayApplicationContext(
            HostControlClient.CreateDefault(),
            new HostProcessLauncher(),
            new SystemLauncher(),
            runtimePaths.LogsDirectory,
            activationRequest,
            shutdownRequest
        );

        try
        {
            Application.Run(context);
        }
        finally
        {
            singleInstance.ReleaseMutex();
        }

        return 0;
    }

    private static int SignalExistingTrayToActivate()
    {
        try
        {
            using var activationRequest = EventWaitHandle.OpenExisting(ActivationEventName);
            return activationRequest.Set() ? 0 : 1;
        }
        catch (WaitHandleCannotBeOpenedException)
        {
            return 0;
        }
        catch (UnauthorizedAccessException)
        {
            return 1;
        }
    }

    private static int SignalExistingTrayToExit()
    {
        try
        {
            using var shutdownRequest = EventWaitHandle.OpenExisting(ShutdownEventName);
            using var singleInstance = Mutex.OpenExisting(SingleInstanceMutexName);

            if (!shutdownRequest.Set()) return 1;

            try
            {
                if (!singleInstance.WaitOne(TimeSpan.FromSeconds(10))) return 1;

                singleInstance.ReleaseMutex();
                return 0;
            }
            catch (AbandonedMutexException)
            {
                return 0;
            }
        }
        catch (WaitHandleCannotBeOpenedException)
        {
            return 0;
        }
        catch (UnauthorizedAccessException)
        {
            return 1;
        }
    }
}
