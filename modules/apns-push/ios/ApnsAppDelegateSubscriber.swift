import ExpoModulesCore
import UIKit
import UserNotifications

final class ApnsPushBridge {
  static let shared = ApnsPushBridge()

  private let lock = NSLock()
  private var token: String?
  private var pendingAction: String?

  var onToken: ((String) -> Void)?
  var onAction: ((String) -> Void)?
  var onError: ((String) -> Void)?

  private init() {}

  func setToken(_ hex: String) {
    lock.lock()
    token = hex
    let callback = onToken
    lock.unlock()
    callback?(hex)
  }

  func currentToken() -> String? {
    lock.lock()
    defer { lock.unlock() }
    return token
  }

  func recordAction(_ url: String) {
    lock.lock()
    pendingAction = url
    let callback = onAction
    lock.unlock()
    callback?(url)
  }

  func consumePendingAction() -> String? {
    lock.lock()
    let next = pendingAction
    pendingAction = nil
    lock.unlock()
    return next
  }

  func notifyError(_ message: String) {
    lock.lock()
    let callback = onError
    lock.unlock()
    callback?(message)
  }
}

public class ApnsAppDelegateSubscriber: ExpoAppDelegateSubscriber, UNUserNotificationCenterDelegate {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let allowOnce = UNNotificationAction(identifier: "ALLOW_ONCE", title: "Allow once", options: [])
    let deny = UNNotificationAction(identifier: "DENY", title: "Deny", options: [.destructive])
    let category = UNNotificationCategory(
      identifier: "APPROVAL",
      actions: [allowOnce, deny],
      intentIdentifiers: [],
      options: []
    )
    let center = UNUserNotificationCenter.current()
    center.setNotificationCategories([category])
    center.delegate = self
    return true
  }

  public func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    ApnsPushBridge.shared.setToken(hex)
  }

  public func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    ApnsPushBridge.shared.notifyError(error.localizedDescription)
  }

  public func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if #available(iOS 14.0, *) {
      completionHandler([.banner, .sound])
    } else {
      completionHandler([.alert, .sound])
    }
  }

  public func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let info = response.notification.request.content.userInfo
    let targetUrl: String?

    if response.actionIdentifier == "ALLOW_ONCE" || response.actionIdentifier == "DENY",
       let approval = info["approval"] as? [AnyHashable: Any],
       let reqId = approval["id"] as? String {
      let choice = response.actionIdentifier == "ALLOW_ONCE" ? "once" : "deny"
      var components = URLComponents(string: "hermesbot://approve")
      var items = [
        URLQueryItem(name: "id", value: reqId),
        URLQueryItem(name: "choice", value: choice),
      ]
      if let profile = approval["profile"] as? String, !profile.isEmpty {
        items.append(URLQueryItem(name: "profile", value: profile))
      }
      if let kind = approval["kind"] as? String, !kind.isEmpty {
        items.append(URLQueryItem(name: "kind", value: kind))
      }
      components?.queryItems = items
      targetUrl = components?.url?.absoluteString
    } else {
      targetUrl = info["url"] as? String
    }

    if let urlString = targetUrl, let url = URL(string: urlString) {
      ApnsPushBridge.shared.recordAction(urlString)
      DispatchQueue.main.async {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
      }
    }

    completionHandler()
  }
}
