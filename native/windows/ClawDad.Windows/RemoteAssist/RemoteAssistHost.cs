using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace ClawDad.Windows.RemoteAssist;

internal sealed record RemoteAssistStatus(
    bool Enabled,
    bool Configured,
    int PairedDeviceCount,
    bool ScreenRecordingGranted,
    bool AccessibilityGranted,
    bool RelayConnected,
    bool Active,
    string Message
)
{
    internal IReadOnlyDictionary<string, object?> ToDictionary() =>
        new Dictionary<string, object?>
        {
            ["enabled"] = Enabled,
            ["configured"] = Configured,
            ["pairedDeviceCount"] = PairedDeviceCount,
            ["screenRecordingGranted"] = ScreenRecordingGranted,
            ["accessibilityGranted"] = AccessibilityGranted,
            ["captureAvailable"] = ScreenRecordingGranted,
            ["controlAvailable"] = AccessibilityGranted,
            ["relayConnected"] = RelayConnected,
            ["active"] = Active,
            ["platform"] = "windows",
            ["message"] = Message,
        };
}

internal sealed class RemoteAssistHost : IAsyncDisposable
{
    private static readonly string[] Capabilities =
    [
        "remote-assist",
        "remote-assist.clipboard",
        "remote-assist.displays",
        "remote-assist.special-commands",
        "remote-assist.terminal-tabs",
    ];

    private readonly object _stateGate = new();
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private readonly SemaphoreSlim _sessionMutation = new(1, 1);
    private readonly RemotePeerBridge _peer;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly FileSystemWatcher _configurationWatcher;
    private CancellationTokenSource? _relayCancellation;
    private Task? _relayTask;
    private ClientWebSocket? _socket;
    private CancellationTokenSource? _sessionCancellation;
    private CancellationTokenSource? _peerDisconnectCancellation;
    private CancellationTokenSource? _configurationRestartDelay;
    private string _currentSessionId = "";
    private string _currentDeviceId = "";
    private bool _relayConnected;
    private bool _enabled;
    private int _sequence;
    private readonly HashSet<string> _seenEnvelopeIds = new(StringComparer.Ordinal);
    private readonly Queue<string> _seenEnvelopeOrder = new();
    private bool _disposed;

    internal RemoteAssistHost(RemotePeerBridge peer)
    {
        _peer = peer;
        _peer.LocalIceCandidate += PeerLocalIceCandidate;
        _peer.ConnectionStateChanged += PeerConnectionStateChanged;
        _peer.FatalError += PeerFatalError;
        _enabled = LoadEnabled();

        var configDirectory = Path.GetDirectoryName(RemoteCloudConfiguration.ConfigurationPath)!;
        Directory.CreateDirectory(configDirectory);
        _configurationWatcher = new FileSystemWatcher(configDirectory, "cloud.json")
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
            EnableRaisingEvents = true,
        };
        _configurationWatcher.Changed += ConfigurationChanged;
        _configurationWatcher.Created += ConfigurationChanged;
        _configurationWatcher.Renamed += ConfigurationChanged;
        _configurationWatcher.Deleted += ConfigurationChanged;
    }

    internal event Action<RemoteAssistStatus>? StatusChanged;

    internal RemoteAssistStatus Status
    {
        get
        {
            RemoteCloudConfiguration? configuration = null;
            try
            {
                if (File.Exists(RemoteCloudConfiguration.ConfigurationPath))
                {
                    configuration = RemoteCloudConfiguration.Load();
                }
            }
            catch
            {
                // The pairing file may be between atomic writes.
            }

            lock (_stateGate)
            {
                var configured = configuration?.Ready == true;
                var pairedCount = configuration?.TrustedDevicePublicKeys.Count ?? 0;
                var active = !string.IsNullOrEmpty(_currentSessionId);
                var message = !_enabled
                    ? "Remote Assist is off."
                    : !configured
                        ? "Create a Pair iPhone code on this computer to finish Remote Assist setup."
                        : pairedCount == 0
                            ? "Pair an iPhone before using Remote Assist."
                            : active
                                ? "Your paired iPhone is controlling this Windows computer."
                                : _relayConnected
                                    ? "Remote Assist is ready."
                                    : "Remote Assist is reconnecting.";
                return new RemoteAssistStatus(
                    _enabled,
                    configured,
                    pairedCount,
                    true,
                    true,
                    _relayConnected,
                    active,
                    message
                );
            }
        }
    }

    internal void StartIfEnabled()
    {
        PublishStatus();
        if (_enabled)
        {
            StartRelayLoop();
        }
    }

    internal async Task<RemoteAssistStatus> SetEnabledAsync(bool enabled)
    {
        ThrowIfDisposed();
        lock (_stateGate)
        {
            _enabled = enabled;
        }
        SaveEnabled(enabled);
        if (enabled)
        {
            StartRelayLoop();
        }
        else
        {
            await StopActiveSessionAsync(
                "Remote Assist was turned off on the Windows computer.",
                true
            );
            await StopRelayLoopAsync();
        }
        PublishStatus();
        return Status;
    }

    internal RemoteAssistStatus RequestPermissions()
    {
        PublishStatus();
        return Status;
    }

    internal RemoteAssistStatus OpenPrivacySettings(string pane)
    {
        // Windows capture and standard-level SendInput do not use a macOS-style
        // privacy toggle. The status surface explains the administrator boundary.
        PublishStatus();
        return Status;
    }

    internal Task StopActiveSessionAsync() => StopActiveSessionAsync(
        "Remote Assist was stopped on the Windows computer.",
        true
    );

    internal string DiagnosticsText()
    {
        var status = Status;
        return string.Join(Environment.NewLine,
        [
            $"Remote Assist enabled: {(status.Enabled ? "yes" : "no")}",
            $"Remote Assist paired devices: {status.PairedDeviceCount}",
            $"Screen capture: {(status.ScreenRecordingGranted ? "available" : "unavailable")}",
            $"Control access: {(status.AccessibilityGranted ? "available" : "unavailable")}",
            $"Relay connected: {(status.RelayConnected ? "yes" : "no")}",
            $"Remote session active: {(status.Active ? "yes" : "no")}",
        ]);
    }

    private void StartRelayLoop()
    {
        lock (_stateGate)
        {
            if (_relayTask is not null || !_enabled || _disposed)
            {
                return;
            }
            _relayCancellation = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
            var cancellationToken = _relayCancellation.Token;
            _relayTask = Task.Run(() => RelayLoopAsync(cancellationToken), cancellationToken);
        }
    }

    private async Task RelayLoopAsync(CancellationToken cancellationToken)
    {
        var reconnectAttempt = 0;
        while (!cancellationToken.IsCancellationRequested)
        {
            RemoteCloudConfiguration configuration;
            try
            {
                configuration = RemoteCloudConfiguration.Load();
                if (!configuration.Ready)
                {
                    throw new InvalidOperationException("The paired-host identity is incomplete.");
                }
            }
            catch
            {
                SetRelayState(false, null);
                await DelayReconnectAsync(3, cancellationToken);
                continue;
            }

            using var socket = new ClientWebSocket();
            socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
            if (!string.IsNullOrWhiteSpace(configuration.RelayHostToken))
            {
                socket.Options.SetRequestHeader(
                    "Authorization",
                    $"Bearer {configuration.RelayHostToken}"
                );
            }

            try
            {
                await socket.ConnectAsync(configuration.RealtimeUri(), cancellationToken);
                SetRelayState(true, socket);
                reconnectAttempt = 0;
                await SendHostReadyAsync(configuration, cancellationToken);
                using var heartbeatCancellation = CancellationTokenSource.CreateLinkedTokenSource(
                    cancellationToken
                );
                var heartbeat = HeartbeatLoopAsync(
                    socket,
                    configuration,
                    heartbeatCancellation.Token
                );
                try
                {
                    await ReceiveLoopAsync(socket, configuration, cancellationToken);
                }
                finally
                {
                    heartbeatCancellation.Cancel();
                    try
                    {
                        await heartbeat;
                    }
                    catch (OperationCanceledException)
                    {
                        // Expected during reconnect.
                    }
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception error)
            {
                RuntimeLog.Write("remote-assist-relay", error.Message);
            }
            finally
            {
                SetRelayState(false, null, expectedSocket: socket);
                try
                {
                    socket.Abort();
                }
                catch
                {
                    // The socket is already closed.
                }
            }

            reconnectAttempt += 1;
            var delay = Math.Min(30, 1.5 * Math.Pow(2, Math.Min(5, reconnectAttempt - 1)));
            await DelayReconnectAsync(delay, cancellationToken);
        }

        lock (_stateGate)
        {
            _relayTask = null;
        }
    }

    private async Task ReceiveLoopAsync(
        ClientWebSocket socket,
        RemoteCloudConfiguration configuration,
        CancellationToken cancellationToken
    )
    {
        var buffer = new byte[64 * 1024];
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(
                    new ArraySegment<byte>(buffer),
                    cancellationToken
                );
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    return;
                }
                message.Write(buffer, 0, result.Count);
                if (message.Length > 2 * 1024 * 1024)
                {
                    throw new InvalidOperationException("The Remote Assist relay message was too large.");
                }
            } while (!result.EndOfMessage);

            var text = Encoding.UTF8.GetString(message.ToArray());
            var envelope = RemoteCloudCodec.Deserialize(text);
            if (envelope is null)
            {
                continue;
            }
            if (envelope.Type == "pong" && envelope.SourceDeviceId == "cloud-relay")
            {
                SetRelayState(true, socket);
                continue;
            }
            if (!envelope.Type.StartsWith("remote.assist.", StringComparison.Ordinal)
                || !RememberEnvelope(envelope.Id)
                || !RemoteCloudCodec.Verify(envelope, configuration))
            {
                continue;
            }
            await HandleRemoteEnvelopeAsync(envelope, configuration, cancellationToken);
        }
    }

    private async Task HandleRemoteEnvelopeAsync(
        RemoteCloudEnvelope envelope,
        RemoteCloudConfiguration configuration,
        CancellationToken relayCancellation
    )
    {
        switch (envelope.Type)
        {
            case "remote.assist.request":
                await HandleRequestAsync(envelope, configuration, relayCancellation);
                break;
            case "remote.assist.answer":
                if (IsCurrentSession(envelope))
                {
                    await _peer.AcceptAnswerAsync(envelope.BodyString("sdp"));
                }
                break;
            case "remote.assist.ice":
                if (IsCurrentSession(envelope))
                {
                    _peer.AddRemoteIce(new RemotePeerIceCandidate(
                        envelope.BodyString("candidate"),
                        envelope.BodyString("sdpMid"),
                        envelope.BodyInt("sdpMLineIndex")
                    ));
                }
                break;
            case "remote.assist.stop":
                if (IsCurrentSession(envelope))
                {
                    await StopActiveSessionAsync(
                        "Remote Assist was closed on the iPhone.",
                        false
                    );
                }
                break;
        }
    }

    private async Task HandleRequestAsync(
        RemoteCloudEnvelope envelope,
        RemoteCloudConfiguration configuration,
        CancellationToken relayCancellation
    )
    {
        var sessionId = envelope.BodyString("sessionId");
        if (string.IsNullOrWhiteSpace(sessionId))
        {
            return;
        }
        await _sessionMutation.WaitAsync(relayCancellation);
        try
        {
            bool enabled;
            string currentSession;
            string currentDevice;
            lock (_stateGate)
            {
                enabled = _enabled;
                currentSession = _currentSessionId;
                currentDevice = _currentDeviceId;
            }
            if (!enabled)
            {
                await SendErrorAsync(
                    "Remote Assist is off on your Windows computer.",
                    "remote_assist_disabled",
                    sessionId,
                    envelope.SourceDeviceId,
                    relayCancellation
                );
                return;
            }
            if (!string.IsNullOrEmpty(currentSession))
            {
                if (currentDevice != envelope.SourceDeviceId)
                {
                    await SendErrorAsync(
                        "Another Remote Assist session is already open.",
                        "remote_assist_busy",
                        sessionId,
                        envelope.SourceDeviceId,
                        relayCancellation
                    );
                    return;
                }
                if (currentSession == sessionId)
                {
                    return;
                }
                await StopActiveSessionCoreAsync(
                    "Remote Assist reconnected from the same iPhone.",
                    false
                );
            }

            var sessionCancellation = CancellationTokenSource.CreateLinkedTokenSource(
                relayCancellation,
                _lifetime.Token
            );
            lock (_stateGate)
            {
                _currentSessionId = sessionId;
                _currentDeviceId = envelope.SourceDeviceId;
                _sessionCancellation = sessionCancellation;
            }
            PublishStatus();

            try
            {
                await SendRemoteEnvelopeAsync(
                    "remote.assist.available",
                    new Dictionary<string, object?>
                    {
                        ["sessionId"] = sessionId,
                        ["computerName"] = Environment.MachineName,
                        ["macName"] = Environment.MachineName,
                        ["hostPlatform"] = "windows",
                    },
                    envelope.SourceDeviceId,
                    sessionCancellation.Token
                );
                var ice = await configuration.ResolveIceServersAsync(
                    envelope.SourceDeviceId,
                    sessionCancellation.Token
                );
                EnsureCurrentSession(sessionId, envelope.SourceDeviceId);
                var offer = await _peer.StartAsync(ice.IceServers, sessionCancellation.Token);
                EnsureCurrentSession(sessionId, envelope.SourceDeviceId);
                await SendRemoteEnvelopeAsync(
                    "remote.assist.offer",
                    new Dictionary<string, object?>
                    {
                        ["sessionId"] = sessionId,
                        ["sdp"] = offer.Sdp,
                        ["width"] = offer.Width,
                        ["height"] = offer.Height,
                        ["iceServers"] = IceServerObjects(ice.IceServers),
                        ["iceRelayAvailable"] = ice.RelayAvailable,
                        ["iceExpiresIn"] = ice.ExpiresIn,
                        ["iceRefreshAfter"] = ice.RefreshAfter,
                    },
                    envelope.SourceDeviceId,
                    sessionCancellation.Token
                );
                if (ice.RelayAvailable && ice.RefreshAfter > 0)
                {
                    _ = Task.Run(() => RefreshIceCredentialsAsync(
                        configuration,
                        sessionId,
                        envelope.SourceDeviceId,
                        ice.RefreshAfter,
                        sessionCancellation.Token
                    ));
                }
            }
            catch (OperationCanceledException) when (sessionCancellation.IsCancellationRequested)
            {
                // A retry or explicit stop replaced this session.
            }
            catch (Exception error)
            {
                if (IsCurrentSession(sessionId, envelope.SourceDeviceId))
                {
                    await SendErrorAsync(
                        error.Message,
                        "remote_assist_start_failed",
                        sessionId,
                        envelope.SourceDeviceId,
                        relayCancellation
                    );
                    await StopActiveSessionCoreAsync(error.Message, false);
                }
            }
        }
        finally
        {
            _sessionMutation.Release();
        }
    }

    private async Task RefreshIceCredentialsAsync(
        RemoteCloudConfiguration configuration,
        string sessionId,
        string deviceId,
        int initialDelaySeconds,
        CancellationToken cancellationToken
    )
    {
        var delay = initialDelaySeconds;
        while (!cancellationToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(Math.Max(30, delay)), cancellationToken);
            EnsureCurrentSession(sessionId, deviceId);
            var resolution = await configuration.ResolveIceServersAsync(deviceId, cancellationToken);
            EnsureCurrentSession(sessionId, deviceId);
            if (!resolution.RelayAvailable)
            {
                delay = 30;
                continue;
            }
            _peer.UpdateIceServers(resolution.IceServers);
            await SendRemoteEnvelopeAsync(
                "remote.assist.ice-servers",
                new Dictionary<string, object?>
                {
                    ["sessionId"] = sessionId,
                    ["iceServers"] = IceServerObjects(resolution.IceServers),
                    ["expiresIn"] = resolution.ExpiresIn,
                    ["refreshAfter"] = resolution.RefreshAfter,
                },
                deviceId,
                cancellationToken
            );
            delay = Math.Max(30, resolution.RefreshAfter);
        }
    }

    private void PeerLocalIceCandidate(RemotePeerIceCandidate candidate)
    {
        var (sessionId, deviceId, cancellationToken) = CurrentSessionSnapshot();
        if (string.IsNullOrEmpty(sessionId) || string.IsNullOrEmpty(candidate.Candidate))
        {
            return;
        }
        _ = Task.Run(async () =>
        {
            try
            {
                await SendRemoteEnvelopeAsync(
                    "remote.assist.ice",
                    new Dictionary<string, object?>
                    {
                        ["sessionId"] = sessionId,
                        ["candidate"] = candidate.Candidate,
                        ["sdpMid"] = candidate.SdpMid,
                        ["sdpMLineIndex"] = candidate.SdpMLineIndex,
                    },
                    deviceId,
                    cancellationToken
                );
            }
            catch
            {
                // ICE gathering continues; the relay loop owns reconnection.
            }
        });
    }

    private void PeerConnectionStateChanged(string state)
    {
        if (state == "connected")
        {
            _peerDisconnectCancellation?.Cancel();
            _peerDisconnectCancellation?.Dispose();
            _peerDisconnectCancellation = null;
            return;
        }
        if (state == "disconnected")
        {
            var snapshot = CurrentSessionSnapshot();
            if (string.IsNullOrEmpty(snapshot.SessionId))
            {
                return;
            }
            _peerDisconnectCancellation?.Cancel();
            _peerDisconnectCancellation?.Dispose();
            var timeout = CancellationTokenSource.CreateLinkedTokenSource(
                snapshot.CancellationToken,
                _lifetime.Token
            );
            _peerDisconnectCancellation = timeout;
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(15), timeout.Token);
                    if (IsCurrentSession(snapshot.SessionId, snapshot.DeviceId))
                    {
                        await StopActiveSessionAsync(
                            "Remote Assist disconnected during a network change.",
                            true
                        );
                    }
                }
                catch (OperationCanceledException)
                {
                    // The peer recovered or the session closed.
                }
            });
            return;
        }
        if (state is "failed" or "closed")
        {
            _ = StopActiveSessionAsync("The Remote Assist connection ended.", true);
        }
    }

    private void PeerFatalError(Exception error)
    {
        RuntimeLog.Write("remote-assist", error.ToString());
        _ = StopActiveSessionAsync(error.Message, true);
    }

    private async Task StopActiveSessionAsync(string reason, bool notifyPhone)
    {
        await _sessionMutation.WaitAsync();
        try
        {
            await StopActiveSessionCoreAsync(reason, notifyPhone);
        }
        finally
        {
            _sessionMutation.Release();
        }
    }

    private async Task StopActiveSessionCoreAsync(string reason, bool notifyPhone)
    {
        string sessionId;
        string deviceId;
        CancellationTokenSource? cancellation;
        lock (_stateGate)
        {
            sessionId = _currentSessionId;
            deviceId = _currentDeviceId;
            cancellation = _sessionCancellation;
            _currentSessionId = "";
            _currentDeviceId = "";
            _sessionCancellation = null;
        }
        _peerDisconnectCancellation?.Cancel();
        _peerDisconnectCancellation?.Dispose();
        _peerDisconnectCancellation = null;
        cancellation?.Cancel();
        await _peer.StopAsync();
        cancellation?.Dispose();

        if (notifyPhone && !string.IsNullOrEmpty(sessionId) && !string.IsNullOrEmpty(deviceId))
        {
            try
            {
                await SendRemoteEnvelopeAsync(
                    "remote.assist.stop",
                    new Dictionary<string, object?>
                    {
                        ["sessionId"] = sessionId,
                        ["reason"] = reason,
                    },
                    deviceId,
                    _lifetime.Token
                );
            }
            catch
            {
                // The relay may already be reconnecting.
            }
        }
        PublishStatus();
    }

    private bool IsCurrentSession(RemoteCloudEnvelope envelope) =>
        IsCurrentSession(envelope.BodyString("sessionId"), envelope.SourceDeviceId);

    private bool IsCurrentSession(string sessionId, string deviceId)
    {
        lock (_stateGate)
        {
            return !string.IsNullOrEmpty(sessionId)
                && _currentSessionId == sessionId
                && _currentDeviceId == deviceId;
        }
    }

    private void EnsureCurrentSession(string sessionId, string deviceId)
    {
        if (!IsCurrentSession(sessionId, deviceId))
        {
            throw new OperationCanceledException("The Remote Assist session was replaced.");
        }
    }

    private (string SessionId, string DeviceId, CancellationToken CancellationToken)
        CurrentSessionSnapshot()
    {
        lock (_stateGate)
        {
            return (
                _currentSessionId,
                _currentDeviceId,
                _sessionCancellation?.Token ?? _lifetime.Token
            );
        }
    }

    private async Task SendHostReadyAsync(
        RemoteCloudConfiguration configuration,
        CancellationToken cancellationToken
    )
    {
        await SendEnvelopeAsync(
            "host.ready",
            new Dictionary<string, object?>
            {
                ["remoteAssist"] = true,
                ["readyAt"] = RemoteCloudCodec.DateString(DateTimeOffset.UtcNow),
                ["hostName"] = Environment.MachineName,
                ["hostPlatform"] = "windows",
                ["capabilities"] = Capabilities,
            },
            "",
            configuration,
            cancellationToken
        );
    }

    private async Task HeartbeatLoopAsync(
        ClientWebSocket socket,
        RemoteCloudConfiguration configuration,
        CancellationToken cancellationToken
    )
    {
        while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
        {
            await Task.Delay(TimeSpan.FromSeconds(20), cancellationToken);
            await SendEnvelopeAsync(
                "ping",
                new Dictionary<string, object?>
                {
                    ["role"] = "remote-assist-host",
                    ["sentAt"] = RemoteCloudCodec.DateString(DateTimeOffset.UtcNow),
                },
                configuration.HostId,
                configuration,
                cancellationToken
            );
        }
    }

    private Task SendRemoteEnvelopeAsync(
        string type,
        IReadOnlyDictionary<string, object?> body,
        string targetDeviceId,
        CancellationToken cancellationToken
    )
    {
        if (!type.StartsWith("remote.assist.", StringComparison.Ordinal))
        {
            return Task.CompletedTask;
        }
        var configuration = RemoteCloudConfiguration.Load();
        return SendEnvelopeAsync(
            type,
            body,
            targetDeviceId,
            configuration,
            cancellationToken
        );
    }

    private async Task SendEnvelopeAsync(
        string type,
        IReadOnlyDictionary<string, object?> body,
        string targetDeviceId,
        RemoteCloudConfiguration configuration,
        CancellationToken cancellationToken
    )
    {
        ClientWebSocket? socket;
        lock (_stateGate)
        {
            socket = _socket;
        }
        if (socket is null || socket.State != WebSocketState.Open)
        {
            throw new InvalidOperationException("ClawDad is reconnecting to its secure relay.");
        }

        var envelope = RemoteCloudCodec.Sign(
            RemoteCloudCodec.Create(
                type,
                configuration,
                targetDeviceId,
                Interlocked.Increment(ref _sequence),
                body
            ),
            configuration
        );
        var bytes = Encoding.UTF8.GetBytes(RemoteCloudCodec.Serialize(envelope));
        await _sendGate.WaitAsync(cancellationToken);
        try
        {
            await socket.SendAsync(
                new ArraySegment<byte>(bytes),
                WebSocketMessageType.Text,
                true,
                cancellationToken
            );
        }
        finally
        {
            _sendGate.Release();
        }
    }

    private Task SendErrorAsync(
        string message,
        string code,
        string sessionId,
        string targetDeviceId,
        CancellationToken cancellationToken
    ) => SendRemoteEnvelopeAsync(
        "remote.assist.error",
        new Dictionary<string, object?>
        {
            ["sessionId"] = sessionId,
            ["error"] = message,
            ["code"] = code,
        },
        targetDeviceId,
        cancellationToken
    );

    private static object[] IceServerObjects(IReadOnlyList<RemoteIceServer> servers) =>
        servers.Select(server => new Dictionary<string, object?>
        {
            ["urls"] = server.Urls,
            ["username"] = server.Username,
            ["credential"] = server.Credential,
        }).Cast<object>().ToArray();

    private void ConfigurationChanged(object sender, FileSystemEventArgs args)
    {
        CancellationToken cancellationToken;
        lock (_stateGate)
        {
            if (_disposed)
            {
                return;
            }
            _configurationRestartDelay?.Cancel();
            _configurationRestartDelay?.Dispose();
            _configurationRestartDelay = CancellationTokenSource.CreateLinkedTokenSource(
                _lifetime.Token
            );
            cancellationToken = _configurationRestartDelay.Token;
        }
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(600, cancellationToken);
                await RestartRelayLoopAsync();
            }
            catch (OperationCanceledException)
            {
                // A newer cloud configuration write owns the restart.
            }
            catch (Exception error) when (!_disposed)
            {
                RuntimeLog.Write("remote-assist", error.ToString());
            }
        });
    }

    private async Task RestartRelayLoopAsync()
    {
        await StopActiveSessionAsync(
            "The paired Windows host configuration changed.",
            true
        );
        await StopRelayLoopAsync();
        if (_enabled && !_disposed)
        {
            StartRelayLoop();
        }
        PublishStatus();
    }

    private async Task StopRelayLoopAsync()
    {
        Task? task;
        CancellationTokenSource? cancellation;
        ClientWebSocket? socket;
        lock (_stateGate)
        {
            task = _relayTask;
            cancellation = _relayCancellation;
            socket = _socket;
            _relayTask = null;
            _relayCancellation = null;
            _socket = null;
            _relayConnected = false;
        }
        cancellation?.Cancel();
        try
        {
            socket?.Abort();
        }
        catch
        {
            // The socket is already gone.
        }
        if (task is not null)
        {
            try
            {
                await task.WaitAsync(TimeSpan.FromSeconds(3));
            }
            catch
            {
                // Cancellation and shutdown both land here.
            }
        }
        cancellation?.Dispose();
    }

    private void SetRelayState(
        bool connected,
        ClientWebSocket? socket,
        ClientWebSocket? expectedSocket = null
    )
    {
        lock (_stateGate)
        {
            if (expectedSocket is not null && !ReferenceEquals(_socket, expectedSocket))
            {
                return;
            }
            _relayConnected = connected;
            _socket = socket;
        }
        PublishStatus();
    }

    private bool RememberEnvelope(string id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return false;
        }
        lock (_stateGate)
        {
            if (!_seenEnvelopeIds.Add(id))
            {
                return false;
            }
            _seenEnvelopeOrder.Enqueue(id);
            while (_seenEnvelopeOrder.Count > 512)
            {
                _seenEnvelopeIds.Remove(_seenEnvelopeOrder.Dequeue());
            }
            return true;
        }
    }

    private static async Task DelayReconnectAsync(
        double seconds,
        CancellationToken cancellationToken
    )
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(seconds), cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // The relay loop is stopping.
        }
    }

    private void PublishStatus()
    {
        StatusChanged?.Invoke(Status);
    }

    private static string PreferencesPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClawDad",
        "remote-assist.json"
    );

    private static bool LoadEnabled()
    {
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(PreferencesPath));
            return document.RootElement.TryGetProperty("enabled", out var value)
                && value.ValueKind == JsonValueKind.True;
        }
        catch
        {
            return false;
        }
    }

    private static void SaveEnabled(bool enabled)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(PreferencesPath)!);
        File.WriteAllText(
            PreferencesPath,
            JsonSerializer.Serialize(new { enabled }, RemoteCloudCodec.JsonOptions),
            new UTF8Encoding(false)
        );
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        _configurationWatcher.Dispose();
        _configurationRestartDelay?.Cancel();
        _configurationRestartDelay?.Dispose();
        _lifetime.Cancel();
        await StopActiveSessionAsync("ClawDad closed on Windows.", true);
        await StopRelayLoopAsync();
        _peer.LocalIceCandidate -= PeerLocalIceCandidate;
        _peer.ConnectionStateChanged -= PeerConnectionStateChanged;
        _peer.FatalError -= PeerFatalError;
        _sessionMutation.Dispose();
        _sendGate.Dispose();
        _lifetime.Dispose();
    }
}
