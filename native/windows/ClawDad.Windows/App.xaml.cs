using Microsoft.UI.Xaml;

namespace ClawDad.Windows;

public partial class App : Application
{
    private Mutex? _instanceMutex;
    private MainWindow? _window;

    public App()
    {
        InitializeComponent();
        UnhandledException += (_, args) =>
        {
            RuntimeLog.Write("ui", args.Exception.ToString());
        };
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _instanceMutex = new Mutex(
            initiallyOwned: true,
            name: @"Local\earth.frg.ClawDad.Windows",
            createdNew: out var createdNew
        );
        if (!createdNew)
        {
            RuntimeLog.Write("ui", "A second ClawDad Windows launch was stopped.");
            Exit();
            return;
        }
        _window = new MainWindow();
        _window.Activate();
    }
}
