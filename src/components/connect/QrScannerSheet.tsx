import { requireOptionalNativeModule } from 'expo-modules-core'
import type { BarcodeScanningResult } from 'expo-camera'
import { useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { Pill } from '@/components/ui/Pill'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import { parseConnectQr, type ParsedConnectQr } from '@/features/connect/qr'
import { haptic } from '@/lib/haptics'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

type CameraModule = typeof import('expo-camera')

interface Props {
  visible: boolean
  onClose: () => void
  onScanned: (parsed: ParsedConnectQr) => void
}

export function canScanQr(): boolean {
  return Platform.OS !== 'web' && !!requireOptionalNativeModule('ExpoCamera')
}

function ScannerBody({ onClose, onScanned }: Omit<Props, 'visible'>) {
  const { c } = useTheme()
  const [cameraMod, setCameraMod] = useState<CameraModule | null>(null)
  const [granted, setGranted] = useState<boolean | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const handled = useRef(false)

  useEffect(() => {
    let cancelled = false

    if (!canScanQr()) {
      Promise.resolve().then(() => {
        if (!cancelled) {
          setGranted(false)
        }
      })

      return () => {
        cancelled = true
      }
    }

    void import('expo-camera')
      .then(async mod => {
        if (cancelled) {
          return
        }

        setCameraMod(mod)
        const current = await mod.Camera.getCameraPermissionsAsync()
        const finalStatus = current.granted ? current : await mod.Camera.requestCameraPermissionsAsync()

        if (!cancelled) {
          setGranted(finalStatus.granted)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGranted(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  function handleBarcode(result: BarcodeScanningResult) {
    if (handled.current) {
      return
    }

    const parsed = parseConnectQr(result.data)

    if (!parsed) {
      setHint('Not a Hermes server QR code.')

      return
    }

    handled.current = true
    haptic('confirm')
    onScanned(parsed)
    onClose()
  }

  const CameraView = cameraMod?.CameraView

  return (
    <View style={styles.body}>
      <T variant="sheetTitle">Scan server QR</T>
      <T variant="secondary" color="text2">
        Point the camera at a Hermes server address or connect QR code.
      </T>

      {granted && CameraView ? (
        <View style={[styles.frame, { backgroundColor: c.canvas }]}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcode}
          />
          <View pointerEvents="none" style={[styles.reticle, { borderColor: c.primary }]} />
        </View>
      ) : (
        <View style={[styles.placeholder, { backgroundColor: c.tone }]}>
          <T variant="secondary" color="text2" style={styles.center}>
            {granted === null ? 'Starting camera…' : 'Camera access is needed to scan a QR code.'}
          </T>
        </View>
      )}

      {hint ? (
        <T variant="label" color="danger">
          {hint}
        </T>
      ) : null}

      <Pill label="Cancel" variant="secondary" height={48} onPress={onClose} />
    </View>
  )
}

export function QrScannerSheet({ visible, onClose, onScanned }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} label="Scan server QR code">
      {visible ? <ScannerBody onClose={onClose} onScanned={onScanned} /> : null}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: 12 },
  frame: { height: 240, borderRadius: radius.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  reticle: { width: 156, height: 156, borderRadius: radius.list, borderWidth: 2, opacity: 0.75 },
  placeholder: { height: 180, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  center: { textAlign: 'center' },
})
