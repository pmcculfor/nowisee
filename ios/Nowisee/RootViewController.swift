import UIKit

final class RootViewController: UIViewController, DirectTouchOverlayDelegate, InputSurfaceDelegate,
  DisplayPort
{
  private let overlay = DirectTouchOverlay()
  private let inputSurface = InputSurfaceView()
  private let rpc = AppRpc()
  private var navigator: Navigator!
  private var oauth: OAuthHandoff!
  private var announcedLabel: String?
  private var overlayOwnsVoiceOver = false
  private var awaitingOverlayFocus = false
  private var pendingLabel: String?
  private var mode: NodeKind = .text
  private var didBootstrap = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    overlay.delegate = self
    overlay.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(overlay)

    inputSurface.delegate = self
    inputSurface.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(inputSurface)

    NSLayoutConstraint.activate([
      overlay.topAnchor.constraint(equalTo: view.topAnchor),
      overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      inputSurface.topAnchor.constraint(equalTo: view.topAnchor),
      inputSurface.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      inputSurface.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      inputSurface.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])

    oauth = OAuthHandoff(window: view.window, rpc: rpc)
    oauth.onReturnPath = { [weak self] location in
      self?.openReturnedPath(location)
    }

    navigator = Navigator(
      rpc: rpc,
      display: self,
      clipboard: DeviceClipboard(),
      setAddressBar: { _ in },
      handOffExternal: { [weak self] href in
        self?.openExternal(href)
      }
    )

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleOpenURL(_:)),
      name: .nowiseeOpenURL,
      object: nil
    )
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    oauth.setWindow(view.window)
    if !didBootstrap {
      didBootstrap = true
      Task { await navigator.openLocation(AppLocation(appId: ShellIds.rootAppId, path: "/")) }
    }
  }

  func overlayDidFire(_ intent: NavIntent) {
    guard !navigator.isBlocked else {
      return
    }
    navigator.onIntent(intent)
  }

  func overlayDidBecomeFocused() {
    guard awaitingOverlayFocus else {
      return
    }
    awaitingOverlayFocus = false
    overlayOwnsVoiceOver = true
    guard let pending = pendingLabel, pending != announcedLabel else {
      pendingLabel = nil
      return
    }
    pendingLabel = nil
    overlay.setLabel(pending)
    announcedLabel = pending
    UIAccessibility.post(notification: .announcement, argument: pending)
  }

  func inputDidFire(_ intent: NavIntent) {
    guard !navigator.isBlocked else {
      return
    }
    navigator.onIntent(intent)
  }

  func showText(_ label: String) {
    let leavingInput = mode == .input
    mode = .text
    inputSurface.hide()
    overlay.setNavigationEnabled(true)
    overlay.setVoiceOverElement(true)

    // Hold later labels until VoiceOver has actually focused the overlay, so an
    // `.announcement` cannot speak before the `.screenChanged` from leaving input.
    if awaitingOverlayFocus {
      pendingLabel = label
      return
    }

    if leavingInput || !overlayOwnsVoiceOver {
      overlay.setLabel(label)
      overlayOwnsVoiceOver = true
      announcedLabel = label
      if UIAccessibility.isVoiceOverRunning {
        awaitingOverlayFocus = true
        pendingLabel = nil
      }
      UIAccessibility.post(notification: .screenChanged, argument: overlay)
      return
    }

    if label != announcedLabel {
      overlay.setLabel(label)
      announcedLabel = label
      UIAccessibility.post(notification: .announcement, argument: label)
    }
  }

  func showInput(_ initialText: String, secret: Bool, autocomplete: InputAutocomplete?) {
    mode = .input
    awaitingOverlayFocus = false
    pendingLabel = nil
    overlayOwnsVoiceOver = false
    announcedLabel = nil
    overlay.setNavigationEnabled(false)
    inputSurface.present(
      initialText: initialText,
      secret: secret,
      autocomplete: autocomplete,
      accessibleName: accessibleName(secret: secret, autocomplete: autocomplete)
    )
    inputSurface.setButtonsEnabled(!navigator.isBlocked)
    UIAccessibility.post(notification: .screenChanged, argument: inputSurface.voiceOverTarget())
  }

  func getInputText() -> String {
    inputSurface.inputText()
  }

  private func accessibleName(secret: Bool, autocomplete: InputAutocomplete?) -> String {
    if secret || autocomplete == .currentPassword || autocomplete == .newPassword {
      return "Password"
    }
    if autocomplete == .username {
      return "Email"
    }
    return "Input"
  }

  private func openExternal(_ href: String) {
    guard let url = URL(string: href) else {
      return
    }
    oauth.setWindow(view.window)
    oauth.start(authorizeURL: url)
  }

  private func openReturnedPath(_ location: String) {
    let parsed = PathRouter.parse(location, rootAppId: ShellIds.rootAppId)
    Task { await navigator.openLocation(parsed) }
  }

  @objc private func handleOpenURL(_ note: Notification) {
    guard let url = note.object as? URL else {
      return
    }
    if url.path.hasPrefix("/oauth/callback") {
      Task { await finishOAuthFromLink(url) }
      return
    }
    openReturnedPath(url.path)
  }

  private func finishOAuthFromLink(_ url: URL) async {
    do {
      let result = try await rpc.getWithoutRedirect(url)
      if let location = result.location {
        openReturnedPath(location)
      }
    } catch {
      print("OAuth universal-link GET failed \(error)")
    }
  }
}

extension Notification.Name {
  static let nowiseeOpenURL = Notification.Name("nowiseeOpenURL")
}
