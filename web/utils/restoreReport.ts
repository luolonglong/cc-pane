import { info as logInfo } from "@tauri-apps/plugin-log";
import { usePanesStore } from "@/stores/usePanesStore";

/**
 * 重启恢复报告：rehydrate 后把可恢复 tab 的绑定状态写入应用日志
 * （经 @tauri-apps/plugin-log 落到 cc-panes.log，grep `[restore-report]` 查看）。
 * 用于事后核对「哪些 tab 带着 resumeId 恢复、哪些只能开新对话」。
 */
export async function logRestoreReport(): Promise<void> {
  const tabs = usePanesStore.getState().getRestorableTabs();
  const terminalTabs = tabs.filter(
    ({ tab }) => tab.contentType === "terminal" && tab.projectPath,
  );

  const entries = terminalTabs.map(({ tab, paneId }) => {
    const hasResumeId = Boolean(tab.resumeId && tab.resumeId !== "new");
    const isAgentTab = tab.launchClaude === true || Boolean(tab.cliTool && tab.cliTool !== "none");
    const recoveryState = hasResumeId
      ? "bound"
      : tab.restoreState === "blocked-missing-resume-id"
        || Boolean(tab.restoring && tab.savedSessionId && isAgentTab && tab.resumeId !== "new")
        ? "blocked-missing-resume-id"
        : tab.resumeId === "new" || !tab.restoring || !isAgentTab
          ? "fresh"
          : "unbound";
    return {
      tabId: tab.id,
      paneId,
      cliTool: tab.cliTool ?? "none",
      runtime: tab.ssh ? "ssh" : tab.wsl ? "wsl" : "local",
      project: tab.projectPath.split(/[/\\]/).pop() ?? tab.projectPath,
      hasResumeId,
      resumeIdPrefix: hasResumeId ? tab.resumeId?.slice(0, 8) ?? null : null,
      resumeIdSource: tab.resumeIdSource ?? null,
      recoveryState,
    };
  });

  const byCliTool: Record<string, {
    bound: number;
    blockedMissingResumeId: number;
    fresh: number;
    unbound: number;
  }> = {};
  for (const entry of entries) {
    const bucket = (byCliTool[entry.cliTool] ??= {
      bound: 0,
      blockedMissingResumeId: 0,
      fresh: 0,
      unbound: 0,
    });
    if (entry.recoveryState === "bound") bucket.bound += 1;
    else if (entry.recoveryState === "blocked-missing-resume-id") bucket.blockedMissingResumeId += 1;
    else if (entry.recoveryState === "fresh") bucket.fresh += 1;
    else bucket.unbound += 1;
  }

  const summary = {
    total: entries.length,
    withResumeId: entries.filter((e) => e.hasResumeId).length,
    withoutResumeId: entries.filter((e) => !e.hasResumeId).length,
    blockedMissingResumeId: entries.filter((e) => e.recoveryState === "blocked-missing-resume-id").length,
    fresh: entries.filter((e) => e.recoveryState === "fresh").length,
    byCliTool,
    tabs: entries,
  };

  try {
    await logInfo(`[restore-report] ${JSON.stringify(summary)}`);
  } catch {
    // plugin-log 不可用（如纯浏览器环境）时静默跳过
  }
}
