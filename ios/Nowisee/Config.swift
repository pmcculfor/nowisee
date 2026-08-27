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
  static let firstFraction: CGFloat = 0.25
  static let stepFraction: CGFloat = 0.10

  /// First tick at 25% of overlay height, then one tick per additional 10%.
  static func count(distanceFraction: CGFloat) -> Int {
    let distance = abs(distanceFraction)
    if distance < firstFraction {
      return 0
    }
    return 1 + Int((distance - firstFraction) / stepFraction)
  }
}
