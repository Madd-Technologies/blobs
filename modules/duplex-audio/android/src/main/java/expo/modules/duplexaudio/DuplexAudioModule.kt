package expo.modules.duplexaudio

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.util.Base64
import android.view.WindowManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Call audio for a voice call with a bot: the microphone and the speaker at once, PCM16 mono at 24 kHz both ways.
 *
 * The microphone is Android's voice-call source with the platform echo canceller and noise suppressor, and playback is a
 * voice-call stream on the same audio session, so the canceller hears what the bot says and keeps it out of the microphone.
 * Microphone frames (100 ms) go to JS as `onFrame` with two levels for the call screen: yours (`level`) and the voice's as it
 * plays (`out`). JS feeds the bot's audio back with `play`, and `flush` drops what is still queued when the person starts
 * talking. The screen stays on for the call.
 */
class DuplexAudioModule : Module() {
  private var call: CallAudio? = null

  override fun definition() = ModuleDefinition {
    Name("DuplexAudio")

    Events("onFrame", "onError")

    AsyncFunction("start") {
      val context = appContext.reactContext ?: throw CallAudioException("The app is not ready.")

      if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        throw CallAudioException("Blobs needs the microphone for calls. Allow it in Settings.")
      }

      call?.stop()
      val audio = CallAudio(
        context,
        onFrame = { pcm, level, out -> sendEvent("onFrame", mapOf("pcm" to pcm, "level" to level, "out" to out)) },
        onError = { message -> sendEvent("onError", mapOf("message" to message)) },
      )
      audio.start()
      call = audio
      keepScreenOn(true)
    }

    Function("play") { pcm: String ->
      call?.play(pcm)
    }

    Function("flush") {
      call?.flush()
    }

    Function("setSpeaker") { on: Boolean ->
      call?.setSpeaker(on)
    }

    AsyncFunction("stop") {
      call?.stop()
      call = null
      keepScreenOn(false)
    }

    OnDestroy {
      call?.stop()
      call = null
    }
  }

  private fun keepScreenOn(on: Boolean) {
    val activity = appContext.currentActivity ?: return

    activity.runOnUiThread {
      if (on) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }
  }
}

class CallAudioException(message: String) : CodedException(message)

private const val RATE = 24_000
/** 100 ms of PCM16 mono: ten frames a second over the bridge. */
private const val FRAME_BYTES = RATE / 10 * 2

private class CallAudio(
  context: Context,
  private val onFrame: (String, Double, Double) -> Unit,
  private val onError: (String) -> Unit,
) {
  private val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val attributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()
  private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes).build()
  private val queue = LinkedBlockingQueue<ByteArray>()
  private var previousMode = AudioManager.MODE_NORMAL
  private var record: AudioRecord? = null
  private var track: AudioTrack? = null
  private var canceller: AcousticEchoCanceler? = null
  private var suppressor: NoiseSuppressor? = null
  private var reader: Thread? = null
  private var writer: Thread? = null
  @Volatile private var running = false
  /** How loud the voice is right now, 0 to 1 (0 when nothing plays). */
  @Volatile private var outLevel = 0.0
  /** Bumped by `flush`, so the writer drops the rest of the chunk it is on. */
  @Volatile private var generation = 0

  fun start() {
    previousMode = manager.mode
    manager.requestAudioFocus(focus)
    manager.mode = AudioManager.MODE_IN_COMMUNICATION

    val inMin = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val mic = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(inMin, FRAME_BYTES * 4))

    if (mic.state != AudioRecord.STATE_INITIALIZED) {
      mic.release()
      restore()
      throw CallAudioException("The microphone is busy or unavailable.")
    }

    record = mic

    if (AcousticEchoCanceler.isAvailable()) {
      canceller = AcousticEchoCanceler.create(mic.audioSessionId)?.also { it.enabled = true }
    }

    if (NoiseSuppressor.isAvailable()) {
      suppressor = NoiseSuppressor.create(mic.audioSessionId)?.also { it.enabled = true }
    }

    val outMin = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    track = AudioTrack.Builder()
      .setAudioAttributes(attributes)
      .setAudioFormat(AudioFormat.Builder().setSampleRate(RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setBufferSizeInBytes(max(outMin * 2, FRAME_BYTES * 2))
      .setSessionId(mic.audioSessionId)
      .build()

    setSpeaker(true)
    running = true
    mic.startRecording()
    track?.play()

    reader = Thread({ readLoop(mic) }, "duplex-audio-mic").also { it.start() }
    writer = Thread({ writeLoop() }, "duplex-audio-speaker").also { it.start() }
  }

  private fun readLoop(mic: AudioRecord) {
    val buffer = ByteArray(FRAME_BYTES)

    while (running) {
      var filled = 0

      while (running && filled < FRAME_BYTES) {
        val read = mic.read(buffer, filled, FRAME_BYTES - filled)

        if (read < 0) {
          if (running) {
            onError("The microphone stopped ($read).")
          }

          return
        }

        filled += read
      }

      if (filled == FRAME_BYTES) {
        onFrame(Base64.encodeToString(buffer, Base64.NO_WRAP), level(buffer, 0, buffer.size), outLevel)
      }
    }
  }

  private fun writeLoop() {
    while (running) {
      val chunk = queue.poll(100, TimeUnit.MILLISECONDS)

      if (chunk == null) {
        outLevel = 0.0
        continue
      }

      // In 100 ms slices, so the voice's level follows what plays and a flush cuts in at once.
      val started = generation
      var at = 0

      while (running && generation == started && at < chunk.size) {
        val end = min(chunk.size, at + FRAME_BYTES)
        outLevel = level(chunk, at, end)
        track?.write(chunk, at, end - at, AudioTrack.WRITE_BLOCKING)
        at = end
      }
    }

    outLevel = 0.0
  }

  fun play(pcm: String) {
    if (!running) {
      return
    }

    try {
      queue.offer(Base64.decode(pcm, Base64.DEFAULT))
    } catch (error: IllegalArgumentException) {
      onError("Unreadable audio from the voice.")
    }
  }

  fun flush() {
    generation++
    queue.clear()
    outLevel = 0.0
    track?.let {
      it.pause()
      it.flush()
      it.play()
    }
  }

  /** The loudspeaker, or the earpiece held to your ear. */
  fun setSpeaker(on: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val wanted = if (on) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
      manager.availableCommunicationDevices.firstOrNull { it.type == wanted }?.let { manager.setCommunicationDevice(it) }
    } else {
      @Suppress("DEPRECATION")
      manager.isSpeakerphoneOn = on
    }
  }

  fun stop() {
    if (!running && record == null) {
      return
    }

    running = false
    queue.clear()

    try {
      record?.stop()
    } catch (_: IllegalStateException) {
      // Never started.
    }

    reader?.join(500)
    writer?.join(500)

    try {
      track?.pause()
      track?.flush()
      track?.stop()
    } catch (_: IllegalStateException) {
      // Never started.
    }

    canceller?.release()
    suppressor?.release()
    record?.release()
    track?.release()
    canceller = null
    suppressor = null
    record = null
    track = null
    reader = null
    writer = null
    restore()
  }

  private fun restore() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      manager.clearCommunicationDevice()
    } else {
      @Suppress("DEPRECATION")
      manager.isSpeakerphoneOn = false
    }

    manager.mode = previousMode
    manager.abandonAudioFocusRequest(focus)
  }

  /** How loud a stretch of PCM16 is, 0 to 1, on a curve that makes speech visible. */
  private fun level(frame: ByteArray, from: Int, to: Int): Double {
    var sum = 0.0
    var count = 0
    var i = from

    while (i + 1 < to) {
      val sample = ((frame[i + 1].toInt() shl 8) or (frame[i].toInt() and 0xff)).toShort().toDouble() / 32768.0
      sum += sample * sample
      count++
      i += 2
    }

    return if (count == 0) 0.0 else min(1.0, sqrt(sqrt(sum / count)) * 1.4)
  }
}
