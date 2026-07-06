import SwiftUI

@main
struct EduTerminalApp: App {
    @StateObject private var store = TerminalStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
    }
}
