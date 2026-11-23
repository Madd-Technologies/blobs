import ExpoModulesCore
import Foundation
import UIKit

private let appGroupId = "group.com.maddtechnologies.blobs"
private let pendingKey = "pending_share"

public class ShareInboxModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ShareInbox")

    Events("onShared")

    OnCreate {
      self.observer = NotificationCenter.default.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        if let payload = self?.peekPending(clear: false) {
          self?.sendEvent("onShared", payload)
        }
      }
    }

    OnDestroy {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
        self.observer = nil
      }
    }

    Function("consumePending") { () -> [String: Any]? in
      return self.peekPending(clear: true)
    }
  }

  private func peekPending(clear: Bool) -> [String: Any]? {
    guard let defaults = UserDefaults(suiteName: appGroupId),
          let raw = defaults.data(forKey: pendingKey) ?? defaults.string(forKey: pendingKey)?.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else {
      return nil
    }

    if clear {
      defaults.removeObject(forKey: pendingKey)
      defaults.synchronize()
    }

    var out: [String: Any] = [:]
    if let text = obj["text"] as? String, !text.isEmpty {
      out["text"] = text
    }
    if let url = obj["url"] as? String, !url.isEmpty {
      out["url"] = url
    }

    let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)
    let rawFiles = obj["files"] as? [[String: Any]] ?? []
    let resolvedFiles: [[String: Any]] = rawFiles.compactMap { entry in
      guard let rawPath = entry["path"] as? String ?? entry["uri"] as? String else { return nil }
      let fileUrl: URL
      if rawPath.hasPrefix("file://"), let parsed = URL(string: rawPath) {
        fileUrl = parsed
      } else if let container = container, !rawPath.hasPrefix("/") {
        fileUrl = container.appendingPathComponent(rawPath)
      } else {
        fileUrl = URL(fileURLWithPath: rawPath)
      }
      return [
        "uri": fileUrl.absoluteString,
        "name": (entry["name"] as? String) ?? fileUrl.lastPathComponent,
        "mime": (entry["mime"] as? String) ?? "application/octet-stream",
      ]
    }
    out["files"] = resolvedFiles
    return out
  }
}
