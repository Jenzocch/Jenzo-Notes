import { db } from "../db";
import type { TaskRecord } from "../types";
import { readImageIdea, verifiedImageEvidence } from "./imageIdeas";
import { readSecureVault, secureVaultTransaction } from "./secureSecretary";
import { wallTimeCandidates } from "./secretary";
import { dueDateInputToTimestamp } from "./taskSync";

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
  issuedAt: number;
  expiresAt: number;
}

export interface PlanningOperation extends PlanningProposal {
  status: "confirmed" | "partially-synced" | "synced" | "cancelled";
  localTaskId?: string;
  sync: Partial<Record<GooglePlanningDestination, PlanningSyncState>>;
  remoteIds: Partial<Record<GooglePlanningDestination, string>>;
  imageSource?: { cardId: string; updatedAt: number; sha256: string };
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
const noteReference = (cardId?: string) => cardId ? `Jenzo Notes card reference: ${cardId}` : "Jenzo Notes local draft reference only";

function oneInstant(wall: string, zone: string) {
  const candidates = wallTimeCandidates(wall, zone);
  if (!candidates.length) throw new Error("This local time does not exist because of a daylight-saving transition");
  if (candidates.length > 1) throw new Error("This local time occurs twice; choose another time and confirm the time zone");
  return candidates[0];
}

export function planningQuestions(input: PlanningInput) {
  const questions: string[] = [];
  if (!input.title.trim()) questions.push("What should this be called?");
  if (!input.details.trim()) questions.push("What details should be retained in Notes?");
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

export function proposePlanning(input: PlanningInput): PlanningProposal {
  if (input.title.length > 500 || input.details.length > 8000 || input.location.length > 1000 || input.origin.length > 1000 || input.transport.length > 500) throw new Error("Planning draft is too large");
  if (input.destinations.some(value => !["google-calendar", "google-tasks"].includes(value))) throw new Error("Invalid planning destination");
  const normalized = { ...input, title: input.title.trim(), details: input.details.trim(), destinations: [...new Set(input.destinations)] };
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
  return { id: crypto.randomUUID(), input: normalized, questions, startInstant, airportArrivalInstant, leaveInstant, issuedAt, expiresAt: issuedAt + 5 * 60000 };
}

function proposalFingerprint(proposal: PlanningProposal) { return JSON.stringify(proposal); }

const confirmations = new Map<string, Promise<PlanningOperation>>();
export function confirmPlanning(proposal: PlanningProposal): Promise<PlanningOperation> {
  const existing = confirmations.get(proposal.id); if (existing) return existing;
  const run = confirmPlanningInner(proposal).finally(() => confirmations.delete(proposal.id)); confirmations.set(proposal.id, run); return run;
}

async function confirmPlanningInner(proposal: PlanningProposal) {
  if (!validId(proposal.id) || proposal.questions.length || planningQuestions(proposal.input).length || proposal.expiresAt !== proposal.issuedAt + 5 * 60000 || Date.now() > proposal.expiresAt) throw new Error("Draft is incomplete or expired; preview it again before confirming");
  if (proposal.input.kind !== "task") {
    const expectedStart = oneInstant(proposal.input.wallTime, proposal.input.timeZone);
    const expectedArrival = proposal.input.kind === "international-flight" ? expectedStart - 180 * 60000 : undefined;
    const expectedLeave = expectedArrival === undefined ? undefined : expectedArrival - (Number(proposal.input.travelMinutes) + Number(proposal.input.preparationMinutes) + Number(proposal.input.trafficMinutes)) * 60000;
    if (proposal.startInstant !== expectedStart || proposal.airportArrivalInstant !== expectedArrival || proposal.leaveInstant !== expectedLeave) throw new Error("Draft timing changed; preview it again before confirming");
  }
  const imageCard = proposal.input.imageCardId ? await validateImageCard(proposal.input.imageCardId) : undefined;
  const imageIdea = imageCard ? readImageIdea(imageCard) : null;
  let localTask: TaskRecord | undefined;
  if (proposal.input.kind === "task") {
    localTask = await db.tasks.where("conversionKey").equals(`google-planning:${proposal.id}`).first();
    if (!localTask) {
      const now = Date.now();
      localTask = { id: crypto.randomUUID(), title: proposal.input.title, done: false, cardId: proposal.input.imageCardId, conversionKey: `google-planning:${proposal.id}`, dueAt: proposal.input.dueDate ? dueDateInputToTimestamp(proposal.input.dueDate) : undefined, createdAt: now, updatedAt: now };
      await db.tasks.add(localTask);
    }
  }
  return secureVaultTransaction(data => {
    const key = prefix + proposal.id; const existing = data.entries[key] as PlanningOperation | undefined;
    if (existing) {
      if (proposalFingerprint({ id: existing.id, input: existing.input, questions: existing.questions, startInstant: existing.startInstant, airportArrivalInstant: existing.airportArrivalInstant, leaveInstant: existing.leaveInstant, issuedAt: existing.issuedAt, expiresAt: existing.expiresAt }) !== proposalFingerprint(proposal)) throw new Error("Planning operation ID was reused with different content");
      return existing;
    }
    const operation: PlanningOperation = { ...proposal, status: "confirmed", localTaskId: localTask?.id, sync: Object.fromEntries(proposal.input.destinations.map(destination => [destination, "pending"])), remoteIds: {}, ...(imageCard && imageIdea ? { imageSource: { cardId: imageCard.id, updatedAt: imageCard.updatedAt, sha256: imageIdea.sha256 } } : {}), createdAt: Date.now() };
    data.entries[key] = operation; return operation;
  });
}

export async function listPlanningOperations() {
  const entries = Object.entries((await readSecureVault()).data.entries).filter(([key]) => key.startsWith(prefix));
  return entries.map(([key, value]) => {
    const operation = value as PlanningOperation;
    if (!operation || key !== prefix + operation.id || !validId(operation.id) || !["confirmed", "partially-synced", "synced", "cancelled"].includes(operation.status) || !operation.input || !["task", "online-meeting", "international-flight"].includes(operation.input.kind) || !Array.isArray(operation.input.destinations) || operation.input.destinations.some(destination => !["google-calendar", "google-tasks"].includes(destination)) || planningQuestions(operation.input).length) throw new Error("Invalid planning record; original data retained for recovery");
    return operation;
  });
}

export async function cancelPlanning(id: string) {
  return secureVaultTransaction(data => { const operation = data.entries[prefix + id] as PlanningOperation | undefined; if (!operation) throw new Error("Planning operation not found"); if (Object.values(operation.sync).includes("created")) throw new Error("Already-created Google items cannot be cancelled locally; remove them in Google"); operation.status = "cancelled"; return operation; });
}

async function validateImageCard(cardId: string) {
  const card = await db.cards.get(cardId);
  if (!card || card.state === "trash" || !readImageIdea(card)) throw new Error("Linked Notes image is missing or changed");
  await verifiedImageEvidence(card);
  return card;
}

async function validateOperationImage(operation: PlanningOperation) {
  if (!operation.input.imageCardId) return;
  const card = await validateImageCard(operation.input.imageCardId); const idea = readImageIdea(card);
  if (!operation.imageSource || operation.imageSource.cardId !== card.id || operation.imageSource.updatedAt !== card.updatedAt || operation.imageSource.sha256 !== idea?.sha256) throw new Error("Linked Notes image is missing or changed");
}

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
  return { title: operation.input.title, notes, ...(operation.input.dueDate ? { due: `${operation.input.dueDate}T00:00:00.000Z` } : {}) };
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
  if (operation.input.imageCardId) { try { await validateOperationImage(operation); } catch { return updateSync(id, operation.input.destinations, "source-invalid"); } }
  const connection = await connector.connectionState();
  if (connection !== "connected") return updateSync(id, operation.input.destinations.filter(destination => operation!.sync[destination] !== "created"), connection);
  for (const destination of operation.input.destinations) {
    if (signal?.aborted) break;
    operation = (await listPlanningOperations()).find(value => value.id === id)!;
    if (operation.status === "cancelled" || operation.sync[destination] === "created") continue;
    try {
      const result = destination === "google-calendar" ? await connector.createCalendar(calendarPayload(operation), `${id}:calendar`, signal) : await connector.createTask(tasksPayload(operation), `${id}:tasks`, signal);
      await secureVaultTransaction(data => { const current = data.entries[prefix + id] as PlanningOperation; if (current.status !== "cancelled") { current.sync[destination] = "created"; current.remoteIds[destination] = result.id; refreshStatus(current); } });
    } catch (error) {
      if (signal?.aborted) break;
      await updateSync(id, [destination], error instanceof Error && /token/i.test(error.message) ? "token-invalid" : "failed");
    }
  }
  return (await listPlanningOperations()).find(value => value.id === id)!;
}

function refreshStatus(operation: PlanningOperation) {
  const states = operation.input.destinations.map(destination => operation.sync[destination]);
  operation.status = states.every(value => value === "created") ? "synced" : states.some(value => value === "created") ? "partially-synced" : "confirmed";
}

async function updateSync(id: string, destinations: GooglePlanningDestination[], state: PlanningSyncState | GoogleConnectionState) {
  return secureVaultTransaction(data => { const operation = data.entries[prefix + id] as PlanningOperation | undefined; if (!operation) throw new Error("Planning operation not found"); for (const destination of destinations) if (operation.sync[destination] !== "created") operation.sync[destination] = state as PlanningSyncState; refreshStatus(operation); return operation; });
}

export function createMockGoogleConnector(state: GoogleConnectionState, fail?: GooglePlanningDestination): GooglePlanningConnector {
  const seen = new Map<string, string>();
  const create = async (destination: GooglePlanningDestination, key: string, signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); if (fail === destination) throw new Error("synthetic partial sync failure"); const prior = seen.get(key); if (prior) return { id: prior }; const id = `MOCK-${destination}-${seen.size + 1}`; seen.set(key, id); return { id }; };
  return { mode: "mock", connectionState: async () => state, createCalendar: async (_payload, key, signal) => create("google-calendar", key, signal), createTask: async (_payload, key, signal) => create("google-tasks", key, signal) };
}
