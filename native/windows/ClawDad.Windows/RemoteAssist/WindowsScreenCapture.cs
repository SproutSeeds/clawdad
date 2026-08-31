using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace ClawDad.Windows.RemoteAssist;

internal sealed record WindowsDisplay(
    string Id,
    string Name,
    int Left,
    int Top,
    int Width,
    int Height,
    bool IsPrimary
);

internal sealed record WindowsDisplayState(
    int TopologyRevision,
    string SelectedDisplayId,
    IReadOnlyList<WindowsDisplay> Displays
);

internal sealed record RemoteScreenFrame(byte[] Jpeg, int Width, int Height);

internal sealed class DisplaySelectionException : Exception
{
    internal DisplaySelectionException(string code, string message, WindowsDisplayState state)
        : base(message)
    {
        Code = code;
        State = state;
    }

    internal string Code { get; }
    internal WindowsDisplayState State { get; }
}

internal sealed class WindowsScreenCapture : IAsyncDisposable
{
    private const int MaximumCaptureWidth = 1600;
    private const int MaximumCaptureHeight = 1000;
    private const int CaptureIntervalMilliseconds = 100;
    private readonly object _gate = new();
    private readonly ImageCodecInfo _jpegEncoder;
    private CancellationTokenSource? _captureCancellation;
    private Task? _captureTask;
    private IReadOnlyList<WindowsDisplay> _displays = [];
    private WindowsDisplay? _selected;
    private string _topologySignature = "";
    private int _topologyRevision = 1;

    internal WindowsScreenCapture()
    {
        _jpegEncoder = ImageCodecInfo.GetImageEncoders()
            .First(codec => codec.FormatID == ImageFormat.Jpeg.Guid);
        RefreshTopology();
    }

    internal event Action<RemoteScreenFrame>? FrameReady;
    internal event Action<WindowsDisplayState>? TopologyChanged;

    internal WindowsDisplayState State
    {
        get
        {
            lock (_gate)
            {
                if (_selected is null || _displays.Count == 0)
                {
                    throw new InvalidOperationException("ClawDad could not find a Windows display to share.");
                }
                return new WindowsDisplayState(
                    _topologyRevision,
                    _selected.Id,
                    _displays.ToArray()
                );
            }
        }
    }

    internal WindowsDisplay SelectedDisplay
    {
        get
        {
            lock (_gate)
            {
                return _selected ?? throw new InvalidOperationException(
                    "ClawDad could not find a Windows display to share."
                );
            }
        }
    }

    internal (int Width, int Height) CaptureSize
    {
        get
        {
            var selected = SelectedDisplay;
            return ScaledSize(selected.Width, selected.Height);
        }
    }

    internal void Start()
    {
        if (_captureTask is not null)
        {
            return;
        }
        RefreshTopology();
        _captureCancellation = new CancellationTokenSource();
        _captureTask = Task.Run(() => CaptureLoopAsync(_captureCancellation.Token));
    }

    internal WindowsDisplayState SelectDisplay(string displayId, int expectedRevision)
    {
        RefreshTopology();
        lock (_gate)
        {
            var state = CurrentStateLocked();
            if (expectedRevision != _topologyRevision)
            {
                throw new DisplaySelectionException(
                    "stale_topology",
                    "The available screens changed. Choose a screen again.",
                    state
                );
            }
            var target = _displays.FirstOrDefault(display => display.Id == displayId);
            if (target is null)
            {
                throw new DisplaySelectionException(
                    "display_unavailable",
                    "That Windows display is no longer available.",
                    state
                );
            }
            _selected = target;
            return CurrentStateLocked();
        }
    }

    internal WindowsDisplayState RefreshTopology()
    {
        var monitors = EnumerateDisplays();
        if (monitors.Count == 0)
        {
            throw new InvalidOperationException("ClawDad could not find a Windows display to share.");
        }
        WindowsDisplayState state;
        var changed = false;
        lock (_gate)
        {
            var signature = string.Join('|', monitors.Select(display =>
                $"{display.Id}:{display.Left}:{display.Top}:{display.Width}:{display.Height}:{display.IsPrimary}"));
            if (!string.IsNullOrEmpty(_topologySignature)
                && !string.Equals(signature, _topologySignature, StringComparison.Ordinal)
                && _topologyRevision < int.MaxValue)
            {
                _topologyRevision += 1;
                changed = true;
            }
            _topologySignature = signature;
            var currentId = _selected?.Id;
            _displays = monitors;
            _selected = monitors.FirstOrDefault(display => display.Id == currentId)
                ?? monitors.FirstOrDefault(display => display.IsPrimary)
                ?? monitors[0];
            state = CurrentStateLocked();
        }
        if (changed)
        {
            TopologyChanged?.Invoke(state);
        }
        return state;
    }

    private async Task CaptureLoopAsync(CancellationToken cancellationToken)
    {
        var nextTopologyRefresh = DateTimeOffset.UtcNow;
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                if (DateTimeOffset.UtcNow >= nextTopologyRefresh)
                {
                    RefreshTopology();
                    nextTopologyRefresh = DateTimeOffset.UtcNow.AddSeconds(2);
                }
                var display = SelectedDisplay;
                var frame = Capture(display);
                FrameReady?.Invoke(frame);
            }
            catch (Exception error)
            {
                RuntimeLog.Write("remote-assist-capture", error.Message);
            }

            try
            {
                await Task.Delay(CaptureIntervalMilliseconds, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private RemoteScreenFrame Capture(WindowsDisplay display)
    {
        var (width, height) = ScaledSize(display.Width, display.Height);
        using var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(bitmap);
        var destination = graphics.GetHdc();
        var source = GetDC(IntPtr.Zero);
        try
        {
            _ = SetStretchBltMode(destination, StretchHalftone);
            if (!StretchBlt(
                    destination,
                    0,
                    0,
                    width,
                    height,
                    source,
                    display.Left,
                    display.Top,
                    display.Width,
                    display.Height,
                    SourceCopy | CaptureBlt))
            {
                throw new InvalidOperationException(
                    $"Windows could not capture {display.Name} ({Marshal.GetLastWin32Error()})."
                );
            }
        }
        finally
        {
            _ = ReleaseDC(IntPtr.Zero, source);
            graphics.ReleaseHdc(destination);
        }

        using var stream = new MemoryStream();
        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(Encoder.Quality, 68L);
        bitmap.Save(stream, _jpegEncoder, parameters);
        return new RemoteScreenFrame(stream.ToArray(), width, height);
    }

    private WindowsDisplayState CurrentStateLocked()
    {
        if (_selected is null || _displays.Count == 0)
        {
            throw new InvalidOperationException("ClawDad could not find a Windows display to share.");
        }
        return new WindowsDisplayState(_topologyRevision, _selected.Id, _displays.ToArray());
    }

    private static (int Width, int Height) ScaledSize(int sourceWidth, int sourceHeight)
    {
        var scale = Math.Min(
            1.0,
            Math.Min(
                MaximumCaptureWidth / (double)sourceWidth,
                MaximumCaptureHeight / (double)sourceHeight
            )
        );
        var width = Math.Max(2, (int)Math.Round(sourceWidth * scale)) & ~1;
        var height = Math.Max(2, (int)Math.Round(sourceHeight * scale)) & ~1;
        return (width, height);
    }

    private static List<WindowsDisplay> EnumerateDisplays()
    {
        var monitors = new List<WindowsDisplay>();
        _ = EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (monitor, _, _, _) =>
        {
            var info = new MonitorInfoEx
            {
                Size = Marshal.SizeOf<MonitorInfoEx>(),
                DeviceName = "",
            };
            if (GetMonitorInfo(monitor, ref info))
            {
                var device = info.DeviceName.TrimEnd('\0');
                var suffix = new string(device.Reverse().TakeWhile(char.IsDigit).Reverse().ToArray());
                monitors.Add(new WindowsDisplay(
                    string.IsNullOrWhiteSpace(device) ? $"monitor-{monitor.ToInt64():x}" : device,
                    string.IsNullOrWhiteSpace(suffix) ? $"Display {monitors.Count + 1}" : $"Display {suffix}",
                    info.Monitor.Left,
                    info.Monitor.Top,
                    info.Monitor.Right - info.Monitor.Left,
                    info.Monitor.Bottom - info.Monitor.Top,
                    (info.Flags & MonitorPrimary) != 0
                ));
            }
            return true;
        }, IntPtr.Zero);
        return monitors
            .Where(display => display.Width > 0 && display.Height > 0)
            .OrderByDescending(display => display.IsPrimary)
            .ThenBy(display => display.Left)
            .ThenBy(display => display.Top)
            .ToList();
    }

    public async ValueTask DisposeAsync()
    {
        _captureCancellation?.Cancel();
        if (_captureTask is not null)
        {
            try
            {
                await _captureTask;
            }
            catch (OperationCanceledException)
            {
                // Expected while closing Remote Assist.
            }
        }
        _captureCancellation?.Dispose();
        _captureCancellation = null;
        _captureTask = null;
    }

    private const int StretchHalftone = 4;
    private const uint SourceCopy = 0x00CC0020;
    private const uint CaptureBlt = 0x40000000;
    private const uint MonitorPrimary = 0x00000001;

    private delegate bool MonitorEnumerationCallback(
        IntPtr monitor,
        IntPtr deviceContext,
        IntPtr bounds,
        IntPtr data
    );

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfoEx
    {
        public int Size;
        public NativeRect Monitor;
        public NativeRect Work;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplayMonitors(
        IntPtr deviceContext,
        IntPtr clipRect,
        MonitorEnumerationCallback callback,
        IntPtr data
    );

    [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfoEx info);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr window);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr window, IntPtr deviceContext);

    [DllImport("gdi32.dll")]
    private static extern int SetStretchBltMode(IntPtr deviceContext, int mode);

    [DllImport("gdi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StretchBlt(
        IntPtr destination,
        int destinationX,
        int destinationY,
        int destinationWidth,
        int destinationHeight,
        IntPtr source,
        int sourceX,
        int sourceY,
        int sourceWidth,
        int sourceHeight,
        uint operation
    );
}
