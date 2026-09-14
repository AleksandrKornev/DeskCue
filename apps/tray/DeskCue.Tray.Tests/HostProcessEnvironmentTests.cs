using DeskCue.Tray.SystemIntegration;
using Xunit;

namespace DeskCue.Tray.Tests;

public sealed class DeskCueRuntimePathsResolverTests
{
    [Fact]
    public void PreservesAnExplicitDataDirectoryAsAnAbsolutePath()
    {
        var explicitDirectory = Path.Combine(Path.GetTempPath(), "deskcue-isolated-smoke", "data");

        var resolved = DeskCueRuntimePathsResolver.Resolve(
            $"  {explicitDirectory}  ",
            Path.Combine(Path.GetTempPath(), "real-local-app-data")
        );

        Assert.Equal(Path.GetFullPath(explicitDirectory), resolved.DataDirectory);
        Assert.Equal(
            Path.Combine(resolved.DataDirectory, "service", "host-control-token"),
            resolved.HostControlTokenPath
        );
        Assert.Equal(
            Path.Combine(resolved.DataDirectory, "service", "logs"),
            resolved.LogsDirectory
        );
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void FallsBackToTheDeskCueDirectoryUnderLocalAppData(string? explicitDirectory)
    {
        var localAppData = Path.Combine(Path.GetTempPath(), "deskcue-local-app-data");

        var resolved = DeskCueRuntimePathsResolver.Resolve(
            explicitDirectory,
            localAppData
        );

        Assert.Equal(
            Path.GetFullPath(Path.Combine(localAppData, "DeskCue", "data")),
            resolved.DataDirectory
        );
        Assert.StartsWith(resolved.DataDirectory, resolved.HostControlTokenPath);
        Assert.StartsWith(resolved.DataDirectory, resolved.LogsDirectory);
    }
}
