import ExpoModulesCore
import UIKit
import UserNotifications

public class ApnsPushModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ApnsPush")

    Events("onToken", "onAction", "onError")

    OnCreate {
      ApnsPushBridge.shared.onToken = { [weak self] token in
        self?.sendEvent("onToken", ["token": token])
      }
      ApnsPushBridge.shared.onAction = { [weak self] url in
        self?.sendEvent("onAction", ["url": url])
      }
      ApnsPushBridge.shared.onError = { [weak self] message in
        self?.sendEvent("onError", ["message": message])
      }
    }

    OnDestroy {
      ApnsPushBridge.shared.onToken = nil
      ApnsPushBridge.shared.onAction = nil
      ApnsPushBridge.shared.onError = nil
    }

    AsyncFunction("requestPermissionsAndRegister") { (promise: Promise) in
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
        if let error = error {
          promise.reject("APNS_PERM_ERROR", error.localizedDescription)
          return
        }
        if granted {
          DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
          }
        }
        promise.resolve(granted)
      }
    }

    Function("getToken") {
      return ApnsPushBridge.shared.currentToken()
    }

    Function("getEnvironment") {
      #if DEBUG
      return "sandbox"
      #else
      return "production"
      #endif
    }

    Function("consumePendingAction") {
      return ApnsPushBridge.shared.consumePendingAction()
    }
  }
}
