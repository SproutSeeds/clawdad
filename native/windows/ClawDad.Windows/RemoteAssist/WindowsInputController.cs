using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Windows.ApplicationModel.DataTransfer;

namespace ClawDad.Windows.RemoteAssist;

internal sealed class WindowsInputController : IDisposable
{
    private readonly WindowsScreenCapture _capture;
    private bool _leftButtonDown;
    private bool _rightButtonDown;

    internal WindowsInputController(WindowsScreenCapture capture)
    {
        _capture = capture;
    }

    internal void HandlePointer(JsonElement message)
    {
        var x = UnitNumber(message, "x", 0.5);
        var y = UnitNumber(message, "y", 0.5);
        var action = String(message, "action");
        var button = String(message, "button") == "right" ? MouseButton.Right : MouseButton.Left;
        var display = _capture.SelectedDisplay;
        var pointX = display.Left + Math.Clamp(
            (int)Math.Round(x * Math.Max(0, display.Width - 1)),
            0,
            Math.Max(0, display.Width - 1)
        );
        var pointY = display.Top + Math.Clamp(
            (int)Math.Round(y * Math.Max(0, display.Height - 1)),
            0,
            Math.Max(0, display.Height - 1)
        );
        if (!SetCursorPos(pointX, pointY))
        {
            return;
        }

        switch (action)
        {
            case "down":
                SendMouseButton(button, true);
                break;
            case "up":
                SendMouseButton(button, false);
                break;
            case "click":
                SendMouseButton(button, true);
                SendMouseButton(button, false);
                break;
            case "move":
            case "drag":
                break;
        }
    }

    internal void HandleScroll(JsonElement message)
    {
        var deltaX = Number(message, "deltaX");
        var deltaY = Number(message, "deltaY");
        if (Math.Abs(deltaY) > double.Epsilon)
        {
            var wheel = NormalizeWheelDelta(-deltaY);
            SendMouse(MouseEventWheel, unchecked((uint)wheel));
        }
        if (Math.Abs(deltaX) > double.Epsilon)
        {
            var wheel = NormalizeWheelDelta(deltaX);
            SendMouse(MouseEventHorizontalWheel, unchecked((uint)wheel));
        }
    }

    internal async Task<IReadOnlyDictionary<string, object?>> HandleInputAsync(JsonElement message)
    {
        var action = String(message, "action");
        var requestId = String(message, "requestId");
        if (string.IsNullOrWhiteSpace(requestId))
        {
            return InputFailure(action, requestId, "The Remote Assist input request was invalid.");
        }

        var accepted = action switch
        {
            "text" => SendUnicodeText(String(message, "text")),
            "key" => SendKey(String(message, "key")),
            "shortcut" => SendShortcut(String(message, "shortcut")),
            _ => false,
        };
        await Task.Yield();
        return accepted
            ? InputSuccess(action, requestId, ForegroundTarget(
                action == "shortcut" ? "SystemShortcut" : "WindowsApp"))
            : InputFailure(
                action,
                requestId,
                "Windows did not accept that input. If the focused app is running as administrator, reopen ClawDad as administrator too."
            );
    }

    internal async Task<IReadOnlyDictionary<string, object?>> HandleClipboardAsync(JsonElement message)
    {
        var action = String(message, "action");
        var requestId = String(message, "requestId");
        if (string.IsNullOrWhiteSpace(requestId))
        {
            return ClipboardFailure(action, requestId, "The Remote Assist clipboard request was invalid.");
        }

        try
        {
            switch (action)
            {
                case "paste":
                {
                    var text = String(message, "text");
                    if (string.IsNullOrEmpty(text))
                    {
                        return ClipboardFailure(action, requestId, "The iPhone clipboard did not contain any text.");
                    }
                    var package = new DataPackage();
                    package.SetText(text);
                    Clipboard.SetContent(package);
                    Clipboard.Flush();
                    if (!SendChord([VirtualControl], VirtualV))
                    {
                        return ClipboardFailure(
                            action,
                            requestId,
                            "Windows did not accept Paste. If the focused app is running as administrator, reopen ClawDad as administrator too."
                        );
                    }
                    return ClipboardSuccess(action, requestId);
                }
                case "copy":
                {
                    var sequence = GetClipboardSequenceNumber();
                    if (!SendChord([VirtualControl], VirtualC))
                    {
                        return ClipboardFailure(action, requestId, "Windows did not accept Copy from the focused app.");
                    }
                    for (var attempt = 0; attempt < 20 && GetClipboardSequenceNumber() == sequence; attempt += 1)
                    {
                        await Task.Delay(50);
                    }
                    if (GetClipboardSequenceNumber() == sequence)
                    {
                        return ClipboardFailure(
                            action,
                            requestId,
                            "Select text on Windows, then tap Copy from Windows again."
                        );
                    }
                    var content = Clipboard.GetContent();
                    if (!content.Contains(StandardDataFormats.Text))
                    {
                        return ClipboardFailure(action, requestId, "The Windows clipboard does not contain text.");
                    }
                    var text = await content.GetTextAsync();
                    if (string.IsNullOrEmpty(text))
                    {
                        return ClipboardFailure(action, requestId, "The Windows clipboard does not contain text.");
                    }
                    if (System.Text.Encoding.UTF8.GetByteCount(text) > 64 * 1024)
                    {
                        return ClipboardFailure(action, requestId, "The selected Windows text is larger than 64 KB.");
                    }
                    return ClipboardSuccess(action, requestId, text);
                }
                default:
                    return ClipboardFailure(action, requestId, "The Remote Assist clipboard command was invalid.");
            }
        }
        catch (Exception error)
        {
            return ClipboardFailure(action, requestId, $"ClawDad could not use the Windows clipboard: {error.Message}");
        }
    }

    private bool SendUnicodeText(string text)
    {
        if (string.IsNullOrEmpty(text) || System.Text.Encoding.UTF8.GetByteCount(text) > 64 * 1024)
        {
            return false;
        }
        const int chunkSize = 128;
        for (var offset = 0; offset < text.Length; offset += chunkSize)
        {
            var chunk = text.AsSpan(offset, Math.Min(chunkSize, text.Length - offset));
            var inputs = new List<NativeInput>(chunk.Length * 2);
            foreach (var character in chunk)
            {
                inputs.Add(MakeKeyboardInput(0, character, KeyEventUnicode));
                inputs.Add(MakeKeyboardInput(0, character, KeyEventUnicode | KeyEventKeyUp));
            }
            if (!Send(inputs))
            {
                return false;
            }
        }
        return true;
    }

    private bool SendKey(string key)
    {
        var virtualKey = key.ToLowerInvariant() switch
        {
            "enter" or "return" => VirtualReturn,
            "backspace" => VirtualBackspace,
            "delete" => VirtualDelete,
            "escape" => VirtualEscape,
            "tab" => VirtualTab,
            "arrowup" or "arrow_up" => VirtualUp,
            "arrowdown" or "arrow_down" => VirtualDown,
            "arrowleft" or "arrow_left" => VirtualLeft,
            "arrowright" or "arrow_right" => VirtualRight,
            "space" => VirtualSpace,
            _ => (ushort)0,
        };
        return virtualKey != 0 && SendChord([], virtualKey);
    }

    private bool SendShortcut(string shortcut)
    {
        return shortcut switch
        {
            "control_c" => SendChord([VirtualControl], VirtualC),
            "control_j" => SendChord([VirtualControl], VirtualJ),
            "escape" => SendChord([], VirtualEscape),
            "tab" => SendChord([], VirtualTab),
            "arrow_up" => SendChord([], VirtualUp),
            "arrow_down" => SendChord([], VirtualDown),
            "arrow_left" => SendChord([], VirtualLeft),
            "arrow_right" => SendChord([], VirtualRight),
            "control_l" => SendChord([VirtualControl], VirtualL),
            "command_t" => SendChord([VirtualControl], VirtualT),
            "command_tab" => SendChord([VirtualMenu], VirtualTab),
            _ => false,
        };
    }

    private static bool SendChord(IReadOnlyList<ushort> modifiers, ushort key)
    {
        var inputs = new List<NativeInput>(modifiers.Count * 2 + 2);
        inputs.AddRange(modifiers.Select(modifier => MakeKeyboardInput(modifier, '\0', 0)));
        inputs.Add(MakeKeyboardInput(key, '\0', 0));
        inputs.Add(MakeKeyboardInput(key, '\0', KeyEventKeyUp));
        inputs.AddRange(modifiers.Reverse().Select(modifier =>
            MakeKeyboardInput(modifier, '\0', KeyEventKeyUp)));
        return Send(inputs);
    }

    private void SendMouseButton(MouseButton button, bool down)
    {
        var flags = button switch
        {
            MouseButton.Left when down => MouseEventLeftDown,
            MouseButton.Left => MouseEventLeftUp,
            MouseButton.Right when down => MouseEventRightDown,
            _ => MouseEventRightUp,
        };
        if (SendMouse(flags, 0))
        {
            if (button == MouseButton.Left)
            {
                _leftButtonDown = down;
            }
            else
            {
                _rightButtonDown = down;
            }
        }
    }

    private static bool SendMouse(uint flags, uint mouseData)
    {
        return Send([
            new NativeInput
            {
                Type = InputMouse,
                Data = new InputUnion
                {
                    Mouse = new MouseInput
                    {
                        MouseData = mouseData,
                        Flags = flags,
                    },
                },
            },
        ]);
    }

    private static NativeInput MakeKeyboardInput(ushort virtualKey, char scanCode, uint flags)
    {
        return new NativeInput
        {
            Type = InputKeyboard,
            Data = new InputUnion
            {
                Keyboard = new KeyboardInputData
                {
                    VirtualKey = virtualKey,
                    ScanCode = (ushort)scanCode,
                    Flags = flags,
                },
            },
        };
    }

    private static bool Send(IReadOnlyList<NativeInput> inputs)
    {
        if (inputs.Count == 0)
        {
            return true;
        }
        var array = inputs.ToArray();
        return SendInput((uint)array.Length, array, Marshal.SizeOf<NativeInput>()) ==
            (uint)array.Length;
    }

    private static int NormalizeWheelDelta(double value)
    {
        var rounded = (int)Math.Round(value);
        if (rounded == 0)
        {
            rounded = value < 0 ? -1 : 1;
        }
        return Math.Clamp(rounded, -960, 960);
    }

    private static IReadOnlyDictionary<string, object?> ForegroundTarget(string role)
    {
        var window = GetForegroundWindow();
        var application = "Windows";
        string? identifier = null;
        if (window != IntPtr.Zero)
        {
            _ = GetWindowThreadProcessId(window, out var processId);
            try
            {
                using var process = Process.GetProcessById((int)processId);
                application = process.ProcessName;
                identifier = process.MainModule?.FileName;
            }
            catch
            {
                // The foreground app may be protected; its window is still the target.
            }
        }
        return new Dictionary<string, object?>
        {
            ["applicationName"] = application,
            ["bundleIdentifier"] = identifier,
            ["role"] = role,
        };
    }

    private static IReadOnlyDictionary<string, object?> InputSuccess(
        string action,
        string requestId,
        IReadOnlyDictionary<string, object?> target
    ) => new Dictionary<string, object?>
    {
        ["type"] = "input.result",
        ["action"] = action,
        ["requestId"] = requestId,
        ["ok"] = true,
        ["target"] = target,
    };

    private static IReadOnlyDictionary<string, object?> InputFailure(
        string action,
        string requestId,
        string error
    ) => new Dictionary<string, object?>
    {
        ["type"] = "input.result",
        ["action"] = action,
        ["requestId"] = requestId,
        ["ok"] = false,
        ["error"] = error,
    };

    private static IReadOnlyDictionary<string, object?> ClipboardSuccess(
        string action,
        string requestId,
        string? text = null
    ) => new Dictionary<string, object?>
    {
        ["type"] = "clipboard.result",
        ["action"] = action,
        ["requestId"] = requestId,
        ["text"] = text,
        ["ok"] = true,
    };

    private static IReadOnlyDictionary<string, object?> ClipboardFailure(
        string action,
        string requestId,
        string error
    ) => new Dictionary<string, object?>
    {
        ["type"] = "clipboard.result",
        ["action"] = action,
        ["requestId"] = requestId,
        ["ok"] = false,
        ["error"] = error,
    };

    private static string String(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    private static double Number(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.TryGetDouble(out var number)
            ? number
            : 0;

    private static double UnitNumber(JsonElement element, string property, double fallback)
    {
        var value = element.TryGetProperty(property, out var entry) && entry.TryGetDouble(out var number)
            ? number
            : fallback;
        return Math.Clamp(value, 0, 1);
    }

    public void Dispose()
    {
        if (_leftButtonDown)
        {
            SendMouseButton(MouseButton.Left, false);
        }
        if (_rightButtonDown)
        {
            SendMouseButton(MouseButton.Right, false);
        }
    }

    private enum MouseButton
    {
        Left,
        Right,
    }

    private const uint InputMouse = 0;
    private const uint InputKeyboard = 1;
    private const uint KeyEventKeyUp = 0x0002;
    private const uint KeyEventUnicode = 0x0004;
    private const uint MouseEventLeftDown = 0x0002;
    private const uint MouseEventLeftUp = 0x0004;
    private const uint MouseEventRightDown = 0x0008;
    private const uint MouseEventRightUp = 0x0010;
    private const uint MouseEventWheel = 0x0800;
    private const uint MouseEventHorizontalWheel = 0x01000;
    private const ushort VirtualBackspace = 0x08;
    private const ushort VirtualTab = 0x09;
    private const ushort VirtualReturn = 0x0D;
    private const ushort VirtualControl = 0x11;
    private const ushort VirtualMenu = 0x12;
    private const ushort VirtualEscape = 0x1B;
    private const ushort VirtualSpace = 0x20;
    private const ushort VirtualLeft = 0x25;
    private const ushort VirtualUp = 0x26;
    private const ushort VirtualRight = 0x27;
    private const ushort VirtualDown = 0x28;
    private const ushort VirtualDelete = 0x2E;
    private const ushort VirtualC = 0x43;
    private const ushort VirtualJ = 0x4A;
    private const ushort VirtualL = 0x4C;
    private const ushort VirtualT = 0x54;
    private const ushort VirtualV = 0x56;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeInput
    {
        public uint Type;
        public InputUnion Data;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyboardInputData Keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int X;
        public int Y;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInputData
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(
        uint inputCount,
        [In] NativeInput[] inputs,
        int inputSize
    );

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern uint GetClipboardSequenceNumber();
}
