import AVFoundation
import ExpoModulesCore
import UIKit

public class DuplexAudioModule: Module {
  private var callAudio: IosCallAudio?

  public func definition() -> ModuleDefinition {
    Name("DuplexAudio")

    Events("onFrame", "onError")

    AsyncFunction("start") {
      try self.startCall()
    }

    Function("play") { (pcm: String) in
      self.callAudio?.play(pcm: pcm)
    }

    Function("flush") {
      self.callAudio?.flush()
    }

    Function("setSpeaker") { (on: Bool) in
      self.callAudio?.setSpeaker(on: on)
    }

    AsyncFunction("stop") {
      self.stopCall()
    }

    OnDestroy {
      self.stopCall()
    }
  }

  private func startCall() throws {
    let status = AVAudioSession.sharedInstance().recordPermission
    if status == .denied {
      throw NSError(
        domain: "DuplexAudio",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Blobs needs the microphone for calls. Allow it in Settings."]
      )
    }

    callAudio?.stop()
    let audio = IosCallAudio(
      onFrame: { [weak self] pcm, level, out in
        self?.sendEvent("onFrame", ["pcm": pcm, "level": level, "out": out])
      },
      onError: { [weak self] message in
        self?.sendEvent("onError", ["message": message])
      }
    )
    try audio.start()
    callAudio = audio
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = true
    }
  }

  private func stopCall() {
    callAudio?.stop()
    callAudio = nil
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = false
    }
  }
}

private let targetRate: Double = 24_000
private let frameSamples = 2_400
private let frameBytes = frameSamples * 2

private final class IosCallAudio {
  private let onFrame: (String, Double, Double) -> Void
  private let onError: (String) -> Void
  private let lock = NSLock()
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()

  private var converter: AVAudioConverter?
  private var accumulated = Data()
  private var running = false
  private var outLevel: Double = 0
  private var generation: Int = 0

  private lazy var pcm24Int16 = AVAudioFormat(
    commonFormat: .pcmFormatInt16,
    sampleRate: targetRate,
    channels: 1,
    interleaved: true
  )!

  private lazy var pcm24Float32 = AVAudioFormat(
    commonFormat: .pcmFormatFloat32,
    sampleRate: targetRate,
    channels: 1,
    interleaved: false
  )!

  init(onFrame: @escaping (String, Double, Double) -> Void, onError: @escaping (String) -> Void) {
    self.onFrame = onFrame
    self.onError = onError
  }

  func start() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
    try session.setPreferredSampleRate(targetRate)
    try session.setPreferredIOBufferDuration(0.02)
    try session.setActive(true)

    let input = engine.inputNode
    try? input.setVoiceProcessingEnabled(true)

    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: pcm24Float32)

    let inputFormat = input.outputFormat(forBus: 0)
    guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
      throw NSError(
        domain: "DuplexAudio",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "The microphone is busy or unavailable."]
      )
    }

    guard let audioConverter = AVAudioConverter(from: inputFormat, to: pcm24Int16) else {
      throw NSError(
        domain: "DuplexAudio",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Could not configure 24 kHz voice converter."]
      )
    }
    converter = audioConverter

    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 2400, format: inputFormat) { [weak self] buffer, _ in
      self?.handleInput(buffer: buffer)
    }

    engine.prepare()
    try engine.start()
    player.play()
    running = true
    setSpeaker(on: true)
  }

  func play(pcm: String) {
    guard running, let data = Data(base64Encoded: pcm), !data.isEmpty else {
      return
    }

    let sampleCount = data.count / 2
    guard sampleCount > 0, let floatBuffer = AVAudioPCMBuffer(pcmFormat: pcm24Float32, frameCapacity: AVAudioFrameCount(sampleCount)) else {
      return
    }
    floatBuffer.frameLength = AVAudioFrameCount(sampleCount)

    guard let channel = floatBuffer.floatChannelData?[0] else {
      return
    }

    var sum = 0.0
    data.withUnsafeBytes { raw in
      let samples = raw.bindMemory(to: Int16.self)
      for i in 0..<sampleCount {
        let normalized = Double(samples[i]) / 32768.0
        channel[i] = Float(normalized)
        sum += normalized * normalized
      }
    }

    let level = sampleCount == 0 ? 0.0 : min(1.0, sqrt(sqrt(sum / Double(sampleCount))) * 1.4)
    lock.lock()
    let currentGen = generation
    outLevel = level
    lock.unlock()

    player.scheduleBuffer(floatBuffer) { [weak self] in
      guard let self = self else { return }
      self.lock.lock()
      if self.generation == currentGen {
        self.outLevel = 0.0
      }
      self.lock.unlock()
    }
  }

  func flush() {
    lock.lock()
    generation += 1
    outLevel = 0.0
    lock.unlock()

    player.stop()
    if running {
      player.play()
    }
  }

  func setSpeaker(on: Bool) {
    let session = AVAudioSession.sharedInstance()
    try? session.overrideOutputAudioPort(on ? .speaker : .none)
  }

  func stop() {
    lock.lock()
    let wasRunning = running
    running = false
    accumulated.removeAll(keepingCapacity: false)
    outLevel = 0.0
    generation += 1
    lock.unlock()

    guard wasRunning else {
      return
    }

    engine.inputNode.removeTap(onBus: 0)
    player.stop()
    engine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func handleInput(buffer: AVAudioPCMBuffer) {
    guard running, let converter = converter else { return }

    let ratio = targetRate / buffer.format.sampleRate
    let capacity = max(256, AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64)
    guard let converted = AVAudioPCMBuffer(pcmFormat: pcm24Int16, frameCapacity: capacity) else { return }

    var consumed = false
    var error: NSError?
    let status = converter.convert(to: converted, error: &error) { _, outStatus in
      if consumed {
        outStatus.pointee = .noDataNow
        return nil
      }
      consumed = true
      outStatus.pointee = .haveData
      return buffer
    }

    if status == .error || error != nil {
      onError("Microphone conversion failed.")
      return
    }

    let count = Int(converted.frameLength)
    guard count > 0, let int16Ptr = converted.int16ChannelData?[0] else { return }
    let chunk = Data(bytes: int16Ptr, count: count * 2)

    var readyFrames: [(Data, Double, Double)] = []
    lock.lock()
    accumulated.append(chunk)
    let currentOut = outLevel
    while accumulated.count >= frameBytes {
      let frame = accumulated.prefix(frameBytes)
      accumulated.removeFirst(frameBytes)
      readyFrames.append((Data(frame), Self.pcmLevel(frame), currentOut))
    }
    lock.unlock()

    for (frame, level, out) in readyFrames {
      onFrame(frame.base64EncodedString(), level, out)
    }
  }

  private static func pcmLevel(_ data: Data) -> Double {
    let count = data.count / 2
    guard count > 0 else { return 0.0 }
    var sum = 0.0
    data.withUnsafeBytes { raw in
      let samples = raw.bindMemory(to: Int16.self)
      for i in 0..<count {
        let sample = Double(samples[i]) / 32768.0
        sum += sample * sample
      }
    }
    return min(1.0, sqrt(sqrt(sum / Double(count))) * 1.4)
  }
}
