using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using DeskCue.Tray.Menu;
using Xunit;

namespace DeskCue.Tray.Tests;

public sealed class ApplicationIdentityTests
{
    private const string ExpectedIconResourceName = "DeskCue.Tray.Assets.deskcue.ico";
    private static readonly Version ExpectedAssemblyVersion = new(0, 2, 0, 0);

    [Fact]
    public void TrayAssemblyUsesDeskCueProductAndVersionIdentity()
    {
        var assembly = typeof(TrayMenuProjection).Assembly;
        var versionInfo = FileVersionInfo.GetVersionInfo(assembly.Location);

        Assert.Equal(ExpectedAssemblyVersion, assembly.GetName().Version);
        Assert.Equal("0.2.0.0", versionInfo.FileVersion);
        Assert.Equal("0.2.0", versionInfo.ProductVersion);
        Assert.Equal("DeskCue", versionInfo.ProductName);
        Assert.Equal("DeskCue Tray", versionInfo.FileDescription);
    }

    [Fact]
    public void TrayAssemblyEmbedsAReadableMultiSizeDeskCueIcon()
    {
        var assembly = typeof(TrayMenuProjection).Assembly;

        using var stream = assembly.GetManifestResourceStream(ExpectedIconResourceName);

        Assert.NotNull(stream);
        Assert.True(stream.Length > 0);

        using var reader = new BinaryReader(stream, System.Text.Encoding.UTF8, leaveOpen: true);

        Assert.Equal((ushort)0, reader.ReadUInt16());
        Assert.Equal((ushort)1, reader.ReadUInt16());

        var imageCount = reader.ReadUInt16();
        var sizes = new List<int>(imageCount);

        for (var index = 0; index < imageCount; index += 1)
        {
            var encodedWidth = reader.ReadByte();

            sizes.Add(encodedWidth == 0 ? 256 : encodedWidth);
            stream.Position += 15;
        }

        Assert.Equal([16, 20, 24, 32, 40, 48, 64, 128, 256], sizes);

        stream.Position = 0;

        using var icon = new Icon(stream);
        using var smallIcon = new Icon(icon, new Size(16, 16));
        using var largeTrayIcon = new Icon(icon, new Size(32, 32));

        Assert.Equal(new Size(16, 16), smallIcon.Size);
        Assert.Equal(new Size(32, 32), largeTrayIcon.Size);
    }

    [Fact]
    public void TrayProjectDeclaresTheEmbeddedIconAsItsWindowsApplicationIcon()
    {
        var projectDirectory = FindProjectDirectory();
        var project = File.ReadAllText(Path.Combine(projectDirectory, "DeskCue.Tray.csproj"));

        Assert.Contains("<ApplicationIcon>Assets\\deskcue.ico</ApplicationIcon>", project);
        Assert.Contains(
            "<EmbeddedResource Include=\"Assets\\deskcue.ico\" LogicalName=\"DeskCue.Tray.Assets.deskcue.ico\" />",
            project
        );
    }

    [Fact]
    public void TrayExecutableUsesTheEmbeddedDeskCueIcon()
    {
        var assembly = typeof(TrayMenuProjection).Assembly;
        var executablePath = Path.Combine(Path.GetDirectoryName(assembly.Location)!, "DeskCue.Tray.exe");

        Assert.True(File.Exists(executablePath));

        using var actualIcon = Icon.ExtractAssociatedIcon(executablePath);
        using var stream = assembly.GetManifestResourceStream(ExpectedIconResourceName);

        Assert.NotNull(actualIcon);
        Assert.NotNull(stream);

        using var expectedIcon = new Icon(stream, actualIcon.Size);
        using var actualBitmap = actualIcon.ToBitmap();
        using var expectedBitmap = expectedIcon.ToBitmap();

        Assert.Equal(expectedBitmap.Size, actualBitmap.Size);

        for (var y = 0; y < actualBitmap.Height; y += 1)
        {
            for (var x = 0; x < actualBitmap.Width; x += 1)
            {
                Assert.Equal(expectedBitmap.GetPixel(x, y).ToArgb(), actualBitmap.GetPixel(x, y).ToArgb());
            }
        }
    }

    private static string FindProjectDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "apps", "tray", "DeskCue.Tray");

            if (Directory.Exists(candidate)) return candidate;

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate the DeskCue tray project.");
    }
}
