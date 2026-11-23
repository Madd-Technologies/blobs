import ActivityKit
import ExpoModulesCore
import Foundation
import WidgetKit

private let appGroupId = "group.com.maddtechnologies.blobs"
private let snapshotKey = "station_snapshot"

public class LiveStationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveStation")

    Function("isSupported") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    Function("updateWidgetSnapshot") { (json: String) in
      if let defaults = UserDefaults(suiteName: appGroupId) {
        defaults.set(json, forKey: snapshotKey)
        defaults.synchronize()
      }
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }

    AsyncFunction("startActivity") { (botName: String, profile: String, taskTitle: String, phase: String, needsYouCount: Int) -> String? in
      guard #available(iOS 16.2, *) else {
        return nil
      }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        return nil
      }

      let attributes = StationActivityAttributes(botName: botName, profile: profile, taskTitle: taskTitle)
      let state = StationActivityAttributes.ContentState(
        phase: phase,
        detail: taskTitle,
        needsYouCount: needsYouCount,
        updatedAt: Date().timeIntervalSince1970
      )
      let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(600))
      let activity = try Activity<StationActivityAttributes>.request(
        attributes: attributes,
        content: content,
        pushType: nil
      )
      return activity.id
    }

    AsyncFunction("updateActivity") { (activityId: String, phase: String, detail: String, needsYouCount: Int) in
      guard #available(iOS 16.2, *) else {
        return
      }
      guard let activity = Activity<StationActivityAttributes>.activities.first(where: { $0.id == activityId }) else {
        return
      }
      let state = StationActivityAttributes.ContentState(
        phase: phase,
        detail: detail,
        needsYouCount: needsYouCount,
        updatedAt: Date().timeIntervalSince1970
      )
      await activity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(600)))
    }

    AsyncFunction("endActivity") { (activityId: String) in
      guard #available(iOS 16.2, *) else {
        return
      }
      guard let activity = Activity<StationActivityAttributes>.activities.first(where: { $0.id == activityId }) else {
        return
      }
      await activity.end(nil, dismissalPolicy: .default)
    }
  }
}
