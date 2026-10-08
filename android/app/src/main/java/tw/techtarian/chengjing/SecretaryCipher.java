package tw.techtarian.chengjing;

import java.nio.charset.StandardCharsets;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Same authenticated envelope for host tests and the Android Keystore adapter. */
public final class SecretaryCipher {
    public static final String FORMAT = "chengjing-android-secretary-vault";
    public static final long MAX_REVISION = 9007199254740991L;
    private SecretaryCipher() {}
    public static final class Sealed {
        public final byte[] iv, ciphertext;
        Sealed(byte[] iv, byte[] ciphertext) { this.iv = iv; this.ciphertext = ciphertext; }
    }
    private static byte[] aad(String id, long revision) {
        if (id == null || !id.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}") || revision < 0 || revision > MAX_REVISION)
            throw new IllegalArgumentException("vault-invalid-metadata");
        return (FORMAT + "\n2\nandroid-keystore\n" + id + "\n" + revision).getBytes(StandardCharsets.UTF_8);
    }
    public static Sealed seal(SecretKey key, String id, long revision, byte[] plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key); // Keystore supplies a fresh randomized IV.
        cipher.updateAAD(aad(id, revision));
        return new Sealed(cipher.getIV(), cipher.doFinal(plaintext));
    }
    public static byte[] open(SecretKey key, String id, long revision, byte[] iv, byte[] ciphertext) throws Exception {
        if (iv == null || iv.length != 12 || ciphertext == null || ciphertext.length < 16)
            throw new IllegalArgumentException("vault-invalid-envelope");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
        cipher.updateAAD(aad(id, revision));
        return cipher.doFinal(ciphertext);
    }
}
