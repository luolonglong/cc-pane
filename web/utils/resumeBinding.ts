export interface ResumeBindingTarget {
  updateTabAgentResumeId: (
    ptySessionId: string,
    resumeSessionId: string,
    resumeSource?: string,
  ) => boolean;
}

interface RetryOptions {
  isCancelled?: () => boolean;
  maxRetries?: number;
  schedule?: (callback: () => void, delayMs: number) => void;
}

/**
 * Persist a deterministic agent resume id into the terminal leaf. The backend
 * event can arrive before createSession has written the PTY id into Zustand,
 * so retry a bounded number of times instead of dropping that binding.
 */
export function applyResumeBindingWithRetry(
  target: ResumeBindingTarget,
  ptySessionId: string,
  resumeSessionId: string,
  resumeSource: string | undefined,
  options: RetryOptions = {},
): void {
  const maxRetries = options.maxRetries ?? 6;
  const schedule = options.schedule ?? ((callback, delayMs) => {
    window.setTimeout(callback, delayMs);
  });

  const apply = (attempt: number) => {
    if (options.isCancelled?.()) return;

    const found = target.updateTabAgentResumeId(
      ptySessionId,
      resumeSessionId,
      resumeSource,
    );
    if (!found && attempt < maxRetries && !options.isCancelled?.()) {
      schedule(() => apply(attempt + 1), 500 * (attempt + 1));
    }
  };

  apply(0);
}
