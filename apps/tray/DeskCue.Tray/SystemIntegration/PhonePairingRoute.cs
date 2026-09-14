namespace DeskCue.Tray.SystemIntegration;

public static class PhonePairingRoute
{
    public static string Build(string baseUrl)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri) ||
            baseUri.Scheme is not ("http" or "https") ||
            !baseUri.IsLoopback)
        {
            throw new InvalidOperationException("DeskCue Host returned an unsafe dashboard address.");
        }

        return new Uri(baseUri, "/settings?tab=access&action=pair-device").AbsoluteUri;
    }
}
