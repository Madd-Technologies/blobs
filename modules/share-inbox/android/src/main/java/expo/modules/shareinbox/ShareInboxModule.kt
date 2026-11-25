package expo.modules.shareinbox

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class ShareInboxModule : Module() {
  private var pending: Map<String, Any?>? = null

  override fun definition() = ModuleDefinition {
    Name("ShareInbox")

    Events("onShared")

    OnCreate {
      appContext.currentActivity?.intent?.let { ingest(it, notify = false) }
    }

    OnNewIntent { intent ->
      ingest(intent, notify = true)
    }

    Function("consumePending") {
      appContext.currentActivity?.intent?.let { intent ->
        if (pending == null) {
          ingest(intent, notify = false)
        }
      }
      val out = pending
      pending = null
      out
    }
  }

  private fun ingest(intent: Intent, notify: Boolean) {
    val action = intent.action
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) {
      return
    }

    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()?.takeIf { it.isNotEmpty() }
    val uris = mutableListOf<Uri>()

    if (action == Intent.ACTION_SEND) {
      val single = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      }
      if (single != null) uris.add(single)
    } else {
      val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
      }
      if (list != null) uris.addAll(list)
    }

    val files = uris.mapIndexedNotNull { idx, uri -> copyToCache(uri, idx) }
    if (text == null && files.isEmpty()) {
      return
    }

    val isUrl = text != null && (text.startsWith("http://") || text.startsWith("https://")) && !text.contains(" ")
    val payload = mutableMapOf<String, Any?>(
      "files" to files
    )
    if (isUrl) {
      payload["url"] = text
    } else if (text != null) {
      payload["text"] = text
    }

    pending = payload
    intent.action = null
    if (notify) {
      sendEvent("onShared", payload)
    }
  }

  private fun copyToCache(uri: Uri, idx: Int): Map<String, String>? {
    val context = appContext.reactContext ?: return null
    val resolver = context.contentResolver
    val mime = resolver.getType(uri) ?: "application/octet-stream"
    var name = "shared-${System.currentTimeMillis()}-$idx"
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        cursor.getString(0)?.takeIf { it.isNotBlank() }?.let { name = it }
      }
    }
    val safeName = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
    val dest = File(context.cacheDir, "${System.currentTimeMillis()}-$safeName")
    return try {
      (resolver.openInputStream(uri) ?: return null).use { input ->
        dest.outputStream().use { input.copyTo(it) }
      }
      mapOf("uri" to Uri.fromFile(dest).toString(), "name" to name, "mime" to mime)
    } catch (_: Exception) {
      null
    }
  }
}
