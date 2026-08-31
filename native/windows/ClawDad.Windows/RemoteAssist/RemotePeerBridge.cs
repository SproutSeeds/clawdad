using System.Text.Json;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace ClawDad.Windows.RemoteAssist;

internal sealed record RemotePeerOffer(string Sdp, int Width, int Height);
internal sealed record RemotePeerIceCandidate(string Candidate, string SdpMid, int SdpMLineIndex);

internal sealed class RemotePeerBridge : IAsyncDisposable
{
    private readonly WebView2 _webView;
    private readonly DispatcherQueue _dispatcher;
    private readonly TaskCompletionSource _pageReady = new(
        TaskCreationOptions.RunContinuationsAsynchronously
    );
    private TaskCompletionSource<RemotePeerOffer>? _offerCompletion;
    private WindowsScreenCapture? _capture;
    private RemoteControlRouter? _controlRouter;
    private int _frameQueued;
    private int _generation;
    private bool _initialized;

    internal RemotePeerBridge(WebView2 webView)
    {
        _webView = webView;
        _dispatcher = webView.DispatcherQueue;
    }

    internal event Action<RemotePeerIceCandidate>? LocalIceCandidate;
    internal event Action<string>? ConnectionStateChanged;
    internal event Action<Exception>? FatalError;

    internal async Task InitializeAsync(CoreWebView2Environment environment)
    {
        if (_initialized)
        {
            return;
        }
        await _webView.EnsureCoreWebView2Async(environment);
        _webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
        _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        _webView.CoreWebView2.WebMessageReceived += WebMessageReceived;
        var pagePath = Path.Combine(
            AppContext.BaseDirectory,
            "RemoteAssist",
            "remote-assist.html"
        );
        if (!File.Exists(pagePath))
        {
            throw new FileNotFoundException("The Windows Remote Assist bridge is missing.", pagePath);
        }
        _webView.CoreWebView2.Navigate(new Uri(pagePath).AbsoluteUri);
        await _pageReady.Task.WaitAsync(TimeSpan.FromSeconds(12));
        _initialized = true;
    }

    internal async Task<RemotePeerOffer> StartAsync(
        IReadOnlyList<RemoteIceServer> iceServers,
        CancellationToken cancellationToken
    )
    {
        if (!_initialized)
        {
            throw new InvalidOperationException("The Windows Remote Assist bridge is not ready.");
        }
        await StopAsync();
        var generation = Interlocked.Increment(ref _generation);
        var capture = new WindowsScreenCapture();
        var router = new RemoteControlRouter(capture);
        _capture = capture;
        _controlRouter = router;
        capture.FrameReady += FrameReady;
        router.ResponseReady += ControlResponseReady;
        var (width, height) = capture.CaptureSize;
        _offerCompletion = new TaskCompletionSource<RemotePeerOffer>(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        capture.Start();
        Post(new Dictionary<string, object?>
        {
            ["action"] = "start",
            ["generation"] = generation,
            ["width"] = width,
            ["height"] = height,
            ["iceServers"] = IceServerObjects(iceServers),
        });
        try
        {
            return await _offerCompletion.Task.WaitAsync(
                TimeSpan.FromSeconds(18),
                cancellationToken
            );
        }
        catch
        {
            await StopAsync();
            throw;
        }
    }

    internal Task AcceptAnswerAsync(string sdp)
    {
        if (string.IsNullOrWhiteSpace(sdp))
        {
            throw new InvalidOperationException("The iPhone returned an invalid Remote Assist answer.");
        }
        Post(new Dictionary<string, object?>
        {
            ["action"] = "answer",
            ["sdp"] = sdp,
        });
        return Task.CompletedTask;
    }

    internal void AddRemoteIce(RemotePeerIceCandidate candidate)
    {
        Post(new Dictionary<string, object?>
        {
            ["action"] = "remote-ice",
            ["candidate"] = candidate.Candidate,
            ["sdpMid"] = candidate.SdpMid,
            ["sdpMLineIndex"] = candidate.SdpMLineIndex,
        });
    }

    internal void UpdateIceServers(IReadOnlyList<RemoteIceServer> iceServers)
    {
        Post(new Dictionary<string, object?>
        {
            ["action"] = "ice-servers",
            ["iceServers"] = IceServerObjects(iceServers),
        });
    }

    internal async Task StopAsync()
    {
        Interlocked.Increment(ref _generation);
        _offerCompletion?.TrySetCanceled();
        _offerCompletion = null;
        Post(new Dictionary<string, object?> { ["action"] = "stop" });

        var router = _controlRouter;
        _controlRouter = null;
        if (router is not null)
        {
            router.ResponseReady -= ControlResponseReady;
            router.SetChannelOpen(false);
            router.Dispose();
        }
        var capture = _capture;
        _capture = null;
        if (capture is not null)
        {
            capture.FrameReady -= FrameReady;
            await capture.DisposeAsync();
        }
        Interlocked.Exchange(ref _frameQueued, 0);
    }

    private async void WebMessageReceived(
        CoreWebView2 sender,
        CoreWebView2WebMessageReceivedEventArgs args
    )
    {
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var root = document.RootElement;
            var type = String(root, "type");
            switch (type)
            {
                case "ready":
                    _pageReady.TrySetResult();
                    break;
                case "offer":
                {
                    var sdp = String(root, "sdp");
                    var capture = _capture;
                    if (!string.IsNullOrWhiteSpace(sdp) && capture is not null)
                    {
                        var size = capture.CaptureSize;
                        _offerCompletion?.TrySetResult(new RemotePeerOffer(
                            sdp,
                            size.Width,
                            size.Height
                        ));
                    }
                    break;
                }
                case "ice":
                {
                    var candidate = String(root, "candidate");
                    if (!string.IsNullOrWhiteSpace(candidate))
                    {
                        LocalIceCandidate?.Invoke(new RemotePeerIceCandidate(
                            candidate,
                            String(root, "sdpMid"),
                            Int(root, "sdpMLineIndex")
                        ));
                    }
                    break;
                }
                case "connection-state":
                    ConnectionStateChanged?.Invoke(String(root, "state"));
                    break;
                case "control-state":
                    _controlRouter?.SetChannelOpen(String(root, "state") == "open");
                    break;
                case "control":
                    if (_controlRouter is not null)
                    {
                        await _controlRouter.HandleAsync(String(root, "data"));
                    }
                    break;
                case "error":
                    FatalError?.Invoke(new InvalidOperationException(
                        String(root, "message") is { Length: > 0 } message
                            ? message
                            : "The Windows Remote Assist connection failed."
                    ));
                    break;
            }
        }
        catch (Exception error)
        {
            FatalError?.Invoke(error);
        }
    }

    private void FrameReady(RemoteScreenFrame frame)
    {
        var generation = _generation;
        if (Interlocked.Exchange(ref _frameQueued, 1) == 1)
        {
            return;
        }
        var data = Convert.ToBase64String(frame.Jpeg);
        if (!_dispatcher.TryEnqueue(() =>
            {
                try
                {
                    if (generation == _generation && _capture is not null)
                    {
                        Post(new Dictionary<string, object?>
                        {
                            ["action"] = "frame",
                            ["generation"] = generation,
                            ["width"] = frame.Width,
                            ["height"] = frame.Height,
                            ["data"] = data,
                        });
                    }
                }
                finally
                {
                    Interlocked.Exchange(ref _frameQueued, 0);
                }
            }))
        {
            Interlocked.Exchange(ref _frameQueued, 0);
        }
    }

    private void ControlResponseReady(string json)
    {
        _ = _dispatcher.TryEnqueue(() => Post(new Dictionary<string, object?>
        {
            ["action"] = "send-control",
            ["data"] = json,
        }));
    }

    private void Post(IReadOnlyDictionary<string, object?> message)
    {
        var json = JsonSerializer.Serialize(message, RemoteCloudCodec.JsonOptions);
        if (_dispatcher.HasThreadAccess)
        {
            PostJson(json);
            return;
        }
        _ = _dispatcher.TryEnqueue(() => PostJson(json));
    }

    private void PostJson(string json)
    {
        _webView.CoreWebView2?.PostWebMessageAsJson(json);
    }

    private static object[] IceServerObjects(IReadOnlyList<RemoteIceServer> servers) =>
        servers.Select(server => new Dictionary<string, object?>
        {
            ["urls"] = server.Urls,
            ["username"] = server.Username,
            ["credential"] = server.Credential,
        }).Cast<object>().ToArray();

    private static string String(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    private static int Int(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.TryGetInt32(out var number)
            ? number
            : 0;

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        if (_webView.CoreWebView2 is not null)
        {
            _webView.CoreWebView2.WebMessageReceived -= WebMessageReceived;
        }
    }
}
