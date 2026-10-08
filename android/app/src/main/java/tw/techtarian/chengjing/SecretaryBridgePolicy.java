package tw.techtarian.chengjing;

import java.net.URI;

/** Native private capabilities belong only to the packaged top-level document. */
public final class SecretaryBridgePolicy {
    private SecretaryBridgePolicy() {}
    public static boolean trustedOrigin(String raw) {
        try {
            URI uri = new URI(raw);
            return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
        } catch (Exception ignored) { return false; }
    }
    public static boolean trustedDocument(String raw) {
        try {
            URI uri = new URI(raw);
            return trustedOrigin(raw) && "/assets/public/index.html".equals(uri.getRawPath()) && uri.getRawQuery() == null;
        } catch (Exception ignored) { return false; }
    }
}
