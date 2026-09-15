import Foundation

protocol AppRpcing: AnyObject {
  func open(appId: String, path: String, extras: RefreshExtras) async throws -> RefreshResult
  func refresh(appId: String, nodeId: String, extras: RefreshExtras) async throws -> RefreshResult
  func getWithoutRedirect(_ url: URL) async throws -> (status: Int, location: String?)
}

enum AppRpcError: Error {
  case badStatus(Int)
  case malformed
  case cancelled
  case transport(Error)
}

/// Same-origin POST /api/apps/:id/open|refresh with cookie jar + Origin CSRF.
final class AppRpc: AppRpcing {
  private let originHeader: String
  private let redirects: GetRedirectBlocker
  private let session: URLSession

  init(origin: URL = NowiseeOrigin.url, urlSession: URLSession? = nil) {
    let trimmed = origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    self.originHeader = trimmed
    let blocker = GetRedirectBlocker()
    self.redirects = blocker
    if let urlSession {
      self.session = urlSession
    } else {
      let config = URLSessionConfiguration.default
      config.httpCookieAcceptPolicy = .always
      config.httpShouldSetCookies = true
      config.httpCookieStorage = HTTPCookieStorage.shared
      self.session = URLSession(configuration: config, delegate: blocker, delegateQueue: nil)
    }
  }

  func open(appId: String, path: String, extras: RefreshExtras) async throws -> RefreshResult {
    try await post(appId: appId, kind: "open", body: RefreshDecoding.wireBody(path: path, extras: extras))
  }

  func refresh(appId: String, nodeId: String, extras: RefreshExtras) async throws -> RefreshResult {
    try await post(
      appId: appId,
      kind: "refresh",
      body: RefreshDecoding.wireBody(nodeId: nodeId, extras: extras)
    )
  }

  /// GET used for OAuth callback. Does not follow redirects so Location stays ours.
  func getWithoutRedirect(_ url: URL) async throws -> (status: Int, location: String?) {
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    let (_, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw AppRpcError.malformed
    }
    return (http.statusCode, http.value(forHTTPHeaderField: "Location"))
  }

  private func post(appId: String, kind: String, body: [String: Any]) async throws -> RefreshResult {
    try Task.checkCancellation()
    let encodedId = appId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? appId
    guard let built = URL(string: "\(originHeader)/api/apps/\(encodedId)/\(kind)") else {
      throw AppRpcError.malformed
    }
    var request = URLRequest(url: built)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(originHeader, forHTTPHeaderField: "Origin")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    do {
      let (data, response) = try await session.data(for: request)
      try Task.checkCancellation()
      guard let http = response as? HTTPURLResponse else {
        throw AppRpcError.malformed
      }
      guard (200..<300).contains(http.statusCode) else {
        throw AppRpcError.badStatus(http.statusCode)
      }
      let json = try JSONSerialization.jsonObject(with: data)
      guard let result = RefreshDecoding.result(from: json) else {
        throw AppRpcError.malformed
      }
      return result
    } catch is CancellationError {
      throw AppRpcError.cancelled
    } catch let err as AppRpcError {
      throw err
    } catch {
      throw AppRpcError.transport(error)
    }
  }
}

private final class GetRedirectBlocker: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    if task.originalRequest?.httpMethod == "GET" {
      completionHandler(nil)
      return
    }
    completionHandler(request)
  }
}
