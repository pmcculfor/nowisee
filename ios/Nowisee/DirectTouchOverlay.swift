import UIKit

protocol DirectTouchOverlayDelegate: AnyObject {
  func overlayDidFire(_ intent: NavIntent)
}

/// Transparent Direct Touch layer. VoiceOver focuses this view (not the page)
/// and speaks `accessibilityLabel`. Hidden on input so the WKWebView form is reachable.
final class DirectTouchOverlay: UIView {
  weak var delegate: DirectTouchOverlayDelegate?

  private enum Axis {
    case horizontal
    case vertical
  }

  private var axis: Axis?
  private var scrolling = false
  private var lastTickY: CGFloat = 0
  private let decideDistance: CGFloat = 12
  private let horizontalCommitFraction: CGFloat = 0.08
  private let horizontalMinPoints: CGFloat = 36
  /// Allow quite diagonal enter/back: horizontal need only beat 40% of vertical.
  private let horizontalVsVertical: CGFloat = 0.4

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isOpaque = false
    isAccessibilityElement = true
    accessibilityTraits.insert(.allowsDirectInteraction)
    accessibilityViewIsModal = true
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
    accessibilityViewIsModal = enabled
    if enabled {
      accessibilityTraits.insert(.allowsDirectInteraction)
    }
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
      scrolling = false
      lastTickY = 0
    case .changed:
      if scrolling {
        emitVerticalTicks(translationY: translation.y, height: bounds.height)
        return
      }
      if abs(translation.y) >= bounds.height * ScrubTicks.firstFraction {
        scrolling = true
        axis = .vertical
        lastTickY = translation.y
        delegate?.overlayDidFire(translation.y >= 0 ? .next : .prev)
        return
      }
      if axis == nil, hypot(translation.x, translation.y) >= decideDistance {
        if abs(translation.x) >= abs(translation.y) * horizontalVsVertical {
          axis = .horizontal
        }
      }
    case .ended, .cancelled:
      if !scrolling {
        commitHorizontalIfNeeded(translation: translation, width: bounds.width)
      }
      axis = nil
      scrolling = false
      lastTickY = 0
    default:
      break
    }
  }

  private func emitVerticalTicks(translationY: CGFloat, height: CGFloat) {
    let step = height * ScrubTicks.stepFraction
    guard step > 0 else {
      return
    }
    let delta = translationY - lastTickY
    let steps = Int(delta / step)
    guard steps != 0 else {
      return
    }
    lastTickY += CGFloat(steps) * step
    let intent: NavIntent = steps > 0 ? .next : .prev
    for _ in 0..<abs(steps) {
      delegate?.overlayDidFire(intent)
    }
  }

  private func commitHorizontalIfNeeded(translation: CGPoint, width: CGFloat) {
    let threshold = max(width * horizontalCommitFraction, horizontalMinPoints)
    let horizontalEnough = abs(translation.x) >= threshold
    let notMostlyVertical = abs(translation.x) >= abs(translation.y) * horizontalVsVertical
    let treatAsHorizontal = axis == .horizontal || (axis == nil && horizontalEnough && notMostlyVertical)
    guard treatAsHorizontal, horizontalEnough else {
      return
    }
    if translation.x > 0 {
      delegate?.overlayDidFire(.enter)
    } else {
      delegate?.overlayDidFire(.back)
    }
  }
}
