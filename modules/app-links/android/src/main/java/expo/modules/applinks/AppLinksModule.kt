package expo.modules.applinks

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hands a web link to one app (Gmail, Outlook) instead of letting Android choose. Android gives a link to an app on its own only
 * when the app's App Links are verified and switched on for that host and path; anything else goes to the browser. Naming the
 * package skips that choice: the app gets the link if any of its filters takes it, verified or not. With no link, the app's front
 * door opens. Starting an activity is never filtered by package visibility, so no `<queries>` are needed: a missing app, or one
 * that will not take the link, just answers false.
 */
class AppLinksModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppLinks")

    AsyncFunction("open") { packageName: String, url: String? ->
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      val intent =
        if (url != null) {
          // Browsable, as a tap in a browser would be, so only the filters an app opened to web links can take it.
          Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
        } else {
          Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        }

      intent.setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

      try {
        activity.startActivity(intent)
        true
      } catch (_: ActivityNotFoundException) {
        false
      } catch (_: SecurityException) {
        false
      }
    }.runOnQueue(Queues.MAIN)
  }
}
