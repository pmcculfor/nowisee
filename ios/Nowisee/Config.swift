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
  case recents
}

enum RecentsHold {
  /// One second so a pause while choosing a swipe direction does not open Recents.
  static let duration: TimeInterval = 1
  /// Fail the hold if the finger moves this far — that is a swipe starting.
  static let slop: CGFloat = 20
}

enum ScrubTicks {
  /// First prev/next tick, as a fraction of overlay height.
  static let firstFraction: CGFloat = 0.08
  /// Extra travel after the first tick before faster scrubbing.
  static let secondGapFraction: CGFloat = 0.08
  /// After the second tick, each further 4% of height (either direction) is one tick.
  static let fastStepFraction: CGFloat = 0.04
}
