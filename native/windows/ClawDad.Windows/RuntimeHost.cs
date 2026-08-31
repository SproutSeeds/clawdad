using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ClawDad.Windows;

internal sealed class RuntimeHost : IAsyncDisposable
{
    private const int PreferredPort = 4487;
    private const int FallbackPortStart = 4488;
    private const int FallbackPortEnd = 4517;
    private const string LocalHost = "127.0.0.1";
    private const string ProductionCloudUrl = "https://clawdad-cloud.frg.earth";
    private static readonly string[] WindowsCapabilities =
    [
        "artifacts",
        "catalog",
        "history",
        "message.send",
        "models",
        "pairing",
        "projects.create",
        "remote-assist",
        "remote-assist.clipboard",
        "remote-assist.displays",
        "remote-assist.special-commands",
        "remote-assist.terminal-tabs",
        "sessions",
        "speech.synthesize",
        "speech.transcribe",
        "status",
    ];

    private readonly ProcessJob _job = new();
    private readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(2),
    };
    private Process? _serverProcess;
    private Process? _cloudHostProcess;
    private FileSystemWatcher? _cloudWatcher;
    private CancellationTokenSource? _cloudRestartDelay;
    private bool _disposed;

    internal RuntimeHost()
    {
        SupportDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ClawDad"
        );
        Directory.CreateDirectory(SupportDirectory);
        Directory.CreateDirectory(RuntimeLog.DirectoryPath);
        EnsureInitialCloudConfiguration();

        RuntimeRoot = FindRuntimeRoot() ?? throw new InvalidOperationException(
            "ClawDad's bundled Windows runtime is missing. Reinstall ClawDad or set CLAWDAD_ROOT and relaunch."
        );
        NodePath = FindNodeExecutable(RuntimeRoot) ?? throw new InvalidOperationException(
            "ClawDad could not find node.exe. Install Node.js, bundle node\\node.exe, or set CLAWDAD_NODE_PATH."
        );
        Token = CredentialStore.GetOrCreateNativeToken();
        TokenFile = Path.Combine(SupportDirectory, "native-server.token");
        File.WriteAllText(TokenFile, Token + Environment.NewLine, new UTF8Encoding(false));
        File.SetAttributes(TokenFile, File.GetAttributes(TokenFile) | FileAttributes.Hidden);
        RuntimeVersion = ReadRuntimeVersion(RuntimeRoot);
    }

    internal string RuntimeRoot { get; }
    internal string SupportDirectory { get; }
    internal string TokenFile { get; }
    internal string Token { get; }
    internal string RuntimeVersion { get; }
    internal string NodePath { get; }
    internal int Port { get; private set; }
    internal Uri BaseUri => new($"http://{LocalHost}:{Port}/");
    internal bool IsReady { get; private set; }
    internal bool CodexAvailable => FindExecutable("codex.exe") is not null || FindExecutable("codex") is not null;
    internal string CapabilityArgument => string.Join(',', WindowsCapabilities);

    private static string CloudConfigurationPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".clawdad",
        "cloud.json"
    );

    private static void EnsureInitialCloudConfiguration()
    {
        if (File.Exists(CloudConfigurationPath))
        {
            return;
        }

        var machineSlug = new string(
            Environment.MachineName
                .ToLowerInvariant()
                .Select(character =>
                    char.IsLetterOrDigit(character) || character == '-'
                        ? character
                        : '-'
                )
                .ToArray()
        ).Trim('-');
        if (string.IsNullOrEmpty(machineSlug))
        {
            machineSlug = "computer";
        }
        if (machineSlug.Length > 48)
        {
            machineSlug = machineSlug[..48].TrimEnd('-');
        }
        if (string.IsNullOrEmpty(machineSlug))
        {
            machineSlug = "computer";
        }
        var hostId = $"windows-{machineSlug}-{Guid.NewGuid():N}";
        if (hostId.Length > 80)
        {
            hostId = hostId[..80];
        }

        Directory.CreateDirectory(Path.GetDirectoryName(CloudConfigurationPath)!);
        try
        {
            using var stream = new FileStream(
                CloudConfigurationPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None
            );
            JsonSerializer.Serialize(
                stream,
                new
                {
                    cloudUrl = ProductionCloudUrl,
                    hostId,
                    hostName = Environment.MachineName,
                    hostPlatform = "windows",
                    capabilities = WindowsCapabilities,
                },
                new JsonSerializerOptions { WriteIndented = true }
            );
        }
        catch (IOException) when (File.Exists(CloudConfigurationPath))
        {
            // Another first-start path created the same per-user configuration.
        }
    }

    internal async Task<Uri> StartAsync(
        Action<string>? status = null,
        CancellationToken cancellationToken = default
    )
    {
        ThrowIfDisposed();
        status?.Invoke("Checking local ClawDad service...");
        Port = await ChoosePortAsync(cancellationToken);
        if (!await IsAuthenticatedRuntimeAsync(Port, cancellationToken))
        {
            status?.Invoke("Starting local ClawDad service...");
            _serverProcess = StartNodeProcess(
                "native-server",
                [
                    Path.Combine(RuntimeRoot, "lib", "server.mjs"),
                    "serve",
                    "--host", LocalHost,
                    "--port", Port.ToString(),
                    "--auth-mode", "token",
                    "--token-file", TokenFile,
                ]
            );
            await WaitForHealthAsync(status, cancellationToken);
        }

        IsReady = true;
        StartCloudConfigurationWatcher();
        await RestartCloudHostAsync();
        status?.Invoke("Opening ClawDad...");
        return BaseUri;
    }

    internal HttpRequestMessage AuthenticatedRequest(Uri uri)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        request.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true };
        return request;
    }

    internal string DiagnosticsText(string remoteAssistText)
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "development";
        return string.Join(Environment.NewLine,
        [
            "ClawDad Desktop Diagnostics",
            $"App: {version}",
            $"Runtime: {RuntimeVersion}",
            $"Windows: {Environment.OSVersion.VersionString}",
            $"Architecture: {System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture}",
            $"Service ready: {(IsReady ? "yes" : "no")}",
            $"Codex CLI available: {(CodexAvailable ? "yes" : "no")}",
            $"Local port: {Port}",
            remoteAssistText,
        ]);
    }

    private async Task<int> ChoosePortAsync(CancellationToken cancellationToken)
    {
        if (await IsAuthenticatedRuntimeAsync(PreferredPort, cancellationToken))
        {
            return PreferredPort;
        }
        if (PortIsBindable(PreferredPort))
        {
            return PreferredPort;
        }
        for (var port = FallbackPortStart; port <= FallbackPortEnd; port += 1)
        {
            if (await IsAuthenticatedRuntimeAsync(port, cancellationToken) || PortIsBindable(port))
            {
                return port;
            }
        }
        throw new InvalidOperationException(
            $"ClawDad could not find an open local port between {PreferredPort} and {FallbackPortEnd}."
        );
    }

    private bool PortIsBindable(int port)
    {
        try
        {
            using var listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    private async Task<bool> IsAuthenticatedRuntimeAsync(
        int port,
        CancellationToken cancellationToken
    )
    {
        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                $"http://{LocalHost}:{port}/v1/native/capabilities"
            );
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            using var response = await _httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return false;
            }
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var payload = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            var root = payload.RootElement;
            return root.TryGetProperty("ok", out var ok) && ok.GetBoolean()
                && root.TryGetProperty("nativeShellProtocol", out var protocol)
                && protocol.GetInt32() == 1
                && root.TryGetProperty("nativeRuntimeVersion", out var version)
                && string.Equals(version.GetString(), RuntimeVersion, StringComparison.Ordinal);
        }
        catch
        {
            return false;
        }
    }

    private async Task WaitForHealthAsync(
        Action<string>? status,
        CancellationToken cancellationToken
    )
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(25);
        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (_serverProcess?.HasExited == true)
            {
                throw new InvalidOperationException(
                    $"The ClawDad runtime exited during startup. Open {RuntimeLog.DirectoryPath} for details."
                );
            }
            if (await IsAuthenticatedRuntimeAsync(Port, cancellationToken))
            {
                return;
            }
            status?.Invoke("Waiting for ClawDad service...");
            await Task.Delay(350, cancellationToken);
        }
        throw new TimeoutException(
            $"ClawDad did not become ready. Open {RuntimeLog.DirectoryPath} for details."
        );
    }

    private void StartCloudConfigurationWatcher()
    {
        if (_cloudWatcher is not null || _disposed)
        {
            return;
        }
        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".clawdad"
        );
        Directory.CreateDirectory(directory);
        _cloudWatcher = new FileSystemWatcher(directory, "cloud.json")
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
            EnableRaisingEvents = true,
        };
        _cloudWatcher.Changed += CloudConfigurationChanged;
        _cloudWatcher.Created += CloudConfigurationChanged;
        _cloudWatcher.Renamed += CloudConfigurationChanged;
        _cloudWatcher.Deleted += CloudConfigurationChanged;
    }

    private void CloudConfigurationChanged(object sender, FileSystemEventArgs args)
    {
        if (_disposed)
        {
            return;
        }
        _cloudRestartDelay?.Cancel();
        _cloudRestartDelay?.Dispose();
        var delay = new CancellationTokenSource();
        _cloudRestartDelay = delay;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(600, delay.Token);
                if (_disposed)
                {
                    return;
                }
                await RestartCloudHostAsync();
            }
            catch (OperationCanceledException)
            {
                // A newer configuration write owns the restart.
            }
            catch (Exception error)
            {
                RuntimeLog.Write("native-cloud-host", error.ToString());
            }
        });
    }

    private Task RestartCloudHostAsync()
    {
        StopProcess(_cloudHostProcess);
        _cloudHostProcess = null;
        var configPath = CloudConfigurationPath;
        if (!File.Exists(configPath) || !IsReady)
        {
            return Task.CompletedTask;
        }

        _cloudHostProcess = StartNodeProcess(
            "native-cloud-host",
            [
                Path.Combine(RuntimeRoot, "lib", "server.mjs"),
                "cloud-host",
                "--config", configPath,
                "--local-url", BaseUri.AbsoluteUri,
                "--local-token-file", TokenFile,
                "--host-name", Environment.MachineName,
                "--host-platform", "windows",
                "--capabilities", CapabilityArgument,
            ]
        );
        return Task.CompletedTask;
    }

    private Process StartNodeProcess(string channel, IReadOnlyList<string> arguments)
    {
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = NodePath,
                WorkingDirectory = RuntimeRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
            EnableRaisingEvents = true,
        };
        foreach (var argument in arguments)
        {
            process.StartInfo.ArgumentList.Add(argument);
        }
        ConfigureEnvironment(process.StartInfo.Environment);
        process.OutputDataReceived += (_, args) =>
        {
            if (!string.IsNullOrWhiteSpace(args.Data))
            {
                RuntimeLog.Write(channel, args.Data);
            }
        };
        process.ErrorDataReceived += (_, args) =>
        {
            if (!string.IsNullOrWhiteSpace(args.Data))
            {
                RuntimeLog.Write(channel, args.Data);
            }
        };
        process.Exited += (_, _) =>
        {
            RuntimeLog.Write(channel, $"Process exited with code {process.ExitCode}.");
        };
        if (!process.Start())
        {
            throw new InvalidOperationException($"ClawDad could not start {channel}.");
        }
        _job.Add(process);
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        RuntimeLog.Write(channel, $"Started {NodePath} {string.Join(' ', arguments)}");
        return process;
    }

    private void ConfigureEnvironment(IDictionary<string, string?> environment)
    {
        environment["CLAWDAD_ROOT"] = RuntimeRoot;
        environment["CLAWDAD_SERVER_TOKEN_FILE"] = TokenFile;
        environment["CLAWDAD_DISABLE_DELEGATE_SUPERVISOR_RESUME"] = "1";
        environment["CLAWDAD_NATIVE_RUNTIME_VERSION"] = RuntimeVersion;
        environment["CLAWDAD_CLOUD_HOST_NAME"] = Environment.MachineName;
        environment["CLAWDAD_CLOUD_HOST_PLATFORM"] = "windows";
        environment["CLAWDAD_CLOUD_HOST_CAPABILITIES"] = CapabilityArgument;
    }

    private static string? FindRuntimeRoot()
    {
        var candidates = new List<string?>
        {
            Environment.GetEnvironmentVariable("CLAWDAD_ROOT"),
            Path.Combine(AppContext.BaseDirectory, "runtime"),
            AppContext.BaseDirectory,
            Environment.CurrentDirectory,
        };
        foreach (var candidate in candidates.Where(value => !string.IsNullOrWhiteSpace(value)))
        {
            var current = new DirectoryInfo(Path.GetFullPath(candidate!));
            for (var depth = 0; current is not null && depth < 10; depth += 1, current = current.Parent)
            {
                if (File.Exists(Path.Combine(current.FullName, "package.json"))
                    && File.Exists(Path.Combine(current.FullName, "lib", "server.mjs")))
                {
                    return current.FullName;
                }
            }
        }
        return null;
    }

    private static string? FindNodeExecutable(string runtimeRoot)
    {
        var candidates = new List<string?>
        {
            Environment.GetEnvironmentVariable("CLAWDAD_NODE_PATH"),
            Path.Combine(AppContext.BaseDirectory, "node", "node.exe"),
            Path.Combine(runtimeRoot, "node", "node.exe"),
            FindExecutable("node.exe"),
        };
        return candidates.FirstOrDefault(value =>
            !string.IsNullOrWhiteSpace(value) && File.Exists(value));
    }

    private static string? FindExecutable(string name)
    {
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "")
                     .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var candidate = Path.Combine(directory.Trim('"'), name);
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
            catch
            {
                // Ignore malformed PATH entries.
            }
        }
        return null;
    }

    private static string ReadRuntimeVersion(string root)
    {
        var marker = Path.Combine(root, ".bundle-version");
        if (File.Exists(marker))
        {
            var value = File.ReadAllText(marker).Trim();
            if (!string.IsNullOrEmpty(value))
            {
                return value;
            }
        }

        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var relativePath in new[]
                 {
                     "package.json", "lib/server.mjs", "web/index.html", "web/app.css", "web/app.js",
                 })
        {
            var path = Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(path))
            {
                hash.AppendData(File.ReadAllBytes(path));
            }
        }
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    private static void StopProcess(Process? process)
    {
        if (process is null)
        {
            return;
        }
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit(2500);
            }
        }
        catch
        {
            // The process is already gone or Windows is shutting down.
        }
        process.Dispose();
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    public ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return ValueTask.CompletedTask;
        }
        _disposed = true;
        _cloudRestartDelay?.Cancel();
        _cloudRestartDelay?.Dispose();
        _cloudWatcher?.Dispose();
        StopProcess(_cloudHostProcess);
        StopProcess(_serverProcess);
        _httpClient.Dispose();
        _job.Dispose();
        return ValueTask.CompletedTask;
    }
}
