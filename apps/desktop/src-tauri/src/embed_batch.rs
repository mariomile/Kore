//! Bounds for the native embedding boundary. One library call must fit in one
//! microbatch: fastembed retains raw outputs until the whole call is pooled.

use std::sync::Arc;

use fastembed::TextEmbedding;
use tokio::sync::{Mutex, OwnedMutexGuard, OwnedSemaphorePermit, Semaphore};

use crate::error::{AppError, AppResult};

/// Mirrored by `EMBEDDING_BATCH_SIZE` in the TypeScript embedding bindings.
pub const BATCH_SIZE: usize = 4;
const MAX_INPUT_BYTES: usize = 128 * 1024;
const MAX_REQUESTS: usize = 8;

/// Reject oversized IPC payloads before loading the model or queueing work.
pub fn validate(texts: &[String]) -> AppResult<()> {
    if texts.len() > BATCH_SIZE {
        return Err(AppError::parse(format!(
            "An embedding request cannot exceed {BATCH_SIZE} texts"
        )));
    }
    let bytes = texts
        .iter()
        .try_fold(0usize, |total, text| total.checked_add(text.len()));
    if bytes.is_none_or(|bytes| bytes > MAX_INPUT_BYTES) {
        return Err(AppError::parse(format!(
            "An embedding request cannot exceed {MAX_INPUT_BYTES} UTF-8 bytes"
        )));
    }
    Ok(())
}

/// Embed a single bounded request, releasing raw model outputs before return.
pub fn embed(model: &mut TextEmbedding, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
    validate(texts)?;
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    model
        .embed(texts, Some(BATCH_SIZE))
        .map_err(|error| AppError::io(format!("embedding failed: {error}")))
}

/// Bounded admission followed by FIFO execution, without blocking worker
/// threads on the model mutex. Interactive work can run between backfill calls.
pub struct RequestQueue {
    requests: Arc<Semaphore>,
    execution: Arc<Mutex<()>>,
}

impl Default for RequestQueue {
    fn default() -> Self {
        Self {
            requests: Arc::new(Semaphore::new(MAX_REQUESTS)),
            execution: Arc::new(Mutex::new(())),
        }
    }
}

/// Move this lease into blocking work so cancellation cannot free its slot
/// while ONNX is still using the model.
pub struct RequestLease {
    _request: OwnedSemaphorePermit,
    _execution: OwnedMutexGuard<()>,
}

impl RequestQueue {
    pub async fn acquire(&self) -> AppResult<RequestLease> {
        let request = Arc::clone(&self.requests)
            .try_acquire_owned()
            .map_err(|_| AppError::io("Embedding request queue is full; try again"))?;
        let execution = Arc::clone(&self.execution).lock_owned().await;
        Ok(RequestLease {
            _request: request,
            _execution: execution,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::Future;
    use std::task::{Context, Poll, Waker};

    #[test]
    fn rejects_oversized_count_and_utf8_bytes_before_model_work() {
        assert!(validate(&vec!["short".to_string(); BATCH_SIZE + 1]).is_err());
        assert!(validate(&["🙂".repeat(MAX_INPUT_BYTES / 4 + 1)]).is_err());
        assert!(validate(&vec!["a".repeat(MAX_INPUT_BYTES / 2 + 1); 2]).is_err());
        assert!(validate(&vec!["a".repeat(1500); BATCH_SIZE]).is_ok());
    }

    #[test]
    fn serializes_work_and_releases_cancelled_waiters() {
        let queue = RequestQueue::default();
        let mut context = Context::from_waker(Waker::noop());
        let mut first = Box::pin(queue.acquire());
        let Poll::Ready(Ok(first)) = first.as_mut().poll(&mut context) else {
            panic!("first request must run immediately");
        };
        let mut waiting: Vec<_> = (1..MAX_REQUESTS)
            .map(|_| Box::pin(queue.acquire()))
            .collect();
        for request in &mut waiting {
            assert!(request.as_mut().poll(&mut context).is_pending());
        }
        assert!(matches!(
            Box::pin(queue.acquire()).as_mut().poll(&mut context),
            Poll::Ready(Err(_))
        ));
        waiting.pop(); // cancelling a waiter returns its admission slot
        let mut replacement = Box::pin(queue.acquire());
        assert!(replacement.as_mut().poll(&mut context).is_pending());
        drop(first);
        assert!(matches!(
            waiting[0].as_mut().poll(&mut context),
            Poll::Ready(Ok(_))
        ));
    }
}
