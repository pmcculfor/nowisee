import Foundation
@testable import NowiseeCore

enum FixtureError: Error, CustomStringConvertible {
  case message(String)

  var description: String {
    switch self {
    case let .message(text): return text
    }
  }
}

struct NavigatorFixtureFile {
  var id: String
  var apps: [String: Any]
  var steps: [[String: Any]]
  var decode: (accept: Bool, payload: Any)?
  var rootAppId: String
  var recentsAppId: String?
  var clipboardUnavailable: Bool
}

func fixtureDirectory(file: String = #filePath) -> URL {
  URL(fileURLWithPath: file)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("tests", isDirectory: true)
    .appendingPathComponent("fixtures", isDirectory: true)
    .appendingPathComponent("navigator", isDirectory: true)
}

func listNavigatorFixtureURLs() throws -> [URL] {
  let dir = fixtureDirectory()
  let names = try FileManager.default.contentsOfDirectory(atPath: dir.path)
  return names
    .filter { $0.hasSuffix(".json") && $0 != "schema.json" }
    .sorted()
    .map { dir.appendingPathComponent($0) }
}

func loadNavigatorFixture(url: URL) throws -> NavigatorFixtureFile {
  let data = try Data(contentsOf: url)
  guard let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    throw FixtureError.message("\(url.lastPathComponent) is not an object")
  }
  guard let id = raw["id"] as? String else {
    throw FixtureError.message("\(url.lastPathComponent) missing id")
  }
  var apps = raw["apps"] as? [String: Any] ?? [:]
  if let appsFrom = raw["appsFrom"] as? String {
    let baseURL = fixtureDirectory().appendingPathComponent("apps").appendingPathComponent("\(appsFrom).json")
    let baseData = try Data(contentsOf: baseURL)
    guard let base = try JSONSerialization.jsonObject(with: baseData) as? [String: Any] else {
      throw FixtureError.message("appsFrom \(appsFrom) is not an object")
    }
    apps = mergeApps(base, apps)
  }
  let config = raw["config"] as? [String: Any] ?? [:]
  var recents: String?
  if config["recentsAppId"] is NSNull {
    recents = nil
  } else if let value = config["recentsAppId"] as? String {
    recents = value
  }
  var decode: (Bool, Any)?
  if let spec = raw["decode"] as? [String: Any], let accept = spec["accept"] as? Bool, let payload = spec["payload"] {
    decode = (accept, payload)
  }
  return NavigatorFixtureFile(
    id: id,
    apps: apps,
    steps: raw["steps"] as? [[String: Any]] ?? [],
    decode: decode,
    rootAppId: config["rootAppId"] as? String ?? "home",
    recentsAppId: recents,
    clipboardUnavailable: config["clipboard"] as? String == "unavailable"
  )
}

private func mergeApps(_ base: [String: Any], _ overlay: [String: Any]) -> [String: Any] {
  var out = base
  for (id, value) in overlay {
    guard let over = value as? [String: Any] else {
      out[id] = value
      continue
    }
    guard let prior = out[id] as? [String: Any] else {
      out[id] = over
      continue
    }
    var merged = prior
    if let graph = over["graph"] {
      merged["graph"] = graph
    }
    if let open = over["open"] as? [String: Any] {
      var priorOpen = prior["open"] as? [String: Any] ?? [:]
      for (k, v) in open {
        priorOpen[k] = v
      }
      merged["open"] = priorOpen
    }
    if let refresh = over["refresh"] as? [String: Any] {
      var priorRefresh = prior["refresh"] as? [String: Any] ?? [:]
      for (k, v) in refresh {
        priorRefresh[k] = v
      }
      merged["refresh"] = priorRefresh
    }
    out[id] = merged
  }
  return out
}

struct Reply {
  var result: RefreshResult?
  var patch: [String: Any]?
  var error: String?
  var hold: String?
}

struct ReplyQueue {
  var reusable: Bool
  var items: [Reply]
}

struct Graph {
  var appId: String
  var nodes: [NodePayload]
  var map: NavigationMap
  var openTips: [String: String]
  var nullLocationIds: [String]
}

struct CallRecord {
  var method: String
  var appId: String
  var path: String?
  var nodeId: String?
  var extras: RefreshExtras
}

final class FakeDisplay: DisplayPort {
  var label = ""
  var kind: NodeKind = .text
  var inputText = ""

  func showText(_ label: String) {
    self.label = label
    kind = .text
  }

  func showInput(_ initialText: String, secret: Bool, autocomplete: InputAutocomplete?) {
    label = initialText
    inputText = initialText
    kind = .input
  }

  func getInputText() -> String {
    inputText
  }
}

final class FakeClipboard: ClipboardWriting {
  var texts: [String] = []

  func writeText(_ text: String) throws {
    texts.append(text)
  }
}

@MainActor
final class ScriptedRpc: AppRpcing {
  var calls: [CallRecord] = []
  var unheldBusy = 0
  var heldBusy = 0

  private var released: Set<String> = []
  private var waiters: [String: CheckedContinuation<Void, Never>] = [:]
  private var openQueues: [String: [String: ReplyQueue]] = [:]
  private var refreshQueues: [String: [String: ReplyQueue]] = [:]
  private var graphs: [String: Graph] = [:]

  init(apps: [String: Any]) throws {
    for (id, raw) in apps {
      guard let app = raw as? [String: Any] else {
        continue
      }
      if let graphRaw = app["graph"] as? [String: Any] {
        graphs[id] = try parseGraph(graphRaw)
      }
      if let open = app["open"] as? [String: Any] {
        openQueues[id] = try parseQueues(open)
      }
      if let refresh = app["refresh"] as? [String: Any] {
        refreshQueues[id] = try parseQueues(refresh)
      }
    }
  }

  func release(_ name: String) {
    released.insert(name)
    if let waiter = waiters.removeValue(forKey: name) {
      waiter.resume()
    }
  }

  func open(appId: String, path: String, extras: RefreshExtras) async throws -> RefreshResult {
    try await fulfill(appId: appId, method: "open", key: path, extras: extras, path: path, nodeId: nil)
  }

  func refresh(appId: String, nodeId: String, extras: RefreshExtras) async throws -> RefreshResult {
    try await fulfill(appId: appId, method: "refresh", key: nodeId, extras: extras, path: nil, nodeId: nodeId)
  }

  func getWithoutRedirect(_ url: URL) async throws -> (status: Int, location: String?) {
    throw FixtureError.message("unexpected GET \(url)")
  }

  private func fulfill(
    appId: String,
    method: String,
    key: String,
    extras: RefreshExtras,
    path: String?,
    nodeId: String?
  ) async throws -> RefreshResult {
    let reply = takeReply(method: method, appId: appId, key: key)
    calls.append(CallRecord(method: method, appId: appId, path: path, nodeId: nodeId, extras: extras))
    let held = reply.hold != nil
    if held {
      heldBusy += 1
    } else {
      unheldBusy += 1
    }
    defer {
      if held {
        heldBusy -= 1
      } else {
        unheldBusy -= 1
      }
    }
    if let hold = reply.hold {
      await waitHold(hold)
      try Task.checkCancellation()
    }
    if reply.error == "malformed" {
      throw AppRpcError.malformed
    }
    if reply.error == "transport" {
      throw AppRpcError.transport(FixtureError.message("transport"))
    }
    var result = reply.result
    if result == nil, let graph = graphs[appId] {
      let tipId = method == "open" ? openTipId(graph, path: key) : key
      result = resultFromGraph(graph, tipId: tipId)
    }
    guard var out = result else {
      throw FixtureError.message("No result for \(method) \(appId) \(key)")
    }
    if let patch = reply.patch {
      out = applyPatch(out, patch)
    }
    return out
  }

  private func waitHold(_ name: String) async {
    if released.contains(name) {
      return
    }
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
      if released.contains(name) {
        cont.resume()
        return
      }
      waiters[name] = cont
    }
  }

  private func takeReply(method: String, appId: String, key: String) -> Reply {
    if method == "open" {
      return take(&openQueues, appId: appId, key: key)
    }
    return take(&refreshQueues, appId: appId, key: key)
  }

  private func take(_ queues: inout [String: [String: ReplyQueue]], appId: String, key: String) -> Reply {
    guard var queue = queues[appId]?[key], !queue.items.isEmpty else {
      return Reply()
    }
    if queue.reusable {
      return queue.items[0]
    }
    let item = queue.items.removeFirst()
    var byApp = queues[appId] ?? [:]
    byApp[key] = queue
    queues[appId] = byApp
    return item
  }
}

func parseQueues(_ rec: [String: Any]) throws -> [String: ReplyQueue] {
  var out: [String: ReplyQueue] = [:]
  for (key, value) in rec {
    if let arr = value as? [Any] {
      out[key] = ReplyQueue(reusable: false, items: try arr.map { try parseReply($0) })
    } else {
      out[key] = ReplyQueue(reusable: true, items: [try parseReply(value)])
    }
  }
  return out
}

func parseReply(_ value: Any) throws -> Reply {
  guard let rec = value as? [String: Any] else {
    throw FixtureError.message("reply is not an object")
  }
  var reply = Reply()
  reply.error = rec["error"] as? String
  reply.hold = rec["hold"] as? String
  reply.patch = rec["patch"] as? [String: Any]
  if let resultRaw = rec["result"] {
    guard let parsed = RefreshDecoding.result(from: resultRaw) else {
      throw FixtureError.message("reply.result failed RefreshDecoding")
    }
    reply.result = parsed
  }
  return reply
}

func parseGraph(_ rec: [String: Any]) throws -> Graph {
  guard let appId = rec["appId"] as? String else {
    throw FixtureError.message("graph missing appId")
  }
  guard let mapRaw = rec["map"], let map = RefreshDecoding.navigationMap(mapRaw) else {
    throw FixtureError.message("graph map failed RefreshDecoding")
  }
  guard let nodesRaw = rec["nodes"] as? [Any] else {
    throw FixtureError.message("graph missing nodes")
  }
  var nodes: [NodePayload] = []
  for item in nodesRaw {
    guard let node = RefreshDecoding.nodePayload(item) else {
      throw FixtureError.message("graph node failed RefreshDecoding")
    }
    nodes.append(node)
  }
  let openTips = rec["openTips"] as? [String: String] ?? [:]
  let nullIds = rec["nullLocationIds"] as? [String] ?? []
  return Graph(appId: appId, nodes: nodes, map: map, openTips: openTips, nullLocationIds: nullIds)
}

func openTipId(_ graph: Graph, path: String) -> String {
  if let mapped = graph.openTips[path] {
    return mapped
  }
  if path.hasPrefix("/") {
    return String(path.dropFirst())
  }
  return path
}

func resultFromGraph(_ graph: Graph, tipId: String) -> RefreshResult {
  let node = graph.nodes.first(where: { $0.id == tipId }) ?? NodePayload(id: tipId, label: tipId)
  let location: AppLocation?
  if graph.nullLocationIds.contains(tipId) {
    location = nil
  } else if graph.openTips["/"] == tipId {
    location = AppLocation(appId: graph.appId, path: "/")
  } else {
    location = AppLocation(appId: graph.appId, path: "/\(tipId)")
  }
  return RefreshResult(
    navigationMap: graph.map,
    warm: graph.nodes,
    node: node,
    location: location,
    clipboardText: nil,
    stack: nil
  )
}

func applyPatch(_ base: RefreshResult, _ patch: [String: Any]) -> RefreshResult {
  var out = base
  if let clip = patch["clipboardText"] as? String {
    out.clipboardText = clip
  }
  if let nodeRaw = patch["node"], let node = RefreshDecoding.nodePayload(nodeRaw) {
    out.node = node
  }
  if let mapRaw = patch["navigationMap"], let map = RefreshDecoding.navigationMap(mapRaw) {
    out.navigationMap = map
  }
  if patch["location"] is NSNull {
    out.location = nil
  } else if let loc = RefreshDecoding.appLocation(patch["location"]) {
    out.location = loc
  }
  if let stack = RefreshDecoding.stackEntries(patch["stack"]) {
    out.stack = stack
  }
  return out
}

@MainActor
func settle(nav: Navigator, rpc: ScriptedRpc) async throws {
  try await Task.sleep(nanoseconds: 5_000_000)
  let deadline = Date().addingTimeInterval(2)
  while Date() < deadline {
    if rpc.unheldBusy > 0 {
      await Task.yield()
      continue
    }
    if nav.hasInFlight && rpc.heldBusy == 0 {
      await Task.yield()
      continue
    }
    return
  }
  throw FixtureError.message("Fixture settle timed out")
}

@MainActor
func runNavigatorFixture(_ fixture: NavigatorFixtureFile) async throws {
  if let decode = fixture.decode {
    let accepted = RefreshDecoding.result(from: decode.payload) != nil
    if accepted != decode.accept {
      throw FixtureError.message("\(fixture.id): RefreshDecoding accept=\(accepted), expected \(decode.accept)")
    }
    return
  }
  if fixture.steps.isEmpty {
    throw FixtureError.message("\(fixture.id) has no steps")
  }

  let display = FakeDisplay()
  let rpc = try ScriptedRpc(apps: fixture.apps)
  let clipboard = fixture.clipboardUnavailable ? nil : FakeClipboard()
  var addressLog: [AppLocation] = []
  var externalLog: [String] = []

  let nav = Navigator(
    rpc: rpc,
    display: display,
    clipboard: clipboard,
    rootAppId: fixture.rootAppId,
    recentsAppId: fixture.recentsAppId ?? ShellIds.recentsAppId,
    setAddressBar: { addressLog.append($0) },
    handOffExternal: { externalLog.append($0) }
  )

  for (index, step) in fixture.steps.enumerated() {
    if let open = step["open"] as? [String: Any],
       let appId = open["appId"] as? String,
       let path = open["path"] as? String
    {
      await nav.openLocation(AppLocation(appId: appId, path: path))
      try await settle(nav: nav, rpc: rpc)
      continue
    }
    if let intentRaw = step["intent"] as? String {
      guard let intent = NavIntent(rawValue: intentRaw) else {
        throw FixtureError.message("\(fixture.id) step \(index): unknown intent \(intentRaw)")
      }
      nav.onIntent(intent)
      try await settle(nav: nav, rpc: rpc)
      continue
    }
    if let text = step["setInput"] as? String {
      display.inputText = text
      continue
    }
    if let name = step["release"] as? String {
      rpc.release(name)
      try await settle(nav: nav, rpc: rpc)
      continue
    }
    if let exp = step["expect"] as? [String: Any] {
      let errors = checkExpect(
        exp,
        nav: nav,
        display: display,
        rpc: rpc,
        clipboard: clipboard,
        addressLog: addressLog,
        externalLog: externalLog
      )
      if !errors.isEmpty {
        throw FixtureError.message("\(fixture.id) step \(index): \(errors.joined(separator: "; "))")
      }
    }
  }
}

private func checkExpect(
  _ exp: [String: Any],
  nav: Navigator,
  display: FakeDisplay,
  rpc: ScriptedRpc,
  clipboard: FakeClipboard?,
  addressLog: [AppLocation],
  externalLog: [String]
) -> [String] {
  var errors: [String] = []
  if let label = exp["label"] as? String, display.label != label {
    errors.append("label \(display.label.debugDescription) != \(label.debugDescription)")
  }
  if let kind = exp["kind"] as? String {
    let got = display.kind == .input ? "input" : "text"
    if got != kind {
      errors.append("kind \(got) != \(kind)")
    }
  }
  let stack = nav.stackSnapshot
  if let tipId = exp["tipId"] as? String, stack.last?.nodeId != tipId {
    errors.append("tipId \(stack.last?.nodeId ?? "nil") != \(tipId)")
  }
  if let expected = exp["stack"] as? [String] {
    let got = stack.map(\.nodeId)
    if got != expected {
      errors.append("stack \(got) != \(expected)")
    }
  }
  if let expected = exp["frames"] as? [Any] {
    let gotNorm: [String?] = stack.map(\.frame)
    let expNorm: [String?] = expected.map { item in
      if item is NSNull { return nil }
      return item as? String
    }
    if gotNorm != expNorm {
      errors.append("frames \(gotNorm) != \(expNorm)")
    }
  }
  if let blocked = exp["blocked"] as? Bool, nav.isBlocked != blocked {
    errors.append("blocked \(nav.isBlocked) != \(blocked)")
  }
  if let address = exp["address"] as? [String: Any],
     let appId = address["appId"] as? String,
     let path = address["path"] as? String
  {
    let last = addressLog.last
    if last?.appId != appId || last?.path != path {
      errors.append("address \(String(describing: last)) != \(appId) \(path)")
    }
  }
  if let external = exp["external"] as? String, externalLog.last != external {
    errors.append("external \(externalLog.last ?? "nil") != \(external)")
  }
  if let clip = exp["clipboard"] as? String, clipboard?.texts.last != clip {
    errors.append("clipboard \(clipboard?.texts.last ?? "nil") != \(clip)")
  }
  if let lastCall = exp["lastCall"] as? [String: Any] {
    guard let last = rpc.calls.last else {
      errors.append("lastCall missing")
      return errors
    }
    if let method = lastCall["method"] as? String, last.method != method {
      errors.append("lastCall.method \(last.method) != \(method)")
    }
    if let appId = lastCall["appId"] as? String, last.appId != appId {
      errors.append("lastCall.appId \(last.appId) != \(appId)")
    }
    if let nodeId = lastCall["nodeId"] as? String, last.nodeId != nodeId {
      errors.append("lastCall.nodeId \(last.nodeId ?? "nil") != \(nodeId)")
    }
    if let path = lastCall["path"] as? String, last.path != path {
      errors.append("lastCall.path \(last.path ?? "nil") != \(path)")
    }
    if let extras = lastCall["extras"] as? [String: Any] {
      if extras.keys.contains("action") {
        if extras["action"] is NSNull {
          if last.extras.action != nil {
            errors.append("expected no action")
          }
        } else if let action = extras["action"] as? [String: Any],
                  let trigger = action["triggerId"] as? String,
                  last.extras.action?.triggerId != trigger
        {
          errors.append("action triggerId \(last.extras.action?.triggerId ?? "nil") != \(trigger)")
        }
      }
      if let inputText = extras["inputText"] as? String, last.extras.inputText != inputText {
        errors.append("inputText \(last.extras.inputText ?? "nil") != \(inputText)")
      }
      if let ids = extras["parkedAppIds"] as? [String], last.extras.parkedAppIds != ids {
        errors.append("parkedAppIds \(last.extras.parkedAppIds ?? []) != \(ids)")
      }
    }
  }
  return errors
}
