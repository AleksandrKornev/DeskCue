using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using DeskCue.Tray.SystemIntegration;

namespace DeskCue.Tray.HostControl;

public sealed class HostControlClient : IHostControlClient
{
    private const int MinimumTokenCharacters = 32;
    private const int MaximumTokenCharacters = 256;
    private const int MaximumTokenFileBytes = MaximumTokenCharacters + 2;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };
    private static readonly byte[] RequestTerminator = Encoding.UTF8.GetBytes(
        $"\n{HostControlProtocol.RequestEndMarker}\n"
    );
    private readonly string _tokenPath;

    public HostControlClient(string tokenPath)
    {
        _tokenPath = tokenPath;
    }

    public static HostControlClient CreateDefault()
    {
        return new HostControlClient(
            DeskCueRuntimePathsResolver.ResolveCurrent().HostControlTokenPath
        );
    }

    public Task<HostStatus> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        return SendAsync(HostControlMethods.Status, cancellationToken);
    }

    public Task<HostStatus> ExecuteAsync(
        string method,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(method);

        return SendAsync(method, cancellationToken);
    }

    private async Task<HostStatus> SendAsync(string method, CancellationToken cancellationToken)
    {
        var token = await ReadTokenAsync(cancellationToken);
        var pipeName = GetPipeName();
        var request = new HostControlRequest(
            HostControlProtocol.Version,
            Guid.NewGuid().ToString("N"),
            token,
            method
        );
        var payload = JsonSerializer.SerializeToUtf8Bytes(request, JsonOptions);

        if (payload.Length + RequestTerminator.Length > HostControlProtocol.MaximumFrameBytes)
        {
            throw new HostControlException("request_too_large", "The host request is too large.");
        }

        try
        {
            await using var pipe = new NamedPipeClientStream(
                ".",
                pipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous
            );
            using var connectDeadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

            connectDeadline.CancelAfter(HostControlTimeoutPolicy.ConnectTimeout);
            await pipe.ConnectAsync(
                (int)HostControlTimeoutPolicy.ConnectTimeout.TotalMilliseconds,
                connectDeadline.Token
            );

            using var responseDeadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

            responseDeadline.CancelAfter(HostControlTimeoutPolicy.GetResponseTimeout(method));
            await pipe.WriteAsync(payload, responseDeadline.Token);
            await pipe.WriteAsync(RequestTerminator, responseDeadline.Token);
            await pipe.FlushAsync(responseDeadline.Token);

            var responsePayload = await ReadBoundedLineAsync(pipe, responseDeadline.Token);
            using var responseDocument = JsonDocument.Parse(responsePayload);

            HostControlResponseValidator.Validate(responseDocument.RootElement, request.Id);
            var response = responseDocument.RootElement.Deserialize<HostControlResponse>(JsonOptions)
                ?? throw new HostControlException("invalid_response", "DeskCue Host returned an empty response.");

            if (response.ProtocolVersion != HostControlProtocol.Version || response.Id != request.Id)
            {
                throw new HostControlException(
                    "invalid_response",
                    "DeskCue Host returned a response for a different request."
                );
            }

            if (!response.Ok)
            {
                throw new HostControlException(
                    response.Error?.Code ?? "host_error",
                    response.Error?.Message ?? "DeskCue Host rejected the request.",
                    response.Error?.Retryable ?? false,
                    blockers: NormalizeBlockers(response.Error?.Details?.Blockers)
                );
            }

            if (response.Result.ValueKind != JsonValueKind.Object ||
                !response.Result.TryGetProperty("status", out var statusElement))
            {
                throw new HostControlException(
                    "invalid_response",
                    "DeskCue Host did not return its current status."
                );
            }

            var status = statusElement.Deserialize<HostStatus>(JsonOptions)
                ?? throw new HostControlException(
                    "invalid_response",
                    "DeskCue Host returned an invalid status."
                );

            if (status.Host is null || status.Daemon is null || status.Update is null ||
                status.Autostart is null || status.Capabilities is null)
            {
                throw new HostControlException(
                    "invalid_response",
                    "DeskCue Host returned an incomplete status."
                );
            }

            return status;
        }
        catch (HostControlException)
        {
            throw;
        }
        catch (JsonException error)
        {
            throw new HostControlException(
                "invalid_response",
                "DeskCue Host returned invalid JSON.",
                innerException: error
            );
        }
        catch (OperationCanceledException error) when (!cancellationToken.IsCancellationRequested)
        {
            throw new HostControlException(
                "host_timeout",
                "DeskCue Host did not respond in time.",
                retryable: true,
                innerException: error
            );
        }
        catch (Exception error) when (error is IOException or TimeoutException or UnauthorizedAccessException)
        {
            throw new HostControlException(
                "host_unavailable",
                "DeskCue Host is unavailable.",
                retryable: true,
                innerException: error
            );
        }
    }

    private async Task<string> ReadTokenAsync(CancellationToken cancellationToken)
    {
        try
        {
            var file = new FileInfo(_tokenPath);

            if (!file.Exists || file.Length <= 0 || file.Length > MaximumTokenFileBytes)
            {
                throw new HostControlException(
                    "host_unavailable",
                    "DeskCue Host is unavailable.",
                    retryable: true
                );
            }

            var token = (await File.ReadAllTextAsync(_tokenPath, Encoding.UTF8, cancellationToken)).Trim();

            if (token.Length is < MinimumTokenCharacters or > MaximumTokenCharacters)
            {
                throw new HostControlException(
                    "host_unavailable",
                    "DeskCue Host is unavailable.",
                    retryable: true
                );
            }

            return token;
        }
        catch (HostControlException)
        {
            throw;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new HostControlException(
                "host_unavailable",
                "DeskCue Host is unavailable.",
                retryable: true,
                innerException: error
            );
        }
    }

    private string GetPipeName()
    {
        var serviceDirectory = Path.GetDirectoryName(Path.GetFullPath(_tokenPath));

        if (string.IsNullOrWhiteSpace(serviceDirectory))
        {
            throw new HostControlException(
                "host_unavailable",
                "DeskCue Host is unavailable.",
                retryable: true
            );
        }

        var normalizedServiceDirectory = serviceDirectory
            .Replace('\\', '/')
            .ToLowerInvariant();
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(normalizedServiceDirectory));
        var suffix = Convert.ToHexString(digest).ToLowerInvariant()[..24];

        return $"deskcue-host-{suffix}";
    }

    private static IReadOnlyList<HostControlBlocker> NormalizeBlockers(
        IReadOnlyList<HostControlBlocker>? blockers
    )
    {
        if (blockers is null) return [];

        return blockers
            .Where(blocker => !string.IsNullOrWhiteSpace(blocker.Code) && blocker.Count > 0)
            .Take(8)
            .Select(NormalizeBlocker)
            .ToArray();
    }

    private static HostControlBlocker NormalizeBlocker(HostControlBlocker blocker)
    {
        var code = blocker.Code.Trim();
        var message = blocker.Message?.Trim() ?? string.Empty;

        return blocker with
        {
            Code = code[..Math.Min(code.Length, 64)],
            Count = Math.Min(blocker.Count, 1_000_000),
            Message = message[..Math.Min(message.Length, 256)]
        };
    }

    private static async Task<byte[]> ReadBoundedLineAsync(
        Stream stream,
        CancellationToken cancellationToken
    )
    {
        using var output = new MemoryStream();
        var next = new byte[1];

        while (true)
        {
            var read = await stream.ReadAsync(next, cancellationToken);

            if (read == 0)
            {
                throw new HostControlException(
                    "invalid_response",
                    "DeskCue Host closed the connection before replying."
                );
            }

            if (next[0] == (byte)'\n') break;

            output.WriteByte(next[0]);

            if (output.Length >= HostControlProtocol.MaximumFrameBytes)
            {
                throw new HostControlException(
                    "response_too_large",
                    "DeskCue Host returned a response that is too large."
                );
            }
        }

        return output.ToArray();
    }

    private sealed record HostControlRequest(
        [property: JsonPropertyName("protocolVersion")] int ProtocolVersion,
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("token")] string Token,
        [property: JsonPropertyName("method")] string Method
    );

    private sealed record HostControlResponse
    {
        [JsonPropertyName("protocolVersion")]
        public int ProtocolVersion { get; init; }

        [JsonPropertyName("id")]
        public string Id { get; init; } = string.Empty;

        [JsonPropertyName("ok")]
        public bool Ok { get; init; }

        [JsonPropertyName("result")]
        public JsonElement Result { get; init; }

        [JsonPropertyName("error")]
        public HostControlError? Error { get; init; }
    }

    private sealed record HostControlError
    {
        [JsonPropertyName("code")]
        public string Code { get; init; } = "host_error";

        [JsonPropertyName("message")]
        public string Message { get; init; } = "DeskCue Host rejected the request.";

        [JsonPropertyName("retryable")]
        public bool Retryable { get; init; }

        [JsonPropertyName("details")]
        public HostControlErrorDetails? Details { get; init; }
    }

    private sealed record HostControlErrorDetails
    {
        [JsonPropertyName("blockers")]
        public List<HostControlBlocker>? Blockers { get; init; }
    }
}
