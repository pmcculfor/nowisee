import Foundation

private struct InFlight {
  var token: Int
  var task: Task<Void, Never>
  var isAction: Bool
}

private enum ApplyAs {
  case open(appId: String)
  case refresh
}

private struct LoadRecovery {
  var stackBefore: [StackEntry]
  var previous: NodePayload?
}

private struct CallArgs {
  var token: Int
  var isAction: Bool
  var baseExtras: RefreshExtras
  var applyAs: ApplyAs
  var invoke: (RefreshExtras) async throws -> RefreshResult
  var enterRecoveryOnFailure: LoadRecovery?
}

private struct Displayed {
  var appId: String
  var id: String
  var kind: NodeKind
  var label: String
}

/// Single owner of every state transition: stack, cache, map, blocked, display.
@MainActor
final class Navigator {
  private let rootAppId: String
  private let recentsAppId: String
  private let rpc: AppRpcing
  private let display: DisplayPort
  private let clipboard: ClipboardWriting?
  private let map = NavigationMapStore()
  private let cache = NodeCache()
  private let stack = NavStack()
  private let park = SessionPark()
  private let setAddressBar: (AppLocation) -> Void
  private let handOffExternal: (String) -> Void

  private var blocked = false
  private var transitionToken = 0
  private var inFlight: InFlight?
  private var pending: CallArgs?
  private var currentAppId: String?
  private var tipKind: NodeKind = .text
  private var displayed: Displayed?
  private var loadRecovery: LoadRecovery?
  private var pendingPark: ParkedSession?

  var isBlocked: Bool { blocked }
  var currentTipKind: NodeKind { tipKind }
  var transitionTokenValue: Int { transitionToken }

  init(
    rpc: AppRpcing,
    display: DisplayPort,
    clipboard: ClipboardWriting?,
    rootAppId: String = ShellIds.rootAppId,
    recentsAppId: String = ShellIds.recentsAppId,
    setAddressBar: @escaping (AppLocation) -> Void,
    handOffExternal: @escaping (String) -> Void
  ) {
    self.rpc = rpc
    self.display = display
    self.clipboard = clipboard
    self.rootAppId = rootAppId
    self.recentsAppId = recentsAppId
    self.setAddressBar = setAddressBar
    self.handOffExternal = handOffExternal
  }

  func onIntent(_ intent: NavIntent) {
    if blocked {
      return
    }
    if loadRecovery != nil {
      onLoadRecoveryIntent(intent)
      return
    }
    if intent == .recents, currentAppId != recentsAppId {
      Task { await openLocation(AppLocation(appId: recentsAppId, path: "/")) }
      return
    }
    guard let tip = stack.tip() else {
      return
    }
    guard let edge = map.lookup(fromNodeId: tip.nodeId, intent: intent.rawValue) else {
      return
    }
    guard isWellFormed(edge) else {
      return
    }

    var extras = RefreshExtras()
    let tipPayload = cache.get(tip.nodeId)
    let kind = tipPayload?.kind ?? tipKind
    switch edge {
    case .external, .resume:
      break
    case .node, .app:
      if edge.passInputText && kind == .input {
        extras.inputText = display.getInputText()
      }
      if edge.action {
        extras.action = true
      }
    }

    transitionToken += 1
    let token = transitionToken

    switch edge {
    case let .external(href):
      preemptReadOnly()
      handOffExternal(href)
    case let .resume(appId):
      resumeApp(appId)
    case let .app(to, _, _):
      Task { await openLocation(to, extras: extras) }
    case let .node(toNodeId, stackBehavior, _, _):
      followNodeEdge(toNodeId: toNodeId, behavior: stackBehavior, extras: extras, token: token)
    }
  }

  func openLocation(_ location: AppLocation, extras: RefreshExtras = RefreshExtras()) async {
    var appId = location.appId
    var path = location.path
    if !PathRouter.isAppId(appId) && appId != rootAppId {
      appId = rootAppId
      path = "/"
    }
    if !PathRouter.isCanonicalPath(path) {
      return
    }

    pendingPark = (currentAppId != nil && currentAppId != appId) ? snapshotCurrent() : nil
    transitionToken += 1
    let token = transitionToken
    preemptReadOnly()
    blocked = true
    let capturedAppId = appId
    let capturedPath = path
    await startCall(
      CallArgs(
        token: token,
        isAction: extras.action,
        baseExtras: extras,
        applyAs: .open(appId: capturedAppId),
        invoke: { [rpc] extras in
          try await rpc.open(appId: capturedAppId, path: capturedPath, extras: extras)
        },
        enterRecoveryOnFailure: nil
      )
    ).value
  }

  private func resumeApp(_ appId: String) {
    guard let parked = park.peek(appId), !parked.stack.isEmpty else {
      Task { await openLocation(AppLocation(appId: appId, path: "/")) }
      return
    }
    if let outgoing = snapshotCurrent(), outgoing.appId != appId {
      park.put(outgoing)
    }
    park.drop(appId)

    transitionToken += 1
    let token = transitionToken
    preemptReadOnly()

    currentAppId = appId
    stack.restore(parked.stack)
    cache.clear()
    map.replace([:])
    displayed = nil
    paintParked(parked)
    blocked = true

    let stackBefore = parked.stack
    let previous = payloadForParked(parked)
    let capturedAppId = appId
    startCall(
      CallArgs(
        token: token,
        isAction: false,
        baseExtras: RefreshExtras(),
        applyAs: .refresh,
        invoke: { [rpc, stack] extras in
          try await rpc.refresh(appId: capturedAppId, stack: stack.snapshot(), extras: extras)
        },
        enterRecoveryOnFailure: LoadRecovery(stackBefore: stackBefore, previous: previous)
      )
    )
  }

  private func followNodeEdge(
    toNodeId: String?,
    behavior: StackBehavior,
    extras: RefreshExtras,
    token: Int
  ) {
    let stackBefore = stack.snapshot()
    let previous = payloadForCurrentTip()
    let destId: String
    if behavior == .pop {
      if stack.length <= 1 {
        Task { await openLocation(AppLocation(appId: rootAppId, path: "/")) }
        return
      }
      stack.pop()
      destId = stack.tip()!.nodeId
    } else {
      guard let toNodeId else {
        return
      }
      destId = toNodeId
    }

    if let payload = cache.get(destId) {
      applyLocalMove(behavior: behavior, payload: payload, updateDisplay: true)
      scheduleCall(refreshCall(token: token, extras: extras, recovery: nil))
      return
    }

    blocked = true
    applyLocalMove(behavior: behavior, payload: NodePayload(id: destId, label: ""), updateDisplay: false)
    scheduleCall(
      refreshCall(
        token: token,
        extras: extras,
        recovery: LoadRecovery(stackBefore: stackBefore, previous: previous)
      )
    )
  }

  private func onLoadRecoveryIntent(_ intent: NavIntent) {
    if intent == .enter {
      guard loadRecovery != nil, currentAppId != nil else {
        return
      }
      transitionToken += 1
      let token = transitionToken
      preemptReadOnly()
      blocked = true
      startCall(refreshCall(token: token, extras: RefreshExtras(), recovery: loadRecovery))
      return
    }
    if intent == .back {
      exitLoadRecovery()
    }
  }

  private func enterLoadRecovery(_ recovery: LoadRecovery) {
    loadRecovery = recovery
    tipKind = .text
    display.showText(LoadFailure.label)
    if let currentAppId {
      displayed = Displayed(
        appId: currentAppId,
        id: stack.tip()?.nodeId ?? "",
        kind: .text,
        label: LoadFailure.label
      )
    }
  }

  private func exitLoadRecovery() {
    guard let recovery = loadRecovery else {
      return
    }
    loadRecovery = nil
    stack.restore(recovery.stackBefore)
    if let payload = recovery.previous ?? payloadForCurrentTip() {
      showPayload(payload)
    }
  }

  private func payloadForCurrentTip() -> NodePayload? {
    guard let tip = stack.tip() else {
      return nil
    }
    if let cached = cache.get(tip.nodeId) {
      return cached
    }
    if let displayed, displayed.appId == currentAppId {
      return NodePayload(id: displayed.id, label: displayed.label, kind: displayed.kind)
    }
    return NodePayload(id: tip.nodeId, label: tip.label)
  }

  private func applyLocalMove(behavior: StackBehavior, payload: NodePayload, updateDisplay: Bool) {
    let entry = StackEntry(nodeId: payload.id, label: payload.label, location: nil)
    if behavior == .push {
      stack.push(entry)
    } else {
      stack.replaceTip(entry)
    }
    if updateDisplay {
      showPayload(payload)
    }
  }

  private func showPayload(_ payload: NodePayload) {
    let kind = payload.kind
    tipKind = kind
    if let currentAppId {
      displayed = Displayed(appId: currentAppId, id: payload.id, kind: kind, label: payload.label)
    }
    if kind == .input {
      display.showInput(payload.label, secret: payload.secret, autocomplete: payload.autocomplete)
    } else {
      display.showText(payload.label)
    }
  }

  private func isAlreadyShowing(_ payload: NodePayload) -> Bool {
    guard let displayed, displayed.appId == currentAppId else {
      return false
    }
    if displayed.id != payload.id || displayed.kind != payload.kind {
      return false
    }
    if payload.kind == .input {
      return true
    }
    return displayed.label == payload.label
  }

  private func refreshCall(token: Int, extras: RefreshExtras, recovery: LoadRecovery?) -> CallArgs {
    let snapshot = stack.snapshot()
    let appId = currentAppId ?? rootAppId
    return CallArgs(
      token: token,
      isAction: extras.action,
      baseExtras: extras,
      applyAs: .refresh,
      invoke: { [rpc] extras in
        try await rpc.refresh(appId: appId, stack: snapshot, extras: extras)
      },
      enterRecoveryOnFailure: recovery
    )
  }

  private func preemptReadOnly() {
    pending = nil
    if let inFlight, !inFlight.isAction {
      inFlight.task.cancel()
    }
  }

  private func scheduleCall(_ args: CallArgs) {
    if args.isAction {
      preemptReadOnly()
      startCall(args)
      return
    }
    if inFlight == nil {
      startCall(args)
      return
    }
    pending = args
  }

  private func flushPending() {
    guard let next = pending else {
      return
    }
    pending = nil
    startCall(next)
  }

  private func resultCoversCurrentTip(_ result: RefreshResult) -> Bool {
    guard let tipId = stack.tip()?.nodeId else {
      return false
    }
    if result.node.id == tipId {
      return true
    }
    return result.warm.contains { $0.id == tipId }
  }

  private func applyCovering(_ result: RefreshResult) {
    map.replace(result.navigationMap)
    let stackIds = stack.snapshot().map(\.nodeId)
    cache.replaceWarm(warm: result.warm, tip: result.node, stackIds: stackIds)
    guard let tip = stack.tip(), let current = cache.get(tip.nodeId) else {
      return
    }
    if !isAlreadyShowing(current) {
      showPayload(current)
    }
    blocked = false
  }

  @discardableResult
  private func startCall(_ args: CallArgs) -> Task<Void, Never> {
    let running = Task { @MainActor [weak self] in
      guard let self else {
        return
      }
      await self.runCall(args)
    }
    inFlight = InFlight(token: args.token, task: running, isAction: args.isAction)
    return running
  }

  private func runCall(_ args: CallArgs) async {
    var callExtras = args.baseExtras
    if args.isAction {
      callExtras.action = true
    } else {
      callExtras.action = false
    }
    if shouldSendParkedIds(args.applyAs) {
      callExtras.parkedAppIds = parkedAppIdsForRecents()
    } else {
      callExtras.parkedAppIds = nil
    }

    do {
      let result = try await args.invoke(callExtras)
      let settled = fulfillClipboardText(result, isAction: args.isAction)
      if args.token == transitionToken {
        applyResult(settled, applyAs: args.applyAs)
        pendingPark = nil
        blocked = false
      } else if !args.isAction, case .refresh = args.applyAs, resultCoversCurrentTip(settled) {
        applyCovering(settled)
      }
    } catch {
      if args.token != transitionToken {
        finishCall(args)
        return
      }
      if isCancelled(error) {
        finishCall(args)
        return
      }
      print("Navigator: refresh/open failed \(error)")
      if let recovery = args.enterRecoveryOnFailure {
        enterLoadRecovery(recovery)
      }
      pendingPark = nil
      blocked = false
    }
    finishCall(args)
  }

  private func finishCall(_ args: CallArgs) {
    if inFlight?.token == args.token {
      inFlight = nil
      flushPending()
    }
  }

  private func fulfillClipboardText(_ result: RefreshResult, isAction: Bool) -> RefreshResult {
    guard isAction, let text = result.clipboardText, !text.isEmpty else {
      return result
    }
    guard let clipboard else {
      return withStatusLabel(result, "Copy failed: clipboard unavailable.")
    }
    do {
      try clipboard.writeText(text)
      return result
    } catch {
      return withStatusLabel(result, "Copy failed.")
    }
  }

  private func applyResult(_ result: RefreshResult, applyAs: ApplyAs) {
    loadRecovery = nil
    if case let .open(appId) = applyAs {
      if let pendingPark, pendingPark.appId != appId {
        park.put(pendingPark)
      }
      park.drop(appId)
      self.pendingPark = nil
      stack.clear()
      cache.clear()
      map.replace([:])
      displayed = nil
      currentAppId = appId
    }

    map.replace(result.navigationMap)

    let priorLocation = stack.tip()?.location
    let location: AppLocation?
    if result.location == nil {
      location = priorLocation
    } else if let loc = result.location, PathRouter.isCanonicalPath(loc.path) {
      location = loc
    } else {
      location = priorLocation
    }

    let tipEntry = StackEntry(nodeId: result.node.id, label: result.node.label, location: location)
    if stack.length == 0 {
      stack.push(tipEntry)
    } else {
      stack.replaceTip(tipEntry)
    }

    let stackIds = stack.snapshot().map(\.nodeId)
    cache.replaceWarm(warm: result.warm, tip: result.node, stackIds: stackIds)

    if !isAlreadyShowing(result.node) {
      showPayload(result.node)
    } else {
      tipKind = result.node.kind
    }

    if let loc = result.location, PathRouter.isCanonicalPath(loc.path) {
      setAddressBar(loc)
    }
  }

  private func shouldSendParkedIds(_ applyAs: ApplyAs) -> Bool {
    switch applyAs {
    case let .open(appId):
      return appId == recentsAppId
    case .refresh:
      return currentAppId == recentsAppId
    }
  }

  private func parkedAppIdsForRecents() -> [String] {
    let ids = park.list()
    guard let pending = pendingPark else {
      return ids
    }
    return [pending.appId] + ids.filter { $0 != pending.appId }
  }

  private func snapshotCurrent() -> ParkedSession? {
    guard let currentAppId, stack.length > 0 else {
      return nil
    }
    let tip = stack.tip()
    let payload = tip.flatMap { cache.get($0.nodeId) }
    var session = ParkedSession(
      appId: currentAppId,
      stack: stack.snapshot(),
      tipKind: tipKind,
      inputText: nil,
      secret: false,
      autocomplete: nil
    )
    if tipKind == .input {
      session.inputText = display.getInputText()
      session.secret = payload?.secret ?? false
      session.autocomplete = payload?.autocomplete
    }
    return session
  }

  private func paintParked(_ session: ParkedSession) {
    guard let tip = session.stack.last else {
      return
    }
    tipKind = session.tipKind
    displayed = Displayed(appId: session.appId, id: tip.nodeId, kind: session.tipKind, label: tip.label)
    if session.tipKind == .input {
      display.showInput(
        session.inputText ?? tip.label,
        secret: session.secret,
        autocomplete: session.autocomplete
      )
    } else {
      display.showText(tip.label)
    }
    if let location = locationFromStack(session.stack) {
      setAddressBar(location)
    }
  }

  private func payloadForParked(_ session: ParkedSession) -> NodePayload? {
    guard let tip = session.stack.last else {
      return nil
    }
    return NodePayload(
      id: tip.nodeId,
      label: tip.label,
      kind: session.tipKind,
      secret: session.secret,
      autocomplete: session.autocomplete
    )
  }
}

private func isCancelled(_ error: Error) -> Bool {
  if error is CancellationError {
    return true
  }
  if let urlError = error as? URLError, urlError.code == .cancelled {
    return true
  }
  if case AppRpcError.cancelled = error {
    return true
  }
  return false
}

private func withStatusLabel(_ result: RefreshResult, _ label: String) -> RefreshResult {
  var copy = result
  copy.clipboardText = nil
  copy.node.label = label
  return copy
}

private func isWellFormed(_ edge: NavEdge) -> Bool {
  switch edge {
  case let .node(toNodeId, behavior, _, _):
    return behavior == .pop || toNodeId != nil
  case let .app(to, _, _):
    return !to.appId.isEmpty && PathRouter.isCanonicalPath(to.path)
  case let .resume(appId):
    return !appId.isEmpty
  case let .external(href):
    return !href.isEmpty
  }
}

private func locationFromStack(_ stack: [StackEntry]) -> AppLocation? {
  for entry in stack.reversed() {
    if let location = entry.location {
      return location
    }
  }
  return nil
}
