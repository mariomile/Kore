//! Opt-in native regression experiments. These never open a graph, download
//! a model, or call an external provider. See docs/memory-budget.md for usage.

use std::path::PathBuf;
use std::time::Instant;

use fastembed::{EmbeddingModel, TextEmbedding, TextInitOptions};

use crate::{embed_batch, process_memory};

pub(super) fn cached_model() -> TextEmbedding {
    let cache_dir = PathBuf::from(
        std::env::var_os("KORE_EMBED_BENCH_CACHE")
            .expect("set KORE_EMBED_BENCH_CACHE to an already populated model cache"),
    );
    let repository =
        hf_hub::Cache::new(cache_dir.clone()).model("Qdrant/all-MiniLM-L6-v2-onnx".to_string());
    for file in [
        "model.onnx",
        "tokenizer.json",
        "config.json",
        "special_tokens_map.json",
        "tokenizer_config.json",
    ] {
        assert!(
            repository.get(file).is_some(),
            "missing cached {file}; benchmark never downloads"
        );
    }
    crate::embed::commit_environment(ort::init()).expect("production ONNX thread pool");
    TextEmbedding::try_new(
        TextInitOptions::new(EmbeddingModel::AllMiniLML6V2).with_cache_dir(cache_dir),
    )
    .expect("load the cached production model")
}

pub(super) fn parameter(name: &str, default: usize, max: usize) -> usize {
    let value = std::env::var(name)
        .map(|value| value.parse().expect("integer benchmark parameter"))
        .unwrap_or(default);
    assert!(
        (1..=max).contains(&value),
        "{name} must be between 1 and {max}"
    );
    value
}

pub(super) fn record(phase: &str, mode: &str, count: usize, cycle: usize, elapsed_ms: f64) {
    let memory = process_memory::read(std::process::id()).expect("native footprint measurement");
    println!(
        "{}",
        serde_json::json!({
            "phase": phase, "mode": mode, "texts": count, "cycle": cycle, "pid": std::process::id(),
            "elapsedMs": elapsed_ms, "memory": memory,
        })
    );
}

#[test]
#[ignore = "requires an existing model cache; run alone with --ignored --nocapture"]
fn native_embedding_memory() {
    let mode = std::env::var("KORE_EMBED_BENCH_MODE").unwrap_or_else(|_| "bounded".to_string());
    assert!(matches!(
        mode.as_str(),
        "baseline" | "inference16" | "release" | "bounded"
    ));
    let count = parameter("KORE_EMBED_BENCH_TEXTS", 32, 1024);
    let cycles = parameter("KORE_EMBED_BENCH_CYCLES", 3, 50);
    let batch_size = parameter(
        "KORE_EMBED_BENCH_BATCH",
        embed_batch::BATCH_SIZE,
        embed_batch::BATCH_SIZE,
    );
    // Reproducing the old 256-text peak can pressure the user's machine.
    // The smaller baseline still demonstrates arena growth without doing so.
    assert!(
        mode == "bounded" || count <= 64,
        "baseline and inference16 are limited to 64 texts for safety"
    );
    let long_text =
        "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu. ".repeat(40);
    let texts: Vec<_> = (0..count)
        .map(|index| format!("Document {index}. {long_text}"))
        .collect();
    record("before-load", &mode, count, 0, 0.0);
    let _qos = crate::embed::BackgroundQos::engage();
    let started = Instant::now();
    let mut model = cached_model();
    record(
        "loaded",
        &mode,
        count,
        0,
        started.elapsed().as_secs_f64() * 1000.0,
    );
    for cycle in 0..cycles {
        let started = Instant::now();
        let vectors = if mode == "release" {
            // Kore 0.30.1 bounds outer calls and inference batches at 16.
            let mut vectors = Vec::with_capacity(count);
            for batch in texts.chunks(16) {
                vectors.extend(model.embed(batch, Some(16)).expect("released inference"));
            }
            vectors
        } else if mode != "bounded" {
            // The pre-0.30.1 source used the library default (256). This variant
            // limits inference only, while still submitting an entire note.
            let batch = (mode == "inference16").then_some(16);
            model.embed(&texts, batch).expect("baseline inference")
        } else {
            let mut vectors = Vec::with_capacity(count);
            for batch in texts.chunks(batch_size) {
                vectors.extend(embed_batch::embed(&mut model, batch).expect("bounded inference"));
            }
            vectors
        };
        assert_eq!(vectors.len(), count);
        assert!(vectors
            .iter()
            .all(|vector| vector.len() == 384 && vector.iter().all(|value| value.is_finite())));
        record(
            "embedded",
            &mode,
            count,
            cycle,
            started.elapsed().as_secs_f64() * 1000.0,
        );
        drop(vectors);
        let started = Instant::now();
        embed_batch::embed(&mut model, &["Find my notes about planning".to_string()]).unwrap();
        record(
            "warm-query",
            &mode,
            1,
            cycle,
            started.elapsed().as_secs_f64() * 1000.0,
        );
    }
    drop(model);
    record("model-dropped", &mode, count, cycles, 0.0);
    for (seconds, delay) in [(1, 1), (5, 4), (15, 10), (30, 15)] {
        std::thread::sleep(std::time::Duration::from_secs(delay));
        record("settled", &mode, count, cycles, seconds as f64 * 1000.0);
    }
}

#[test]
#[ignore = "requires an existing model cache; verifies actual ONNX vectors"]
fn bounded_batches_preserve_vectors() {
    let _qos = crate::embed::BackgroundQos::engage();
    let mut model = cached_model();
    let texts: Vec<_> = (0..33)
        .map(|index| match index % 3 {
            0 => "Project planning and the next milestone.".to_string(),
            1 => "Memoria, ricerca e appunti. 漢字🙂".repeat(20),
            _ => "A longer sentence about the memory of an application. ".repeat(30),
        })
        .collect();
    let baseline: Vec<_> = texts
        .chunks(16)
        .flat_map(|batch| model.embed(batch, Some(16)).unwrap())
        .collect();
    let bounded: Vec<_> = texts
        .chunks(embed_batch::BATCH_SIZE)
        .flat_map(|batch| embed_batch::embed(&mut model, batch).unwrap())
        .collect();
    assert_eq!(baseline.len(), bounded.len());
    for (expected, actual) in baseline.iter().zip(&bounded) {
        assert_eq!(actual.len(), 384);
        let similarity: f32 = expected
            .iter()
            .zip(actual)
            .map(|(left, right)| left * right)
            .sum();
        assert!(
            similarity > 0.99999,
            "batching changed a vector: cosine {similarity}"
        );
    }
}
