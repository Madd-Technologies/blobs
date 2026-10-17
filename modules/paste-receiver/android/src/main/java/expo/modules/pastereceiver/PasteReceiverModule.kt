package expo.modules.pastereceiver

import android.content.Context
import android.net.Uri
import android.view.inputmethod.InputMethodManager
import android.webkit.MimeTypeMap
import android.widget.EditText
import androidx.core.view.ContentInfoCompat
import androidx.core.view.OnReceiveContentListener
import androidx.core.view.ViewCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.Executors

/**
 * Lets a React Native text field take pictures. Its field only declares text, so a keyboard (Samsung's clipboard, Gboard)
 * has nowhere to put a picture and drops it. With Android's rich-content hook the field accepts any image type: the keyboard
 * hands the picture over *with* a grant to read it (a clipboard link into the gallery has none for other apps), and it is
 * copied into the app's cache and reported to JS as `onPicture`. Text keeps its usual handling.
 */
class PasteReceiverModule : Module() {
  private val io = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("PasteReceiver")

    Events("onPicture")

    AsyncFunction("enable") { viewTag: Int ->
      val field = appContext.findView<EditText>(viewTag) ?: return@AsyncFunction false

      ViewCompat.setOnReceiveContentListener(field, MIME_TYPES, listener(viewTag))

      // A field that already has the keyboard keeps its old input connection until it is restarted.
      if (field.isFocused) {
        (field.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.restartInput(field)
      }

      true
    }.runOnQueue(Queues.MAIN)
  }

  private fun listener(viewTag: Int) = OnReceiveContentListener { _, payload ->
    val split = payload.partition { item -> item.uri != null }
    val pictures = split.first
    val uris = pictures?.clip?.let { clip -> (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri } } ?: emptyList()

    if (uris.isNotEmpty()) {
      io.execute { uris.forEach { report(viewTag, it) } }
    }

    // Everything that is not a picture (typed or pasted text) goes on as usual.
    split.second
  }

  private fun report(viewTag: Int, uri: Uri) {
    try {
      val context = appContext.reactContext ?: throw IllegalStateException("The app went away")
      val resolver = context.contentResolver
      val mime = resolver.getType(uri)?.takeIf { it.startsWith("image/") } ?: "image/png"
      val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "png"
      val file = File(context.cacheDir, "pasted-${System.currentTimeMillis()}.$ext")

      (resolver.openInputStream(uri) ?: throw IllegalStateException("No picture to read")).use { input ->
        file.outputStream().use { input.copyTo(it) }
      }

      sendEvent("onPicture", mapOf("viewTag" to viewTag, "uri" to Uri.fromFile(file).toString(), "mime" to mime, "size" to file.length()))
    } catch (error: Exception) {
      sendEvent("onPicture", mapOf("viewTag" to viewTag, "error" to (error.message ?: error.javaClass.simpleName)))
    }
  }

  companion object {
    private val MIME_TYPES = arrayOf("image/*")
  }
}
