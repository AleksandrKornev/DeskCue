namespace DeskCue.Tray;

internal static class TrayIconFactory
{
    internal const string ResourceName = "DeskCue.Tray.Assets.deskcue.ico";

    public static Icon Create()
    {
        using var stream = typeof(TrayIconFactory).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException("The embedded DeskCue icon is unavailable.");
        using var icon = new Icon(stream);

        return (Icon)icon.Clone();
    }
}
