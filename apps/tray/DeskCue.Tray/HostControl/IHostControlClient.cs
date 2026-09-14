namespace DeskCue.Tray.HostControl;

public interface IHostControlClient
{
    Task<HostStatus> GetStatusAsync(CancellationToken cancellationToken = default);

    Task<HostStatus> ExecuteAsync(string method, CancellationToken cancellationToken = default);
}
