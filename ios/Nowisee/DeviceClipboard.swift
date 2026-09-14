import UIKit

final class DeviceClipboard: ClipboardWriting {
  func writeText(_ text: String) throws {
    UIPasteboard.general.string = text
  }
}
