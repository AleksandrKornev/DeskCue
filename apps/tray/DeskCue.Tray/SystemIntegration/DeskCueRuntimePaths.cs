namespace DeskCue.Tray.SystemIntegration;

public sealed record DeskCueRuntimePaths(
    string DataDirectory,
    string HostControlTokenPath,
    string LogsDirectory
);

public static class DeskCueRuntimePathsResolver
{
    public static DeskCueRuntimePaths ResolveCurrent()
    {
        return Resolve(
            Environment.GetEnvironmentVariable("DESKCUE_DATA_DIR"),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        );
    }

    public static DeskCueRuntimePaths Resolve(
        string? explicitDataDirectory,
        string localAppDataDirectory
    )
    {
        var dataDirectory = !string.IsNullOrWhiteSpace(explicitDataDirectory)
            ? Path.GetFullPath(explicitDataDirectory.Trim())
            : Path.GetFullPath(Path.Combine(localAppDataDirectory, "DeskCue", "data"));
        var serviceDirectory = Path.Combine(dataDirectory, "service");

        return new DeskCueRuntimePaths(
            dataDirectory,
            Path.Combine(serviceDirectory, "host-control-token"),
            Path.Combine(serviceDirectory, "logs")
        );
    }
}
