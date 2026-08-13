import { describe, it, expect } from "vitest";
import { pickCreateSessionResumeId, shouldBlockMissingResumeIdRestore } from "./terminalResume";

describe("pickCreateSessionResumeId", () => {
  it("returns the explicit resumeId from props", () => {
    expect(pickCreateSessionResumeId({ resumeId: "sess-123" })).toBe("sess-123");
  });

  it("never falls back to launch history when resumeId is absent", () => {
    // The resolver deliberately has no history fallback. Restoration decides
    // separately whether an absent id is safe to launch as a new session.
    expect(pickCreateSessionResumeId({ resumeId: undefined })).toBeUndefined();
    expect(pickCreateSessionResumeId({})).toBeUndefined();
  });

  it("treats the explicit new-session sentinel as no resume argument", () => {
    expect(pickCreateSessionResumeId({ resumeId: "new" })).toBeUndefined();
  });
});

describe("shouldBlockMissingResumeIdRestore", () => {
  it("blocks an agent restore after its saved PTY is gone and no resume id exists", () => {
    expect(shouldBlockMissingResumeIdRestore({
      restoring: true,
      savedSessionId: "old-pty",
      cliTool: "codex",
    })).toBe(true);
  });

  it("allows a trusted resume id, explicit fresh tab, and shell restore", () => {
    expect(shouldBlockMissingResumeIdRestore({
      restoring: true,
      savedSessionId: "old-pty",
      cliTool: "codex",
      resumeId: "resume-1",
    })).toBe(false);
    expect(shouldBlockMissingResumeIdRestore({
      restoring: true,
      savedSessionId: "old-pty",
      cliTool: "codex",
      resumeId: "new",
    })).toBe(false);
    expect(shouldBlockMissingResumeIdRestore({
      restoring: true,
      savedSessionId: "old-pty",
      cliTool: "none",
    })).toBe(false);
  });
});
