import ActivityKit
import Foundation

@available(iOS 16.1, *)
public struct StationActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var phase: String
    public var detail: String
    public var needsYouCount: Int
    public var updatedAt: Double

    public init(phase: String, detail: String, needsYouCount: Int, updatedAt: Double) {
      self.phase = phase
      self.detail = detail
      self.needsYouCount = needsYouCount
      self.updatedAt = updatedAt
    }
  }

  public var botName: String
  public var profile: String
  public var taskTitle: String

  public init(botName: String, profile: String, taskTitle: String) {
    self.botName = botName
    self.profile = profile
    self.taskTitle = taskTitle
  }
}
