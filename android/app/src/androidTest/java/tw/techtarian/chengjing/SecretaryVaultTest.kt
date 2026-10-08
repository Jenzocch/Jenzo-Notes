package tw.techtarian.chengjing

import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.File
import java.security.KeyStore
import java.util.UUID

/** Compile now; execution requires separately approved device/test APK installation. */
class SecretaryVaultTest {
    private lateinit var context: ContextWrapper
    private lateinit var root: File
    private lateinit var vault: SecretaryVault
    private val marker = "SYNTHETIC-PRIVATE-ANDROID-NOTE"
    @Before fun setup() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        root = File(target.cacheDir, "secretary-isolated-test-${UUID.randomUUID()}").apply { mkdirs() }
        context = object : ContextWrapper(target) { override fun getFilesDir(): File = root }
        vault = SecretaryVault(context, true); vault.setActive(true)
    }
    @After fun cleanup() {
        vault.setActive(false)
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(vault.keyAlias) }
        root.deleteRecursively() // Only this test's UUID-scoped cache directory.
    }
    private fun call(name: String, args: JSONObject = JSONObject()) = vault.call("secretary.vault.$name", args)
    private fun data(title: String = marker) = JSONObject().put("version", 2).put("entries", JSONObject().put("secretary-item:synthetic-note", JSONObject()
        .put("id", "synthetic-note").put("kind", "note").put("title", title).put("plainText", title).put("done", false).put("createdAt", 1).put("updatedAt", 2)))
    private fun commit(revision: Long, value: JSONObject = data()) = call("commit", JSONObject().put("expectedRevision", revision).put("data", value))
    private fun denied(action: () -> Unit) { var rejected = false; try { action() } catch (_: Exception) { rejected = true }; assertTrue("must fail closed", rejected) }
    @Test fun encryptionRestartLockAndCas() {
        assertEquals("locked", call("status").getString("state")); denied { call("read") }
        call("unlock"); assertEquals(1L, commit(0).getLong("revision")); denied { commit(0) }
        val backup = call("backup").getString("data"); assertFalse(backup.contains(marker))
        call("lock"); denied { call("read") }
        val restarted = SecretaryVault(context, true); restarted.setActive(true)
        assertEquals("locked", restarted.status().getString("state")); restarted.call("secretary.vault.unlock", JSONObject())
        assertEquals(marker, restarted.call("secretary.vault.read", JSONObject()).getJSONObject("data").getJSONObject("entries").getJSONObject("secretary-item:synthetic-note").getString("plainText"))
        restarted.setActive(false); denied { restarted.call("secretary.vault.unlock", JSONObject()) }; denied { restarted.call("secretary.vault.read", JSONObject()) }
    }
    @Test fun restorePreviewConflictCheckpointAndRollback() {
        call("unlock"); commit(0)
        val backup = call("backup").getString("data"); commit(1, data("SYNTHETIC-NEW"))
        var preview = call("previewRestore", JSONObject().put("data", backup))
        assertEquals("SYNTHETIC-NEW", call("read").getJSONObject("data").getJSONObject("entries").getJSONObject("secretary-item:synthetic-note").getString("title"))
        call("cancelRestore", JSONObject().put("token", preview.getString("token"))); denied { call("confirmRestore", JSONObject().put("token", preview.getString("token"))) }
        preview = call("previewRestore", JSONObject().put("data", backup)); commit(2, data("SYNTHETIC-NEWER"))
        denied { call("confirmRestore", JSONObject().put("token", preview.getString("token"))) }
        preview = call("previewRestore", JSONObject().put("data", backup))
        val restored = call("confirmRestore", JSONObject().put("token", preview.getString("token")))
        val rollback = call("previewRollback", JSONObject().put("id", restored.getString("rollbackId")))
        call("confirmRestore", JSONObject().put("token", rollback.getString("token")))
        assertEquals("SYNTHETIC-NEWER", call("read").getJSONObject("data").getJSONObject("entries").getJSONObject("secretary-item:synthetic-note").getString("title"))
        denied { call("previewRollback", JSONObject().put("id", "../../other")) }
    }
    @Test fun tamperAndMissingKeyRetainCiphertext() {
        call("unlock"); commit(0); call("lock")
        val file = File(root, "private-secretary-v2/android-secretary-v2.vault.json")
        val raw = file.readText(); val changed = JSONObject(raw).put("revision", 2).toString()
        file.writeText(changed); denied { call("unlock") }; assertEquals(changed, file.readText())
        file.writeText(raw)
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(vault.keyAlias) }
        denied { call("unlock") }; assertEquals(raw, file.readText())
    }
    @Test fun rendererCannotForgeNativeConsentAndQaCannotNotify() {
        call("unlock")
        val incoming = data(); incoming.getJSONObject("entries").put("secretary-android-notification:fake-operation", JSONObject().put("state", "scheduled"))
        commit(0, incoming)
        assertFalse(call("read").getJSONObject("data").getJSONObject("entries").has("secretary-android-notification:fake-operation"))
        assertFalse(vault.call("secretary.notifications.status", JSONObject()).getBoolean("available"))
        denied { vault.call("secretary.notifications.schedule", JSONObject().put("operationId", "synthetic-operation").put("fingerprint", "fake")) }
        val invalid = data(); invalid.getJSONObject("entries").put("arbitrary-namespace", JSONObject())
        denied { commit(1, invalid) }; assertEquals(1L, call("read").getLong("revision"))
    }
}
