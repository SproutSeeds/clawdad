using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace ClawDad.Windows.RemoteAssist;

internal sealed record WindowsTerminalTab(
    string Id,
    string Title,
    string Detail,
    bool IsSelected,
    bool IsBusy
);

internal sealed record WindowsTerminalTabState(
    int Revision,
    string? SelectedTabId,
    IReadOnlyList<WindowsTerminalTab> Tabs
);

internal sealed class TerminalTabException : Exception
{
    internal TerminalTabException(
        string code,
        string message,
        WindowsTerminalTabState? state = null
    ) : base(message)
    {
        Code = code;
        State = state;
    }

    internal string Code { get; }
    internal WindowsTerminalTabState? State { get; }
}

internal sealed class WindowsTerminalTabs
{
    private sealed record Snapshot(
        string Id,
        IntPtr WindowHandle,
        AutomationElement Element,
        int WindowIndex,
        int TabIndex,
        string Title,
        bool IsSelected
    );

    private readonly object _gate = new();
    private int _revision = 1;
    private bool _hasCatalog;
    private IReadOnlyList<string> _topology = [];
    private Dictionary<string, Snapshot> _snapshots = new(StringComparer.Ordinal);

    internal Task<WindowsTerminalTabState> CatalogAsync()
    {
        return Task.Run(Catalog);
    }

    internal async Task<WindowsTerminalTabState> FocusAsync(
        string tabId,
        int expectedRevision
    )
    {
        var current = await CatalogAsync();
        if (current.Revision != expectedRevision)
        {
            throw new TerminalTabException(
                "stale_catalog",
                "The Windows Terminal tabs changed. Choose a tab again.",
                current
            );
        }

        Snapshot? target;
        lock (_gate)
        {
            _snapshots.TryGetValue(tabId, out target);
        }
        if (target is null)
        {
            throw new TerminalTabException(
                "tab_unavailable",
                "That Windows Terminal tab is no longer open.",
                current
            );
        }

        try
        {
            await Task.Run(() =>
            {
                if (target.Element.TryGetCurrentPattern(
                        SelectionItemPattern.Pattern,
                        out var rawPattern)
                    && rawPattern is SelectionItemPattern pattern)
                {
                    pattern.Select();
                }
                else
                {
                    target.Element.SetFocus();
                }
                _ = ShowWindow(target.WindowHandle, ShowRestore);
                _ = SetForegroundWindow(target.WindowHandle);
                target.Element.SetFocus();
            });
        }
        catch (UnauthorizedAccessException)
        {
            throw new TerminalTabException(
                "terminal_elevated",
                "Windows Terminal is running as administrator. Reopen ClawDad as administrator to switch its tabs.",
                current
            );
        }
        catch (ElementNotAvailableException)
        {
            throw new TerminalTabException(
                "tab_unavailable",
                "That Windows Terminal tab is no longer open.",
                current
            );
        }
        catch (Exception error)
        {
            throw new TerminalTabException(
                "focus_failed",
                $"ClawDad could not focus that Windows Terminal tab: {error.Message}",
                current
            );
        }

        await Task.Delay(120);
        var updated = await CatalogAsync();
        if (updated.SelectedTabId != tabId)
        {
            throw new TerminalTabException(
                "focus_failed",
                "Windows Terminal switched tabs but could not become the focused window.",
                updated
            );
        }
        return updated;
    }

    private WindowsTerminalTabState Catalog()
    {
        try
        {
            var snapshots = ReadSnapshots();
            lock (_gate)
            {
                var topology = snapshots.Select(snapshot => snapshot.Id).ToArray();
                if (_hasCatalog && !topology.SequenceEqual(_topology, StringComparer.Ordinal)
                    && _revision < int.MaxValue)
                {
                    _revision += 1;
                }
                _hasCatalog = true;
                _topology = topology;
                _snapshots = snapshots.ToDictionary(snapshot => snapshot.Id, StringComparer.Ordinal);

                var selected = snapshots.FirstOrDefault(snapshot => snapshot.IsSelected)?.Id;
                return new WindowsTerminalTabState(
                    _revision,
                    selected,
                    snapshots.Select(snapshot => new WindowsTerminalTab(
                        snapshot.Id,
                        TruncateTitle(snapshot.Title),
                        $"Window {snapshot.WindowIndex} • Tab {snapshot.TabIndex}",
                        snapshot.Id == selected,
                        false
                    )).ToArray()
                );
            }
        }
        catch (UnauthorizedAccessException)
        {
            throw new TerminalTabException(
                "terminal_elevated",
                "Windows Terminal is running as administrator. Reopen ClawDad as administrator to read its tabs."
            );
        }
        catch (TerminalTabException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new TerminalTabException(
                "automation_failed",
                $"ClawDad could not read Windows Terminal tabs: {error.Message}"
            );
        }
    }

    private static List<Snapshot> ReadSnapshots()
    {
        var result = new List<Snapshot>();
        var windows = AutomationElement.RootElement.FindAll(
            TreeScope.Children,
            Condition.TrueCondition
        );
        var terminalWindows = new List<AutomationElement>();
        foreach (AutomationElement window in windows)
        {
            if (IsWindowsTerminal(window))
            {
                terminalWindows.Add(window);
            }
        }

        var foreground = RootWindow(GetForegroundWindow());
        for (var windowIndex = 0; windowIndex < terminalWindows.Count; windowIndex += 1)
        {
            var window = terminalWindows[windowIndex];
            var handle = new IntPtr(window.Current.NativeWindowHandle);
            var tabItems = window.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(
                    AutomationElement.ControlTypeProperty,
                    ControlType.TabItem
                )
            );
            for (var tabIndex = 0; tabIndex < tabItems.Count; tabIndex += 1)
            {
                var element = tabItems[tabIndex];
                var runtimeId = element.GetRuntimeId();
                var automationId = element.Current.AutomationId;
                var identity = runtimeId is { Length: > 0 }
                    ? string.Join('.', runtimeId)
                    : $"{automationId}:{tabIndex + 1}";
                var selectedInWindow = IsSelected(element);
                result.Add(new Snapshot(
                    $"{handle.ToInt64():x}:{identity}",
                    handle,
                    element,
                    windowIndex + 1,
                    tabIndex + 1,
                    element.Current.Name,
                    handle == foreground && selectedInWindow
                ));
            }
        }
        return result;
    }

    private static bool IsWindowsTerminal(AutomationElement window)
    {
        var className = window.Current.ClassName ?? "";
        if (className.Contains("CASCADIA_HOSTING_WINDOW_CLASS", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        var processId = window.Current.ProcessId;
        if (processId <= 0)
        {
            return false;
        }
        try
        {
            using var process = Process.GetProcessById(processId);
            return process.ProcessName.Equals("WindowsTerminal", StringComparison.OrdinalIgnoreCase)
                || process.ProcessName.Equals("wt", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static bool IsSelected(AutomationElement element)
    {
        try
        {
            return element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var rawPattern)
                && rawPattern is SelectionItemPattern pattern
                && pattern.Current.IsSelected;
        }
        catch
        {
            return false;
        }
    }

    private static string TruncateTitle(string value)
    {
        var printable = new string((value ?? "")
            .Select(character => char.IsControl(character) ? ' ' : character)
            .ToArray());
        var clean = string.Join(' ', printable
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (string.IsNullOrWhiteSpace(clean))
        {
            clean = "Terminal Tab";
        }
        while (System.Text.Encoding.UTF8.GetByteCount(clean) > 256)
        {
            clean = clean[..^1];
        }
        return clean;
    }

    private static IntPtr RootWindow(IntPtr window)
    {
        return window == IntPtr.Zero ? IntPtr.Zero : GetAncestor(window, GetAncestorRoot);
    }

    private const int ShowRestore = 9;
    private const uint GetAncestorRoot = 2;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr window);
}
