import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
struct StationLiveActivity: Widget {
  private let amber = Color(red: 0.96, green: 0.65, blue: 0.14)

  var body: some WidgetConfiguration {
    ActivityConfiguration(for: StationActivityAttributes.self) { context in
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Circle()
            .fill(context.state.needsYouCount > 0 ? amber : Color.white)
            .frame(width: 8, height: 8)
          Text(context.attributes.botName)
            .font(.headline)
          Spacer()
          if context.state.needsYouCount > 0 {
            Text("\(context.state.needsYouCount) needs you")
              .font(.caption.weight(.semibold))
              .foregroundStyle(amber)
          } else {
            Text(context.state.phase)
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        Text(context.state.detail.isEmpty ? context.attributes.taskTitle : context.state.detail)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
      .padding(14)
      .activityBackgroundTint(Color(red: 0.10, green: 0.10, blue: 0.11))
      .widgetURL(URL(string: "hermesbot://bot/\(context.attributes.profile)"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text(context.attributes.botName)
            .font(.headline)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.state.needsYouCount > 0 ? "\(context.state.needsYouCount) waiting" : context.state.phase)
            .font(.caption.weight(.semibold))
            .foregroundStyle(context.state.needsYouCount > 0 ? amber : .secondary)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.state.detail.isEmpty ? context.attributes.taskTitle : context.state.detail)
            .font(.subheadline)
            .lineLimit(2)
        }
      } compactLeading: {
        Circle()
          .fill(context.state.needsYouCount > 0 ? amber : Color.white)
          .frame(width: 8, height: 8)
      } compactTrailing: {
        Text(context.state.needsYouCount > 0 ? "\(context.state.needsYouCount)" : context.attributes.botName)
          .font(.caption2.weight(.semibold))
          .lineLimit(1)
      } minimal: {
        Circle()
          .fill(context.state.needsYouCount > 0 ? amber : Color.white)
          .frame(width: 8, height: 8)
      }
      .widgetURL(URL(string: "hermesbot://bot/\(context.attributes.profile)"))
    }
  }
}
