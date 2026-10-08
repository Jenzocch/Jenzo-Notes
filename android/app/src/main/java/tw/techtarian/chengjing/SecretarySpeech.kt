package tw.techtarian.chengjing

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import org.json.JSONObject

/** Main-thread, installed on-device language only; never requests permission or downloads. */
class SecretarySpeech(private val activity: Activity, private val allowed: () -> Boolean, private val emit: (JSONObject) -> Unit) {
    private var recognizer: SpeechRecognizer? = null
    private var session: String? = null
    private var cancelPendingStart: (() -> Unit)? = null
    fun status(): JSONObject {
        val reason = when {
            Build.VERSION.SDK_INT < 33 -> "installed-language-check-requires-api-33"
            activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED -> "microphone-permission-required"
            !SpeechRecognizer.isOnDeviceRecognitionAvailable(activity) -> "on-device-recognizer-unavailable"
            else -> "available-pending-installed-language-check"
        }
        return JSONObject().put("available", reason == "available-pending-installed-language-check").put("reason", reason).put("cloudFallback", false)
    }
    fun stop(id: String? = null) {
        if (id != null && id != session) return
        session = null
        val cancelled = cancelPendingStart; cancelPendingStart = null; cancelled?.invoke()
        val old = recognizer; recognizer = null
        try { old?.cancel() } catch (_: Exception) { /* Revoked capability still ends this session. */ }
        finally { try { old?.destroy() } catch (_: Exception) {} }
    }
    fun start(id: String, language: String, reply: (Any?, String?) -> Unit) {
        if (!allowed()) { reply(null, "vault-locked"); return }
        if (Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !status().getBoolean("available")) { reply(null, status().getString("reason") + "; use typing/paste"); return }
        if (!id.matches(Regex("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")) || !language.matches(Regex("[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}"))) {
            reply(null, "Invalid speech session or language"); return
        }
        if (session != null) { reply(null, "Speech session already active"); return }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language).putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false).putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        session = id
        var replied = false
        fun respond(value: Any?, error: String?) { if (!replied) { replied = true; cancelPendingStart = null; reply(value, error) } }
        cancelPendingStart = { respond(null, "Speech request cancelled") }
        try {
            val speech = SpeechRecognizer.createOnDeviceSpeechRecognizer(activity); recognizer = speech
            fun finish(error: String? = null, text: String? = null) {
                if (session != id) return
                if (allowed()) emit(JSONObject().put("sessionId", id).put("kind", if (error != null) "error" else if (text != null) "result" else "end")
                    .put("text", text ?: JSONObject.NULL).put("error", error ?: JSONObject.NULL))
                respond(null, error ?: "Speech session ended before starting")
                stop(id)
            }
            speech.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onError(error: Int) { finish("On-device speech error $error; use typing/paste") }
                override fun onResults(results: Bundle?) {
                    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.take(128000)
                    finish(text = text)
                }
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            speech.checkRecognitionSupport(intent, activity.mainExecutor, object : RecognitionSupportCallback {
                override fun onSupportResult(support: RecognitionSupport) {
                    if (session != id || !allowed()) { respond(null, "Speech request cancelled"); stop(id); return }
                    if (support.installedOnDeviceLanguages.none { it.equals(language, ignoreCase = true) }) {
                        finish("Installed on-device language unavailable; no download or cloud fallback"); return
                    }
                    try { speech.startListening(intent); respond(JSONObject().put("sessionId", id), null) }
                    catch (_: Exception) { finish("On-device speech could not start; use typing/paste") }
                }
                override fun onError(error: Int) { finish("Cannot verify installed on-device language ($error); use typing/paste") }
            })
            android.os.Handler(activity.mainLooper).postDelayed({ if (session == id && !replied) { respond(null, "Installed language check timed out; use typing/paste"); stop(id) } }, 15000)
        } catch (_: Exception) { respond(null, "On-device speech unavailable; use typing/paste"); stop(id) }
    }
}
