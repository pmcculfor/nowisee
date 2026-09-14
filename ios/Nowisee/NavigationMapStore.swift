import Foundation

final class NavigationMapStore {
  private var map: NavigationMap = [:]

  func lookup(fromNodeId: String, intent: String) -> NavEdge? {
    map[fromNodeId]?[intent]
  }

  func replace(_ map: NavigationMap) {
    self.map = map
  }

  func snapshot() -> NavigationMap {
    map
  }
}
