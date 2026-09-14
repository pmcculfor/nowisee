import Foundation

final class NodeCache {
  private var entries: [String: NodePayload] = [:]
  private var pinned: Set<String> = []
  private let maxEntries: Int

  init(maxEntries: Int = 500) {
    self.maxEntries = maxEntries
  }

  func get(_ nodeId: String) -> NodePayload? {
    entries[nodeId]
  }

  func clear() {
    entries.removeAll()
    pinned.removeAll()
  }

  func replaceWarm(warm: [NodePayload], tip: NodePayload, stackIds: [String]) {
    var preserved: [String: NodePayload] = [:]
    for id in stackIds {
      if let existing = entries[id] {
        preserved[id] = existing
      }
    }

    entries.removeAll()
    for payload in warm {
      entries[payload.id] = payload
    }
    entries[tip.id] = tip

    for id in stackIds where entries[id] == nil {
      if let prior = preserved[id] {
        entries[id] = prior
      }
    }

    pinned = Set(stackIds)
    pinned.insert(tip.id)
    evictIfNeeded()
  }

  func size() -> Int {
    entries.count
  }

  private func evictIfNeeded() {
    guard entries.count > maxEntries else {
      return
    }
    for id in entries.keys {
      if entries.count <= maxEntries {
        break
      }
      if !pinned.contains(id) {
        entries.removeValue(forKey: id)
      }
    }
  }
}
