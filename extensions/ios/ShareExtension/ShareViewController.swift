import Foundation
import Social
import UIKit
import UniformTypeIdentifiers

private let appGroupId = "group.com.maddtechnologies.blobs"
private let pendingKey = "pending_share"

final class ShareViewController: UIViewController {
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    extractAndHandoff()
  }

  private func extractAndHandoff() {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
      finish()
      return
    }

    let group = DispatchGroup()
    let lock = NSLock()
    var sharedText: String?
    var sharedUrl: String?
    var sharedFiles: [[String: String]] = []

    let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)
    let inboxDir = container?.appendingPathComponent("SharedInbox", isDirectory: true)
    if let dir = inboxDir {
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    for item in items {
      if let text = item.attributedContentText?.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        lock.lock()
        if sharedText == nil { sharedText = text }
        lock.unlock()
      }

      for provider in item.attachments ?? [] {
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
          group.enter()
          provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
            defer { group.leave() }
            if let url = data as? URL {
              lock.lock()
              if url.isFileURL, let copied = Self.copyFile(url, to: inboxDir, mime: "application/octet-stream") {
                sharedFiles.append(copied)
              } else if sharedUrl == nil {
                sharedUrl = url.absoluteString
              }
              lock.unlock()
            }
          }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
          group.enter()
          provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
            defer { group.leave() }
            if let str = data as? String, !str.isEmpty {
              lock.lock()
              if sharedText == nil { sharedText = str }
              lock.unlock()
            }
          }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
          group.enter()
          provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
            defer { group.leave() }
            guard let url = url, let copied = Self.copyFile(url, to: inboxDir, mime: "image/jpeg") else { return }
            lock.lock()
            sharedFiles.append(copied)
            lock.unlock()
          }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
          group.enter()
          provider.loadFileRepresentation(forTypeIdentifier: UTType.data.identifier) { url, _ in
            defer { group.leave() }
            guard let url = url, let copied = Self.copyFile(url, to: inboxDir, mime: "application/octet-stream") else { return }
            lock.lock()
            sharedFiles.append(copied)
            lock.unlock()
          }
        }
      }
    }

    group.notify(queue: .main) {
      var payload: [String: Any] = ["files": sharedFiles]
      if let text = sharedText { payload["text"] = text }
      if let url = sharedUrl { payload["url"] = url }

      if let defaults = UserDefaults(suiteName: appGroupId),
         let jsonData = try? JSONSerialization.data(withJSONObject: payload) {
        defaults.set(jsonData, forKey: pendingKey)
        defaults.synchronize()
      }

      if let hostUrl = URL(string: "hermesbot://share") {
        self.openHostApp(hostUrl)
      }
      self.finish()
    }
  }

  private static func copyFile(_ source: URL, to dir: URL?, mime: String) -> [String: String]? {
    guard let dir = dir else { return nil }
    let fileName = source.lastPathComponent.isEmpty ? "shared-item" : source.lastPathComponent
    let destName = "\(UUID().uuidString)-\(fileName)"
    let dest = dir.appendingPathComponent(destName)
    do {
      if FileManager.default.fileExists(atPath: dest.path) {
        try FileManager.default.removeItem(at: dest)
      }
      try FileManager.default.copyItem(at: source, to: dest)
      return [
        "path": "SharedInbox/\(destName)",
        "name": fileName,
        "mime": mime,
      ]
    } catch {
      return nil
    }
  }

  private func openHostApp(_ url: URL) {
    var responder: UIResponder? = self
    let selector = NSSelectorFromString("openURL:")
    while let current = responder {
      if current.responds(to: selector) {
        current.perform(selector, with: url)
        break
      }
      responder = current.next
    }
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}
