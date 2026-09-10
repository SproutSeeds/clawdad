import Foundation

/// Restarts only the Process created by this app. Never kills a live child or
/// adopts a PID/port owned by another app. Work receipts remain the runtime's
/// responsibility; this layer never submits or replays an agent request.
final class NativeManagedService {
  private let queue: DispatchQueue
  private let interval: TimeInterval
  private let clock: () -> TimeInterval
  private let diagnostic: (String) -> Void
  private var timer: DispatchSourceTimer?
  private var launch: (() throws -> Process)?
  private var process: Process?
  private var failures = 0
  private var nextAttempt: TimeInterval = 0
  private var launchedAt: TimeInterval = 0

  init(label: String, interval: TimeInterval = 2,
       clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
       diagnostic: @escaping (String) -> Void = { _ in }) {
    queue = DispatchQueue(label: label)
    self.interval = interval; self.clock = clock; self.diagnostic = diagnostic
  }

  func start(_ launch: @escaping () throws -> Process) throws {
    try queue.sync {
      guard self.launch == nil else { return }
      let child = try launch()
      self.launch = launch; process = child
      failures = 0; nextAttempt = 0; launchedAt = clock()
      let timer = DispatchSource.makeTimerSource(queue: queue)
      timer.schedule(deadline: .now() + interval, repeating: interval)
      timer.setEventHandler { [weak self] in self?.checkOnQueue() }
      self.timer = timer; timer.resume()
    }
  }

  /// Also used by deterministic process fixtures; serialized with start/stop.
  func check() { queue.sync { checkOnQueue() } }

  private func checkOnQueue() {
    guard let launch else { return }
    let now = clock()
    if process?.isRunning == true {
      if now - launchedAt >= 60 { failures = 0 }
      return
    }
    if let exited = process {
      diagnostic("Managed service exited (status \(exited.terminationStatus)); recovery scheduled.")
      process = nil
      nextAttempt = now + min(30, pow(2, Double(failures)))
      failures = min(failures + 1, 6)
    }
    guard now >= nextAttempt else { return }
    do {
      process = try launch(); launchedAt = now
      diagnostic("Managed service restarted.")
    } catch {
      diagnostic("Managed service restart failed; retry scheduled.")
      nextAttempt = now + min(30, pow(2, Double(failures)))
      failures = min(failures + 1, 6)
    }
  }

  func stop() {
    queue.sync {
      launch = nil
      timer?.cancel(); timer = nil
      if let process { NativeManagedProcessTerminator.stop(process) }
      process = nil
    }
  }
}
