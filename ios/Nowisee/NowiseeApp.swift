import SwiftUI

@main
struct NowiseeApp: App {
  var body: some Scene {
    WindowGroup {
      NativeShellView()
        .ignoresSafeArea()
        .onOpenURL { url in
          NotificationCenter.default.post(name: .nowiseeOpenURL, object: url)
        }
    }
  }
}

private struct NativeShellView: UIViewControllerRepresentable {
  func makeUIViewController(context: Context) -> RootViewController {
    RootViewController()
  }

  func updateUIViewController(_ uiViewController: RootViewController, context: Context) {}
}
