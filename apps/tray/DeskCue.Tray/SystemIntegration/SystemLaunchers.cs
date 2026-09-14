using System.Diagnostics;

namespace DeskCue.Tray.SystemIntegration;

public interface ISystemLauncher
{
    void OpenDirectory(string path);

    void OpenWebUrl(string url);
}

public sealed class SystemLauncher : ISystemLauncher
{
    public void OpenDirectory(string path)
    {
        if (!Directory.Exists(path))
        {
            throw new DirectoryNotFoundException("DeskCue has not created its logs directory yet.");
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = path,
            UseShellExecute = true
        });
    }

    public void OpenWebUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) ||
            !uri.IsLoopback)
        {
            throw new InvalidOperationException("DeskCue Host returned an unsafe dashboard address.");
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = uri.AbsoluteUri,
            UseShellExecute = true
        });
    }
}

public interface IHostProcessLauncher
{
    void EnsureStarted();
}

public sealed class HostProcessLauncher : IHostProcessLauncher
{
    public void EnsureStarted()
    {
        var installationDirectory = AppContext.BaseDirectory;
        var nodePath = Path.Combine(installationDirectory, "runtime", "node.exe");
        var applicationDirectory = Path.Combine(installationDirectory, "app");
        var hostEntryPath = Path.Combine(
            applicationDirectory,
            "apps",
            "host",
            "dist",
            "index.js"
        );

        if (!File.Exists(nodePath) || !File.Exists(hostEntryPath))
        {
            throw new FileNotFoundException("The DeskCue Host installation is incomplete.");
        }

        var startInfo = new ProcessStartInfo
        {
            CreateNoWindow = true,
            FileName = nodePath,
            UseShellExecute = false,
            WorkingDirectory = applicationDirectory,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        startInfo.ArgumentList.Add(hostEntryPath);
        startInfo.ArgumentList.Add("--background");
        startInfo.Environment["DESKCUE_DISTRIBUTION_MODE"] = "installed";
        startInfo.Environment["DESKCUE_DATA_DIR"] = DeskCueRuntimePathsResolver
            .ResolveCurrent()
            .DataDirectory;

        Process.Start(startInfo)?.Dispose();
    }
}
