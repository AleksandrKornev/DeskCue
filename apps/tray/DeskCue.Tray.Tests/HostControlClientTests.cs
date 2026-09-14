using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DeskCue.Tray.HostControl;
using Xunit;

namespace DeskCue.Tray.Tests;

public sealed class HostControlClientTests
{
    [Theory]
    [InlineData(HostControlMethods.Status, 4)]
    [InlineData(HostControlMethods.AutostartGet, 4)]
    [InlineData(HostControlMethods.DaemonStop, 15)]
    [InlineData(HostControlMethods.DaemonStart, 35)]
    [InlineData(HostControlMethods.DaemonRestart, 45)]
    [InlineData(HostControlMethods.UpdateCheck, 75)]
    public void AssignsBoundedResponseDeadlinesByMethod(string method, int expectedSeconds)
    {
        Assert.Equal(
            TimeSpan.FromSeconds(expectedSeconds),
            HostControlTimeoutPolicy.GetResponseTimeout(method)
        );
    }

    [Fact]
    public void UpdateApplyAllowsAThirtyFiveMinuteDownloadAndHandoff()
    {
        Assert.Equal(
            TimeSpan.FromMinutes(35),
            HostControlTimeoutPolicy.GetResponseTimeout(HostControlMethods.UpdateApply)
        );
    }

    [Fact]
    public async Task UsesTheVersionedAuthenticatedHostControlEnvelope()
    {
        var token = $"{Guid.NewGuid():N}{Guid.NewGuid():N}";
        var tokenPath = CreateTokenFile(token);
        var pipeName = GetPipeName(tokenPath);
        await using var server = CreateServer(pipeName);
        var serverTask = Task.Run(async () =>
        {
            await server.WaitForConnectionAsync();
            using var reader = new StreamReader(server, Encoding.UTF8, leaveOpen: true);
            await using var writer = new StreamWriter(server, new UTF8Encoding(false), leaveOpen: true)
            {
                AutoFlush = true
            };
            var line = await reader.ReadLineAsync();
            var marker = await reader.ReadLineAsync();

            Assert.NotNull(line);
            Assert.Equal(HostControlProtocol.RequestEndMarker, marker);
            using var request = JsonDocument.Parse(line);
            var requestId = request.RootElement.GetProperty("id").GetString();

            Assert.Equal(HostControlProtocol.Version, request.RootElement.GetProperty("protocolVersion").GetInt32());
            Assert.Equal(token, request.RootElement.GetProperty("token").GetString());
            Assert.Equal("status", request.RootElement.GetProperty("method").GetString());

            await writer.WriteLineAsync(JsonSerializer.Serialize(new
            {
                protocolVersion = HostControlProtocol.Version,
                id = requestId,
                ok = true,
                result = new
                {
                    status = CreateWireStatus()
                }
            }));
        });

        try
        {
            var client = new HostControlClient(tokenPath);
            var status = await client.GetStatusAsync();

            Assert.Equal("running", status.Host.State);
            Assert.Equal("generation-1", status.Daemon.Generation);
            Assert.Equal("http://127.0.0.1:4100", status.Daemon.BaseUrl);
            Assert.True(status.Capabilities[HostControlMethods.DaemonStop].Allowed);
            await serverTask;
        }
        finally
        {
            DeleteTokenFile(tokenPath);
        }
    }

    [Fact]
    public async Task PreservesStructuredHostErrorsWithoutLeakingTheToken()
    {
        var token = $"{Guid.NewGuid():N}{Guid.NewGuid():N}";
        var tokenPath = CreateTokenFile(token);
        await using var server = CreateServer(GetPipeName(tokenPath));
        var serverTask = Task.Run(async () =>
        {
            await server.WaitForConnectionAsync();
            using var reader = new StreamReader(server, Encoding.UTF8, leaveOpen: true);
            await using var writer = new StreamWriter(server, new UTF8Encoding(false), leaveOpen: true)
            {
                AutoFlush = true
            };
            var line = await reader.ReadLineAsync();
            var marker = await reader.ReadLineAsync();

            Assert.NotNull(line);
            Assert.Equal(HostControlProtocol.RequestEndMarker, marker);
            using var request = JsonDocument.Parse(line);

            await writer.WriteLineAsync(JsonSerializer.Serialize(new
            {
                protocolVersion = HostControlProtocol.Version,
                id = request.RootElement.GetProperty("id").GetString(),
                ok = false,
                error = new
                {
                    code = "busy",
                    message = "Active work blocks this action.",
                    retryable = true,
                    details = new
                    {
                        blockers = new[]
                        {
                            new
                            {
                                code = "source_agent_turn_active",
                                count = 2,
                                message = "Two source-agent turns are active."
                            }
                        }
                    }
                }
            }));
        });

        try
        {
            var client = new HostControlClient(tokenPath);
            var error = await Assert.ThrowsAsync<HostControlException>(() =>
                client.ExecuteAsync(HostControlMethods.DaemonStop)
            );

            Assert.Equal("busy", error.Code);
            Assert.True(error.Retryable);
            var blocker = Assert.Single(error.Blockers);
            Assert.Equal("source_agent_turn_active", blocker.Code);
            Assert.Equal(2, blocker.Count);
            Assert.Equal("Two source-agent turns are active.", blocker.Message);
            Assert.DoesNotContain(token, error.ToString(), StringComparison.Ordinal);
            await serverTask;
        }
        finally
        {
            DeleteTokenFile(tokenPath);
        }
    }

    [Fact]
    public async Task RejectsAnEmptyNestedStatus()
    {
        await AssertInvalidStatusAsync(new JsonObject());
    }

    [Fact]
    public async Task RejectsUnknownStatesAndInvalidNumericRanges()
    {
        var status = CreateWireStatusNode();

        status["daemon"]!.AsObject()["state"] = "teleporting";
        status["daemon"]!.AsObject()["port"] = 70_000;

        await AssertInvalidStatusAsync(status);
    }

    [Fact]
    public async Task RejectsInvalidHostTimestamps()
    {
        var status = CreateWireStatusNode();

        status["host"]!.AsObject()["startedAt"] = "yesterday-ish";

        await AssertInvalidStatusAsync(status);
    }

    [Fact]
    public async Task RejectsUnknownCapabilityKeysAndUnboundedReasons()
    {
        var status = CreateWireStatusNode();

        status["capabilities"]!.AsObject()["daemon.teleport"] = new JsonObject
        {
            ["allowed"] = false,
            ["reason"] = new string('x', 513)
        };

        await AssertInvalidStatusAsync(status);
    }

    [Fact]
    public async Task RejectsMalformedTypedBlockers()
    {
        await AssertInvalidResponseAsync(requestId => new
        {
            protocolVersion = HostControlProtocol.Version,
            id = requestId,
            ok = false,
            error = new
            {
                code = "update_blocked",
                message = "Update is blocked.",
                retryable = false,
                details = new
                {
                    blockers = new[]
                    {
                        new { code = "source_agent_turn_active", count = 0, message = "Invalid count." }
                    }
                }
            }
        });
    }

    private static NamedPipeServerStream CreateServer(string pipeName)
    {
        return new NamedPipeServerStream(
            pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous
        );
    }

    private static async Task AssertInvalidStatusAsync(JsonObject status)
    {
        await AssertInvalidResponseAsync(requestId => new
        {
            protocolVersion = HostControlProtocol.Version,
            id = requestId,
            ok = true,
            result = new { status }
        });
    }

    private static async Task AssertInvalidResponseAsync(Func<string?, object> createResponse)
    {
        var token = $"{Guid.NewGuid():N}{Guid.NewGuid():N}";
        var tokenPath = CreateTokenFile(token);
        await using var server = CreateServer(GetPipeName(tokenPath));
        var serverTask = Task.Run(async () =>
        {
            await server.WaitForConnectionAsync();
            using var reader = new StreamReader(server, Encoding.UTF8, leaveOpen: true);
            await using var writer = new StreamWriter(server, new UTF8Encoding(false), leaveOpen: true)
            {
                AutoFlush = true
            };
            var line = await reader.ReadLineAsync();
            var marker = await reader.ReadLineAsync();

            Assert.NotNull(line);
            Assert.Equal(HostControlProtocol.RequestEndMarker, marker);
            using var request = JsonDocument.Parse(line);
            var requestId = request.RootElement.GetProperty("id").GetString();

            await writer.WriteLineAsync(JsonSerializer.Serialize(createResponse(requestId)));
        });

        try
        {
            var client = new HostControlClient(tokenPath);
            var error = await Assert.ThrowsAsync<HostControlException>(() => client.GetStatusAsync());

            Assert.Equal("invalid_response", error.Code);
            await serverTask;
        }
        finally
        {
            DeleteTokenFile(tokenPath);
        }
    }

    private static string CreateTokenFile(string token)
    {
        var directory = Path.Combine(Path.GetTempPath(), $"deskcue-tray-token-{Guid.NewGuid():N}");
        var path = Path.Combine(directory, "host-control-token");

        Directory.CreateDirectory(directory);
        File.WriteAllText(path, $"{token}\n", new UTF8Encoding(false));
        return path;
    }

    private static void DeleteTokenFile(string tokenPath)
    {
        var directory = Path.GetDirectoryName(tokenPath);

        if (directory is not null) Directory.Delete(directory, recursive: true);
    }

    private static string GetPipeName(string tokenPath)
    {
        var serviceDirectory = Path.GetDirectoryName(Path.GetFullPath(tokenPath));

        Assert.False(string.IsNullOrWhiteSpace(serviceDirectory));
        var normalizedServiceDirectory = serviceDirectory
            .Replace('\\', '/')
            .ToLowerInvariant();
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(normalizedServiceDirectory));
        return $"deskcue-host-{Convert.ToHexString(digest).ToLowerInvariant()[..24]}";
    }

    private static object CreateWireStatus()
    {
        return new
        {
            autostart = new { enabled = (bool?)null, supported = false },
            busyReason = (string?)null,
            capabilities = new Dictionary<string, object>
            {
                ["daemon.stop"] = new { allowed = true, reason = (string?)null }
            },
            daemon = new
            {
                baseUrl = "http://127.0.0.1:4100",
                generation = "generation-1",
                lastError = (string?)null,
                pid = 1234,
                port = 4100,
                restartAttempt = 0,
                state = "running",
                version = "0.1.1"
            },
            host = new
            {
                pid = 4321,
                startedAt = "2026-09-13T00:00:00.000Z",
                state = "running",
                version = "0.1.1"
            },
            update = new
            {
                availableVersion = (string?)null,
                lastError = (string?)null,
                state = "idle"
            }
        };
    }

    private static JsonObject CreateWireStatusNode()
    {
        return JsonSerializer.SerializeToNode(CreateWireStatus())!.AsObject();
    }
}
