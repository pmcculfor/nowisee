import Foundation

struct ParkedSession: Equatable {
  var appId: String
  var stack: [StackEntry]
  var tipKind: NodeKind
  var inputText: String?
  var secret: Bool
  var autocomplete: InputAutocomplete?
}

final class SessionPark {
  private static let cap = 16
  private var sessions: [String: ParkedSession] = [:]
  private var order: [String] = []

  func put(_ session: ParkedSession) {
    sessions[session.appId] = session
    order = [session.appId] + order.filter { $0 != session.appId }
    while order.count > Self.cap {
      if let evict = order.popLast() {
        sessions.removeValue(forKey: evict)
      }
    }
  }

  func peek(_ appId: String) -> ParkedSession? {
    sessions[appId]
  }

  func take(_ appId: String) -> ParkedSession? {
    guard let session = sessions[appId] else {
      return nil
    }
    drop(appId)
    return session
  }

  func drop(_ appId: String) {
    sessions.removeValue(forKey: appId)
    order.removeAll { $0 == appId }
  }

  func list() -> [String] {
    order
  }
}
