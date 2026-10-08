import { db } from "../db";
import { useAppStore } from "../store";
import type { BrainContentType } from "../types";
import { journalBrainTitle } from "./brain";
import { intlLocale } from "../i18n";
import { getTaskIntegrationCopy, taskCopyFormat } from "./taskIntegrationCopy";
import { isMaterializedCard } from "./journalVisibility";
import { requirePublicRecord, requirePublicSources } from "./privateOutbound";

/** Only legacy public tables are authority for community publication. Never
 * accept arbitrary replacement body/title or look up encrypted-vault sources.
 */
export async function resolvePublicShareSource(key: unknown) {
  if (typeof key !== "string" || !key) throw new Error("share-source-required");
  requirePublicSources("share", [{ key }]);
  const match = /^(card|board|fragment|task):(.+)$/.exec(key);
  if (!match || match[2].startsWith("private:")) throw new Error("share-source-unknown");
  const type = match[1] as BrainContentType, id = match[2];
  const language = useAppStore.getState().language || "zh-TW";
  return db.transaction("r", db.cards, db.boards, db.boardNodes, db.fragments, db.tasks, async () => {
    const table = type === "card" ? db.cards : type === "board" ? db.boards : type === "fragment" ? db.fragments : db.tasks;
    const record = await table.get(id);
    if (!record) throw new Error("share-source-unavailable");
    requirePublicRecord("share", record);
    let title: string, body: string;
    if (type === "card") {
      const card = await db.cards.get(id);
      if (!card || card.state === "trash" || !isMaterializedCard(card)) throw new Error("share-source-unavailable");
      title = card.kind === "journal" ? journalBrainTitle(card, language) : card.title;
      body = card.plainText.trim() || title;
    } else if (type === "board") {
      const board = await db.boards.get(id);
      if (!board) throw new Error("share-source-unavailable");
      const nodes = (await db.boardNodes.where("boardId").equals(id).toArray()).filter(node => !node.cardId);
      nodes.forEach(node => requirePublicRecord("share", node));
      title = board.title;
      const text = nodes.map(node => node.title || node.text || "").filter(Boolean).join("\n");
      body = [board.description, text].filter(Boolean).join("\n").trim() || title;
    } else if (type === "fragment") {
      const fragment = await db.fragments.get(id);
      if (!fragment) throw new Error("share-source-unavailable");
      title = fragment.text.slice(0, 36); body = fragment.text.trim() || title;
    } else {
      const task = await db.tasks.get(id);
      if (!task) throw new Error("share-source-unavailable");
      const card = task.cardId ? await db.cards.get(task.cardId) : undefined;
      if (task.cardId && (!card || card.state === "trash")) throw new Error("share-source-unavailable");
      if (card) requirePublicRecord("share", card);
      const copy = getTaskIntegrationCopy(language);
      const due = task.dueAt ? new Intl.DateTimeFormat(intlLocale[language], { year: "numeric", month: "short", day: "numeric" }).format(task.dueAt) : "";
      title = task.title;
      body = [task.done ? copy.taskDone : copy.taskOpen, card ? `${copy.source}: ${card.title}` : "", due ? taskCopyFormat(copy.due, { date: due }) : copy.noDue].filter(Boolean).join("\n");
    }
    return { key, sourceType: type, title, body, updatedAt: record.updatedAt };
  });
}
