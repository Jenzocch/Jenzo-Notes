import { db } from "../db";
import { isMaterializedCard } from "./journalVisibility";
import { requirePublicRecord } from "./privateOutbound";

/** Validate sourceContext's structured wire format against legacy authority.
 * No arbitrary-text classification, vault reads, or caller “public” override.
 */
export async function validatePublicSourceContext(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new Error("outbound-provenance-invalid:remote-ai");
  await db.transaction("r", db.cards, db.fragments, async () => {
    for (const source of value) {
      if (!source || typeof source.key !== "string" || typeof source.title !== "string" || typeof source.excerpt !== "string" || !source.excerpt.trim() || source.excerpt.length > 1600) throw new Error("outbound-provenance-invalid:remote-ai");
      const match = /^(card|fragment):(.+)$/.exec(source.key);
      if (!match) throw new Error("outbound-source-unknown:remote-ai");
      const record = match[1] === "card" ? await db.cards.get(match[2]) : await db.fragments.get(match[2]);
      if (!record || ("state" in record && (record.state === "trash" || !isMaterializedCard(record)))) throw new Error("outbound-source-unavailable:remote-ai");
      requirePublicRecord("remote-ai", record);
      const text = "plainText" in record ? record.plainText : record.text;
      const title = "title" in record ? record.title : record.text.split("\n")[0].slice(0, 80);
      const url = "sourceUrl" in record ? record.sourceUrl : undefined;
      if (title !== source.title || !text.includes(source.excerpt) || source.sourceUrl !== url) throw new Error("outbound-source-changed:remote-ai");
    }
  });
}
