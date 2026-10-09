import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EvidenceInvestigation } from "./EvidenceInvestigation";
import { lockSecureVault, unlockSecureVault } from "../lib/secureSecretary";
import { mockSecretaryVault } from "../lib/secureSecretary.fixture";
vi.mock("../hooks/useI18n", () => ({ useI18n: () => ({ language: "en" }) }));
let host: HTMLDivElement; let root: Root;
const settle = async (action: () => void | Promise<unknown>) => act(async () => { await action(); await new Promise(resolve => setTimeout(resolve, 20)); });
const button = (text: string) => [...host.querySelectorAll("button")].find(button => button.textContent === text)!;
async function ready(predicate: () => boolean) { const start = Date.now(); while (!predicate() && Date.now() - start < 5000) await settle(() => {}); expect(predicate()).toBe(true); }
const click = async (text: string) => { await ready(() => !!button(text) && !button(text).disabled); await settle(() => button(text).click()); };
beforeEach(async () => {
  Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: webcrypto.subtle });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.chengjing = { secretaryVault: mockSecretaryVault() } as NonNullable<Window["chengjing"]>; await unlockSecureVault();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); await settle(() => root.render(<EvidenceInvestigation />));
});
afterEach(async () => { await settle(() => root.unmount()); host.remove(); await lockSecureVault(); window.chengjing = undefined; });
it("shows classified proposals and visibly revokes export/task actions after source change", async () => {
  await click("Open isolated FG-17 case"); await click("Retrieve related passages"); await click("Review FG-17 mock proposal");
  await ready(() => host.querySelectorAll("[data-finding-kind]").length === 5); await ready(() => !button("Export plaintext after confirmation").disabled);
  expect(button("Export plaintext after confirmation").disabled).toBe(false);
  await click("Preview cited task"); await ready(() => !!host.querySelector(".investigation-task-preview"));
  await click("Simulate QC source change"); await ready(() => !!host.querySelector('[data-source-state="changed"]'));
  expect(host.querySelector('[data-source-state="changed"]')).not.toBeNull();
  expect(button("Export plaintext after confirmation").disabled).toBe(true); expect(host.querySelector(".investigation-task-preview")).toBeNull();
});
it("discards an isolated case completely when returning to real local sources", async () => {
  await click("Open isolated FG-17 case"); await click("Retrieve related passages"); await click("Review FG-17 mock proposal"); await ready(() => !!host.querySelector(".investigation-brief"));
  await click("Close case · Use local sources"); expect(host.querySelector(".investigation-brief")).toBeNull(); expect(host.querySelectorAll(".investigation-results article")).toHaveLength(0);
  await settle(() => lockSecureVault()); expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
});
