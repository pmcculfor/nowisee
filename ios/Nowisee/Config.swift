import UIKit

enum NowiseeOrigin {
  /// Production site. Change this to a Mac LAN URL only for local spikes.
  static let url = URL(string: "https://nowisee.app")!
  static var host: String { url.host ?? "nowisee.app" }
}

enum NavIntent: String {
  case prev
  case next
  case enter
  case back
}

enum ScrubTicks {
  /// First prev/next tick, as a fraction of overlay height.
  static let firstFraction: CGFloat = 0.12
  /// After the first tick, each further 5% of height (either direction) is one tick.
  static let stepFraction: CGFloat = 0.05
}
