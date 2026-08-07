import { describe, expect, it, vi } from "vitest";
import { applyResumeBindingWithRetry } from "./resumeBinding";

describe("applyResumeBindingWithRetry", () => {
  it("retries a binding event that arrives before createSession persists the PTY id", () => {
    const target = {
      updateTabAgentResumeId: vi.fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
    };
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];

    applyResumeBindingWithRetry(target, "pty-1", "resume-1", "osc-title", {
      schedule: (callback, delayMs) => scheduled.push({ callback, delayMs }),
    });

    expect(target.updateTabAgentResumeId).toHaveBeenCalledTimes(1);
    expect(target.updateTabAgentResumeId).toHaveBeenLastCalledWith("pty-1", "resume-1", "osc-title");
    expect(scheduled.map((item) => item.delayMs)).toEqual([500]);

    scheduled.shift()?.callback();
    expect(target.updateTabAgentResumeId).toHaveBeenCalledTimes(2);
    expect(scheduled.map((item) => item.delayMs)).toEqual([1000]);

    scheduled.shift()?.callback();
    expect(target.updateTabAgentResumeId).toHaveBeenCalledTimes(3);
    expect(scheduled).toEqual([]);
  });

  it("does not retry after its listener is cancelled", () => {
    const target = { updateTabAgentResumeId: vi.fn(() => false) };
    const scheduled: Array<() => void> = [];
    let cancelled = false;

    applyResumeBindingWithRetry(target, "pty-1", "resume-1", undefined, {
      isCancelled: () => cancelled,
      schedule: (callback) => scheduled.push(callback),
    });
    cancelled = true;
    scheduled.shift()?.();

    expect(target.updateTabAgentResumeId).toHaveBeenCalledTimes(1);
  });
});
