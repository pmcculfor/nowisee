import Foundation

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
}

struct RefreshExtras: Equatable {
  var inputText: String?
  var action: Bool
  var parkedAppIds: [String]?

  init(inputText: String? = nil, action: Bool = false, parkedAppIds: [String]? = nil) {
    self.inputText = inputText
    self.action = action
    self.parkedAppIds = parkedAppIds
  }
}

enum NavEdge: Equatable {
  case node(toNodeId: String?, stackBehavior: StackBehavior, passInputText: Bool, action: Bool)
  case app(to: AppLocation, passInputText: Bool, action: Bool)
  case external(href: String)
  case resume(appId: String)

  var passInputText: Bool {
    switch self {
    case let .node(_, _, pass, _): return pass
    case let .app(_, pass, _): return pass
    case .external, .resume: return false
    }
  }

  var action: Bool {
    switch self {
    case let .node(_, _, _, action): return action
    case let .app(_, _, action): return action
    case .external, .resume: return false
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
}

protocol DisplayPort: AnyObject {
  func showText(_ label: String)
  func showInput(_ initialText: String, secret: Bool, autocomplete: InputAutocomplete?)
  func getInputText() -> String
}

protocol ClipboardWriting: AnyObject {
  func writeText(_ text: String) throws
}
