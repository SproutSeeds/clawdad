using System.Text.Json;
using ClawDad.Windows.RemoteAssist;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;

namespace ClawDad.Windows;

public sealed partial class MainWindow : Window
{
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SemaphoreSlim _startupGate = new(1, 1);
    private RuntimeHost? _runtime;
    private RemotePeerBridge? _remotePeer;
    private RemoteAssistHost? _remoteAssist;
    private NativeBridge? _nativeBridge;

    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBar);
        Closed += WindowClosed;
        _ = StartAsync();
    }

    private async Task StartAsync()
    {
        if (!await _startupGate.WaitAsync(0))
        {
            return;
        }
        try
        {
            ShowLoading("Starting ClawDad on Windows...");
            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ClawDad",
                "WebView2"
            );
            Directory.CreateDirectory(userDataFolder);
            var environment = await CoreWebView2Environment.CreateWithOptionsAsync(
                null,
                userDataFolder,
                new CoreWebView2EnvironmentOptions()
            );

            if (_remotePeer is null)
            {
                var remotePeer = new RemotePeerBridge(RemoteAssistWebView);
                await remotePeer.InitializeAsync(environment);
                _remotePeer = remotePeer;
                var remoteAssist = new RemoteAssistHost(remotePeer);
                remoteAssist.StatusChanged += RemoteAssistStatusChanged;
                _remoteAssist = remoteAssist;
                remoteAssist.StartIfEnabled();
            }

            _runtime ??= new RuntimeHost();
            var baseUri = await _runtime.StartAsync(
                text => DispatcherQueue.TryEnqueue(() => ShowLoading(text)),
                _lifetime.Token
            );

            await WorkspaceWebView.EnsureCoreWebView2Async(environment);
            ConfigureWorkspaceWebView();
            _nativeBridge = new NativeBridge(
                this,
                WorkspaceWebView.CoreWebView2,
                _runtime,
                _remoteAssist!
            );
            WorkspaceWebView.CoreWebView2.WebMessageReceived -= WorkspaceWebMessageReceived;
            WorkspaceWebView.CoreWebView2.WebMessageReceived += WorkspaceWebMessageReceived;
            NavigateAuthenticated(baseUri, _runtime.Token);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
            // The window is closing.
        }
        catch (Exception error)
        {
            RuntimeLog.Write("startup", error.ToString());
            ShowStartupFailure(error.Message);
        }
        finally
        {
            _startupGate.Release();
        }
    }

    private void ConfigureWorkspaceWebView()
    {
        var core = WorkspaceWebView.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
        core.AddWebResourceRequestedFilter(
            "http://127.0.0.1:*/*",
            CoreWebView2WebResourceContext.All
        );
        core.WebResourceRequested -= WorkspaceWebResourceRequested;
        core.WebResourceRequested += WorkspaceWebResourceRequested;
        core.PermissionRequested -= WorkspacePermissionRequested;
        core.PermissionRequested += WorkspacePermissionRequested;
        WorkspaceWebView.NavigationCompleted -= WorkspaceNavigationCompleted;
        WorkspaceWebView.NavigationCompleted += WorkspaceNavigationCompleted;
    }

    private void NavigateAuthenticated(Uri baseUri, string token)
    {
        var request = WorkspaceWebView.CoreWebView2.Environment.CreateWebResourceRequest(
            baseUri.AbsoluteUri,
            "GET",
            null,
            $"Authorization: Bearer {token}\r\nCache-Control: no-cache\r\n"
        );
        WorkspaceWebView.CoreWebView2.NavigateWithWebResourceRequest(request);
    }

    private void WorkspaceWebResourceRequested(
        CoreWebView2 sender,
        CoreWebView2WebResourceRequestedEventArgs args
    )
    {
        if (_runtime is null || !Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var uri))
        {
            return;
        }
        if (uri.IsLoopback && uri.Port == _runtime.Port)
        {
            args.Request.Headers.SetHeader("Authorization", $"Bearer {_runtime.Token}");
        }
    }

    private void WorkspacePermissionRequested(
        CoreWebView2 sender,
        CoreWebView2PermissionRequestedEventArgs args
    )
    {
        var uri = Uri.TryCreate(args.Uri, UriKind.Absolute, out var parsed) ? parsed : null;
        if (uri?.IsLoopback == true && args.PermissionKind == CoreWebView2PermissionKind.Microphone)
        {
            args.State = CoreWebView2PermissionState.Allow;
            return;
        }
        args.State = CoreWebView2PermissionState.Default;
    }

    private void WorkspaceNavigationCompleted(
        Microsoft.UI.Xaml.Controls.WebView2 sender,
        CoreWebView2NavigationCompletedEventArgs args
    )
    {
        if (args.IsSuccess)
        {
            LoadingSurface.Visibility = Visibility.Collapsed;
            WorkspaceWebView.Focus(FocusState.Programmatic);
        }
        else
        {
            ShowStartupFailure($"ClawDad could not open its local workspace ({args.WebErrorStatus}).");
        }
    }

    private void WorkspaceWebMessageReceived(
        CoreWebView2 sender,
        CoreWebView2WebMessageReceivedEventArgs args
    )
    {
        _nativeBridge?.HandleMessage(sender, args);
    }

    private void RemoteAssistStatusChanged(RemoteAssistStatus status)
    {
        _ = DispatcherQueue.TryEnqueue(() =>
        {
            RemoteAssistIndicator.Visibility = status.Active
                ? Visibility.Visible
                : Visibility.Collapsed;
            if (WorkspaceWebView.CoreWebView2 is null)
            {
                return;
            }
            var payload = new Dictionary<string, object?>
            {
                ["channel"] = "clawdad-native-remote-assist-status",
                ["status"] = status.ToDictionary(),
            };
            WorkspaceWebView.CoreWebView2.PostWebMessageAsJson(
                JsonSerializer.Serialize(payload, RemoteCloudCodec.JsonOptions)
            );
        });
    }

    private void ShowLoading(string text)
    {
        LoadingText.Text = text;
        LoadingRing.IsActive = true;
        RetryButton.Visibility = Visibility.Collapsed;
        LoadingSurface.Visibility = Visibility.Visible;
    }

    private void ShowStartupFailure(string message)
    {
        LoadingText.Text = message;
        LoadingRing.IsActive = false;
        RetryButton.Visibility = Visibility.Visible;
        LoadingSurface.Visibility = Visibility.Visible;
    }

    private void RetryButton_Click(object sender, RoutedEventArgs args)
    {
        _ = StartAsync();
    }

    private async void StopRemoteAssistButton_Click(object sender, RoutedEventArgs args)
    {
        if (_remoteAssist is not null)
        {
            await _remoteAssist.StopActiveSessionAsync();
        }
    }

    private async void WindowClosed(object sender, WindowEventArgs args)
    {
        _lifetime.Cancel();
        if (_remoteAssist is not null)
        {
            _remoteAssist.StatusChanged -= RemoteAssistStatusChanged;
            await _remoteAssist.DisposeAsync();
        }
        if (_remotePeer is not null)
        {
            await _remotePeer.DisposeAsync();
        }
        if (_runtime is not null)
        {
            await _runtime.DisposeAsync();
        }
        _lifetime.Dispose();
    }
}
