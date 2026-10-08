package tw.techtarian.chengjing

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import org.json.JSONArray
import java.time.LocalDateTime
import java.time.ZoneId

/** Best-effort inexact one-shot delivery. No permission dialog, exact alarm or boot receiver. */
class SecretaryNotifications(context: Context, private val isolated: Boolean) {
    private val context = context.applicationContext
    private val prefix = "secretary-android-notification:"
    private val channel = "private-secretary-v2"
    private val manager get() = context.getSystemService(NotificationManager::class.java)
    private val alarms get() = context.getSystemService(AlarmManager::class.java)
    fun status(): JSONObject {
        val granted = Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val enabled = granted && manager.areNotificationsEnabled() && (manager.getNotificationChannel(channel)?.importance != NotificationManager.IMPORTANCE_NONE)
        return JSONObject().put("available", !isolated && enabled).put("mode", "inexact-once")
            .put("reason", if (isolated) "isolated-qa-disabled" else if (!granted) "notification-permission-required" else if (!enabled) "notifications-disabled" else "available")
    }
    private fun pending(id: String, flags: Int = PendingIntent.FLAG_UPDATE_CURRENT): PendingIntent? = PendingIntent.getBroadcast(context, 0,
        Intent(context, SecretaryReminderReceiver::class.java).setAction("tw.techtarian.chengjing.PRIVATE_REMINDER")
            .setData(Uri.parse("chengjing-private-reminder://operation/$id")).putExtra("operationId", id), flags or PendingIntent.FLAG_IMMUTABLE)
    fun cancel(ids: List<String>) { ids.forEach { pending(it, PendingIntent.FLAG_NO_CREATE)?.let { request -> alarms.cancel(request); request.cancel() }; manager.cancel(it, 1) } }
    private fun viable(entries: JSONObject, record: JSONObject): Boolean {
        val op = entries.optJSONObject("secretary-operation:${record.optString("operationId")}") ?: return false
        val task = entries.optJSONObject("secretary-item:${op.optString("taskId")}") ?: return false
        return !task.optBoolean("done", true) && op.optString("status") in listOf("scheduled", "due") && op.optString("repeat") == "once"
            && op.optString("proposalFingerprint") == record.optString("fingerprint") && op.optDouble("nextDueAt") == record.optDouble("dueAt")
    }
    /** Renderer snapshots may neither insert native consent nor erase it to bypass deduplication. */
    fun preserveAndCancel(previous: JSONObject, next: JSONObject): List<String> {
        val old = previous.getJSONObject("entries"); val entries = next.getJSONObject("entries")
        entries.keys().asSequence().filter { it.startsWith(prefix) }.toList().forEach { entries.remove(it) }
        val cancelled = mutableListOf<String>()
        old.keys().asSequence().filter { it.startsWith(prefix) }.toList().forEach { name ->
            val record = JSONObject(old.getJSONObject(name).toString())
            if (record.optString("state") in listOf("requested", "scheduled") && !viable(entries, record)) {
                record.put("state", "cancelled-needs-fresh-confirmation"); cancelled.add(record.getString("operationId"))
            }
            entries.put(name, record)
        }
        return cancelled
    }
    fun disableRestored(previous: JSONObject, incoming: JSONObject): List<String> {
        val ids = previous.getJSONObject("entries").keys().asSequence().filter { it.startsWith(prefix) }
            .map { previous.getJSONObject("entries").getJSONObject(it).getString("operationId") }.toList()
        val entries = incoming.getJSONObject("entries")
        entries.keys().asSequence().filter { it.startsWith(prefix) }.toList().forEach { name -> entries.getJSONObject(name).put("state", "restore-needs-fresh-confirmation") }
        // Keep current tombstones too; restoring an older backup is not renewed scheduling consent.
        previous.getJSONObject("entries").keys().asSequence().filter { it.startsWith(prefix) && !entries.has(it) }.toList().forEach { name ->
            entries.put(name, JSONObject(previous.getJSONObject("entries").getJSONObject(name).toString()).put("state", "restore-needs-fresh-confirmation"))
        }
        return ids
    }
    fun schedule(data: JSONObject, id: String, fingerprint: String, persist: () -> Unit): JSONObject {
        check(id.matches(Regex("[\\w-]{8,100}"))) { "Invalid notification operation ID" }
        check(status().getBoolean("available")) { status().getString("reason") }
        val entries = data.getJSONObject("entries")
        val prior = entries.optJSONObject(prefix + id)
        if (prior != null) {
            check(prior.getString("fingerprint") == fingerprint) { "Notification ID already used" }
            return JSONObject().put("state", prior.getString("state")).put("mode", "inexact-once")
        }
        val op = entries.optJSONObject("secretary-operation:$id") ?: error("Confirmed reminder missing")
        val now = System.currentTimeMillis()
        val issued = op.getLong("issuedAt"); val expires = op.getLong("expiresAt"); val created = op.getLong("createdAt")
        val instant = op.getLong("instant")
        val wall = LocalDateTime.parse(op.getString("wallTime")); val zone = ZoneId.of(op.getString("timeZone"))
        val validInstants = zone.rules.getValidOffsets(wall).map { wall.toInstant(it).toEpochMilli() }
        val selected = op.getJSONArray("destinations")
        val original = JSONArray(fingerprint)
        val sorted = (0 until selected.length()).map { selected.getString(it) }.distinct().sorted()
        check(original.length() == 10 && original.getString(0) == id && original.getString(1) == op.getString("title")
            && original.getString(2) == op.getString("wallTime") && original.getString(3) == op.getString("timeZone")
            && original.getDouble(4) == instant.toDouble() && original.getString(5) == op.getString("repeat")
            && original.getJSONArray(6).let { array -> (0 until array.length()).map { array.getString(it) } } == sorted
            && original.getDouble(7) == issued.toDouble() && original.getDouble(8) == expires.toDouble()
            && original.getBoolean(9) == op.getBoolean("overdueAtIssue") && !op.getBoolean("overdueAtIssue")) { "Confirmed proposal no longer matches; create a fresh preview" }
        check(op.getString("id") == id && op.getString("proposalFingerprint") == fingerprint && op.getString("repeat") == "once"
            && op.getString("status") == "scheduled" && instant == op.getLong("nextDueAt") && instant in validInstants
            && (0 until selected.length()).any { selected.optString(it) == "local" }
            && issued <= created && created <= now && expires == issued + 300000L && created <= expires && now <= expires && instant > now) {
            "Native notification needs a fresh, future one-shot confirmation"
        }
        val record = JSONObject().put("operationId", id).put("fingerprint", fingerprint).put("dueAt", instant).put("state", "requested")
        check(viable(entries, record)) { "Task was completed, removed or changed" }
        entries.put(prefix + id, record); persist() // Durable outbox before OS handoff; never silently retry.
        try {
            manager.createNotificationChannel(NotificationChannel(channel, "Private reminders", NotificationManager.IMPORTANCE_DEFAULT))
            check(status().getBoolean("available")) { "Notifications disabled" }
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, instant, pending(id)!!)
            record.put("state", "scheduled"); persist()
        } catch (error: Exception) {
            cancel(listOf(id)); record.put("state", "handoff-failed-needs-review"); persist()
            throw IllegalStateException("Native notification handoff failed; in-app reminder retained", error)
        }
        return JSONObject().put("state", "scheduled").put("mode", "inexact-once")
    }
    fun deliver(data: JSONObject, id: String, persist: () -> Unit) {
        val entries = data.getJSONObject("entries"); val record = entries.optJSONObject(prefix + id) ?: return
        if (record.optString("state") != "scheduled") return
        val now = System.currentTimeMillis()
        if (!viable(entries, record) || !status().getBoolean("available") || record.getLong("dueAt") > now) {
            record.put("state", "delivery-blocked-needs-review"); persist(); cancel(listOf(id)); return
        }
        record.put("state", "delivery-attempted"); persist() // At most one attempt, not guaranteed delivery.
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(id, 1, android.app.Notification.Builder(context, channel).setSmallIcon(R.mipmap.chengjing_launcher)
            .setContentTitle("Private reminder").setContentText("Open Jenzo Notes to review your reminder.")
            .setVisibility(android.app.Notification.VISIBILITY_PRIVATE).setContentIntent(open).setAutoCancel(true).build())
    }
}

class SecretaryReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "tw.techtarian.chengjing.PRIVATE_REMINDER") return
        val id = intent.getStringExtra("operationId") ?: return
        if (!id.matches(Regex("[\\w-]{8,100}"))) return
        val result = goAsync()
        Thread {
            try { SecretaryVault.get(context.applicationContext).deliver(id) }
            catch (_: Exception) { /* Locked UI stays locked; unreadable ciphertext is never replaced. */ }
            finally { result.finish() }
        }.start()
    }
}
