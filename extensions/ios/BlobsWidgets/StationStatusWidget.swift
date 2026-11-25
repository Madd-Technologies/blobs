import SwiftUI
import WidgetKit

private let appGroupId = "group.com.maddtechnologies.blobs"
private let snapshotKey = "station_snapshot"

struct StationSnapshot: Codable {
  struct BotItem: Codable, Hashable {
    let profile: String
    let name: String
    let state: String
  }

  struct NeedsYouItem: Codable, Hashable {
    let profile: String
    let name: String
    let summary: String
  }

  let needsYouCount: Int
  let activeCount: Int
  let fleetPaused: Bool
  let bots: [BotItem]
  let items: [NeedsYouItem]
  let updatedAt: Double

  static let placeholder = StationSnapshot(
    needsYouCount: 2,
    activeCount: 1,
    fleetPaused: false,
    bots: [
      BotItem(profile: "juniper", name: "Juniper", state: "needsYou"),
      BotItem(profile: "scout", name: "Scout", state: "working"),
    ],
    items: [
      NeedsYouItem(profile: "juniper", name: "Juniper", summary: "Approve deployment script"),
    ],
    updatedAt: 0
  )

  static func load() -> StationSnapshot? {
    guard let defaults = UserDefaults(suiteName: appGroupId),
          let raw = defaults.string(forKey: snapshotKey),
          let data = raw.data(using: .utf8) else {
      return nil
    }
    return try? JSONDecoder().decode(StationSnapshot.self, from: data)
  }
}

struct StationEntry: TimelineEntry {
  let date: Date
  let snapshot: StationSnapshot
}

struct StationProvider: TimelineProvider {
  func placeholder(in context: Context) -> StationEntry {
    StationEntry(date: Date(), snapshot: .placeholder)
  }

  func getSnapshot(in context: Context, completion: @escaping (StationEntry) -> Void) {
    completion(StationEntry(date: Date(), snapshot: StationSnapshot.load() ?? .placeholder))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<StationEntry>) -> Void) {
    let current = StationEntry(date: Date(), snapshot: StationSnapshot.load() ?? .placeholder)
    let refresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
    completion(Timeline(entries: [current], policy: .after(refresh)))
  }
}

struct StationStatusWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: StationEntry

  private let amber = Color(red: 0.96, green: 0.65, blue: 0.14)
  private let surface = Color(red: 0.11, green: 0.11, blue: 0.12)

  var body: some View {
    Group {
      if family == .systemSmall {
        smallBody
      } else {
        mediumBody
      }
    }
    .widgetURL(URL(string: "hermesbot://inbox"))
  }

  private var smallBody: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Circle()
          .fill(entry.snapshot.needsYouCount > 0 ? amber : Color.secondary.opacity(0.45))
          .frame(width: 8, height: 8)
        Text(entry.snapshot.fleetPaused ? "Paused" : "Base Station")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }

      Spacer(minLength: 2)

      Text("\(entry.snapshot.needsYouCount)")
        .font(.system(size: 36, weight: .bold, design: .rounded))
        .foregroundStyle(.primary)

      Text(entry.snapshot.needsYouCount == 1 ? "item needs you" : "items need you")
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)

      Text(entry.snapshot.activeCount > 0 ? "\(entry.snapshot.activeCount) bots active" : "All calm")
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(14)
    .background(surface)
  }

  private var mediumBody: some View {
    HStack(spacing: 14) {
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 6) {
          Circle()
            .fill(entry.snapshot.needsYouCount > 0 ? amber : Color.secondary.opacity(0.45))
            .frame(width: 8, height: 8)
          Text(entry.snapshot.fleetPaused ? "Fleet Paused" : "Needs You")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        Spacer(minLength: 2)
        Text("\(entry.snapshot.needsYouCount)")
          .font(.system(size: 34, weight: .bold, design: .rounded))
          .foregroundStyle(.primary)
        Text("\(entry.snapshot.activeCount) active")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      .frame(width: 96, alignment: .leading)

      VStack(alignment: .leading, spacing: 6) {
        if entry.snapshot.items.isEmpty {
          Text("All clear across your bots.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        } else {
          ForEach(entry.snapshot.items.prefix(3), id: \.self) { item in
            HStack(spacing: 6) {
              Circle()
                .fill(amber)
                .frame(width: 6, height: 6)
              Text(item.name)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.primary)
              Text(item.summary)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
          }
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(14)
    .background(surface)
  }
}

struct StationStatusWidget: Widget {
  let kind = "StationStatusWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: StationProvider()) { entry in
      if #available(iOS 17.0, *) {
        StationStatusWidgetView(entry: entry)
          .containerBackground(Color(red: 0.08, green: 0.08, blue: 0.09), for: .widget)
      } else {
        StationStatusWidgetView(entry: entry)
      }
    }
    .configurationDisplayName("Blobs Base Station")
    .description("Pending decisions and live status across your Hermes bots.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
