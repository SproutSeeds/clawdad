using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ClawDad.Windows.RemoteAssist;

internal sealed class RemoteCloudSignature
{
    [JsonPropertyName("alg")]
    public string Algorithm { get; set; } = "ES256";

    [JsonPropertyName("keyId")]
    public string KeyId { get; set; } = "";

    [JsonPropertyName("value")]
    public string Value { get; set; } = "";
}

internal sealed class RemoteCloudEnvelope
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("protocolVersion")]
    public string ProtocolVersion { get; set; } = RemoteCloudCodec.ProtocolVersion;

    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("accountId")]
    public string AccountId { get; set; } = "";

    [JsonPropertyName("workspaceId")]
    public string WorkspaceId { get; set; } = "";

    [JsonPropertyName("sourceDeviceId")]
    public string SourceDeviceId { get; set; } = "";

    [JsonPropertyName("targetHostId")]
    public string TargetHostId { get; set; } = "";

    [JsonPropertyName("seq")]
    public int Sequence { get; set; }

    [JsonPropertyName("createdAt")]
    public string CreatedAt { get; set; } = "";

    [JsonPropertyName("expiresAt")]
    public string ExpiresAt { get; set; } = "";

    [JsonPropertyName("body")]
    public Dictionary<string, JsonElement> Body { get; set; } = [];

    [JsonPropertyName("signature")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public RemoteCloudSignature? Signature { get; set; }

    internal string BodyString(string name)
    {
        return Body.TryGetValue(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";
    }

    internal int BodyInt(string name)
    {
        return Body.TryGetValue(name, out var value) && value.TryGetInt32(out var number)
            ? number
            : 0;
    }
}

internal sealed record RemoteIceServer(
    IReadOnlyList<string> Urls,
    string? Username = null,
    string? Credential = null
);

internal sealed record RemoteIceResolution(
    IReadOnlyList<RemoteIceServer> IceServers,
    bool RelayAvailable,
    string RelayReason,
    int ExpiresIn,
    int RefreshAfter
);

internal sealed class RemoteCloudConfiguration
{
    internal string CloudUrl { get; init; } = "";
    internal string AccountId { get; init; } = "";
    internal string WorkspaceId { get; init; } = "";
    internal string HostId { get; init; } = "";
    internal string RelayHostToken { get; init; } = "";
    internal string HostPrivateKeyPem { get; init; } = "";
    internal string HostPublicKeyPem { get; init; } = "";
    internal IReadOnlyDictionary<string, string> TrustedDevicePublicKeys { get; init; }
        = new Dictionary<string, string>();
    internal IReadOnlyList<RemoteIceServer> IceServers { get; init; }
        = [new RemoteIceServer(["stun:stun.cloudflare.com:3478"])];

    internal bool Ready =>
        !string.IsNullOrWhiteSpace(CloudUrl)
        && !string.IsNullOrWhiteSpace(AccountId)
        && !string.IsNullOrWhiteSpace(WorkspaceId)
        && !string.IsNullOrWhiteSpace(HostId)
        && !string.IsNullOrWhiteSpace(HostPrivateKeyPem)
        && !string.IsNullOrWhiteSpace(HostPublicKeyPem);

    internal static string ConfigurationPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".clawdad",
        "cloud.json"
    );

    internal static RemoteCloudConfiguration Load()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(ConfigurationPath));
        var root = document.RootElement;
        var configuredIce = ParseIceServers(root, "remoteAssistIceServers");
        return new RemoteCloudConfiguration
        {
            CloudUrl = String(root, "cloudUrl"),
            AccountId = String(root, "accountId"),
            WorkspaceId = String(root, "workspaceId"),
            HostId = String(root, "hostId"),
            RelayHostToken = FirstNonempty(
                String(root, "relayHostToken"),
                String(root, "devToken"),
                String(root, "cloudDevToken")
            ),
            HostPrivateKeyPem = KeyValue(
                String(root, "hostPrivateKey"),
                String(root, "hostPrivateKeyPath")
            ),
            HostPublicKeyPem = KeyValue(
                String(root, "hostPublicKey"),
                String(root, "hostPublicKeyPath")
            ),
            TrustedDevicePublicKeys = ParseTrustedKeys(root),
            IceServers = configuredIce.Count > 0
                ? configuredIce
                : [new RemoteIceServer(["stun:stun.cloudflare.com:3478"])],
        };
    }

    internal Uri RealtimeUri()
    {
        var source = new Uri(CloudUrl);
        var builder = new UriBuilder(source)
        {
            Scheme = source.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase)
                ? "wss"
                : "ws",
            Path = $"/workspaces/{Uri.EscapeDataString(WorkspaceId)}/realtime",
            Query = $"hostId={Uri.EscapeDataString(HostId)}&accountId={Uri.EscapeDataString(AccountId)}",
        };
        if (source.IsDefaultPort)
        {
            builder.Port = -1;
        }
        return builder.Uri;
    }

    internal async Task<RemoteIceResolution> ResolveIceServersAsync(
        string targetDeviceId,
        CancellationToken cancellationToken
    )
    {
        var fallback = new RemoteIceResolution(IceServers, false, "request_unavailable", 0, 0);
        if (string.IsNullOrWhiteSpace(RelayHostToken) || string.IsNullOrWhiteSpace(targetDeviceId))
        {
            return fallback;
        }

        try
        {
            var source = new Uri(CloudUrl);
            var endpoint = new UriBuilder(source)
            {
                Path = $"/workspaces/{Uri.EscapeDataString(WorkspaceId)}/remote-assist/ice-servers",
                Query = $"accountId={Uri.EscapeDataString(AccountId)}",
            }.Uri;
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", RelayHostToken);
            request.Content = new StringContent(
                JsonSerializer.Serialize(new { targetDeviceId }, RemoteCloudCodec.JsonOptions),
                Encoding.UTF8,
                "application/json"
            );
            using var response = await client.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return fallback;
            }
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var payload = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            var root = payload.RootElement;
            var servers = ParseIceServers(root, "iceServers");
            return new RemoteIceResolution(
                servers.Count > 0 ? servers : IceServers,
                Bool(root, "relayAvailable"),
                String(root, "relayReason"),
                Int(root, "expiresIn"),
                Int(root, "refreshAfter")
            );
        }
        catch
        {
            return fallback;
        }
    }

    private static IReadOnlyDictionary<string, string> ParseTrustedKeys(JsonElement root)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!root.TryGetProperty("trustedDevicePublicKeys", out var value)
            || value.ValueKind != JsonValueKind.Object)
        {
            return result;
        }
        foreach (var entry in value.EnumerateObject())
        {
            if (entry.Value.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(entry.Value.GetString()))
            {
                result[entry.Name] = entry.Value.GetString()!.Trim();
            }
        }
        return result;
    }

    private static List<RemoteIceServer> ParseIceServers(JsonElement root, string property)
    {
        var result = new List<RemoteIceServer>();
        if (!root.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.Array)
        {
            return result;
        }
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }
            var urls = new List<string>();
            if (item.TryGetProperty("urls", out var urlValue))
            {
                if (urlValue.ValueKind == JsonValueKind.Array)
                {
                    urls.AddRange(urlValue.EnumerateArray()
                        .Where(entry => entry.ValueKind == JsonValueKind.String)
                        .Select(entry => entry.GetString() ?? "")
                        .Where(entry => !string.IsNullOrWhiteSpace(entry)));
                }
                else if (urlValue.ValueKind == JsonValueKind.String)
                {
                    urls.Add(urlValue.GetString() ?? "");
                }
            }
            if (urls.Count == 0 && item.TryGetProperty("url", out var singular)
                && singular.ValueKind == JsonValueKind.String)
            {
                urls.Add(singular.GetString() ?? "");
            }
            urls = urls.Where(entry => !string.IsNullOrWhiteSpace(entry)).ToList();
            if (urls.Count == 0)
            {
                continue;
            }
            result.Add(new RemoteIceServer(
                urls,
                OptionalString(item, "username"),
                OptionalString(item, "credential")
            ));
        }
        return result;
    }

    private static string KeyValue(string inline, string path)
    {
        if (inline.Contains("BEGIN ", StringComparison.Ordinal))
        {
            return inline.Trim();
        }
        var candidate = !string.IsNullOrWhiteSpace(path)
            ? path
            : inline.Contains('/') || inline.Contains('\\') ? inline : "";
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return inline.Trim();
        }
        return File.ReadAllText(ExpandHome(candidate)).Trim();
    }

    private static string ExpandHome(string path)
    {
        var value = path.Trim();
        if (value == "~")
        {
            return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        }
        if (value.StartsWith("~/", StringComparison.Ordinal) || value.StartsWith("~\\", StringComparison.Ordinal))
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                value[2..]
            );
        }
        return Environment.ExpandEnvironmentVariables(value);
    }

    private static string FirstNonempty(params string[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? "";

    private static string String(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()?.Trim() ?? ""
            : "";

    private static string? OptionalString(JsonElement element, string name)
    {
        var value = String(element, name);
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private static int Int(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.TryGetInt32(out var number)
            ? Math.Max(0, number)
            : 0;

    private static bool Bool(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
}

internal static class RemoteCloudCodec
{
    internal const string ProtocolVersion = "clawdad.cloud.v1";
    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    internal static RemoteCloudEnvelope Create(
        string type,
        RemoteCloudConfiguration configuration,
        string targetDeviceId,
        int sequence,
        IReadOnlyDictionary<string, object?> body
    )
    {
        var now = DateTimeOffset.UtcNow;
        var bodyElement = JsonSerializer.SerializeToElement(body, JsonOptions);
        return new RemoteCloudEnvelope
        {
            Id = Guid.NewGuid().ToString("D").ToLowerInvariant(),
            ProtocolVersion = ProtocolVersion,
            Type = type,
            AccountId = configuration.AccountId,
            WorkspaceId = configuration.WorkspaceId,
            SourceDeviceId = configuration.HostId,
            TargetHostId = targetDeviceId,
            Sequence = sequence,
            CreatedAt = DateString(now),
            ExpiresAt = DateString(now.AddSeconds(60)),
            Body = bodyElement.EnumerateObject().ToDictionary(
                property => property.Name,
                property => property.Value.Clone(),
                StringComparer.Ordinal
            ),
        };
    }

    internal static RemoteCloudEnvelope Sign(
        RemoteCloudEnvelope envelope,
        RemoteCloudConfiguration configuration
    )
    {
        using var privateKey = ECDsa.Create();
        privateKey.ImportFromPem(configuration.HostPrivateKeyPem);
        var signature = privateKey.SignData(
            CanonicalData(envelope),
            HashAlgorithmName.SHA256,
            DSASignatureFormat.Rfc3279DerSequence
        );
        envelope.Signature = new RemoteCloudSignature
        {
            Algorithm = "ES256",
            KeyId = HostKeyId(configuration.HostPublicKeyPem),
            Value = Base64UrlEncode(signature),
        };
        return envelope;
    }

    internal static bool Verify(
        RemoteCloudEnvelope envelope,
        RemoteCloudConfiguration configuration
    )
    {
        if (!string.Equals(envelope.ProtocolVersion, ProtocolVersion, StringComparison.Ordinal)
            || !string.Equals(envelope.AccountId, configuration.AccountId, StringComparison.Ordinal)
            || !string.Equals(envelope.WorkspaceId, configuration.WorkspaceId, StringComparison.Ordinal)
            || !string.Equals(envelope.TargetHostId, configuration.HostId, StringComparison.Ordinal)
            || envelope.Signature is null
            || !string.Equals(envelope.Signature.Algorithm, "ES256", StringComparison.Ordinal)
            || !configuration.TrustedDevicePublicKeys.TryGetValue(
                envelope.SourceDeviceId,
                out var publicKeyPem)
            || IsExpired(envelope))
        {
            return false;
        }

        try
        {
            using var publicKey = ECDsa.Create();
            publicKey.ImportFromPem(publicKeyPem);
            return publicKey.VerifyData(
                CanonicalData(envelope),
                Base64UrlDecode(envelope.Signature.Value),
                HashAlgorithmName.SHA256,
                DSASignatureFormat.Rfc3279DerSequence
            );
        }
        catch
        {
            return false;
        }
    }

    internal static string Serialize(RemoteCloudEnvelope envelope) =>
        Encoding.UTF8.GetString(SortedJsonData(JsonSerializer.SerializeToElement(envelope, JsonOptions)));

    internal static RemoteCloudEnvelope? Deserialize(string value)
    {
        try
        {
            return JsonSerializer.Deserialize<RemoteCloudEnvelope>(value, JsonOptions);
        }
        catch
        {
            return null;
        }
    }

    internal static byte[] CanonicalData(RemoteCloudEnvelope envelope)
    {
        var signature = envelope.Signature;
        envelope.Signature = null;
        try
        {
            return SortedJsonData(JsonSerializer.SerializeToElement(envelope, JsonOptions));
        }
        finally
        {
            envelope.Signature = signature;
        }
    }

    internal static string DateString(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", System.Globalization.CultureInfo.InvariantCulture);

    private static byte[] SortedJsonData(JsonElement element)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions
               {
                   Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
               }))
        {
            WriteSorted(writer, element);
        }
        return stream.ToArray();
    }

    private static void WriteSorted(Utf8JsonWriter writer, JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in element.EnumerateObject()
                             .OrderBy(property => property.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Name);
                    WriteSorted(writer, property.Value);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var value in element.EnumerateArray())
                {
                    WriteSorted(writer, value);
                }
                writer.WriteEndArray();
                break;
            default:
                element.WriteTo(writer);
                break;
        }
    }

    private static string HostKeyId(string publicKeyPem)
    {
        var body = publicKeyPem
            .Replace("-----BEGIN PUBLIC KEY-----", "", StringComparison.Ordinal)
            .Replace("-----END PUBLIC KEY-----", "", StringComparison.Ordinal)
            .Replace("\r", "", StringComparison.Ordinal)
            .Replace("\n", "", StringComparison.Ordinal)
            .Trim();
        var der = Convert.FromBase64String(body);
        return Base64UrlEncode(SHA256.HashData(der))[..32];
    }

    private static bool IsExpired(RemoteCloudEnvelope envelope)
    {
        return !DateTimeOffset.TryParse(
                   envelope.ExpiresAt,
                   System.Globalization.CultureInfo.InvariantCulture,
                   System.Globalization.DateTimeStyles.AssumeUniversal,
                   out var expiry)
            || expiry.AddSeconds(5) < DateTimeOffset.UtcNow;
    }

    internal static string Base64UrlEncode(ReadOnlySpan<byte> data) =>
        Convert.ToBase64String(data)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

    internal static byte[] Base64UrlDecode(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += (normalized.Length % 4) switch
        {
            2 => "==",
            3 => "=",
            _ => "",
        };
        return Convert.FromBase64String(normalized);
    }
}
