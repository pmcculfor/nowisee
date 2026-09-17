import Foundation

enum ShellIds {
  static let rootAppId = "home"
  static let recentsAppId = "recents"
}

enum NavIntent: String {
  case prev
  case next
  case enter
  case back
  case recents
}

enum LoadFailure {
  static let label =
    "Something went wrong. Please check your network connection. Navigate right to try again. Navigate left to go back."
}

enum ActionFailure {
  static let label =
    "Something went wrong. Please check your network connection. Navigate left to go back."
}

enum NowiseeOrigin {
  /// Production origin. Change this to a Mac LAN HTTPS URL only for local spikes.
  static let url = URL(string: "https://nowisee.app")!
  static var host: String { url.host ?? "nowisee.app" }
  static var originHeader: String {
    let root = url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return root
  }
}

enum NodeKind: String, Equatable {
  case text
  case input
}

enum InputAutocomplete: String, Equatable {
  case off
  case username
  case currentPassword = "current-password"
  case newPassword = "new-password"
}

enum StackBehavior: String, Equatable {
  case push
  case replace
  case pop
  case stay
  case pushTransient
  case popTransient
}

struct AppLocation: Equatable {
  var appId: String
  var path: String
}

struct NodePayload: Equatable {
  var id: String
  var label: String
  var kind: NodeKind
  var secret: Bool
  var autocomplete: InputAutocomplete?

  init(
    id: String,
    label: String,
    kind: NodeKind = .text,
    secret: Bool = false,
    autocomplete: InputAutocomplete? = nil
  ) {
    self.id = id
    self.label = label
    self.kind = kind
    self.secret = secret
    self.autocomplete = autocomplete
  }
}

struct StackEntry: Equatable {
  var nodeId: String
  var label: String
  var location: AppLocation?
  var frame: String?
}

struct ActionExtras: Equatable {
  var triggerId: String
}

struct RefreshExtras: Equatable {
  var inputText: String?
  var action: ActionExtras?
  var parkedAppIds: [String]?

  init(inputText: String? = nil, action: ActionExtras? = nil, parkedAppIds: [String]? = nil) {
    self.inputText = inputText
    self.action = action
    self.parkedAppIds = parkedAppIds
  }

  var isAction: Bool {
    guard let triggerId = action?.triggerId else {
      return false
    }
    return !triggerId.isEmpty
  }
}

enum NavEdge: Equatable {
  case node(
    toNodeId: String?,
    stackBehavior: StackBehavior,
    frame: String?,
    passInputText: Bool,
    action: Bool
  )
  case app(to: AppLocation, passInputText: Bool, action: Bool)
  case external(href: String)
  case resume(appId: String)

  var passInputText: Bool {
    switch self {
    case let .node(_, _, _, pass, _): return pass
    case let .app(_, pass, _): return pass
    case .external, .resume: return false
    }
  }

  var action: Bool {
    switch self {
    case let .node(_, _, _, _, action): return action
    case let .app(_, _, action): return action
    case .external, .resume: return false
    }
  }

  var frame: String? {
    switch self {
    case let .node(_, _, frame, _, _): return frame
    case .app, .external, .resume: return nil
    }
  }
}

typealias NavigationMap = [String: [String: NavEdge]]

struct RefreshResult: Equatable {
  var navigationMap: NavigationMap
  var warm: [NodePayload]
  var node: NodePayload
  var location: AppLocation?
  var clipboardText: String?
  /// Honored only on `open`. Ignored on refresh (decision 1).
  var stack: [StackEntry]?
}

protocol DisplayPort: AnyObject {
  func showText(_ label: String)
  func showInput(_ initialText: String, secret: Bool, autocomplete: InputAutocomplete?)
  func getInputText() -> String
}

protocol ClipboardWriting: AnyObject {
  func writeText(_ text: String) throws
}
