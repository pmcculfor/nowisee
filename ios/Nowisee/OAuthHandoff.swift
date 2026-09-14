import AuthenticationServices
import UIKit

@MainActor
final class OAuthHandoff: NSObject, ASWebAuthenticationPresentationContextProviding {
  private weak var window: UIWindow?
  private var session: ASWebAuthenticationSession?
  private let rpc: AppRpcing
  var onReturnPath: ((String) -> Void)?

  init(window: UIWindow?, rpc: AppRpcing) {
    self.window = window
    self.rpc = rpc
  }

  func setWindow(_ window: UIWindow?) {
    self.window = window
  }

  func start(authorizeURL: URL) {
    let handler: ASWebAuthenticationSession.CompletionHandler = { [weak self] callbackURL, error in
      Task { @MainActor in
        await self?.finish(callbackURL: callbackURL, error: error)
      }
    }
    let auth: ASWebAuthenticationSession
    if #available(iOS 17.4, *) {
      auth = ASWebAuthenticationSession(
        url: authorizeURL,
        callback: .https(host: NowiseeOrigin.host, path: "/oauth/callback"),
        completionHandler: handler
      )
    } else {
      auth = ASWebAuthenticationSession(
        url: authorizeURL,
        callbackURLScheme: "https",
        completionHandler: handler
      )
    }
    auth.presentationContextProvider = self
    auth.prefersEphemeralWebBrowserSession = false
    session = auth
    auth.start()
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    window ?? ASPresentationAnchor()
  }

  private func finish(callbackURL: URL?, error: Error?) async {
    session = nil
    if error != nil {
      return
    }
    guard let callbackURL, callbackURL.path.hasPrefix("/oauth/callback") else {
      return
    }
    do {
      let result = try await rpc.getWithoutRedirect(callbackURL)
      guard let location = result.location, !location.isEmpty else {
        return
      }
      onReturnPath?(location)
    } catch {
      print("OAuth callback GET failed \(error)")
    }
  }
}
