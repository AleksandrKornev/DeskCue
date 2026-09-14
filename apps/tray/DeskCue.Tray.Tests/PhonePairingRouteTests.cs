using DeskCue.Tray.SystemIntegration;
using Xunit;

namespace DeskCue.Tray.Tests;

public sealed class PhonePairingRouteTests
{
    [Fact]
    public void BuildsTheOneShotBrowserPairingRoute()
    {
        Assert.Equal(
            "http://127.0.0.1:4100/settings?tab=access&action=pair-device",
            PhonePairingRoute.Build("http://127.0.0.1:4100/session")
        );
    }

    [Theory]
    [InlineData("https://deskcue.example")]
    [InlineData("file:///C:/DeskCue/index.html")]
    [InlineData("not-a-url")]
    public void RejectsNonLoopbackDashboardAddresses(string address)
    {
        Assert.Throws<InvalidOperationException>(() => PhonePairingRoute.Build(address));
    }
}
