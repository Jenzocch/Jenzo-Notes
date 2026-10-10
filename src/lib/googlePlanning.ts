import { db } from "../db";
import { readImageIdea, verifiedImageEvidence } from "./imageIdeas";
import { readSecureVault, secureVaultEpoch, secureVaultTransaction, type PersistenceGuard } from "./secureSecretary";
import { wallTimeCandidates } from "./secretary";

export type PlanningKind = "task" | "online-meeting" | "international-flight";
export type GooglePlanningDestination = "google-calendar" | "google-tasks";
export type GoogleConnectionState = "not-connected" | "connected" | "token-invalid";
export type PlanningSyncState = "pending" | "created" | "not-connected" | "token-invalid" | "failed" | "source-invalid";

export interface PlanningInput {
  kind: PlanningKind;
  title: string;
  details: string;
  wallTime: string;
  timeZone: string;
  location: string;
  reminderMinutes: string;
  dueDate: string;
  noDueDate: boolean;
  origin: string;
  transport: string;
  travelMinutes: string;
  preparationMinutes: string;
  trafficMinutes: string;
  imageCardId?: string;
  destinations: GooglePlanningDestination[];
}

export interface PlanningProposal {
  id: string;
  input: PlanningInput;
  questions: string[];
  startInstant?: number;
  airportArrivalInstant?: number;
  leaveInstant?: number;
  imageSource?: { cardId: string; updatedAt: number; sha256: string };
  renewGeneration?: number;
  issuedAt: number;
  expiresAt: number;
}

export interface PlanningOperation extends PlanningProposal {
  status: "confirmed" | "partially-synced" | "synced" | "source-revoked" | "cancelled";
  sync: Partial<Record<GooglePlanningDestination, PlanningSyncState>>;
  remoteIds: Partial<Record<GooglePlanningDestination, string>>;
  generation: number;
  sourceAuthority: "valid" | "revoked";
  createdAt: number;
}

export interface CalendarPayload {
  summary: string;
  description: string;
  location: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  reminders: { useDefault: false; overrides: Array<{ method: "popup"; minutes: number }> };
}

export interface TasksPayload { title: string; notes: string; due?: string }

export interface GooglePlanningConnector {
  readonly mode: "mock" | "real";
  connectionState(): Promise<GoogleConnectionState>;
  createCalendar(payload: CalendarPayload, idempotencyKey: string, signal?: AbortSignal): Promise<{ id: string }>;
  createTask(payload: TasksPayload, idempotencyKey: string, signal?: AbortSignal): Promise<{ id: string }>;
}

const prefix = "secretary-google-planning:";
const validId = (value: string) => /^[\w-]{8,100}$/.test(value);
const integer = (value: string, min: number, max: number) => /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
const noteReference = (cardId?: string) => cardId ? `Jenzo Notes card reference: ${cardId}` : "Jenzo encrypted planning reference only";

function oneInstant(wall: string, zone: string) {
  const candidates = wallTimeCandidates(wall, zone);
  if (!candidates.length) throw new Error("This local time does not exist because of a daylight-saving transition");
  if (candidates.length > 1) throw new Error("This local time occurs twice; choose another time and confirm the time zone");
  return candidates[0];
}

export function planningQuestions(input: PlanningInput) {
  const questions: string[] = [];
  if (!input.title.trim()) questions.push("What should this be called?");
  if (!input.details.trim()) questions.push("What details should be retained in the encrypted planning vault?");
  if (!input.destinations.length) questions.push("Should this draft go to Google Calendar, Google Tasks, or both?");
  if (input.kind === "task") {
    if (input.destinations.includes("google-calendar")) questions.push("A Notes task can sync to Google Tasks only in this version; create a separate Calendar draft for a timed event.");
    if (!input.noDueDate && !input.dueDate) questions.push("What is the due date, or should it have no due date?");
    if (input.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || new Date(`${input.dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== input.dueDate)) questions.push("Enter a real due date.");
  } else {
    if (!input.wallTime) questions.push(input.kind === "international-flight" ? "What is the flight departure date and local time?" : "When does the meeting start?");
    if (!input.timeZone.trim()) questions.push("Which IANA time zone applies?");
    if (!input.location.trim()) questions.push(input.kind === "international-flight" ? "Which departure airport/terminal?" : "What is the online meeting link or location?");
    if (!integer(input.reminderMinutes, 0, 40320)) questions.push("How many minutes before should the Calendar notification appear?");
  }
  if (input.kind === "international-flight") {
    if (!input.origin.trim()) questions.push("Where will you depart from for the airport?");
    if (!input.transport.trim()) questions.push("How will you travel to the airport?");
    if (!integer(input.travelMinutes, 1, 1440)) questions.push("How many minutes does travel normally take?");
    if (!integer(input.preparationMinutes, 0, 1440)) questions.push("How many preparation minutes do you need before leaving?");
    if (!integer(input.trafficMinutes, 0, 1440)) questions.push("How many traffic/buffer minutes should be included?");
  }
  return questions;
}

function normalizedPlanningInput(input: PlanningInput): PlanningInput {
  const common = { ...input, title: input.title.trim(), details: input.details.trim(), destinations: [...new Set(input.destinations)] };
  if (input.kind === "task") return { ...common, wallTime: "", location: "", origin: "", transport: "", travelMinutes: "", preparationMinutes: "", trafficMinutes: "" };
  if (input.kind === "online-meeting") return { ...common, dueDate: "", noDueDate: false, imageCardId: undefined, origin: "", transport: "", travelMinutes: "", preparationMinutes: "", trafficMinutes: "" };
  return { ...common, dueDate: "", noDueDate: false, imageCardId: undefined };
}

async function buildPlanningProposal(input: PlanningInput, id: string = crypto.randomUUID(), renewGeneration?: number): Promise<PlanningProposal> {
  if (input.title.length > 500 || input.details.length > 8000 || input.location.length > 1000 || input.origin.length > 1000 || input.transport.length > 500) throw new Error("Planning draft is too large");
  if (input.destinations.some(value => !["google-calendar", "google-tasks"].includes(value))) throw new Error("Invalid planning destination");
  const normalized = normalizedPlanningInput(input);
  const questions = planningQuestions(normalized);
  let startInstant: number | undefined; let airportArrivalInstant: number | undefined; let leaveInstant: number | undefined;
  if (!questions.length && normalized.kind !== "task") {
    startInstant = oneInstant(normalized.wallTime, normalized.timeZone);
    if (normalized.kind === "international-flight") {
      // This is the user's planning preference, not a universal airline rule.
      airportArrivalInstant = startInstant - 180 * 60000;
      leaveInstant = airportArrivalInstant - (Number(normalized.travelMinutes) + Number(normalized.preparationMinutes) + Number(normalized.trafficMinutes)) * 60000;
    }
  }
  const issuedAt = Date.now();
  const imageSource = normalized.imageCardId ? await imageSnapshot(normalized.imageCardId) : undefined;
  const proposal = { id, input: normalized, questions, startInstant, airportArrivalInstant, leaveInstant, imageSource, renewGeneration, issuedAt, expiresAt: issuedAt + 5 * 60000 };
  if (imageSource) await registerProposalGuard(proposal);
  return proposal;
}
export function proposePlanning(input: PlanningInput) { return buildPlanningProposal(input); }

export async function repreviewPlanning(id: string) {
  const operation = (await listPlanningOperations()).find(value => value.id === id);
  if (!operation || operation.status !== "source-revoked" || operation.sourceAuthority !== "revoked" || !operation.input.imageCardId) throw new Error("Planning source consent is not awaiting renewal");
  return buildPlanningProposal(operation.input, operation.id, operation.generation);
}

function proposalFingerprint(proposal: PlanningProposal) { return JSON.stringify(proposal); }

const confirmations = new Map<string, Promise<PlanningOperation>>();
export function confirmPlanning(proposal: PlanningProposal): Promise<PlanningOperation> {
  const existing = confirmations.get(proposal.id); if (existing) return existing;
  const run = confirmPlanningInner(proposal).finally(() => confirmations.delete(proposal.id)); confirmations.set(proposal.id, run); return run;
}

async function confirmPlanningInner(proposal: PlanningProposal) {
  if (!validId(proposal.id) || proposal.questions.length || planningQuestions(proposal.input).length) throw new Error("Draft is incomplete or invalid; preview it again before confirming");
  const prior = (await readSecureVault()).data.entries[prefix + proposal.id] as PlanningOperation | undefined;
  if (prior) {
    if (proposal.renewGeneration !== undefined) return renewPlanningConsent(prior, proposal);
    const priorProposal: PlanningProposal = { id: prior.id, input: prior.input, questions: prior.questions, startInstant: prior.startInstant, airportArrivalInstant: prior.airportArrivalInstant, leaveInstant: prior.leaveInstant, imageSource: prior.imageSource, issuedAt: prior.issuedAt, expiresAt: prior.expiresAt };
    if (proposalFingerprint(priorProposal) !== proposalFingerprint(proposal)) throw new Error("Planning operation ID was reused with different content");
    return prior;
  }
  if (proposal.renewGeneration !== undefined) throw new Error("Planning renewal target is missing; preview again");
  if (proposal.expiresAt !== proposal.issuedAt + 5 * 60000 || Date.now() > proposal.expiresAt) throw new Error("Draft is expired; preview it again before confirming");
  if (proposal.input.kind !== "task") {
    const expectedStart = oneInstant(proposal.input.wallTime, proposal.input.timeZone);
    const expectedArrival = proposal.input.kind === "international-flight" ? expectedStart - 180 * 60000 : undefined;
    const expectedLeave = expectedArrival === undefined ? undefined : expectedArrival - (Number(proposal.input.travelMinutes) + Number(proposal.input.preparationMinutes) + Number(proposal.input.trafficMinutes)) * 60000;
    if (proposal.startInstant !== expectedStart || proposal.airportArrivalInstant !== expectedArrival || proposal.leaveInstant !== expectedLeave) throw new Error("Draft timing changed; preview it again before confirming");
  }
  const guardRecord = proposal.input.imageCardId ? proposalGuards.get(proposal.id) : undefined;
  if (proposal.input.imageCardId && (!proposal.imageSource || !guardRecord)) throw new Error("Image consent expired or changed; preview again");
  let stored = false;
  try { const result = await secureVaultTransaction(data => {
    const key = prefix + proposal.id; const existing = data.entries[key] as PlanningOperation | undefined;
    if (existing) {
      if (proposalFingerprint({ id: existing.id, input: existing.input, questions: existing.questions, startInstant: existing.startInstant, airportArrivalInstant: existing.airportArrivalInstant, leaveInstant: existing.leaveInstant, imageSource: existing.imageSource, issuedAt: existing.issuedAt, expiresAt: existing.expiresAt }) !== proposalFingerprint(proposal)) throw new Error("Planning operation ID was reused with different content");
      return existing;
    }
    const operation: PlanningOperation = { ...proposal, status: "confirmed", sync: Object.fromEntries(proposal.input.destinations.map(destination => [destination, "pending"])), remoteIds: {}, generation: 1, sourceAuthority: "valid", createdAt: Date.now() };
    data.entries[key] = operation; return operation;
  }, guardRecord?.guard); stored = true; return result; } finally { if (stored) disposeProposalGuard(proposal.id); }
}

async function renewPlanningConsent(prior: PlanningOperation, proposal: PlanningProposal) {
  if (prior.status !== "source-revoked" || prior.sourceAuthority !== "revoked" || proposal.renewGeneration !== prior.generation || !proposal.imageSource || JSON.stringify(proposal.input) !== JSON.stringify(prior.input)) throw new Error("Planning renewal authority changed; preview again");
  if (proposal.expiresAt !== proposal.issuedAt + 5 * 60000 || Date.now() > proposal.expiresAt) throw new Error("Draft is expired; preview it again before confirming");
  const guardRecord = proposalGuards.get(proposal.id); if (!guardRecord) throw new Error("Image consent expired or changed; preview again"); let stored = false;
  try { const result = await secureVaultTransaction(data => {
    const current = data.entries[prefix + proposal.id] as PlanningOperation | undefined;
    if (!current || current.status !== "source-revoked" || current.sourceAuthority !== "revoked" || current.generation !== proposal.renewGeneration) throw new Error("Planning renewal authority changed; preview again");
    current.imageSource = proposal.imageSource; current.issuedAt = proposal.issuedAt; current.expiresAt = proposal.expiresAt; current.renewGeneration = undefined; current.sourceAuthority = "valid"; current.generation++; refreshStatus(current); return current;
  }, guardRecord.guard); stored = true; return result; } finally { if (stored) disposeProposalGuard(proposal.id); }
}

export async function listPlanningOperations() {
  const entries = Object.entries((await readSecureVault()).data.entries).filter(([key]) => key.startsWith(prefix));
  return entries.map(([key, value]) => {
    const operation = value as PlanningOperation;
    if (!operation || key !== prefix + operation.id || !validId(operation.id) || !Number.isSafeInteger(operation.generation) || operation.generation < 1 || !["confirmed", "partially-synced", "synced", "source-revoked", "cancelled"].includes(operation.status) || !["valid", "revoked"].includes(operation.sourceAuthority) || (operation.status === "source-revoked" && operation.sourceAuthority !== "revoked") || (operation.sourceAuthority === "revoked" && !["source-revoked", "cancelled"].includes(operation.status)) || !operation.input || !["task", "online-meeting", "international-flight"].includes(operation.input.kind) || !Array.isArray(operation.input.destinations) || operation.input.destinations.some(destination => !["google-calendar", "google-tasks"].includes(destination)) || planningQuestions(operation.input).length || JSON.stringify(operation.input) !== JSON.stringify(normalizedPlanningInput(operation.input)) || Boolean(operation.input.imageCardId) !== Boolean(operation.imageSource) || operation.imageSource?.cardId !== operation.input.imageCardId) throw new Error("Invalid planning record; original data retained for recovery");
    return operation;
  });
}

export async function cancelPlanning(id: string) {
  return secureVaultTransaction(data => { const operation = data.entries[prefix + id] as PlanningOperation | undefined; if (!operation) throw new Error("Planning operation not found"); if (Object.values(operation.sync).includes("created")) throw new Error("Already-created Google items cannot be cancelled locally; remove them in Google"); operation.status = "cancelled"; operation.generation++; return operation; });
}

async function validateImageCard(cardId: string) {
  const card = await db.cards.get(cardId);
  if (!card || card.state === "trash" || !readImageIdea(card)) throw new Error("Linked Notes image is missing or changed");
  await verifiedImageEvidence(card);
  return card;
}

async function imageSnapshot(cardId: string) {
  const card = await validateImageCard(cardId); const idea = readImageIdea(card)!;
  return { cardId: card.id, updatedAt: card.updatedAt, sha256: idea.sha256 };
}

async function validateImageSnapshot(snapshot: NonNullable<PlanningProposal["imageSource"]>) {
  try { const current = await imageSnapshot(snapshot.cardId); if (current.updatedAt !== snapshot.updatedAt || current.sha256 !== snapshot.sha256) throw new Error(); }
  catch { throw new Error("planning-image-source-invalidated; preview again"); }
}

function imageSourceGuard(snapshot: NonNullable<PlanningProposal["imageSource"]>) {
  const epoch = secureVaultEpoch(); let revoked = false; const dispose: Array<() => void> = [];
  const cardChanged = (key: unknown) => { if (String(key) === snapshot.cardId) revoked = true; };
  const cardUpdating = (_changes: unknown, key: unknown) => cardChanged(key);
  const cardCreating = (key: unknown, record: { id?: string }) => cardChanged(key ?? record.id);
  db.cards.hook("updating", cardUpdating); db.cards.hook("deleting", cardChanged); db.cards.hook("creating", cardCreating);
  dispose.push(() => { db.cards.hook("updating").unsubscribe(cardUpdating); db.cards.hook("deleting").unsubscribe(cardChanged); db.cards.hook("creating").unsubscribe(cardCreating); });
  const attachmentChanged = () => { revoked = true; };
  db.attachments.hook("updating", attachmentChanged); db.attachments.hook("deleting", attachmentChanged); db.attachments.hook("creating", attachmentChanged);
  dispose.push(() => { db.attachments.hook("updating").unsubscribe(attachmentChanged); db.attachments.hook("deleting").unsubscribe(attachmentChanged); db.attachments.hook("creating").unsubscribe(attachmentChanged); });
  const lock = () => { revoked = true; }; window.addEventListener("chengjing:secure-vault-locking", lock); dispose.push(() => window.removeEventListener("chengjing:secure-vault-locking", lock));
  const assertCurrent = () => { if (revoked || epoch !== secureVaultEpoch()) throw new Error("planning-image-source-invalidated; preview again"); };
  return { assertCurrent, async revalidate() { assertCurrent(); await validateImageSnapshot(snapshot); assertCurrent(); }, dispose() { dispose.forEach(callback => callback()); } } satisfies PersistenceGuard & { dispose(): void };
}

const proposalGuards = new Map<string, { guard: ReturnType<typeof imageSourceGuard>; timer: ReturnType<typeof setTimeout> }>();
async function registerProposalGuard(proposal: PlanningProposal) {
  const guard = imageSourceGuard(proposal.imageSource!); await guard.revalidate();
  const timer = setTimeout(() => disposeProposalGuard(proposal.id), Math.max(0, proposal.expiresAt - Date.now())); proposalGuards.set(proposal.id, { guard, timer });
}
function disposeProposalGuard(id: string) { const record = proposalGuards.get(id); if (!record) return; clearTimeout(record.timer); record.guard.dispose(); proposalGuards.delete(id); }

function iso(instant: number) { return new Date(instant).toISOString(); }

export function calendarPayload(operation: PlanningOperation): CalendarPayload {
  if (operation.input.kind === "task" || operation.startInstant === undefined) throw new Error("This draft is not a Calendar event");
  const start = operation.input.kind === "international-flight" ? operation.leaveInstant! : operation.startInstant;
  const end = start + (operation.input.kind === "international-flight" ? 30 : 60) * 60000;
  const description = [operation.input.details, noteReference(operation.input.imageCardId), operation.input.kind === "international-flight" ? `User planning preference: target airport arrival ${iso(operation.airportArrivalInstant!)} (3 hours before departure); origin ${operation.input.origin}; transport ${operation.input.transport}; travel ${operation.input.travelMinutes}m; preparation ${operation.input.preparationMinutes}m; traffic buffer ${operation.input.trafficMinutes}m. This is not a universal airline rule.` : ""].filter(Boolean).join("\n\n");
  return { summary: operation.input.kind === "international-flight" ? `Leave for airport: ${operation.input.title}` : operation.input.title, description, location: operation.input.kind === "international-flight" ? `${operation.input.origin} → ${operation.input.location}` : operation.input.location, start: { dateTime: iso(start), timeZone: operation.input.timeZone }, end: { dateTime: iso(end), timeZone: operation.input.timeZone }, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: Number(operation.input.reminderMinutes) }] } };
}

export function tasksPayload(operation: PlanningOperation): TasksPayload {
  const schedule = operation.input.kind === "online-meeting" ? `Meeting: ${operation.input.wallTime} ${operation.input.timeZone}\nLocation: ${operation.input.location}` : operation.input.kind === "international-flight" ? `Flight departure: ${operation.input.wallTime} ${operation.input.timeZone}\nDeparture airport: ${operation.input.location}\nPlanned airport arrival: ${iso(operation.airportArrivalInstant!)}\nPlanned leave/start preparing: ${iso(operation.leaveInstant!)}\nUser preference only; not a universal airline rule.` : "";
  const notes = [operation.input.details, schedule, noteReference(operation.input.imageCardId), operation.input.imageCardId ? "Photo stays in Jenzo Notes; Google Tasks receives no attachment or local file path." : ""].filter(Boolean).join("\n\n");
  // Google Tasks discards the time component of `due`; send date-only intent at UTC midnight.
  return { title: operation.input.title, notes, ...(operation.input.kind === "task" && operation.input.dueDate ? { due: `${operation.input.dueDate}T00:00:00.000Z` } : {}) };
}

const inFlight = new Map<string, Promise<PlanningOperation>>();
export function syncPlanning(id: string, connector: GooglePlanningConnector, signal?: AbortSignal): Promise<PlanningOperation> {
  const existing = inFlight.get(id); if (existing) return existing;
  const run = syncPlanningInner(id, connector, signal).finally(() => inFlight.delete(id)); inFlight.set(id, run); return run;
}

async function syncPlanningInner(id: string, connector: GooglePlanningConnector, signal?: AbortSignal) {
  if (connector.mode !== "mock") throw new Error("Real Google writes are not enabled in this build");
  let operation = (await listPlanningOperations()).find(value => value.id === id); if (!operation) throw new Error("Planning operation not found");
  if (operation.status === "cancelled") throw new Error("Planning operation was cancelled");
  if (operation.status === "source-revoked" || operation.sourceAuthority === "revoked") throw new Error("Planning image consent was revoked; preview and confirm the source again");
  const generation = operation.generation; const sourceGuard = operation.imageSource ? imageSourceGuard(operation.imageSource) : undefined;
  try {
    await sourceGuard?.revalidate();
    const connection = await connector.connectionState();
    await sourceGuard?.revalidate(); operation = await activePlanningOperation(id, generation);
    if (connection !== "connected") return updateSync(id, generation, operation.input.destinations.filter(destination => operation!.sync[destination] !== "created"), connection);
    for (const destination of operation.input.destinations) {
      if (signal?.aborted) break;
      operation = await activePlanningOperation(id, generation);
      if (operation.sync[destination] === "created") continue;
      try {
        await sourceGuard?.revalidate(); operation = await activePlanningOperation(id, generation); sourceGuard?.assertCurrent();
        const result = destination === "google-calendar" ? await connector.createCalendar(calendarPayload(operation), `${id}:calendar`, signal) : await connector.createTask(tasksPayload(operation), `${id}:tasks`, signal);
        await sourceGuard?.revalidate();
        await secureVaultTransaction(data => { const current = data.entries[prefix + id] as PlanningOperation; if (current.status === "cancelled" || current.generation !== generation) return; current.sync[destination] = "created"; current.remoteIds[destination] = result.id; refreshStatus(current); }, sourceGuard);
      } catch (error) {
        if (signal?.aborted) break;
        const state = error instanceof Error && /source-invalidated/.test(error.message) ? "source-invalid" : error instanceof Error && /token/i.test(error.message) ? "token-invalid" : "failed";
        if (state === "source-invalid") await revokeSourceConsent(id, generation, [destination]); else await updateSync(id, generation, [destination], state);
        if (state === "source-invalid") break;
      }
    }
    return (await listPlanningOperations()).find(value => value.id === id)!;
  } catch (error) {
    if (error instanceof Error && /source-invalidated/.test(error.message)) return revokeSourceConsent(id, generation, operation.input.destinations);
    if (error instanceof Error && /cancelled|authority changed/.test(error.message)) return (await listPlanningOperations()).find(value => value.id === id)!;
    throw error;
  } finally { sourceGuard?.dispose(); }
}

async function activePlanningOperation(id: string, generation: number) { const operation = (await listPlanningOperations()).find(value => value.id === id); if (!operation) throw new Error("Planning operation not found"); if (operation.status === "cancelled" || operation.status === "source-revoked" || operation.sourceAuthority !== "valid" || operation.generation !== generation) throw new Error("Planning operation cancelled or authority changed"); return operation; }

function refreshStatus(operation: PlanningOperation) {
  if (operation.sourceAuthority === "revoked") { operation.status = "source-revoked"; return; }
  const states = operation.input.destinations.map(destination => operation.sync[destination]);
  operation.status = states.every(value => value === "created") ? "synced" : states.some(value => value === "created") ? "partially-synced" : "confirmed";
}

async function revokeSourceConsent(id: string, generation: number, destinations: GooglePlanningDestination[]) {
  return secureVaultTransaction(data => { const operation = data.entries[prefix + id] as PlanningOperation | undefined; if (!operation) throw new Error("Planning operation not found"); if (operation.status === "cancelled" || operation.generation !== generation) return operation; for (const destination of destinations) if (operation.sync[destination] !== "created") operation.sync[destination] = "source-invalid"; operation.sourceAuthority = "revoked"; operation.status = "source-revoked"; operation.generation++; return operation; });
}

async function updateSync(id: string, generation: number, destinations: GooglePlanningDestination[], state: PlanningSyncState | GoogleConnectionState) {
  return secureVaultTransaction(data => { const operation = data.entries[prefix + id] as PlanningOperation | undefined; if (!operation) throw new Error("Planning operation not found"); if (operation.status === "cancelled" || operation.generation !== generation) return operation; for (const destination of destinations) if (operation.sync[destination] !== "created") operation.sync[destination] = state as PlanningSyncState; refreshStatus(operation); return operation; });
}

export function createMockGoogleConnector(state: GoogleConnectionState, fail?: GooglePlanningDestination): GooglePlanningConnector {
  const seen = new Map<string, string>();
  const create = async (destination: GooglePlanningDestination, key: string, signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); if (fail === destination) throw new Error("synthetic partial sync failure"); const prior = seen.get(key); if (prior) return { id: prior }; const id = `MOCK-${destination}-${seen.size + 1}`; seen.set(key, id); return { id }; };
  return { mode: "mock", connectionState: async () => state, createCalendar: async (_payload, key, signal) => create("google-calendar", key, signal), createTask: async (_payload, key, signal) => create("google-tasks", key, signal) };
}
