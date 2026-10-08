package tw.techtarian.chengjing;

import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Runs the actual production monitor/ticket code; synthetic state, no Android/device. */
public final class SecretarySessionRaceTest {
    private static int checks;
    private static void check(boolean result, String name) { checks++; if (!result) throw new AssertionError(name); }
    private static void denied(Future<?> result, String name) throws Exception {
        try { result.get(5, TimeUnit.SECONDS); throw new AssertionError(name); }
        catch (ExecutionException expected) { check(expected.getCause() instanceof IllegalStateException && expected.getCause().getMessage().equals("vault-session-changed"), name); }
    }
    private static void busyQueue(boolean explicitLock, String label) throws Exception {
        SecretarySessionGuard guard = new SecretarySessionGuard();
        AtomicBoolean unlocked = new AtomicBoolean(false);
        AtomicInteger writes = new AtomicInteger(), alarms = new AtomicInteger(), restores = new AtomicInteger();
        guard.setActive(true, () -> unlocked.set(false));
        ExecutorService workers = Executors.newFixedThreadPool(3);
        CountDownLatch occupied = new CountDownLatch(3), release = new CountDownLatch(1);
        try {
            for (int i = 0; i < 3; i++) workers.submit(() -> { occupied.countDown(); release.await(); return null; });
            check(occupied.await(5, TimeUnit.SECONDS), "three occupied workers");
            SecretarySessionGuard.Ticket ticket = guard.capture();
            Future<?> oldUnlock = workers.submit(() -> guard.execute(ticket, () -> { unlocked.set(true); return null; }));
            Future<?> oldCommit = workers.submit(() -> guard.execute(ticket, () -> { writes.incrementAndGet(); return null; }));
            Future<?> oldAlarm = workers.submit(() -> guard.execute(ticket, () -> { alarms.incrementAndGet(); return null; }));
            Future<?> oldRestore = workers.submit(() -> guard.execute(ticket, () -> { restores.incrementAndGet(); return null; }));
            if (explicitLock) guard.revoke(() -> unlocked.set(false));
            else { guard.setActive(false, () -> unlocked.set(false)); guard.setActive(true, () -> unlocked.set(false)); }
            release.countDown();
            denied(oldUnlock, label + ": queued unlock rejected");
            denied(oldCommit, label + ": queued commit rejected");
            denied(oldAlarm, label + ": queued schedule rejected");
            denied(oldRestore, label + ": queued restore rejected");
            check(!unlocked.get() && writes.get() == 0 && alarms.get() == 0 && restores.get() == 0, label + ": no side effect");
            guard.execute(guard.capture(), () -> { unlocked.set(true); return null; });
            denied(workers.submit(() -> guard.execute(ticket, () -> { writes.incrementAndGet(); return null; })), label + ": old commit rejected after fresh unlock");
            check(unlocked.get() && writes.get() == 0, label + ": fresh session preserved");
        } finally { release.countDown(); workers.shutdownNow(); check(workers.awaitTermination(5, TimeUnit.SECONDS), "workers stopped"); }
    }
    public static void main(String[] args) throws Exception {
        busyQueue(false, "pause/resume");
        busyQueue(false, "navigation/reload");
        busyQueue(false, "destroy/new foreground");
        busyQueue(true, "explicit lock/unlock");
        SecretarySessionGuard guard = new SecretarySessionGuard();
        boolean inactiveDenied = false;
        try { guard.capture(); } catch (IllegalStateException expected) { inactiveDenied = true; }
        check(inactiveDenied, "inactive ingress cannot issue a ticket that later becomes valid");
        guard.setActive(true, () -> {});
        SecretarySessionGuard other = new SecretarySessionGuard(); other.setActive(true, () -> {});
        check(!guard.isCurrent(other.capture()), "foreign-owner tickets rejected");
        ExecutorService workers = Executors.newFixedThreadPool(2);
        CountDownLatch entered = new CountDownLatch(1), finish = new CountDownLatch(1), revokeRequested = new CountDownLatch(1);
        AtomicBoolean revoked = new AtomicBoolean(false); AtomicInteger writes = new AtomicInteger();
        SecretarySessionGuard.Ticket current = guard.capture();
        try {
            Future<?> mutation = workers.submit(() -> guard.execute(current, () -> { entered.countDown(); finish.await(); writes.incrementAndGet(); return null; }));
            check(entered.await(5, TimeUnit.SECONDS), "mutation entered authorized monitor");
            Future<?> revocation = workers.submit(() -> { revokeRequested.countDown(); guard.revoke(() -> revoked.set(true)); });
            check(revokeRequested.await(5, TimeUnit.SECONDS), "concurrent revocation requested");
            check(!revoked.get(), "revocation cannot interleave between authorization and mutation");
            finish.countDown(); mutation.get(5, TimeUnit.SECONDS); revocation.get(5, TimeUnit.SECONDS);
            check(revoked.get() && writes.get() == 1 && !guard.isCurrent(current), "in-flight mutation linearizes before revocation; old authority stays revoked");
        } finally { finish.countDown(); workers.shutdownNow(); check(workers.awaitTermination(5, TimeUnit.SECONDS), "race workers stopped"); }
        System.out.println("PASS " + checks + " production session-guard race checks; no Android/device execution");
    }
}
