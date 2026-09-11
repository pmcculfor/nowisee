import UIKit
import WebKit

final class RootViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler,
  DirectTouchOverlayDelegate
{
  private var webView: WKWebView!
  private let overlay = DirectTouchOverlay()
  private let errorLabel = UILabel()
  private let retryButton = UIButton(type: .system)
  private let errorStack = UIStackView()
  private let scriptProxy = WeakScriptMessageHandler()

  private var onAppOrigin = true
  private var overlayOwnsVoiceOver = false
  private var announcedLabel: String?
  private var lastSurfaceMode: String = "text"
  /// Latest-label-wins delay after leaving input. Longer than a typical
  /// same-origin action so “Signing in…” can be replaced before VoiceOver hears it.
  private let voiceOverTakeoverDelay: TimeInterval = 0.4
  private var voiceOverTakeoverWork: DispatchWorkItem?

  deinit {
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "nowisee")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    scriptProxy.target = self

    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.defaultWebpagePreferences.allowsContentJavaScript = true
    config.userContentController.add(scriptProxy, name: "nowisee")
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    webView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(webView)

    overlay.delegate = self
    overlay.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(overlay)

    errorLabel.numberOfLines = 0
    errorLabel.textAlignment = .center
    errorLabel.font = .preferredFont(forTextStyle: .body)
    retryButton.setTitle("Retry", for: .normal)
    retryButton.addTarget(self, action: #selector(loadOrigin), for: .touchUpInside)
    errorStack.axis = .vertical
    errorStack.spacing = 16
    errorStack.alignment = .center
    errorStack.addArrangedSubview(errorLabel)
    errorStack.addArrangedSubview(retryButton)
    errorStack.isHidden = true
    errorStack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(errorStack)

    NSLayoutConstraint.activate([
      webView.topAnchor.constraint(equalTo: view.topAnchor),
      webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      overlay.topAnchor.constraint(equalTo: view.topAnchor),
      overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      errorStack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      errorStack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      errorStack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
      errorStack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
    ])

    loadOrigin()
  }

  @objc private func loadOrigin() {
    errorStack.isHidden = true
    webView.isHidden = false
    overlay.setNavigationEnabled(true)
    webView.load(URLRequest(url: NowiseeOrigin.url))
  }

  func overlayDidFire(_ intent: NavIntent) {
    guard onAppOrigin, !overlay.isHidden else {
      return
    }
    let js = "window.__nowiseeNative&&window.__nowiseeNative.onIntent(\"\(intent.rawValue)\")"
    webView.evaluateJavaScript(js, completionHandler: nil)
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == "nowisee" else {
      return
    }
    let dict = message.body as? [String: Any]
    let mode = dict?["mode"] as? String ?? "text"
    let label = dict?["label"] as? String ?? ""
    DispatchQueue.main.async { [weak self] in
      self?.applySurface(mode: mode, label: label)
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    errorStack.isHidden = true
    refreshOriginFlag()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    showLoadError(error)
  }

  func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    showLoadError(error)
  }

  private func applySurface(mode: String, label: String) {
    refreshOriginFlag()
    let navigationOn = onAppOrigin && mode != "input"
    let leavingInput = lastSurfaceMode == "input" && navigationOn
    lastSurfaceMode = navigationOn ? "text" : "input"
    overlay.setNavigationEnabled(navigationOn)
    setWebHiddenFromVoiceOver(navigationOn)

    if navigationOn {
      guard !label.isEmpty else {
        return
      }
      overlay.accessibilityLabel = label
      if !overlayOwnsVoiceOver {
        // After input, keep the overlay out of the VoiceOver tree until the
        // label has settled. A warm working label posted as screenChanged is
        // spoken late, after VoiceOver already started the result, and the
        // rotor hint rides on that stale Direct Touch focus.
        if leavingInput || voiceOverTakeoverWork != nil {
          overlay.setVoiceOverElement(false)
          scheduleVoiceOverTakeover()
        } else {
          finishVoiceOverTakeover()
        }
      } else if label != announcedLabel {
        announcedLabel = label
        UIAccessibility.post(notification: .announcement, argument: label)
      }
      return
    }

    let handingOff = overlayOwnsVoiceOver || voiceOverTakeoverWork != nil
    cancelVoiceOverTakeover()
    overlayOwnsVoiceOver = false
    announcedLabel = nil
    if handingOff {
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        UIAccessibility.post(notification: .screenChanged, argument: self.webView)
      }
    }
  }

  private func scheduleVoiceOverTakeover() {
    voiceOverTakeoverWork?.cancel()
    let work = DispatchWorkItem { [weak self] in
      self?.voiceOverTakeoverWork = nil
      self?.finishVoiceOverTakeover()
    }
    voiceOverTakeoverWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + voiceOverTakeoverDelay, execute: work)
  }

  private func cancelVoiceOverTakeover() {
    voiceOverTakeoverWork?.cancel()
    voiceOverTakeoverWork = nil
  }

  private func finishVoiceOverTakeover() {
    guard onAppOrigin, !overlay.isHidden else {
      return
    }
    overlay.setVoiceOverElement(true)
    overlayOwnsVoiceOver = true
    announcedLabel = overlay.accessibilityLabel
    UIAccessibility.post(notification: .screenChanged, argument: overlay)
  }

  private func setWebHiddenFromVoiceOver(_ hidden: Bool) {
    webView.accessibilityElementsHidden = hidden
    webView.scrollView.accessibilityElementsHidden = hidden
  }

  private func refreshOriginFlag() {
    let host = webView.url?.host
    onAppOrigin = host == nil || host == NowiseeOrigin.host
    if !onAppOrigin {
      cancelVoiceOverTakeover()
      overlay.setNavigationEnabled(false)
      setWebHiddenFromVoiceOver(false)
      overlayOwnsVoiceOver = false
    }
  }

  private func showLoadError(_ error: Error) {
    let ns = error as NSError
    if ns.domain == NSURLErrorDomain, ns.code == NSURLErrorCancelled {
      return
    }
    errorLabel.text = "Could not load Nowisee.\n\(error.localizedDescription)"
    errorStack.isHidden = false
    cancelVoiceOverTakeover()
    overlay.setNavigationEnabled(false)
    setWebHiddenFromVoiceOver(false)
    overlayOwnsVoiceOver = false
  }
}

/// WKUserContentController retains its handler; this breaks the cycle back to the VC.
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    target?.userContentController(userContentController, didReceive: message)
  }
}
