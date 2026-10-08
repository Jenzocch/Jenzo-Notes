package tw.techtarian.chengjing;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/** Synthetic host crypto/URI checks, not Android Keystore/device certification. */
public final class SecretaryHostTest {
    private static int checks;
    private static void check(boolean result, String message) {
        checks++; if (!result) throw new AssertionError(message);
    }
    interface Attempt { void run() throws Exception; }
    private static void rejected(Attempt attempt, String message) throws Exception {
        boolean failed = false;
        try { attempt.run(); } catch (Exception expected) { failed = true; }
        check(failed, message);
    }
    public static void main(String[] args) throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES"); generator.init(256);
        SecretKey key = generator.generateKey(), other = generator.generateKey();
        String id = "471c80a3-7312-4dc7-9945-921d334e0c79";
        byte[] plaintext = "SYNTHETIC-ANDROID-PRIVATE-ONLY: idea, source and draft".getBytes(StandardCharsets.UTF_8);
        SecretaryCipher.Sealed sealed = SecretaryCipher.seal(key, id, 0, plaintext);
        check(Arrays.equals(plaintext, SecretaryCipher.open(key, id, 0, sealed.iv, sealed.ciphertext)), "round-trip");
        check(!Arrays.equals(sealed.iv, SecretaryCipher.seal(key, id, 0, plaintext).iv), "fresh IV");
        check(!new String(sealed.ciphertext, StandardCharsets.UTF_8).contains("SYNTHETIC-ANDROID"), "no readable plaintext");
        rejected(() -> SecretaryCipher.open(other, id, 0, sealed.iv, sealed.ciphertext), "wrong key authentication");
        rejected(() -> SecretaryCipher.open(key, id, 1, sealed.iv, sealed.ciphertext), "revision authenticated");
        rejected(() -> SecretaryCipher.open(key, "571c80a3-7312-4dc7-9945-921d334e0c79", 0, sealed.iv, sealed.ciphertext), "id authenticated");
        final byte[] changed = sealed.ciphertext.clone(); changed[0] ^= 1;
        rejected(() -> SecretaryCipher.open(key, id, 0, sealed.iv, changed), "ciphertext tamper");
        final byte[] tagChanged = sealed.ciphertext.clone(); tagChanged[tagChanged.length - 1] ^= 1;
        rejected(() -> SecretaryCipher.open(key, id, 0, sealed.iv, tagChanged), "tag tamper");
        rejected(() -> SecretaryCipher.seal(key, id, -1, plaintext), "negative revision");
        rejected(() -> SecretaryCipher.seal(key, id, SecretaryCipher.MAX_REVISION + 1, plaintext), "unsafe revision");
        rejected(() -> SecretaryCipher.seal(key, "../other", 0, plaintext), "path metadata");
        String document = "https://appassets.androidplatform.net/assets/public/index.html";
        check(SecretaryBridgePolicy.trustedDocument(document), "packaged document");
        check(SecretaryBridgePolicy.trustedDocument(document + "#journal"), "hash routing");
        String[] denied = { "http://appassets.androidplatform.net/assets/public/index.html", document + "?remote=1",
            "https://appassets.androidplatform.net:444/assets/public/index.html", "https://evil.invalid/assets/public/index.html",
            "https://user@appassets.androidplatform.net/assets/public/index.html", "file:///assets/public/index.html",
            "https://appassets.androidplatform.net/attachments/index.html", "https://appassets.androidplatform.net/assets/public/%69ndex.html",
            "https://appassets.androidplatform.net.evil.invalid/assets/public/index.html", "about:blank", "not a URI" };
        for (String url : denied) check(!SecretaryBridgePolicy.trustedDocument(url), "reject " + url);
        System.out.println("PASS " + checks + " synthetic JVM crypto/bridge checks; no Android/device execution");
    }
}
