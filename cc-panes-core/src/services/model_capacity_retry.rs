use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

pub(crate) const MODEL_CAPACITY_ERROR: &str =
    "Selected model is at capacity. Please try a different model.";
pub(crate) const MODEL_CAPACITY_RETRY_DELAY: Duration = Duration::from_secs(30);

/// Detects the exact capacity message while tolerating PTY read boundaries.
#[derive(Default)]
pub(crate) struct ModelCapacityErrorDetector {
    carry: String,
}

impl ModelCapacityErrorDetector {
    pub(crate) fn observe(&mut self, output: &str) -> bool {
        if output.is_empty() {
            return false;
        }

        let mut combined = std::mem::take(&mut self.carry);
        combined.push_str(output);
        let matched = combined.contains(MODEL_CAPACITY_ERROR);

        let keep_len = MODEL_CAPACITY_ERROR.len().saturating_sub(1);
        if combined.len() <= keep_len {
            self.carry = combined;
        } else {
            let mut start = combined.len() - keep_len;
            while start < combined.len() && !combined.is_char_boundary(start) {
                start += 1;
            }
            self.carry = combined[start..].to_string();
        }

        matched
    }
}

#[derive(Default)]
struct RetryState {
    pending: bool,
    cancelled: bool,
}

/// Owns at most one delayed retry for a session and can wake it during cleanup.
pub(crate) struct ModelCapacityRetryController {
    state: Mutex<RetryState>,
    wake: Condvar,
}

impl ModelCapacityRetryController {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(RetryState::default()),
            wake: Condvar::new(),
        })
    }

    /// Schedule one retry. A second trigger while the first is pending is ignored.
    /// Returning `false` from the callback permanently cancels this controller.
    pub(crate) fn schedule<F>(self: &Arc<Self>, delay: Duration, retry: F) -> bool
    where
        F: FnOnce() -> bool + Send + 'static,
    {
        let mut state = self.lock_state();
        if state.cancelled || state.pending {
            return false;
        }
        state.pending = true;
        drop(state);

        let controller = Arc::clone(self);
        thread::spawn(move || {
            let state = controller.lock_state();
            let wait_result = controller
                .wake
                .wait_timeout_while(state, delay, |state| !state.cancelled);
            let mut state = match wait_result {
                Ok((state, _)) => state,
                Err(error) => error.into_inner().0,
            };

            if state.cancelled {
                state.pending = false;
                return;
            }
            state.pending = false;
            drop(state);

            if !controller.is_cancelled() && !retry() {
                controller.cancel();
            }
        });
        true
    }

    pub(crate) fn cancel(&self) {
        let mut state = self.lock_state();
        state.cancelled = true;
        state.pending = false;
        self.wake.notify_all();
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.lock_state().cancelled
    }

    fn lock_state(&self) -> MutexGuard<'_, RetryState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn detector_matches_only_the_exact_message() {
        let mut detector = ModelCapacityErrorDetector::default();

        assert!(detector.observe(MODEL_CAPACITY_ERROR));

        let mut near_miss = ModelCapacityErrorDetector::default();
        assert!(!near_miss.observe("Selected model is at capacity. Please try another model."));
    }

    #[test]
    fn detector_matches_when_message_crosses_read_chunks() {
        let mut detector = ModelCapacityErrorDetector::default();

        assert!(!detector.observe("Selected model is at "));
        assert!(detector.observe("capacity. Please try a different model."));
    }

    #[test]
    fn controller_deduplicates_pending_retry_and_rearms_after_write() {
        let controller = ModelCapacityRetryController::new();
        let (tx, rx) = mpsc::channel();

        assert!(controller.schedule(Duration::from_millis(20), {
            let tx = tx.clone();
            move || {
                tx.send(()).expect("first retry");
                true
            }
        }));
        assert!(!controller.schedule(Duration::from_millis(20), {
            let tx = tx.clone();
            move || {
                tx.send(()).expect("duplicate retry");
                true
            }
        }));
        rx.recv_timeout(Duration::from_secs(1))
            .expect("scheduled retry");

        assert!(controller.schedule(Duration::ZERO, {
            let tx = tx.clone();
            move || {
                tx.send(()).expect("rearmed retry");
                true
            }
        }));
        rx.recv_timeout(Duration::from_secs(1))
            .expect("rearmed scheduled retry");
        controller.cancel();
    }

    #[test]
    fn controller_cancels_delayed_retry_and_rejects_new_work() {
        let controller = ModelCapacityRetryController::new();
        let (tx, rx) = mpsc::channel();

        assert!(controller.schedule(Duration::from_secs(1), move || {
            tx.send(()).expect("cancelled retry");
            true
        }));
        controller.cancel();

        assert!(rx.recv_timeout(Duration::from_millis(100)).is_err());
        assert!(!controller.schedule(Duration::ZERO, || true));
    }

    #[test]
    fn controller_cancels_after_retry_failure() {
        let controller = ModelCapacityRetryController::new();
        let (tx, rx) = mpsc::channel();

        assert!(controller.schedule(Duration::ZERO, move || {
            tx.send(()).expect("failed retry");
            false
        }));
        rx.recv_timeout(Duration::from_secs(1))
            .expect("failed retry callback");

        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while !controller.is_cancelled() {
            assert!(
                std::time::Instant::now() < deadline,
                "failed retry did not cancel controller"
            );
            thread::yield_now();
        }
        assert!(!controller.schedule(Duration::ZERO, || true));
    }

    #[test]
    fn production_retry_delay_is_thirty_seconds() {
        assert_eq!(MODEL_CAPACITY_RETRY_DELAY, Duration::from_secs(30));
    }
}
