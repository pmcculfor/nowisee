import Foundation

final class NavStack {
  private var entries: [StackEntry] = []

  var length: Int { entries.count }

  func tip() -> StackEntry? {
    entries.last
  }

  func push(_ entry: StackEntry) {
    entries.append(entry)
  }

  func replaceTip(_ entry: StackEntry) {
    precondition(!entries.isEmpty, "Stack.replaceTip: stack is empty")
    entries[entries.count - 1] = entry
  }

  @discardableResult
  func pop() -> StackEntry? {
    entries.popLast()
  }

  func clear() {
    entries = []
  }

  func snapshot() -> [StackEntry] {
    entries
  }

  func restore(_ entries: [StackEntry]) {
    self.entries = entries
  }
}
