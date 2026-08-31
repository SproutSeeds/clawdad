using System.Text;

namespace ClawDad.Windows;

internal static class RuntimeLog
{
    private static readonly object Gate = new();

    internal static string DirectoryPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClawDad",
        "logs"
    );

    internal static void Write(string channel, string message)
    {
        try
        {
            Directory.CreateDirectory(DirectoryPath);
            var safeChannel = string.Concat(channel.Where(character =>
                char.IsLetterOrDigit(character) || character is '-' or '_'));
            var path = Path.Combine(
                DirectoryPath,
                string.IsNullOrWhiteSpace(safeChannel) ? "clawdad.log" : $"{safeChannel}.log"
            );
            var line = $"[{DateTimeOffset.UtcNow:O}] {message.TrimEnd()}\r\n";
            lock (Gate)
            {
                File.AppendAllText(path, line, Encoding.UTF8);
            }
        }
        catch
        {
            // Logging must never terminate the desktop host.
        }
    }
}
