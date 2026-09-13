import Foundation

enum PathRouter {
  static let hostPathSegments: Set<String> = ["api", "oauth", "admin", "assets"]

  static func isCanonicalPath(_ path: String) -> Bool {
    path.hasPrefix("/")
  }

  static func isHostPathSegment(_ id: String) -> Bool {
    hostPathSegments.contains(id)
  }

  static func isAppId(_ id: String) -> Bool {
    guard let regex = try? NSRegularExpression(pattern: "^[a-z][a-z0-9-]*$") else {
      return false
    }
    let range = NSRange(id.startIndex..<id.endIndex, in: id)
    let match = regex.firstMatch(in: id, range: range)
    return match != nil && match?.range.length == id.utf16.count && !isHostPathSegment(id)
  }

  static func parse(_ href: String, rootAppId: String) -> AppLocation {
    let pathname = extractPath(href)
    if pathname == "/" {
      return AppLocation(appId: rootAppId, path: "/")
    }
    let rest = String(pathname.dropFirst())
    let slash = rest.firstIndex(of: "/")
    let appId = slash.map { String(rest[..<$0]) } ?? rest
    let pathRaw = slash.map { String(rest[$0...]) } ?? "/"
    let path = pathFromHref(pathRaw)
    if appId == rootAppId && path == "/" {
      return AppLocation(appId: rootAppId, path: "/")
    }
    if !isAppId(appId) {
      return AppLocation(appId: rootAppId, path: "/")
    }
    return AppLocation(appId: appId, path: path)
  }

  static func hrefFor(_ location: AppLocation, rootAppId: String) -> String {
    precondition(isCanonicalPath(location.path), "path must start with /")
    if location.appId == rootAppId && location.path == "/" {
      return "/"
    }
    if location.path == "/" {
      return "/\(location.appId)"
    }
    return "/\(location.appId)\(location.path)"
  }

  private static func extractPath(_ href: String) -> String {
    let trimmed = href.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return "/"
    }
    if let url = URL(string: trimmed), url.scheme != nil {
      let pathname = url.path
      return pathname.isEmpty ? "/" : pathname
    }
    let beforeQuery = trimmed.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
    let beforeHash = beforeQuery.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
    if beforeHash.hasPrefix("/") {
      return beforeHash
    }
    return "/"
  }

  private static func pathFromHref(_ pathRaw: String) -> String {
    if pathRaw.isEmpty || pathRaw == "/" {
      return "/"
    }
    let withSlash = pathRaw.hasPrefix("/") ? pathRaw : "/\(pathRaw)"
    return withSlash.replacingOccurrences(of: "^/+", with: "/", options: .regularExpression)
  }
}
