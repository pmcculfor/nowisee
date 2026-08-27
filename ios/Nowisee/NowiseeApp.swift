import SwiftUI

@main
struct NowiseeApp: App {
  var body: some Scene {
    WindowGroup {
      WebShellView()
        .ignoresSafeArea()
    }
  }
}

private struct WebShellView: UIViewControllerRepresentable {
  func makeUIViewController(context: Context) -> RootViewController {
    RootViewController()
  }

  func updateUIViewController(_ uiViewController: RootViewController, context: Context) {}
}
