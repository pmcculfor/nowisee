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

  private var announcedLabel: String?
  private var onAppOrigin = true

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
    let input = mode == "input"
    let navigationOn = onAppOrigin && !input
    overlay.setNavigationEnabled(navigationOn)
    webView.accessibilityElementsHidden = navigationOn
    guard navigationOn else {
      announcedLabel = nil
      return
    }
    overlay.accessibilityLabel = label
    if !label.isEmpty, label != announcedLabel {
      announcedLabel = label
      UIAccessibility.post(notification: .announcement, argument: label)
    }
  }

  private func refreshOriginFlag() {
    let host = webView.url?.host
    onAppOrigin = host == nil || host == NowiseeOrigin.host
    if !onAppOrigin {
      overlay.setNavigationEnabled(false)
      webView.accessibilityElementsHidden = false
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
