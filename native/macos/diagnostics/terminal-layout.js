// Metadata only. Never activate, select, create, move, close or read tab contents.
function run() {
  const terminal = Application('com.apple.Terminal');
  if (!terminal.running()) throw new Error('Terminal is not running.');
  const report = {schema: 1, capturedAt: new Date().toISOString(), scripting: []};
  report.scripting = terminal.windows().map(window => ({
    id: window.id(), index: window.index(), bounds: window.bounds(),
    tabs: window.tabs().map((tab, index) => ({
      position: index + 1, tty: tab.tty(), selected: tab.selected(), title: tab.customTitle()
    }))
  }));
  return JSON.stringify(report, null, 2);
}
