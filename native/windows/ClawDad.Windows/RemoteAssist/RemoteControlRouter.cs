using System.Text.Json;

namespace ClawDad.Windows.RemoteAssist;

internal sealed class RemoteControlRouter : IDisposable
{
    private readonly WindowsScreenCapture _capture;
    private readonly WindowsInputController _input;
    private readonly WindowsTerminalTabs _terminalTabs = new();
    private readonly SemaphoreSlim _terminalOperation = new(1, 1);
    private bool _channelOpen;

    internal RemoteControlRouter(WindowsScreenCapture capture)
    {
        _capture = capture;
        _input = new WindowsInputController(capture);
        _capture.TopologyChanged += CaptureTopologyChanged;
    }

    internal event Action<string>? ResponseReady;

    internal void SetChannelOpen(bool open)
    {
        _channelOpen = open;
        if (!open)
        {
            return;
        }
        Send(new Dictionary<string, object?>
        {
            ["type"] = "session.state",
            ["screenLocked"] = false,
        });
        SendDisplayState(_capture.State);
    }

    internal async Task HandleAsync(string json)
    {
        if (string.IsNullOrWhiteSpace(json)
            || System.Text.Encoding.UTF8.GetByteCount(json) > 70 * 1024)
        {
            return;
        }
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(json);
        }
        catch
        {
            return;
        }
        using (document)
        {
            var root = document.RootElement;
            var type = String(root, "type");
            switch (type)
            {
                case "pointer":
                    _input.HandlePointer(root);
                    break;
                case "scroll":
                    _input.HandleScroll(root);
                    break;
                case "input":
                    Send(await _input.HandleInputAsync(root));
                    break;
                case "clipboard":
                    Send(await _input.HandleClipboardAsync(root));
                    break;
                case "display.select":
                    HandleDisplaySelection(root);
                    break;
                case "terminal.tabs.request":
                case "terminal.tab.focus":
                    await HandleTerminalRequestAsync(root, type);
                    break;
            }
        }
    }

    private void HandleDisplaySelection(JsonElement message)
    {
        var requestId = String(message, "requestId");
        var displayId = String(message, "displayId");
        var expectedRevision = Int(message, "expectedTopologyRevision");
        if (string.IsNullOrWhiteSpace(requestId)
            || string.IsNullOrWhiteSpace(displayId)
            || expectedRevision < 1)
        {
            return;
        }

        try
        {
            var state = _capture.SelectDisplay(displayId, expectedRevision);
            Send(new Dictionary<string, object?>
            {
                ["type"] = "display.select.result",
                ["requestId"] = requestId,
                ["ok"] = true,
                ["state"] = DisplayStateObject(state),
            });
            SendDisplayState(state);
        }
        catch (DisplaySelectionException error)
        {
            Send(new Dictionary<string, object?>
            {
                ["type"] = "display.select.result",
                ["requestId"] = requestId,
                ["ok"] = false,
                ["errorCode"] = error.Code,
                ["error"] = error.Message,
                ["state"] = DisplayStateObject(error.State),
            });
            SendDisplayState(error.State);
        }
        catch (Exception error)
        {
            var state = _capture.State;
            Send(new Dictionary<string, object?>
            {
                ["type"] = "display.select.result",
                ["requestId"] = requestId,
                ["ok"] = false,
                ["errorCode"] = "switch_failed",
                ["error"] = error.Message,
                ["state"] = DisplayStateObject(state),
            });
        }
    }

    private async Task HandleTerminalRequestAsync(JsonElement message, string type)
    {
        var requestId = String(message, "requestId");
        if (string.IsNullOrWhiteSpace(requestId))
        {
            return;
        }
        if (!await _terminalOperation.WaitAsync(0))
        {
            SendTerminalFailure(
                type,
                requestId,
                "request_in_progress",
                "ClawDad is already refreshing Windows Terminal tabs.",
                null
            );
            return;
        }

        try
        {
            if (type == "terminal.tabs.request")
            {
                var state = await _terminalTabs.CatalogAsync();
                Send(new Dictionary<string, object?>
                {
                    ["type"] = "terminal.tabs.result",
                    ["requestId"] = requestId,
                    ["ok"] = true,
                    ["state"] = TerminalStateObject(state),
                });
                return;
            }

            var tabId = String(message, "tabId");
            var expectedRevision = Int(message, "expectedRevision");
            if (string.IsNullOrWhiteSpace(tabId) || expectedRevision < 1)
            {
                return;
            }
            var focused = await _terminalTabs.FocusAsync(tabId, expectedRevision);
            Send(new Dictionary<string, object?>
            {
                ["type"] = "terminal.tab.focus.result",
                ["requestId"] = requestId,
                ["ok"] = true,
                ["state"] = TerminalStateObject(focused),
            });
        }
        catch (TerminalTabException error)
        {
            SendTerminalFailure(type, requestId, error.Code, error.Message, error.State);
        }
        catch (Exception error)
        {
            SendTerminalFailure(type, requestId, "automation_failed", error.Message, null);
        }
        finally
        {
            _terminalOperation.Release();
        }
    }

    private void SendTerminalFailure(
        string requestType,
        string requestId,
        string code,
        string error,
        WindowsTerminalTabState? state
    )
    {
        Send(new Dictionary<string, object?>
        {
            ["type"] = requestType == "terminal.tab.focus"
                ? "terminal.tab.focus.result"
                : "terminal.tabs.result",
            ["requestId"] = requestId,
            ["ok"] = false,
            ["errorCode"] = code,
            ["error"] = error,
            ["state"] = state is null ? null : TerminalStateObject(state),
        });
    }

    private void CaptureTopologyChanged(WindowsDisplayState state)
    {
        if (_channelOpen)
        {
            SendDisplayState(state);
        }
    }

    private void SendDisplayState(WindowsDisplayState state)
    {
        Send(new Dictionary<string, object?>
        {
            ["type"] = "display.state",
            ["state"] = DisplayStateObject(state),
        });
    }

    private static IReadOnlyDictionary<string, object?> DisplayStateObject(
        WindowsDisplayState state
    ) => new Dictionary<string, object?>
    {
        ["topologyRevision"] = state.TopologyRevision,
        ["selectedDisplayId"] = state.SelectedDisplayId,
        ["displays"] = state.Displays.Select(display => new Dictionary<string, object?>
        {
            ["id"] = display.Id,
            ["name"] = display.Name,
            ["width"] = display.Width,
            ["height"] = display.Height,
            ["isPrimary"] = display.IsPrimary,
        }).ToArray(),
    };

    private static IReadOnlyDictionary<string, object?> TerminalStateObject(
        WindowsTerminalTabState state
    ) => new Dictionary<string, object?>
    {
        ["revision"] = state.Revision,
        ["selectedTabId"] = state.SelectedTabId,
        ["tabs"] = state.Tabs.Select(tab => new Dictionary<string, object?>
        {
            ["id"] = tab.Id,
            ["title"] = tab.Title,
            ["detail"] = tab.Detail,
            ["isSelected"] = tab.IsSelected,
            ["isBusy"] = tab.IsBusy,
        }).ToArray(),
    };

    private void Send(IReadOnlyDictionary<string, object?> message)
    {
        if (!_channelOpen)
        {
            return;
        }
        ResponseReady?.Invoke(JsonSerializer.Serialize(message, RemoteCloudCodec.JsonOptions));
    }

    private static string String(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    private static int Int(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.TryGetInt32(out var number)
            ? number
            : 0;

    public void Dispose()
    {
        _capture.TopologyChanged -= CaptureTopologyChanged;
        _input.Dispose();
        _terminalOperation.Dispose();
    }
}
