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
    let takeover = dict?["takeover"] as? Bool ?? false
    let mode = dict?["mode"] as? String ?? "text"
    let label = dict?["label"] as? String ?? ""
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if takeover {
        self.applyTakeover()
        self.ackTakeover()
      } else {
        self.applySurface(mode: mode, label: label)
      }
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
      if !overlayOwnsVoiceOver {
        if leavingInput {
          // Focus only: screenChanged must not carry the node string, or a late
          // handling of it speaks a stale warm label after the result announcement.
          moveVoiceOverToOverlay()
          announceOverlayLabel(label)
        } else {
          overlay.setVoiceOverElement(true)
          overlay.accessibilityLabel = label
          overlayOwnsVoiceOver = true
          announcedLabel = label
          UIAccessibility.post(notification: .screenChanged, argument: overlay)
        }
      } else {
        announceOverlayLabel(label)
      }
      return
    }

    let handingOff = overlayOwnsVoiceOver
    overlayOwnsVoiceOver = false
    announcedLabel = nil
    if handingOff {
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        UIAccessibility.post(notification: .screenChanged, argument: self.webView)
      }
    }
  }

  /// Hide the web from VoiceOver and focus the overlay before the page paints text.
  private func applyTakeover() {
    refreshOriginFlag()
    guard onAppOrigin else {
      return
    }
    overlay.setNavigationEnabled(true)
    setWebHiddenFromVoiceOver(true)
    lastSurfaceMode = "text"
    if !overlayOwnsVoiceOver {
      moveVoiceOverToOverlay()
    }
  }

  private func ackTakeover() {
    let js = "window.__nowiseeNative&&window.__nowiseeNative.onTakeoverReady()"
    webView.evaluateJavaScript(js, completionHandler: nil)
  }

  /// Move VoiceOver onto the Direct Touch overlay. Call while
  /// `accessibilityLabel` is still the handoff name, not the node text.
  private func moveVoiceOverToOverlay() {
    overlay.setVoiceOverElement(true)
    overlay.accessibilityLabel = DirectTouchOverlay.focusHandoffLabel
    overlayOwnsVoiceOver = true
    announcedLabel = DirectTouchOverlay.focusHandoffLabel
    UIAccessibility.post(notification: .screenChanged, argument: overlay)
  }

  private func announceOverlayLabel(_ label: String) {
    overlay.accessibilityLabel = label
    guard label != announcedLabel else {
      return
    }
    announcedLabel = label
    UIAccessibility.post(notification: .announcement, argument: label)
  }

  private func setWebHiddenFromVoiceOver(_ hidden: Bool) {
    webView.accessibilityElementsHidden = hidden
    webView.scrollView.accessibilityElementsHidden = hidden
  }

  private func refreshOriginFlag() {
    let host = webView.url?.host
    onAppOrigin = host == nil || host == NowiseeOrigin.host
    if !onAppOrigin {
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
