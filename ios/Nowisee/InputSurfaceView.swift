import UIKit

protocol InputSurfaceDelegate: AnyObject {
  func inputDidFire(_ intent: NavIntent)
}

/// Multiline or secret field plus Cancel / Done / Recent apps.
final class InputSurfaceView: UIView {
  weak var delegate: InputSurfaceDelegate?

  private var textView: UITextView?
  private var secretField: UITextField?
  private let actions = UIStackView()
  private let cancelButton = UIButton(type: .system)
  private let doneButton = UIButton(type: .system)
  private let recentsButton = UIButton(type: .system)

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .systemBackground
    isHidden = true

    actions.axis = .horizontal
    actions.spacing = 12
    actions.distribution = .fillEqually
    actions.translatesAutoresizingMaskIntoConstraints = false
    addSubview(actions)

    configure(cancelButton, title: "Cancel", action: #selector(cancelTapped))
    configure(doneButton, title: "Done", action: #selector(doneTapped))
    configure(recentsButton, title: "Recent apps", action: #selector(recentsTapped))
    actions.addArrangedSubview(cancelButton)
    actions.addArrangedSubview(doneButton)
    actions.addArrangedSubview(recentsButton)

    NSLayoutConstraint.activate([
      actions.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
      actions.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
      actions.bottomAnchor.constraint(equalTo: keyboardLayoutGuide.topAnchor, constant: -12),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func present(initialText: String, secret: Bool, autocomplete: InputAutocomplete?, accessibleName: String) {
    textView?.removeFromSuperview()
    secretField?.removeFromSuperview()
    textView = nil
    secretField = nil
    isHidden = false

    if secret {
      let field = UITextField()
      field.isSecureTextEntry = true
      field.text = initialText
      field.font = ShellFont.body()
      field.adjustsFontForContentSizeCategory = true
      field.borderStyle = .roundedRect
      field.autocapitalizationType = .none
      field.autocorrectionType = .no
      field.spellCheckingType = .no
      field.accessibilityLabel = accessibleName
      field.textContentType = textContentType(autocomplete, secret: true)
      field.translatesAutoresizingMaskIntoConstraints = false
      addSubview(field)
      NSLayoutConstraint.activate([
        field.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor, constant: 24),
        field.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
        field.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
        field.bottomAnchor.constraint(lessThanOrEqualTo: actions.topAnchor, constant: -16),
      ])
      secretField = field
      field.becomeFirstResponder()
    } else {
      let view = UITextView()
      view.text = initialText
      view.font = ShellFont.body()
      view.adjustsFontForContentSizeCategory = true
      view.autocapitalizationType = .none
      view.autocorrectionType = .no
      view.spellCheckingType = .no
      view.accessibilityLabel = accessibleName
      view.textContentType = textContentType(autocomplete, secret: false)
      view.backgroundColor = .secondarySystemBackground
      view.layer.cornerRadius = 8
      view.translatesAutoresizingMaskIntoConstraints = false
      addSubview(view)
      NSLayoutConstraint.activate([
        view.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor, constant: 24),
        view.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
        view.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
        view.bottomAnchor.constraint(equalTo: actions.topAnchor, constant: -16),
      ])
      textView = view
      view.becomeFirstResponder()
    }
  }

  func hide() {
    endEditing(true)
    textView?.removeFromSuperview()
    secretField?.removeFromSuperview()
    textView = nil
    secretField = nil
    isHidden = true
  }

  func inputText() -> String {
    if let secretField {
      return secretField.text ?? ""
    }
    return textView?.text ?? ""
  }

  func voiceOverTarget() -> UIView {
    secretField ?? textView ?? self
  }

  func focusField() {
    (secretField ?? textView)?.becomeFirstResponder()
  }

  private func configure(_ button: UIButton, title: String, action: Selector) {
    button.setTitle(title, for: .normal)
    button.titleLabel?.font = .preferredFont(forTextStyle: .body)
    button.titleLabel?.adjustsFontForContentSizeCategory = true
    button.addTarget(self, action: action, for: .touchUpInside)
  }

  @objc private func cancelTapped() {
    delegate?.inputDidFire(.back)
  }

  @objc private func doneTapped() {
    delegate?.inputDidFire(.enter)
  }

  @objc private func recentsTapped() {
    delegate?.inputDidFire(.recents)
  }

  private func textContentType(_ autocomplete: InputAutocomplete?, secret: Bool) -> UITextContentType? {
    switch autocomplete {
    case .username:
      return .username
    case .currentPassword:
      return .password
    case .newPassword:
      return .newPassword
    case .off, .none:
      return secret ? .password : nil
    }
  }
}
