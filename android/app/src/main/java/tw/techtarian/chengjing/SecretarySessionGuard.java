package tw.techtarian.chengjing;

/** Native-only revocable tickets. Authorization and the entire mutation share this monitor. */
public final class SecretarySessionGuard {
    private Object generation = new Object();
    private boolean active;
    public static final class Ticket {
        private final SecretarySessionGuard owner;
        private final Object generation;
        private Ticket(SecretarySessionGuard owner, Object generation) { this.owner = owner; this.generation = generation; }
    }
    public interface Operation<T> { T run() throws Exception; }
    public synchronized Ticket capture() {
        if (!active) throw new IllegalStateException("vault-session-inactive");
        return new Ticket(this, generation);
    }
    public synchronized boolean isCurrent(Ticket ticket) {
        return active && ticket != null && ticket.owner == this && ticket.generation == generation;
    }
    public synchronized <T> T execute(Ticket ticket, Operation<T> mutation) throws Exception {
        if (!isCurrent(ticket)) throw new IllegalStateException("vault-session-changed");
        return mutation.run();
    }
    public synchronized <T> T inspect(Operation<T> read) throws Exception { return read.run(); }
    public synchronized void setActive(boolean value, Runnable clearSession) {
        active = value;
        if (!value) revoke(clearSession);
    }
    public synchronized void revoke(Runnable clearSession) {
        generation = new Object();
        clearSession.run();
    }
}
