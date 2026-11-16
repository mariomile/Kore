//! Query embeddings for semantic search, with the model the app already
//! downloaded (all-MiniLM-L6-v2, 384 dimensions). The app embeds through
//! fastembed on ONNX Runtime; the CLI runs the very same `model.onnx` and
//! `tokenizer.json` on `tract`, a pure-Rust ONNX runtime, so the binary needs
//! no native library and builds anywhere cargo does (the Linux box an
//! always-on `kore mcp` runs on included).
//!
//! Parity with the app is the contract, so the pre- and post-processing
//! mirror fastembed's `TextEmbedding::embed` for this model: the tokenizer is
//! loaded the way `fastembed::common::load_tokenizer` loads it (truncation at
//! `min(512, model_max_length)`, the special-token map added), the model gets
//! `input_ids`, `attention_mask` and (when it declares one) `token_type_ids`,
//! and the `last_hidden_state` is mean-pooled under the attention mask and
//! L2-normalized. The search side does not take that on trust: before using
//! the model it re-embeds one chunk the app stored and compares vectors
//! (`semantic.rs`), so a drift between the two runtimes turns semantic search
//! off instead of quietly ranking by noise.
//!
//! The CLI never downloads: the model is read where the app cached it, or
//! from `$KORE_MODEL_DIR` (a folder holding the five files, or an hf-hub cache
//! root) on a machine without the app.

use std::path::{Path, PathBuf};

use tokenizers::{AddedToken, PaddingParams, Tokenizer, TruncationParams};
use tract_onnx::prelude::*;

/// The model id the app records on every chunk (`embed.rs` `MODEL_ID` in the
/// desktop crate). Vectors under any other id are not comparable.
pub const MODEL_ID: &str = "all-MiniLM-L6-v2";

/// Output width of the model, and of the `embedding_vectors` column.
pub const DIMENSIONS: usize = 384;

/// The hf-hub repo fastembed resolves for `AllMiniLML6V2`, and its files.
const MODEL_REPO_DIR: &str = "models--Qdrant--all-MiniLM-L6-v2-onnx";
const MODEL_FILES: [&str; 5] = [
    "model.onnx",
    "tokenizer.json",
    "config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
];

/// fastembed's `DEFAULT_MAX_LENGTH` for text embeddings.
const DEFAULT_MAX_LENGTH: usize = 512;

/// The app's bundle identifiers, release first: Tauri's `app_data_dir` is
/// `<data dir>/<identifier>`, and the app caches the model under `models/`.
/// The pre-rename `app.lore.*` dirs come last: the app moves them on its
/// first launch after the rename, but a CLI run before that still finds the
/// model there.
const APP_IDENTIFIERS: [&str; 6] = [
    "app.kore.desktop",
    "app.kore.desktop.beta",
    "app.kore.desktop.dev",
    "app.lore.desktop",
    "app.lore.desktop.beta",
    "app.lore.desktop.dev",
];

/// Where to look for the model, in order: `$KORE_MODEL_DIR`, `$HF_HOME` (the
/// app honours it too), then each app build's data dir.
pub fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for var in ["KORE_MODEL_DIR", "HF_HOME"] {
        if let Some(value) = std::env::var_os(var).filter(|value| !value.is_empty()) {
            dirs.push(PathBuf::from(value));
        }
    }
    if let Some(data) = data_dir() {
        for identifier in APP_IDENTIFIERS {
            dirs.push(data.join(identifier).join("models"));
        }
    }
    dirs
}

/// The platform data dir Tauri's `app_data_dir` builds on.
fn data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if cfg!(target_os = "macos") {
        return home.map(|home| home.join("Library").join("Application Support"));
    }
    if cfg!(windows) {
        return std::env::var_os("APPDATA").map(PathBuf::from);
    }
    std::env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.map(|home| home.join(".local").join("share")))
}

fn has_all_files(dir: &Path) -> bool {
    MODEL_FILES.iter().all(|file| dir.join(file).is_file())
}

/// The folder holding the model's files inside `dir`: the folder itself, or
/// the hf-hub snapshot `refs/main` points at, or else any complete snapshot.
pub fn model_files_in(dir: &Path) -> Option<PathBuf> {
    if has_all_files(dir) {
        return Some(dir.to_path_buf());
    }
    let repo = dir.join(MODEL_REPO_DIR);
    let snapshots = repo.join("snapshots");
    if let Ok(revision) = std::fs::read_to_string(repo.join("refs").join("main")) {
        let pinned = snapshots.join(revision.trim());
        if has_all_files(&pinned) {
            return Some(pinned);
        }
    }
    let mut complete: Vec<PathBuf> = std::fs::read_dir(&snapshots)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| has_all_files(path))
        .collect();
    complete.sort();
    complete.pop()
}

/// The first candidate dir that holds the model.
pub fn locate_model() -> Option<PathBuf> {
    candidate_dirs().iter().find_map(|dir| model_files_in(dir))
}

type Plan = std::sync::Arc<TypedRunnableModel>;

/// Which ONNX input each tensor feeds, by the model's own input order.
#[derive(Clone, Copy)]
enum Input {
    Ids,
    Mask,
    TypeIds,
}

/// A loaded model plus its tokenizer.
pub struct Embedder {
    tokenizer: Tokenizer,
    plan: Plan,
    inputs: Vec<Input>,
}

fn read_json(dir: &Path, file: &str) -> Result<serde_json::Value, String> {
    let text = std::fs::read_to_string(dir.join(file)).map_err(|err| format!("{file}: {err}"))?;
    serde_json::from_str(&text).map_err(|err| format!("{file}: {err}"))
}

/// The tokenizer exactly as `fastembed::common::load_tokenizer` builds it.
fn load_tokenizer(dir: &Path) -> Result<Tokenizer, String> {
    let config = read_json(dir, "config.json")?;
    let special_tokens_map = read_json(dir, "special_tokens_map.json")?;
    let tokenizer_config = read_json(dir, "tokenizer_config.json")?;
    let mut tokenizer = Tokenizer::from_file(dir.join("tokenizer.json"))
        .map_err(|err| format!("tokenizer.json: {err}"))?;

    let model_max_length = tokenizer_config["model_max_length"]
        .as_f64()
        .ok_or("tokenizer_config.json has no model_max_length")? as f32;
    let max_length = DEFAULT_MAX_LENGTH.min(model_max_length as usize);
    let pad_id = config["pad_token_id"].as_u64().unwrap_or(0) as u32;
    let pad_token = tokenizer_config["pad_token"]
        .as_str()
        .ok_or("tokenizer_config.json has no pad_token")?
        .to_string();
    tokenizer
        .with_padding(Some(PaddingParams {
            pad_token,
            pad_id,
            ..Default::default()
        }))
        .with_truncation(Some(TruncationParams {
            max_length,
            ..Default::default()
        }))
        .map_err(|err| format!("tokenizer: {err}"))?;
    if let serde_json::Value::Object(map) = special_tokens_map {
        for value in map.values() {
            if let Some(content) = value.as_str() {
                tokenizer.add_special_tokens(&[AddedToken::from(content.to_string(), true)]);
            } else if let (
                Some(content),
                Some(single_word),
                Some(lstrip),
                Some(rstrip),
                Some(normalized),
            ) = (
                value["content"].as_str(),
                value["single_word"].as_bool(),
                value["lstrip"].as_bool(),
                value["rstrip"].as_bool(),
                value["normalized"].as_bool(),
            ) {
                tokenizer.add_special_tokens(&[AddedToken {
                    content: content.to_string(),
                    special: true,
                    single_word,
                    lstrip,
                    rstrip,
                    normalized,
                }]);
            }
        }
    }
    Ok(tokenizer)
}

impl Embedder {
    /// Load the model and tokenizer from a folder holding the five files.
    /// Batch is fixed at one (a query) and the sequence length stays
    /// symbolic, so one optimized plan serves every query.
    pub fn load(dir: &Path) -> Result<Self, String> {
        let tokenizer = load_tokenizer(dir)?;
        let mut model = tract_onnx::onnx()
            .model_for_path(dir.join("model.onnx"))
            .map_err(|err| format!("model.onnx: {err}"))?;
        let names: Vec<String> = model
            .input_outlets()
            .map_err(|err| err.to_string())?
            .iter()
            .map(|outlet| model.node(outlet.node).name.clone())
            .collect();
        let inputs = names
            .iter()
            .map(|name| match name.as_str() {
                "input_ids" => Ok(Input::Ids),
                "attention_mask" => Ok(Input::Mask),
                "token_type_ids" => Ok(Input::TypeIds),
                other => Err(format!("model.onnx has an unexpected input `{other}`")),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let sequence = model.sym("S");
        for index in 0..inputs.len() {
            model
                .set_input_fact(
                    index,
                    i64::fact([TDim::from(1), TDim::from(sequence.clone())]).into(),
                )
                .map_err(|err| err.to_string())?;
        }
        // fastembed's output precedence for this model: the only output, or
        // `last_hidden_state` by name.
        let outputs = model
            .output_outlets()
            .map_err(|err| err.to_string())?
            .to_vec();
        if outputs.len() > 1 {
            let wanted = outputs
                .iter()
                .find(|outlet| {
                    model.outlet_label(**outlet) == Some("last_hidden_state")
                        || model.node(outlet.node).name == "last_hidden_state"
                })
                .copied()
                .ok_or("model.onnx has no `last_hidden_state` output")?;
            model
                .select_output_outlets(&[wanted])
                .map_err(|err| err.to_string())?;
        }
        let plan = model
            .into_optimized()
            .and_then(|model| model.into_runnable())
            .map_err(|err| format!("model.onnx: {err}"))?;
        Ok(Self {
            tokenizer,
            plan,
            inputs,
        })
    }

    /// Embed one text: the unit vector fastembed would produce for it.
    pub fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|err| format!("tokenizing: {err}"))?;
        let length = encoding.len();
        if length == 0 {
            return Err("the text tokenized to nothing".to_string());
        }
        let as_i64 = |values: &[u32]| values.iter().map(|&value| value as i64).collect::<Vec<_>>();
        let ids = as_i64(encoding.get_ids());
        let mask = as_i64(encoding.get_attention_mask());
        let type_ids = as_i64(encoding.get_type_ids());
        let tensor = |values: &[i64]| -> Result<TValue, String> {
            Tensor::from_shape(&[1, length], values)
                .map(TValue::from)
                .map_err(|err| err.to_string())
        };
        let feeds = self
            .inputs
            .iter()
            .map(|input| match input {
                Input::Ids => tensor(&ids),
                Input::Mask => tensor(&mask),
                Input::TypeIds => tensor(&type_ids),
            })
            .collect::<Result<TVec<_>, _>>()?;
        let outputs = self
            .plan
            .run(feeds)
            .map_err(|err| format!("running the model: {err}"))?;
        let hidden = outputs[0]
            .to_plain_array_view::<f32>()
            .map_err(|err| err.to_string())?;
        let pooled = match hidden.ndim() {
            // Already pooled by the model.
            2 => hidden.iter().copied().collect::<Vec<f32>>(),
            3 => mean_pool(
                hidden.as_slice().ok_or("non-contiguous model output")?,
                &mask,
                hidden.shape()[2],
            ),
            other => return Err(format!("unexpected model output rank {other}")),
        };
        if pooled.len() != DIMENSIONS {
            return Err(format!(
                "the model produced {} dimensions, the index stores {DIMENSIONS}",
                pooled.len()
            ));
        }
        Ok(normalize(&pooled))
    }
}

/// Attention-masked mean over the token axis of a `[1, tokens, width]`
/// output (fastembed's `pooling::mean`; an all-zero mask divides by one).
pub fn mean_pool(hidden: &[f32], mask: &[i64], width: usize) -> Vec<f32> {
    let mut sum = vec![0f32; width];
    let mut count = 0f32;
    for (token, &on) in mask.iter().enumerate() {
        if on == 0 {
            continue;
        }
        count += on as f32;
        let row = &hidden[token * width..(token + 1) * width];
        for (total, value) in sum.iter_mut().zip(row) {
            *total += value * on as f32;
        }
    }
    let count = if count == 0.0 { 1.0 } else { count };
    sum.iter().map(|total| total / count).collect()
}

/// fastembed's `common::normalize`: L2 with a 1e-12 floor.
pub fn normalize(vector: &[f32]) -> Vec<f32> {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    vector.iter().map(|value| value / (norm + 1e-12)).collect()
}

/// Cosine similarity of two vectors (unit or not).
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm = |v: &[f32]| v.iter().map(|value| value * value).sum::<f32>().sqrt();
    dot / (norm(a) * norm(b)).max(1e-12)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mean_pool_ignores_masked_tokens() {
        let hidden = [1.0, 2.0, 3.0, 4.0, 100.0, 100.0];
        assert_eq!(mean_pool(&hidden, &[1, 1, 0], 2), vec![2.0, 3.0]);
        assert_eq!(mean_pool(&hidden, &[0, 0, 0], 2), vec![0.0, 0.0]);
    }

    #[test]
    fn normalize_yields_a_unit_vector() {
        let unit = normalize(&[3.0, 4.0]);
        assert!((unit[0] - 0.6).abs() < 1e-6 && (unit[1] - 0.8).abs() < 1e-6);
        assert_eq!(normalize(&[0.0, 0.0]), vec![0.0, 0.0]);
    }

    #[test]
    fn finds_the_pinned_hf_hub_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join(MODEL_REPO_DIR);
        for revision in ["aaa", "bbb"] {
            let snapshot = repo.join("snapshots").join(revision);
            std::fs::create_dir_all(&snapshot).unwrap();
            for file in MODEL_FILES {
                std::fs::write(snapshot.join(file), "x").unwrap();
            }
        }
        std::fs::create_dir_all(repo.join("refs")).unwrap();
        std::fs::write(repo.join("refs").join("main"), "aaa\n").unwrap();
        assert_eq!(
            model_files_in(dir.path()),
            Some(repo.join("snapshots").join("aaa"))
        );
        std::fs::remove_file(repo.join("refs").join("main")).unwrap();
        assert_eq!(
            model_files_in(dir.path()),
            Some(repo.join("snapshots").join("bbb"))
        );
    }

    #[test]
    fn a_plain_folder_with_the_files_is_the_model_dir() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(model_files_in(dir.path()), None);
        for file in MODEL_FILES {
            std::fs::write(dir.path().join(file), "x").unwrap();
        }
        assert_eq!(model_files_in(dir.path()), Some(dir.path().to_path_buf()));
    }

    /// End to end against a real ONNX model when one is supplied:
    /// `KORE_TEST_MODEL_DIR` holds the five files plus `reference.json`
    /// (`{text: vector}` computed with onnxruntime the way fastembed does).
    /// Skipped otherwise: CI and containers cannot download the model.
    #[test]
    fn matches_reference_vectors_when_a_model_is_supplied() {
        let Some(dir) = std::env::var_os("KORE_TEST_MODEL_DIR") else {
            return;
        };
        let dir = PathBuf::from(dir);
        let embedder = Embedder::load(&dir).expect("model loads");
        let reference: std::collections::BTreeMap<String, Vec<f32>> =
            serde_json::from_str(&std::fs::read_to_string(dir.join("reference.json")).unwrap())
                .unwrap();
        for (text, expected) in reference {
            let actual = embedder.embed(&text).expect("embeds");
            let similarity = cosine(&actual, &expected);
            assert!(similarity > 0.9999, "{text}: cosine {similarity}");
        }
    }
}
