package tw.techtarian.chengjing

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.time.ZoneId
import java.util.UUID
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** New private namespace only: never reads legacy SecureStore, Dexie or sync. */
class SecretaryVault(context: Context, private val isolated: Boolean = false) {
    private val directory = File(context.filesDir, "private-secretary-v2")
    private val file = File(directory, "android-secretary-v2.vault.json")
    internal val keyAlias = if (isolated) "chengjing-private-secretary-v2-qa-" + java.security.MessageDigest.getInstance("SHA-256")
        .digest(directory.absolutePath.toByteArray()).take(12).joinToString("") { "%02x".format(it) } else "chengjing-private-secretary-v2"
    private var unlocked = false
    private val session = SecretarySessionGuard()
    private val previews = mutableMapOf<String, Pair<Long, JSONObject>>()
    private val limit = 2 * 1024 * 1024
    private val appContext = context.applicationContext
    private val notifier by lazy { SecretaryNotifications(appContext, isolated) }
    private data class Opened(val id: String, val revision: Long, val data: JSONObject)

    fun setActive(value: Boolean) = session.setActive(value) { unlocked = false; previews.clear() }
    fun captureTicket(): SecretarySessionGuard.Ticket = session.capture()
    fun isCurrent(ticket: SecretarySessionGuard.Ticket): Boolean = session.isCurrent(ticket)
    fun lock(): JSONObject {
        session.revoke { unlocked = false; previews.clear() }
        return status()
    }
    fun status(): JSONObject = session.inspect {
        JSONObject().put("state", if (unlocked) "unlocked" else "locked")
            .put("protection", "android-keystore+aes-256-gcm").put("formatVersion", 2)
    }
    private fun requireSession() { check(unlocked) { "vault-locked" } }
    private fun key(create: Boolean = false): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val prior = store.getKey(keyAlias, null) as? SecretKey
        if (prior != null) return prior
        check(create) { "vault-key-unavailable-original-retained" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    private fun date(record: JSONObject, name: String): Boolean {
        val value = record.opt(name)
        return value is Number && value.toDouble().isFinite() && kotlin.math.abs(value.toDouble()) <= 8640000000000000.0
    }
    private fun validate(data: JSONObject): JSONObject {
        check(data.opt("version") == 2) { "vault-invalid-data" }
        val entries = data.optJSONObject("entries") ?: error("vault-invalid-data")
        check(entries.length() <= 4096) { "vault-size-limit" }
        for (name in entries.keys()) {
            check(name.matches(Regex("^(secretary-[\\w:-]{1,150}|source-draft-v2|migration-source-v1)$"))) { "vault-invalid-entry" }
            val value = entries.optJSONObject(name) ?: error("vault-invalid-record")
            if (name.startsWith("secretary-item:")) {
                check(value.opt("id") is String && name == "secretary-item:${value.getString("id")}" && value.optString("kind") in listOf("note", "task")
                    && value.opt("title") is String && value.getString("title").length <= 2000
                    && value.opt("plainText") is String && value.getString("plainText").length <= 128000 && value.opt("done") is Boolean
                    && date(value, "createdAt") && date(value, "updatedAt") && (!value.has("dueAt") || date(value, "dueAt"))) { "vault-invalid-private-item" }
            } else if (name.startsWith("secretary-operation:")) {
                check(value.opt("id") is String && name == "secretary-operation:${value.getString("id")}" && value.opt("taskId") is String
                    && value.opt("title") is String && value.getString("title").length <= 2000 && value.opt("proposalFingerprint") is String
                    && value.optString("status") in listOf("scheduled", "due", "done", "needs-review", "cancelled")
                    && value.optString("repeat") in listOf("once", "daily", "weekly") && date(value, "nextDueAt")
                    && value.opt("wallTime") is String && value.opt("timeZone") is String && value.optJSONArray("destinations") != null
                    && value.optJSONObject("destinationsState") != null) { "vault-invalid-reminder" }
                ZoneId.of(value.getString("timeZone"))
            } else if (name == "source-draft-v2") {
                val sources = value.optJSONArray("sources") ?: error("vault-invalid-draft")
                check(value.opt("version") == 2 && value.opt("goal") is String && value.opt("draft") is String && sources.length() <= 8) { "vault-invalid-draft" }
                for (index in 0 until sources.length()) {
                    val source = sources.getJSONObject(index)
                    check(source.optString("type") in listOf("card", "fragment", "private") && listOf("key", "id", "title", "excerpt").all { source.opt(it) is String }
                        && date(source, "updatedAt")) { "vault-invalid-source" }
                }
            }
        }
        val encoded = data.toString().toByteArray(Charsets.UTF_8)
        check(encoded.size <= limit) { "vault-size-limit" }
        return JSONObject(String(encoded, Charsets.UTF_8))
    }
    private fun readRaw(source: File = file): String {
        val atomic = AtomicFile(source)
        atomic.openRead().use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                check(output.size() + count <= limit * 2) { "vault-size-limit" }
                output.write(buffer, 0, count)
            }
            return String(output.toByteArray(), Charsets.UTF_8)
        }
    }
    private fun decode(value: JSONObject, name: String): ByteArray {
        val text = value.getString(name)
        val bytes = Base64.decode(text, Base64.NO_WRAP)
        check(Base64.encodeToString(bytes, Base64.NO_WRAP) == text) { "vault-invalid-envelope" }
        return bytes
    }
    private fun open(raw: String): Opened {
        check(raw.toByteArray(Charsets.UTF_8).size <= limit * 2) { "vault-size-limit" }
        val envelope = JSONObject(raw)
        check(envelope.optString("format") == SecretaryCipher.FORMAT && envelope.opt("version") == 2 && envelope.optString("protection") == "android-keystore") { "vault-unsupported-envelope" }
        val revision = envelope.getLong("revision")
        check(envelope.opt("revision") is Number && envelope.getDouble("revision") == revision.toDouble()) { "vault-invalid-revision" }
        val plaintext = SecretaryCipher.open(key(), envelope.getString("id"), revision, decode(envelope, "iv"), decode(envelope, "ciphertext"))
        try { return Opened(envelope.getString("id"), revision, validate(JSONObject(String(plaintext, Charsets.UTF_8)))) }
        finally { plaintext.fill(0) }
    }
    private fun seal(current: Opened, data: JSONObject, revision: Long): String {
        val plaintext = validate(data).toString().toByteArray(Charsets.UTF_8)
        try {
            val sealed = SecretaryCipher.seal(key(), current.id, revision, plaintext)
            return JSONObject().put("format", SecretaryCipher.FORMAT).put("version", 2).put("protection", "android-keystore")
                .put("id", current.id).put("revision", revision).put("iv", Base64.encodeToString(sealed.iv, Base64.NO_WRAP))
                .put("ciphertext", Base64.encodeToString(sealed.ciphertext, Base64.NO_WRAP)).toString()
        } finally { plaintext.fill(0) }
    }
    private fun write(raw: String, destination: File = file) {
        check(directory.isDirectory || directory.mkdirs()) { "vault-directory-unavailable" }
        val atomic = AtomicFile(destination)
        val stream = atomic.startWrite()
        try { stream.write(raw.toByteArray(Charsets.UTF_8)); atomic.finishWrite(stream) }
        catch (error: Exception) { atomic.failWrite(stream); throw error }
    }
    private fun store(current: Opened, data: JSONObject): Long {
        check(current.revision < SecretaryCipher.MAX_REVISION) { "vault-revision-exhausted" }
        val revision = current.revision + 1
        write(seal(current, data, revision)); previews.clear()
        return revision
    }
    private fun preview(raw: String): JSONObject {
        requireSession()
        val current = open(readRaw()); val incoming = open(raw)
        val token = UUID.randomUUID().toString()
        previews.clear(); previews[token] = current.revision to incoming.data
        return JSONObject().put("token", token).put("formatVersion", 2).put("entries", incoming.data.getJSONObject("entries").length())
            .put("expectedRevision", current.revision).put("accountBound", true)
    }
    fun call(method: String, args: JSONObject, ticket: SecretarySessionGuard.Ticket): JSONObject = session.execute(ticket) { callAuthorized(method, args) }
    private fun callAuthorized(method: String, args: JSONObject): JSONObject {
        when (method) {
            "secretary.vault.status" -> return status()
            "secretary.vault.unlock" -> {
                if (!file.exists() && !File(file.path + ".bak").exists()) {
                    key(true)
                    val empty = JSONObject().put("version", 2).put("entries", JSONObject())
                    write(seal(Opened(UUID.randomUUID().toString(), 0, empty), empty, 0))
                } else open(readRaw()) // Key loss/tamper never replaces original ciphertext.
                unlocked = true; return status()
            }
        }
        requireSession()
        when (method) {
            "secretary.vault.read" -> { val current = open(readRaw()); return JSONObject().put("revision", current.revision).put("data", current.data) }
            "secretary.vault.commit" -> {
                val current = open(readRaw())
                check(args.opt("expectedRevision") is Number && args.getDouble("expectedRevision") == current.revision.toDouble()) { "vault-revision-conflict" }
                val data = validate(args.getJSONObject("data"))
                // Native consent records cannot be created or changed through generic renderer commits.
                val cancelled = notifier.preserveAndCancel(current.data, data)
                val revision = store(current, data)
                notifier.cancel(cancelled)
                return JSONObject().put("revision", revision)
            }
            "secretary.vault.backup" -> { val raw = readRaw(); open(raw); return JSONObject().put("formatVersion", 2).put("data", raw) }
            "secretary.vault.previewRestore" -> return preview(args.getString("data"))
            "secretary.vault.cancelRestore" -> { previews.remove(args.getString("token")); return JSONObject().put("cancelled", true) }
            "secretary.vault.previewRollback" -> {
                val id = args.getString("id"); check(id.matches(Regex("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}"))) { "vault-invalid-rollback" }
                return preview(readRaw(File(directory, "rollback-$id.vault.json")))
            }
            "secretary.vault.confirmRestore" -> {
                val current = open(readRaw()); val incoming = previews[args.getString("token")]
                check(incoming != null && incoming.first == current.revision) { "vault-restore-preview-expired" }
                val rollback = UUID.randomUUID().toString()
                write(readRaw(), File(directory, "rollback-$rollback.vault.json"))
                val cancelled = notifier.disableRestored(current.data, incoming.second)
                store(current, incoming.second)
                notifier.cancel(cancelled)
                return JSONObject().put("restored", true).put("rollbackId", rollback)
            }
            "secretary.notifications.status" -> return notifier.status()
            "secretary.notifications.schedule" -> {
                val current = open(readRaw()); val result = notifier.schedule(current.data, args.getString("operationId"), args.getString("fingerprint")) { store(open(readRaw()), current.data) }
                return result
            }
            else -> error("Unknown private secretary operation")
        }
    }
    /** Only the non-exported receiver can deliver while the UI session remains locked. */
    fun deliver(operationId: String) = session.inspect {
        if (!file.exists()) return@inspect
        val current = open(readRaw())
        notifier.deliver(current.data, operationId) { store(open(readRaw()), current.data) }
    }
    companion object {
        private val instances = mutableMapOf<String, SecretaryVault>()
        @Synchronized fun get(context: Context, isolated: Boolean = false): SecretaryVault {
            val scope = File(context.filesDir, "private-secretary-v2").absolutePath
            return instances.getOrPut(scope) { SecretaryVault(context, isolated) }
        }
    }
}
