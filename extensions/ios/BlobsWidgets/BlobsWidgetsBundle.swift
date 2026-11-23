import SwiftUI
import WidgetKit

@main
struct BlobsWidgetsBundle: WidgetBundle {
  var body: some Widget {
    StationStatusWidget()
    if #available(iOS 16.2, *) {
      StationLiveActivity()
    }
  }
}
