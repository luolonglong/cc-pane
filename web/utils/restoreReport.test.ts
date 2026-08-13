import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutEntry, Panel, Tab } from "@/types";
import { usePanesStore } from "@/stores/usePanesStore";
import { logRestoreReport } from "./restoreReport";

const logInfo = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@tauri-apps/plugin-log", () => ({ info: logInfo }));

function terminalTab(id: string, overrides: Partial<Tab> = {}): Tab {
  const tab: Tab = {
    id,
    title: id,
    contentType: "terminal",
    projectId: id,
    projectPath: `/tmp/${id}`,
    sessionId: null,
    ...overrides,
  };
  const leaf = {
    type: "leaf" as const,
    id: `${id}-leaf`,
    sessionId: tab.sessionId,
    resumeId: tab.resumeId,
    resumeIdSource: tab.resumeIdSource,
    launchClaude: tab.launchClaude,
    cliTool: tab.cliTool,
    restoring: tab.restoring,
    savedSessionId: tab.savedSessionId,
    restoreState: tab.restoreState,
  };
  tab.terminalRootPane = leaf;
  tab.activeTerminalPaneId = leaf.id;
  return tab;
}

describe("logRestoreReport", () => {
  beforeEach(() => {
    logInfo.mockClear();
    const tabs = [
      terminalTab("bound", { cliTool: "codex", resumeId: "resume-1" }),
      terminalTab("blocked", {
        cliTool: "codex",
        restoring: true,
        savedSessionId: "old-pty",
      }),
      terminalTab("fresh", { cliTool: "codex", resumeId: "new" }),
      terminalTab("shell", { cliTool: "none" }),
    ];
    const rootPane: Panel = { type: "panel", id: "pane-1", tabs, activeTabId: "bound" };
    const layout: LayoutEntry = {
      id: "layout-1",
      name: "Layout",
      kind: "normal",
      rootPane,
      activePaneId: rootPane.id,
    };
    usePanesStore.setState({
      rootPane,
      activePaneId: rootPane.id,
      layouts: [layout],
      currentLayoutId: layout.id,
    } as never);
  });

  it("counts blocked missing ids separately from deliberate fresh tabs", async () => {
    await logRestoreReport();

    const message = logInfo.mock.calls[0]?.[0] as string;
    const summary = JSON.parse(message.replace("[restore-report] ", ""));
    expect(summary.blockedMissingResumeId).toBe(1);
    expect(summary.fresh).toBe(2);
    expect(summary.byCliTool.codex).toEqual({
      bound: 1,
      blockedMissingResumeId: 1,
      fresh: 1,
      unbound: 0,
    });
    expect(summary.tabs.find((tab: { tabId: string }) => tab.tabId === "blocked").recoveryState)
      .toBe("blocked-missing-resume-id");
  });
});
