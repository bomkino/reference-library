import SwiftUI

@main
struct ReferenceLibraryApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup("Reference Library") {
            WorkspaceWebViewRepresentable(model: model)
                .frame(minWidth: 760, minHeight: 560)
                .task { await model.start() }
        }
        .defaultSize(width: 1_440, height: 920)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
