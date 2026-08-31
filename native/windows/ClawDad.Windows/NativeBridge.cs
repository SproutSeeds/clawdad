using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using ClawDad.Windows.RemoteAssist;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace ClawDad.Windows;

internal sealed class NativeBridge
{
    private readonly Window _window;
    private readonly CoreWebView2 _webView;
    private readonly RuntimeHost _runtime;
    private readonly RemoteAssistHost _remoteAssist;

    internal NativeBridge(
        Window window,
        CoreWebView2 webView,
        RuntimeHost runtime,
        RemoteAssistHost remoteAssist
    )
    {
        _window = window;
        _webView = webView;
        _runtime = runtime;
        _remoteAssist = remoteAssist;
    }

    internal async void HandleMessage(
        CoreWebView2 sender,
        CoreWebView2WebMessageReceivedEventArgs args
    )
    {
        string id = "";
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var root = document.RootElement;
            id = String(root, "id");
            var method = String(root, "method");
            var parameters = root.TryGetProperty("params", out var parameterValue)
                && parameterValue.ValueKind == JsonValueKind.Object
                ? parameterValue
                : default;
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(method))
            {
                return;
            }

            switch (method)
            {
                case "getCapabilities":
                    Resolve(id, new Dictionary<string, object?>
                    {
                        ["platform"] = "windows",
                        ["chooseFolder"] = true,
                        ["remoteAssist"] = true,
                        ["updates"] = false,
                        ["diagnostics"] = true,
                    });
                    break;
                case "chooseFolder":
                    Resolve(id, await ChooseFolderAsync());
                    break;
                case "getRemoteAssistStatus":
                    Resolve(id, _remoteAssist.Status.ToDictionary());
                    break;
                case "setRemoteAssistEnabled":
                    if (!TryBool(parameters, "enabled", out var enabled))
                    {
                        Resolve(id, error: "enabled must be true or false");
                        return;
                    }
                    Resolve(id, (await _remoteAssist.SetEnabledAsync(enabled)).ToDictionary());
                    break;
                case "requestRemoteAssistPermissions":
                    Resolve(id, _remoteAssist.RequestPermissions().ToDictionary());
                    break;
                case "openRemoteAssistPrivacy":
                    Resolve(id, _remoteAssist.OpenPrivacySettings(
                        String(parameters, "pane")
                    ).ToDictionary());
                    break;
                case "stopRemoteAssist":
                    await _remoteAssist.StopActiveSessionAsync();
                    Resolve(id, _remoteAssist.Status.ToDictionary());
                    break;
                case "getDesktopAppStatus":
                    Resolve(id, DesktopAppStatus());
                    break;
                case "checkForUpdates":
                    Resolve(id, DesktopAppStatus());
                    break;
                case "openLogs":
                    Directory.CreateDirectory(RuntimeLog.DirectoryPath);
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = RuntimeLog.DirectoryPath,
                        UseShellExecute = true,
                    });
                    Resolve(id, new Dictionary<string, object?> { ["opened"] = true });
                    break;
                case "copyDiagnostics":
                    Resolve(id, new Dictionary<string, object?>
                    {
                        ["text"] = _runtime.DiagnosticsText(_remoteAssist.DiagnosticsText()),
                    });
                    break;
                default:
                    Resolve(id, error: $"Unsupported native method: {method}");
                    break;
            }
        }
        catch (Exception error)
        {
            RuntimeLog.Write("native-bridge", error.ToString());
            if (!string.IsNullOrEmpty(id))
            {
                Resolve(id, error: error.Message);
            }
        }
    }

    private async Task<IReadOnlyDictionary<string, object?>> ChooseFolderAsync()
    {
        var picker = new FolderPicker
        {
            SuggestedStartLocation = PickerLocationId.ComputerFolder,
        };
        picker.FileTypeFilter.Add("*");
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(_window));
        var folder = await picker.PickSingleFolderAsync();
        return folder is null
            ? new Dictionary<string, object?> { ["cancelled"] = true }
            : new Dictionary<string, object?>
            {
                ["path"] = folder.Path,
                ["cancelled"] = false,
            };
    }

    private IReadOnlyDictionary<string, object?> DesktopAppStatus()
    {
        var assembly = Assembly.GetExecutingAssembly().GetName();
        var version = assembly.Version?.ToString(3) ?? "development";
        return new Dictionary<string, object?>
        {
            ["version"] = version,
            ["build"] = assembly.Version?.Revision.ToString() ?? "",
            ["runtimeVersion"] = _runtime.RuntimeVersion,
            ["serviceReady"] = _runtime.IsReady,
            ["logsAvailable"] = true,
            ["platform"] = "windows",
            ["updates"] = new Dictionary<string, object?>
            {
                ["canCheckForUpdates"] = false,
                ["message"] = "Windows private beta updates are installed from the private release package.",
            },
        };
    }

    private void Resolve(
        string id,
        IReadOnlyDictionary<string, object?>? result = null,
        string? error = null
    )
    {
        var payload = new Dictionary<string, object?>
        {
            ["channel"] = "clawdad-native-response",
            ["id"] = id,
            ["ok"] = error is null,
            ["result"] = result ?? new Dictionary<string, object?>(),
            ["error"] = error,
        };
        _webView.PostWebMessageAsJson(
            JsonSerializer.Serialize(payload, RemoteCloudCodec.JsonOptions)
        );
    }

    private static string String(JsonElement element, string property) =>
        element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(property, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    private static bool TryBool(JsonElement element, string property, out bool value)
    {
        value = false;
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty(property, out var entry)
            || entry.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            return false;
        }
        value = entry.GetBoolean();
        return true;
    }
}
