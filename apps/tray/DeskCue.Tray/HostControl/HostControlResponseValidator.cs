using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text.Json;

namespace DeskCue.Tray.HostControl;

internal static class HostControlResponseValidator
{
    private const int MaximumCapabilityReasonLength = 512;
    private const int MaximumErrorCodeLength = 128;
    private const int MaximumErrorMessageLength = 4 * 1024;
    private const int MaximumGenerationLength = 128;
    private const int MaximumStatusErrorLength = 4 * 1024;
    private const int MaximumStatusTextLength = 2 * 1024;
    private const int MaximumVersionLength = 128;
    private static readonly HashSet<string> DaemonStates =
    [
        "degraded",
        "running",
        "starting",
        "stopped",
        "stopping"
    ];
    private static readonly HashSet<string> HostStates = ["degraded", "running", "starting", "stopping"];
    private static readonly HashSet<string> Methods =
    [
        HostControlMethods.Status,
        HostControlMethods.DaemonStart,
        HostControlMethods.DaemonStop,
        HostControlMethods.DaemonRestart,
        HostControlMethods.HostShutdown,
        HostControlMethods.UpdateCheck,
        HostControlMethods.UpdateApply,
        HostControlMethods.AutostartGet,
        HostControlMethods.AutostartEnable,
        HostControlMethods.AutostartDisable
    ];
    private static readonly HashSet<string> UpdateStates =
    [
        "applying",
        "available",
        "checking",
        "downloading",
        "failed",
        "idle",
        "staged"
    ];

    public static void Validate(JsonElement root, string expectedId)
    {
        RequireKind(root, JsonValueKind.Object);
        if (RequireInteger(root, "protocolVersion") != HostControlProtocol.Version) ThrowInvalid();
        if (RequireString(root, "id", 1, 128) != expectedId) ThrowInvalid();

        var ok = RequireProperty(root, "ok");

        if (ok.ValueKind == JsonValueKind.True)
        {
            ValidateStatus(RequireObject(RequireObject(root, "result"), "status"));
            return;
        }

        if (ok.ValueKind != JsonValueKind.False) ThrowInvalid();

        ValidateError(RequireObject(root, "error"));
    }

    private static void ValidateStatus(JsonElement status)
    {
        var autostart = RequireObject(status, "autostart");
        var capabilities = RequireObject(status, "capabilities");
        var daemon = RequireObject(status, "daemon");
        var host = RequireObject(status, "host");
        var update = RequireObject(status, "update");

        RequireBooleanOrNull(autostart, "enabled");
        RequireBoolean(autostart, "supported");
        RequireNullableString(status, "busyReason", MaximumStatusTextLength);
        ValidateCapabilities(capabilities);
        RequireNullableString(daemon, "baseUrl", MaximumStatusTextLength);
        RequireNullableString(daemon, "generation", MaximumGenerationLength, allowEmpty: false);
        RequireNullableString(daemon, "lastError", MaximumStatusErrorLength);
        RequireNullablePositiveInteger(daemon, "pid");
        RequireNullableInteger(daemon, "port", 1, 65_535);
        RequireInteger(daemon, "restartAttempt", 0, 1_000_000);
        RequireKnownString(daemon, "state", DaemonStates);
        RequireNullableString(daemon, "version", MaximumVersionLength, allowEmpty: false);
        RequireInteger(host, "pid", 1, int.MaxValue);
        RequireTimestamp(host, "startedAt");
        RequireKnownString(host, "state", HostStates);
        RequireString(host, "version", 1, MaximumVersionLength);
        RequireNullableString(update, "availableVersion", MaximumVersionLength, allowEmpty: false);
        RequireNullableString(update, "lastError", MaximumStatusErrorLength);
        RequireKnownString(update, "state", UpdateStates);
    }

    private static void ValidateCapabilities(JsonElement capabilities)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        var count = 0;

        foreach (var property in capabilities.EnumerateObject())
        {
            count++;
            if (count > Methods.Count || !names.Add(property.Name) || !Methods.Contains(property.Name)) ThrowInvalid();

            RequireKind(property.Value, JsonValueKind.Object);
            RequireBoolean(property.Value, "allowed");
            RequireNullableString(property.Value, "reason", MaximumCapabilityReasonLength);
        }
    }

    private static void ValidateError(JsonElement error)
    {
        RequireString(error, "code", 1, MaximumErrorCodeLength);
        RequireString(error, "message", 1, MaximumErrorMessageLength);
        RequireBoolean(error, "retryable");

        if (!error.TryGetProperty("details", out var details)) return;

        RequireKind(details, JsonValueKind.Object);
        if (!details.TryGetProperty("blockers", out var blockers)) return;

        RequireKind(blockers, JsonValueKind.Array);
        if (blockers.GetArrayLength() > 8) ThrowInvalid();

        foreach (var blocker in blockers.EnumerateArray())
        {
            RequireKind(blocker, JsonValueKind.Object);
            RequireString(blocker, "code", 1, 64);
            RequireInteger(blocker, "count", 1, 1_000_000);
            RequireString(blocker, "message", 0, 512);
        }
    }

    private static void RequireBoolean(JsonElement parent, string name)
    {
        var value = RequireProperty(parent, name);

        if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) ThrowInvalid();
    }

    private static void RequireBooleanOrNull(JsonElement parent, string name)
    {
        var value = RequireProperty(parent, name);

        if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False or JsonValueKind.Null)) ThrowInvalid();
    }

    private static int RequireInteger(
        JsonElement parent,
        string name,
        int minimum = int.MinValue,
        int maximum = int.MaxValue
    )
    {
        var value = RequireProperty(parent, name);

        if (!value.TryGetInt32(out var integer) || integer < minimum || integer > maximum) ThrowInvalid();

        return integer;
    }

    private static void RequireKnownString(
        JsonElement parent,
        string name,
        IReadOnlySet<string> allowed
    )
    {
        var value = RequireString(parent, name, 1, 32);

        if (!allowed.Contains(value)) ThrowInvalid();
    }

    private static void RequireNullableInteger(
        JsonElement parent,
        string name,
        int minimum,
        int maximum
    )
    {
        var value = RequireProperty(parent, name);

        if (value.ValueKind == JsonValueKind.Null) return;
        if (!value.TryGetInt32(out var integer) || integer < minimum || integer > maximum) ThrowInvalid();
    }

    private static void RequireNullablePositiveInteger(JsonElement parent, string name)
    {
        RequireNullableInteger(parent, name, 1, int.MaxValue);
    }

    private static void RequireNullableString(
        JsonElement parent,
        string name,
        int maximumLength,
        bool allowEmpty = true
    )
    {
        var value = RequireProperty(parent, name);

        if (value.ValueKind == JsonValueKind.Null) return;
        if (value.ValueKind != JsonValueKind.String) ThrowInvalid();

        var text = value.GetString();

        if (text is null || text.Length > maximumLength || (!allowEmpty && text.Length == 0)) ThrowInvalid();
    }

    private static JsonElement RequireObject(JsonElement parent, string name)
    {
        var value = RequireProperty(parent, name);

        RequireKind(value, JsonValueKind.Object);
        return value;
    }

    private static JsonElement RequireProperty(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value)) ThrowInvalid();

        return value;
    }

    private static string RequireString(
        JsonElement parent,
        string name,
        int minimumLength,
        int maximumLength
    )
    {
        var value = RequireProperty(parent, name);

        if (value.ValueKind != JsonValueKind.String) ThrowInvalid();

        var text = value.GetString();

        if (text is null || text.Length < minimumLength || text.Length > maximumLength) ThrowInvalid();

        return text;
    }

    private static void RequireTimestamp(JsonElement parent, string name)
    {
        var text = RequireString(parent, name, 1, 64);

        if (!DateTimeOffset.TryParse(
            text,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out _
        ))
        {
            ThrowInvalid();
        }
    }

    private static void RequireKind(JsonElement value, JsonValueKind expected)
    {
        if (value.ValueKind != expected) ThrowInvalid();
    }

    [DoesNotReturn]
    private static void ThrowInvalid()
    {
        throw new HostControlException(
            "invalid_response",
            "DeskCue Host returned an invalid response."
        );
    }
}
