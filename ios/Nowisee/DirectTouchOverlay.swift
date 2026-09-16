import UIKit

protocol DirectTouchOverlayDelegate: AnyObject {
  func overlayDidFire(_ intent: NavIntent)
  func overlayDidBecomeFocused()
}

/// Direct Touch layer. VoiceOver focuses this view and speaks `accessibilityLabel`.
/// Visible text is a separate non-accessible label so the overlay stays one element.
final class DirectTouchOverlay: UIView {
  weak var delegate: DirectTouchOverlayDelegate?

  private enum Axis {
    case horizontal
    case vertical
  }

  private var axis: Axis?
  private var scrolling = false
  private var fastScrolling = false
  private var lastTickY: CGFloat = 0
  private let decideDistance: CGFloat = 12
  private let horizontalCommitFraction: CGFloat = 0.08
  private let horizontalMinPoints: CGFloat = 36
  private let horizontalVsVertical: CGFloat = 0.4
  private let textView = UITextView()
  private var navigationEnabled = true

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .systemBackground
    isOpaque = true
    isAccessibilityElement = true
    accessibilityTraits.insert(.allowsDirectInteraction)
    accessibilityViewIsModal = true
    accessibilityLabel = "Now I See"

    textView.isEditable = false
    textView.isSelectable = false
    textView.isUserInteractionEnabled = false
    textView.isAccessibilityElement = false
    textView.backgroundColor = .clear
    textView.font = .preferredFont(forTextStyle: .body)
    textView.adjustsFontForContentSizeCategory = true
    textView.textContainerInset = UIEdgeInsets(top: 24, left: 16, bottom: 24, right: 16)
    textView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(textView)
    NSLayoutConstraint.activate([
      textView.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor),
      textView.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor),
      textView.leadingAnchor.constraint(equalTo: leadingAnchor),
      textView.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])

    let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
    pan.maximumNumberOfTouches = 1
    addGestureRecognizer(pan)

    let hold = UILongPressGestureRecognizer(target: self, action: #selector(handleHold(_:)))
    hold.minimumPressDuration = RecentsHold.duration
    hold.allowableMovement = RecentsHold.slop
    addGestureRecognizer(hold)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func setLabel(_ label: String) {
    textView.text = label
    accessibilityLabel = label
  }

  override func accessibilityElementDidBecomeFocused() {
    super.accessibilityElementDidBecomeFocused()
    delegate?.overlayDidBecomeFocused()
  }

  func setNavigationEnabled(_ enabled: Bool) {
    navigationEnabled = enabled
    isHidden = !enabled
    isUserInteractionEnabled = enabled
    if !enabled {
      setVoiceOverElement(false)
    }
  }

  func setVoiceOverElement(_ enabled: Bool) {
    isAccessibilityElement = enabled
    accessibilityViewIsModal = enabled
    if enabled {
      accessibilityTraits.insert(.allowsDirectInteraction)
    }
  }

  @objc private func handleHold(_ gesture: UILongPressGestureRecognizer) {
    guard navigationEnabled, gesture.state == .began else {
      return
    }
    fire(.recents)
  }

  @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
    guard navigationEnabled else {
      return
    }
    let translation = gesture.translation(in: self)
    let bounds = bounds
    guard bounds.height > 0, bounds.width > 0 else {
      return
    }

    switch gesture.state {
    case .began:
      axis = nil
      scrolling = false
      fastScrolling = false
      lastTickY = 0
      NavHaptics.prepare()
    case .changed:
      if scrolling {
        emitVerticalTicks(translationY: translation.y, height: bounds.height)
        return
      }
      if abs(translation.y) >= bounds.height * ScrubTicks.firstFraction {
        scrolling = true
        axis = .vertical
        lastTickY = translation.y
        fire(translation.y >= 0 ? .next : .prev)
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
      fastScrolling = false
      lastTickY = 0
    default:
      break
    }
  }

  private func emitVerticalTicks(translationY: CGFloat, height: CGFloat) {
    if !fastScrolling {
      let gap = height * ScrubTicks.secondGapFraction
      guard gap > 0, abs(translationY - lastTickY) >= gap else {
        return
      }
      let sign: CGFloat = translationY >= lastTickY ? 1 : -1
      lastTickY += sign * gap
      fire(sign > 0 ? .next : .prev)
      fastScrolling = true
    }
    let step = height * ScrubTicks.fastStepFraction
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
      fire(intent)
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
      fire(.enter)
    } else {
      fire(.back)
    }
  }

  private func fire(_ intent: NavIntent) {
    NavHaptics.tick()
    delegate?.overlayDidFire(intent)
  }
}
