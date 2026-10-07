import { readSecureVault, secureVaultTransaction, type PrivateItem, type VaultData } from "./secureSecretary";

export type Destination = "local" | "calendar-mock" | "clock-mock";
export type Repeat = "once" | "daily" | "weekly";
export interface ReminderProposal { id: string; title: string; wallTime: string; timeZone: string; instant: number; repeat: Repeat; destinations: Destination[]; issuedAt: number; expiresAt: number; overdueAtIssue: boolean }
export interface ReminderOperation extends ReminderProposal { status: "scheduled" | "due" | "done" | "needs-review" | "cancelled"; taskId: string; proposalFingerprint: string; nextDueAt: number; destinationsState: Partial<Record<Destination, string>>; createdAt: number }
const prefix = "secretary-operation:";
const fingerprint = (p: ReminderProposal) => JSON.stringify([p.id, p.title, p.wallTime, p.timeZone, p.instant, p.repeat, [...p.destinations].sort(), p.issuedAt, p.expiresAt, p.overdueAtIssue]);

function parts(instant: number, timeZone: string) {
  const items = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  return Object.fromEntries(items.map(item => [item.type, item.value]));
}
export function wallTimeCandidates(wall: string, timeZone: string) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(wall)) throw new Error("Use YYYY-MM-DDTHH:mm");
  const naive = Date.parse(`${wall}:00Z`);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== wall) throw new Error("Invalid date/time");
  parts(naive, timeZone); // Validate the IANA zone before proposing anything.
  const offsets = new Set<number>();
  for (let hour = -48; hour <= 48; hour += 6) {
    const sample = naive + hour * 3600000; const p = parts(sample, timeZone);
    offsets.add(Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - sample);
  }
  return [...offsets].map(offset => naive - offset).filter(instant => {
    const p = parts(instant, timeZone);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === wall;
  }).sort((a, b) => a - b);
}

export function parseReminder(text: string, wall: string, timeZone: string, repeat: Repeat, destinations: Destination[], occurrence?: number): ReminderProposal {
  const candidates = wallTimeCandidates(wall, timeZone);
  if (!text.trim() || text.length > 2000 || !destinations.length || destinations.some(item => !["local", "calendar-mock", "clock-mock"].includes(item)) || !["once", "daily", "weekly"].includes(repeat)) throw new Error("Invalid reminder proposal");
  if (!candidates.length) throw new Error("DST gap: this local time does not exist. Choose another time.");
  if (candidates.length > 1 && occurrence === undefined) throw new Error("DST overlap: select the earlier or later occurrence.");
  const instant = candidates[candidates.length === 1 ? 0 : occurrence ?? 0];
  if (instant === undefined) throw new Error("Invalid occurrence");
  const issuedAt = Date.now();
  return { id: crypto.randomUUID(), title: text.trim(), wallTime: wall, timeZone, instant, repeat, destinations: [...new Set(destinations)], issuedAt, expiresAt: issuedAt + 5 * 60000, overdueAtIssue: instant <= issuedAt };
}

export async function confirmReminder(proposal: ReminderProposal, options: { acknowledgeOverdue?: boolean } = {}) {
  // A confirmation handler must validate again; imported/AI content cannot create an operation.
  const candidates = wallTimeCandidates(proposal.wallTime, proposal.timeZone);
  const checked = parseReminder(proposal.title, proposal.wallTime, proposal.timeZone, proposal.repeat, proposal.destinations, candidates.indexOf(proposal.instant));
  if (!/^[\w-]{8,100}$/.test(proposal.id) || checked.instant !== proposal.instant) throw new Error("Invalid operation");
  return secureVaultTransaction(data => {
    const key = prefix + proposal.id; const prior = data.entries[key];
    if (prior) {
      const operation = prior as ReminderOperation;
      if (operation.proposalFingerprint !== fingerprint(proposal)) throw new Error("Operation ID already belongs to another proposal");
      return operation;
    }
    const now = Date.now();
    if (!Number.isFinite(proposal.issuedAt) || proposal.issuedAt > now || proposal.expiresAt !== proposal.issuedAt + 5 * 60000 || now > proposal.expiresAt || proposal.overdueAtIssue !== (proposal.instant <= proposal.issuedAt)) throw new Error("Proposal expired or invalid; create a fresh preview before confirming");
    if (proposal.instant <= now && (!proposal.overdueAtIssue || !options.acknowledgeOverdue)) throw new Error("Reminder is now overdue; create a fresh preview and explicitly confirm immediate catch-up");
    const operation: ReminderOperation = { ...proposal, proposalFingerprint: fingerprint(proposal), taskId: `secretary-${proposal.id}`, status: "scheduled", nextDueAt: proposal.instant, createdAt: now, destinationsState: Object.fromEntries(proposal.destinations.map(destination => [destination, destination === "local" ? "scheduled" : "pending-mock"])) };
    data.entries[`secretary-item:${operation.taskId}`] = { id: operation.taskId, kind: "task", title: proposal.title, plainText: proposal.title, dueAt: proposal.instant, done: false, createdAt: now, updatedAt: now };
    data.entries[key] = operation;
    return operation;
  });
}

function remindersIn(data: VaultData) {
  return Object.entries(data.entries).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => {
    const operation = value as ReminderOperation;
    if (!operation || typeof operation.title !== "string" || operation.title.length > 2000 || typeof operation.id !== "string" || key !== prefix + operation.id || typeof operation.taskId !== "string" || !Array.isArray(operation.destinations) || operation.destinations.some(item => !["local", "calendar-mock", "clock-mock"].includes(item)) || !["scheduled", "due", "done", "needs-review", "cancelled"].includes(operation.status) || !Number.isFinite(operation.nextDueAt) || typeof operation.timeZone !== "string" || typeof operation.wallTime !== "string" || !["once", "daily", "weekly"].includes(operation.repeat) || !operation.destinationsState || typeof operation.destinationsState !== "object") throw new Error("Invalid local reminder record; original data retained for recovery");
    return operation;
  });
}
export async function listReminders() { return remindersIn((await readSecureVault()).data); }
export function reminderDisplayTime(operation: ReminderOperation) { const p = parts(operation.nextDueAt, operation.timeZone); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
type ReminderTask = PrivateItem & { dueAt?: number };
export async function mutateReminderTask(id: string, patch: { done?: boolean; title?: string; dueAt?: number; delete?: boolean }) {
  return secureVaultTransaction(data => {
    const key = `secretary-item:${id}`; const item = data.entries[key] as ReminderTask | undefined;
    if (!item || item.kind !== "task") throw new Error("Private task missing");
    const operation = remindersIn(data).find(value => value.taskId === id);
    if (patch.title !== undefined) { if (!patch.title.trim() || patch.title.length > 2000) throw new Error("Invalid task title"); item.title = patch.title.trim(); item.plainText = item.title; if (operation) operation.title = item.title; }
    if (patch.dueAt !== undefined) { if (!Number.isFinite(patch.dueAt)) throw new Error("Invalid task time"); item.dueAt = patch.dueAt; if (operation) { operation.nextDueAt = patch.dueAt; operation.wallTime = reminderDisplayTime(operation); operation.status = "scheduled"; operation.destinationsState.local = "scheduled"; } }
    if (patch.done !== undefined) item.done = patch.done;
    if (operation && (item.done || patch.delete)) { operation.status = "cancelled"; operation.destinationsState.local = patch.delete ? "task-deleted" : "task-completed"; }
    if (patch.delete) delete data.entries[key]; else item.updatedAt = Date.now();
  });
}
export async function cancelLocalReminder(id: string) {
  return secureVaultTransaction(data => {
    const operation = data.entries[prefix + id] as ReminderOperation; if (!operation) throw new Error("Reminder not found");
    operation.status = "cancelled"; operation.destinationsState.local = "cancelled-in-app";
  });
}
export async function checkDueReminders(now = Date.now()) {
  return secureVaultTransaction(data => {
    const operations = remindersIn(data);
    for (const operation of operations) {
      const task = data.entries[`secretary-item:${operation.taskId}`] as ReminderTask | undefined;
      if (!task || task.done) { operation.status = "cancelled"; operation.destinationsState.local = task ? "task-completed" : "task-deleted"; }
    }
    for (const operation of operations) if (operation.destinations.includes("local") && operation.status === "scheduled" && operation.nextDueAt <= now) {
      operation.status = "due"; operation.destinationsState.local = "due-in-app";
    }
    return operations.filter(operation => operation.status === "due");
  });
}
export async function acknowledgeReminder(id: string, now = Date.now()) {
  return secureVaultTransaction(data => {
    const operation = data.entries[prefix + id] as ReminderOperation; if (!operation) throw new Error("Reminder not found");
    if (operation.status !== "due") return;
    operation.status = "done"; operation.destinationsState.local = "acknowledged";
    if (operation.repeat !== "once") {
      operation.status = "needs-review";
      const p = parts(operation.nextDueAt, operation.timeZone);
      const base = new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
      for (let i = 0; i < 400; i++) {
        const wall = `${base.toISOString().slice(0, 10)}T${operation.wallTime.slice(11)}`;
        const candidates = wallTimeCandidates(wall, operation.timeZone);
        if (candidates.length !== 1) { operation.status = "needs-review"; break; }
        if (candidates[0] > now && candidates[0] > operation.nextDueAt) { operation.nextDueAt = candidates[0]; operation.wallTime = reminderDisplayTime(operation); operation.status = "scheduled"; operation.destinationsState.local = "scheduled"; break; }
        base.setUTCDate(base.getUTCDate() + (operation.repeat === "daily" ? 1 : 7));
      }
    }
    const task = data.entries[`secretary-item:${operation.taskId}`] as ReminderTask | undefined;
    if (task && operation.status === "scheduled") task.dueAt = operation.nextDueAt;
  });
}

/** No transport/network. Each simulated destination keeps independent durable state. */
export async function simulateDestination(id: string, destination: "calendar-mock" | "clock-mock", permission: boolean) {
  return secureVaultTransaction(data => {
    const operation = data.entries[prefix + id] as ReminderOperation; if (!operation) throw new Error("Reminder not found");
    if (!operation.destinations.includes(destination)) throw new Error("Destination not selected");
    const prior = operation.destinationsState[destination];
    if (prior === "mock-created" || prior === "mock-awaiting-clock-confirmation") return prior;
    const state = !permission ? "mock-permission-revoked" : destination === "calendar-mock" ? "mock-created" : operation.repeat === "once" ? "blocked-arbitrary-date" : "mock-awaiting-clock-confirmation";
    operation.destinationsState[destination] = state;
    return state;
  });
}

export const mockSources = [
  { id: "drive-demo-1", provider: "Google Drive", title: "合成旅行清單", text: "MOCK ONLY: packing checklist for a fictional trip.", scope: "drive.file · user-picked files only" },
  { id: "notion-demo-1", provider: "Notion", title: "合成專案頁", text: "MOCK ONLY: fictional project milestones.", scope: "Read content · explicitly shared pages only" },
] as const;
export async function importSelectedMockSources(ids: string[], permission: boolean, operationId: string) {
  if (!permission || !ids.length || ids.some(id => !mockSources.some(source => source.id === id))) throw new Error("Mock permission missing or source not selected");
  if (!/^[\w-]{8,100}$/.test(operationId)) throw new Error("Invalid operation ID");
  return secureVaultTransaction(data => {
    for (const id of [...new Set(ids)]) {
      const source = mockSources.find(source => source.id === id)!; const key = `mock-import-${operationId}-${id}`;
      if (!data.entries[`secretary-item:${key}`]) { const now = Date.now(); data.entries[`secretary-item:${key}`] = { id: key, kind: "note", title: source.title, plainText: `${source.title}\n${source.text}\nMock source ID: ${source.id}`, done: false, createdAt: now, updatedAt: now }; }
    }
  });
}
