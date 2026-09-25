import ExpoModulesCore

internal final class BadFileUriException: Exception {
  override var reason: String { "Not a file:// URI" }
}

public class LogjamPdfRendererModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LogjamPdfRenderer")

    // Keep local data out of iCloud backup — the iOS half of Android's
    // allowBackup=false (mobile/CLAUDE.md privacy mandate). NSDocumentDirectory
    // is backed up by default, which would hand canyon names, coordinates,
    // notes and photos to Apple. The flag applies to everything under the
    // directory, so one call on the Documents root is the whole fix.
    //
    // Throws rather than reporting a success it didn't achieve: a silently
    // un-excluded Documents directory is exactly the failure this prevents.
    // (Android has no counterpart — the JS side never calls this there.)
    AsyncFunction("excludeFromBackup") { (fileUri: String) in
      guard var url = URL(string: fileUri), url.isFileURL else {
        throw BadFileUriException()
      }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
    }
  }
}
