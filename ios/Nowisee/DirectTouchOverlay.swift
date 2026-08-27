import UIKit

protocol DirectTouchOverlayDelegate: AnyObject {
  func overlayDidFire(_ intent: NavIntent)
}

/// Transparent Direct Touch layer. VoiceOver reads `accessibilityLabel`; swipes
/// become intents. Hidden on input nodes so the WKWebView form is reachable.
final class DirectTouchOverlay: UIView {
  weak var delegate: DirectTouchOverlayDelegate?

  private enum Axis {
    case horizontal
    case vertical
  }

  private var axis: Axis?
  private var ticksFired = 0
  private var verticalSign: CGFloat = 0
  private let lockDistance: CGFloat = 24
  private let horizontalCommitFraction: CGFloat = 0.15

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isOpaque = false
    isAccessibilityElement = true
    accessibilityTraits.insert(.allowsDirectInteraction)
    accessibilityLabel = "Nowisee"

    let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
    pan.maximumNumberOfTouches = 1
    addGestureRecognizer(pan)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func setNavigationEnabled(_ enabled: Bool) {
    isHidden = !enabled
    isUserInteractionEnabled = enabled
    isAccessibilityElement = enabled
  }

  @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
    let translation = gesture.translation(in: self)
    let bounds = bounds
    guard bounds.height > 0, bounds.width > 0 else {
      return
    }

    switch gesture.state {
    case .began:
      axis = nil
      ticksFired = 0
      verticalSign = 0
    case .changed:
      if axis == nil {
        if hypot(translation.x, translation.y) < lockDistance {
          return
        }
        axis = abs(translation.y) >= abs(translation.x) ? .vertical : .horizontal
      }
      guard axis == .vertical else {
        return
      }
      let sign: CGFloat = translation.y >= 0 ? 1 : -1
      if sign != verticalSign {
        verticalSign = sign
        ticksFired = 0
      }
      let ticks = ScrubTicks.count(distanceFraction: translation.y / bounds.height)
      while ticksFired < ticks {
        ticksFired += 1
        delegate?.overlayDidFire(sign > 0 ? .next : .prev)
      }
    case .ended, .cancelled:
      if axis == .horizontal {
        let threshold = max(bounds.width * horizontalCommitFraction, 60)
        if translation.x >= threshold {
          delegate?.overlayDidFire(.enter)
        } else if translation.x <= -threshold {
          delegate?.overlayDidFire(.back)
        }
      }
      axis = nil
      ticksFired = 0
      verticalSign = 0
    default:
      break
    }
  }
}
