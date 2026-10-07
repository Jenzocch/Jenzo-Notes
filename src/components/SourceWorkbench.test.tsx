import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceWorkbench } from "./SourceWorkbench";
import { lockSecureVault, unlockSecureVault } from "../lib/secureSecretary";
import { mockSecretaryVault } from "../lib/secureSecretary.fixture";
import { sourcesStillCurrent } from "../lib/sourceWorkbench";
vi.mock("../hooks/useI18n", () => ({ useI18n: () => ({ language: "en" }) }));
vi.mock("./SecureVaultControls", () => ({ SecureVaultControls: () => null }));
vi.mock("../lib/ai", () => ({ runAI: vi.fn() }));
vi.mock("../lib/sourceWorkbench", async importOriginal => ({ ...await importOriginal<typeof import("../lib/sourceWorkbench")>(), sourcesStillCurrent: vi.fn() }));
let host: HTMLDivElement; let root: Root;
async function settle(action: () => void | Promise<unknown>) { await act(async () => { await action(); await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function click(text: string) { await settle(() => { const button = [...host.querySelectorAll("button")].find(el => el.textContent === text)!; expect(button.disabled).toBe(false); button.click(); }); }
async function fill(selector: string, value: string) { await settle(() => { const el = host.querySelector(selector) as HTMLTextAreaElement; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.chengjing = { secretaryVault: mockSecretaryVault() } as NonNullable<Window["chengjing"]>;
  await unlockSecureVault(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await settle(() => root.render(<SourceWorkbench />));
});
afterEach(async () => { await settle(() => root.unmount()); host.remove(); await lockSecureVault(); window.chengjing = undefined; vi.restoreAllMocks(); });
it.each([false, true])("discards a private compose result after lock (unlock again: %s)", async unlockAgain => {
  let finish!: (value: boolean) => void;
  vi.mocked(sourcesStillCurrent).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await fill("fieldset textarea", "LOCK-RACE-PRIVATE-SYNTHETIC"); await click("Capture and select");
  await fill(".source-selection + label textarea", "synthetic goal"); await click("Create excerpt document");
  await settle(() => lockSecureVault()); expect(host.textContent).not.toContain("LOCK-RACE-PRIVATE-SYNTHETIC");
  if (unlockAgain) await settle(() => unlockSecureVault());
  await settle(() => finish(true));
  expect(host.textContent).not.toContain("LOCK-RACE-PRIVATE-SYNTHETIC");
  expect(host.querySelector(".source-document")).toBeNull();
});
