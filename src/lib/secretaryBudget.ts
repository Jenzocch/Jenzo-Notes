import { db } from "../db";

export function requireCloudBudgetAuthorization() {
  // A device-local counter cannot enforce the user's shared monthly target.
  // No production coordinator or trustworthy price agreement has been approved.
  throw new Error("Cloud AI paused: shared NT$100/month budget coordinator and verified prices are not configured. Local capture, search and reminders remain available. / 雲端 AI 暫停：尚未設定共用預算帳本及可信費率。");
}
export interface MockQuote { inputTokens: number; maxOutputTokens: number; retries: number; inputUsdPerMillion: number; outputUsdPerMillion: number; usdToTwd: number; buffer: number }
interface Reservation { operationId: string; quote: string; reservedUnits: number }
interface MockLedger { reservations: Reservation[] }
export function conservativeMockCost(quote: MockQuote) {
  if (Object.values(quote).some(value => !Number.isFinite(value) || value < 0) || !Number.isSafeInteger(quote.inputTokens) || !Number.isSafeInteger(quote.maxOutputTokens) || !Number.isSafeInteger(quote.retries) || quote.retries > 10 || quote.maxOutputTokens <= 0 || quote.inputUsdPerMillion <= 0 || quote.outputUsdPerMillion <= 0 || quote.usdToTwd <= 0 || quote.buffer < 1.3) throw new Error("Unknown or invalid cost: fail closed");
  const units = Math.ceil(((quote.inputTokens * quote.inputUsdPerMillion + quote.maxOutputTokens * quote.outputUsdPerMillion) / 1000000) * (quote.retries + 1) * quote.usdToTwd * quote.buffer * 10000);
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error("Invalid cost");
  return units;
}
export async function reserveMockCost(operationId: string, quote: MockQuote, month = new Date().toISOString().slice(0, 7)) {
  if (!/^[\w-]{8,100}$/.test(operationId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid reservation");
  const units = conservativeMockCost(quote); const signature = JSON.stringify(quote);
  return db.transaction("rw", db.preferences, async () => {
    const key = `secretary-mock-budget:${month}`;
    const ledger = (await db.preferences.get(key))?.value as MockLedger | undefined || { reservations: [] };
    if (!Array.isArray(ledger.reservations) || ledger.reservations.some(item => !item || typeof item.operationId !== "string" || typeof item.quote !== "string" || !Number.isSafeInteger(item.reservedUnits) || item.reservedUnits <= 0) || new Set(ledger.reservations.map(item => item.operationId)).size !== ledger.reservations.length) throw new Error("Invalid mock ledger: fail closed; original data retained");
    const prior = ledger.reservations.find(item => item.operationId === operationId);
    if (prior) { if (prior.quote !== signature) throw new Error("Reservation ID reused with different cost"); return prior.reservedUnits / 10000; }
    const total = ledger.reservations.reduce((sum, item) => sum + item.reservedUnits, 0);
    if (!Number.isSafeInteger(total) || total + units > 100 * 10000) throw new Error("Mock monthly budget exhausted");
    ledger.reservations.push({ operationId, quote: signature, reservedUnits: units });
    await db.preferences.put({ key, value: ledger }); return units / 10000;
  });
}
