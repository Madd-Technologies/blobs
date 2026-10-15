import { View } from 'react-native'

import { Pill } from './Pill'
import { Sheet } from './Sheet'
import { T } from './T'

interface Props {
  visible: boolean
  title: string
  message?: string
  confirmLabel: string
  /** Red confirm for destructive actions. */
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** "Are you sure?" as a bottom sheet: the question, one confirming pill, and Cancel. */
export function ConfirmSheet({ visible, title, message, confirmLabel, destructive, onConfirm, onClose }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} label={title}>
      <View style={{ gap: 6, paddingTop: 4, paddingBottom: 16 }}>
        <T variant="sheetTitle">{title}</T>
        {message ? (
          <T variant="secondary" color="text2">
            {message}
          </T>
        ) : null}
      </View>
      <View style={{ gap: 8 }}>
        <Pill
          label={confirmLabel}
          variant={destructive ? 'destructive' : 'primary'}
          height={52}
          onPress={() => {
            onClose()
            onConfirm()
          }}
        />
        <Pill label="Cancel" variant="ghost" height={42} onPress={onClose} />
      </View>
    </Sheet>
  )
}
