import XCTest
@testable import NowiseeCore

final class NavigatorFixtureTests: XCTestCase {
  func testSharedNavigatorFixtures() async throws {
    let files = try listNavigatorFixtureURLs()
    XCTAssertFalse(files.isEmpty, "expected JSON fixtures in tests/fixtures/navigator")
    var failures: [String] = []
    for url in files {
      do {
        let fixture = try loadNavigatorFixture(url: url)
        try await runOnMain(fixture)
      } catch {
        failures.append("\(url.lastPathComponent): \(error)")
      }
    }
    XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
  }

  func testGeometryCatalogStillPresent() throws {
    let url = fixtureDirectory()
      .deletingLastPathComponent()
      .appendingPathComponent("navigation-geometry.json")
    let data = try Data(contentsOf: url)
    let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    let behaviors = raw?["stackBehaviors"] as? [String]
    XCTAssertEqual(
      behaviors,
      ["push", "replace", "pop", "stay", "pushTransient", "popTransient"]
    )
  }

  @MainActor
  private func runOnMain(_ fixture: NavigatorFixtureFile) async throws {
    try await runNavigatorFixture(fixture)
  }
}
