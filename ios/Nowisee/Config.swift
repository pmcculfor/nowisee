import Foundation
import UIKit

enum NowiseeOrigin {
  /// Production origin. Change this to a Mac LAN HTTPS URL only for local spikes.
  static let url = URL(string: "https://nowisee.app")!
  static var host: String { url.host ?? "nowisee.app" }
  static var originHeader: String {
    let root = url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return root
  }
}

enum ShellIds {
  static let rootAppId = "home"
  static let recentsAppId = "recents"
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

enum ShellFont {
  /// Overlay and input body text, relative to the default Dynamic Type body size.
  static let sizeMultiplier: CGFloat = 3

  static func body() -> UIFont {
    let defaultTraits = UITraitCollection(preferredContentSizeCategory: .large)
    let descriptor = UIFontDescriptor.preferredFontDescriptor(
      withTextStyle: .body,
      compatibleWith: defaultTraits
    )
    let base = UIFont(descriptor: descriptor, size: descriptor.pointSize * sizeMultiplier)
    return UIFontMetrics(forTextStyle: .body).scaledFont(for: base)
  }
}

enum NavHaptics {
  private static let generator = UIImpactFeedbackGenerator(style: .light)

  static func prepare() {
    generator.prepare()
  }

  static func tick() {
    generator.impactOccurred()
    generator.prepare()
  }
}

enum LoadFailure {
  static let label =
    "Something went wrong. Please check your network connection. Navigate right to try again. Navigate left to go back."
}

enum ExternalHandoffFailure {
  static let label =
    "Couldn't open the sign-in page. Navigate right to try again. Navigate left to go back."
}
