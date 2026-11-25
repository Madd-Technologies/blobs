import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

interface LiveStationNative {
  isSupported(): boolean
  updateWidgetSnapshot(json: string): void
  startActivity(botName: string, profile: string, taskTitle: string, phase: string, needsYouCount: number): Promise<string | null>
  updateActivity(activityId: StringOrEmpty, phase: string, detail: string, needsYouCount: number): Promise<void>
  endActivity(activityId: string): Promise<void>
}

type StringOrEmpty = string

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<LiveStationNative>('LiveStation') : null

export function loadLiveStation(): LiveStationNative | null {
  return native
}
