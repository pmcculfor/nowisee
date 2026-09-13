import Foundation

enum RefreshDecoding {
  static func result(from value: Any) -> RefreshResult? {
    guard let rec = asObject(value) else {
      return nil
    }
    guard let node = nodePayload(rec["node"]) else {
      return nil
    }
    guard let warmRaw = rec["warm"] as? [Any], let warm = optionalMap(warmRaw, nodePayload) else {
      return nil
    }
    guard let mapRaw = rec["navigationMap"], let navigationMap = navigationMap(mapRaw) else {
      return nil
    }
    let location: AppLocation?
    if rec["location"] == nil {
      return nil
    }
    if rec["location"] is NSNull {
      location = nil
    } else {
      guard let loc = appLocation(rec["location"]) else {
        return nil
      }
      location = loc
    }
    var clipboardText: String?
    if let clip = rec["clipboardText"] {
      if clip is NSNull {
        return nil
      }
      guard let text = clip as? String else {
        return nil
      }
      clipboardText = text
    }
    return RefreshResult(
      navigationMap: navigationMap,
      warm: warm,
      node: node,
      location: location,
      clipboardText: clipboardText
    )
  }

  static func navigationMap(_ value: Any) -> NavigationMap? {
    guard let rec = asObject(value) else {
      return nil
    }
    var out: NavigationMap = [:]
    for (fromId, intentsRaw) in rec {
      guard let intents = asObject(intentsRaw) else {
        return nil
      }
      var inner: [String: NavEdge] = [:]
      for (intent, edgeRaw) in intents {
        guard let edge = navEdge(edgeRaw) else {
          return nil
        }
        inner[intent] = edge
      }
      out[fromId] = inner
    }
    return out
  }

  static func navEdge(_ value: Any) -> NavEdge? {
    guard let rec = asObject(value), let kind = rec["kind"] as? String else {
      return nil
    }
    switch kind {
    case "node":
      let behaviorRaw = rec["stackBehavior"] as? String ?? ""
      guard let behavior = StackBehavior(rawValue: behaviorRaw) else {
        return nil
      }
      let toNodeId = rec["toNodeId"] as? String
      return .node(
        toNodeId: toNodeId,
        stackBehavior: behavior,
        passInputText: rec["passInputText"] as? Bool == true,
        action: rec["action"] as? Bool == true
      )
    case "app":
      guard let to = appLocation(rec["to"]) else {
        return nil
      }
      return .app(
        to: to,
        passInputText: rec["passInputText"] as? Bool == true,
        action: rec["action"] as? Bool == true
      )
    case "external":
      guard let href = rec["href"] as? String else {
        return nil
      }
      return .external(href: href)
    case "resume":
      guard let appId = rec["appId"] as? String else {
        return nil
      }
      return .resume(appId: appId)
    default:
      return nil
    }
  }

  static func nodePayload(_ value: Any?) -> NodePayload? {
    guard let rec = asObject(value), let id = rec["id"] as? String, let label = rec["label"] as? String else {
      return nil
    }
    var kind: NodeKind = .text
    if let kindRaw = rec["kind"] {
      guard let kindStr = kindRaw as? String, let parsed = NodeKind(rawValue: kindStr) else {
        return nil
      }
      kind = parsed
    }
    var autocomplete: InputAutocomplete?
    if let autoRaw = rec["autocomplete"] as? String {
      autocomplete = InputAutocomplete(rawValue: autoRaw)
    }
    return NodePayload(
      id: id,
      label: label,
      kind: kind,
      secret: rec["secret"] as? Bool == true,
      autocomplete: autocomplete
    )
  }

  static func appLocation(_ value: Any?) -> AppLocation? {
    guard let rec = asObject(value),
          let appId = rec["appId"] as? String,
          let path = rec["path"] as? String,
          PathRouter.isCanonicalPath(path)
    else {
      return nil
    }
    return AppLocation(appId: appId, path: path)
  }

  static func wireBody(path: String, extras: RefreshExtras) -> [String: Any] {
    ["path": path, "extras": wireExtras(extras)]
  }

  static func wireBody(stack: [StackEntry], extras: RefreshExtras) -> [String: Any] {
    [
      "stack": stack.map { entry -> [String: Any] in
        var rec: [String: Any] = ["nodeId": entry.nodeId, "label": entry.label]
        if let location = entry.location {
          rec["location"] = ["appId": location.appId, "path": location.path]
        } else {
          rec["location"] = NSNull()
        }
        return rec
      },
      "extras": wireExtras(extras),
    ]
  }

  static func wireExtras(_ extras: RefreshExtras) -> [String: Any] {
    var rec: [String: Any] = [:]
    if let inputText = extras.inputText {
      rec["inputText"] = inputText
    }
    if extras.action {
      rec["action"] = true
    }
    if let ids = extras.parkedAppIds {
      rec["parkedAppIds"] = ids
    }
    return rec
  }

  private static func asObject(_ value: Any?) -> [String: Any]? {
    value as? [String: Any]
  }

  private static func optionalMap<T, U>(_ items: [T], _ transform: (T) -> U?) -> [U]? {
    var out: [U] = []
    out.reserveCapacity(items.count)
    for item in items {
      guard let mapped = transform(item) else {
        return nil
      }
      out.append(mapped)
    }
    return out
  }
}
