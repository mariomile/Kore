//! Writes waiting for the owner (Plan 33, A2). An agent whose key is in
//! "propose" mode never writes a note: each write tool call is kept here as
//! one JSON file: the tool and the arguments the agent sent, never argv.
//! The owner accepts it (the CLI rebuilds the call through the MCP tool
//! table and runs it signed as that agent) or rejects it (the file goes).
//!
//! The folder is the one synced part of the vault's `.kore/` runtime
//! directory, so a proposal an agent makes through an always-on host
//! reaches the owner's Mac with the next sync. It is hidden, so no index or
//! note list ever shows it.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::agent_identity::AgentIdentity;
use crate::error::CliError;
use crate::mcp::propose::ProposedCall;

/// Graph-relative folder holding one `<id>.json` per proposal.
pub const DIR: &str = ".kore/proposals";

/// One write an agent proposed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Proposal {
    /// File stem: milliseconds then randomness, so names sort by time.
    pub id: String,
    /// Milliseconds since the Unix epoch.
    pub at: u64,
    pub agent: AgentIdentity,
    /// What the agent called, as it sent it.
    pub call: ProposedCall,
}

impl Proposal {
    /// A new proposal with a fresh id.
    pub fn new(agent: AgentIdentity, call: ProposedCall) -> Self {
        let at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
            .unwrap_or_default();
        let mut random = [0u8; 6];
        getrandom::fill(&mut random).expect("the OS random number generator is unavailable");
        Self {
            id: format!("{at:013}-{}", URL_SAFE_NO_PAD.encode(random)),
            at,
            agent,
            call,
        }
    }
}

fn path_for(root: &Path, id: &str) -> Result<PathBuf, CliError> {
    let valid = !id.is_empty()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if !valid {
        return Err(CliError::Usage(format!("no proposal {id:?}")));
    }
    Ok(root.join(DIR).join(format!("{id}.json")))
}

/// Keep `proposal` under the graph.
pub fn save(root: &Path, proposal: &Proposal) -> Result<(), CliError> {
    let path = path_for(root, &proposal.id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(proposal).expect("proposals serialize");
    crate::write::atomic_create(&path, &format!("{text}\n"))
        .map_err(|_| CliError::Runtime(format!("could not save proposal {}", proposal.id)))
}

/// Every readable proposal, oldest first; a malformed file is skipped.
pub fn list(root: &Path) -> Vec<Proposal> {
    let Ok(entries) = std::fs::read_dir(root.join(DIR)) else {
        return Vec::new();
    };
    let mut proposals: Vec<Proposal> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        .filter_map(|entry| std::fs::read(entry.path()).ok())
        .filter_map(|bytes| serde_json::from_slice(&bytes).ok())
        .collect();
    proposals.sort_by(|a, b| a.id.cmp(&b.id));
    proposals
}

/// The proposal `id`.
pub fn load(root: &Path, id: &str) -> Result<Proposal, CliError> {
    let bytes = std::fs::read(path_for(root, id)?)
        .map_err(|_| CliError::Usage(format!("no proposal {id:?}")))?;
    serde_json::from_slice(&bytes)
        .map_err(|err| CliError::Runtime(format!("proposal {id} is unreadable: {err}")))
}

/// Drop the proposal `id`.
pub fn remove(root: &Path, id: &str) -> Result<(), CliError> {
    std::fs::remove_file(path_for(root, id)?)
        .map_err(|_| CliError::Usage(format!("no proposal {id:?}")))
}

/// A proposal taken out of the waiting list while it is being accepted, so
/// a second accept (a double click, two windows) finds nothing to write.
/// It waits in the local, unsynced part of `.kore/` until [`Claim::finish`]
/// drops it or [`Claim::release`] puts it back.
pub struct Claim {
    pub proposal: Proposal,
    waiting: PathBuf,
    claimed: PathBuf,
}

/// Claim proposal `id` for accepting. A rename is atomic, so only one caller
/// ever gets it.
pub fn claim(root: &Path, id: &str) -> Result<Claim, CliError> {
    let waiting = path_for(root, id)?;
    let claimed = root
        .join(kore_index_schema::KORE_DIR)
        .join(format!("accepting-{id}.json"));
    std::fs::rename(&waiting, &claimed)
        .map_err(|_| CliError::Usage(format!("no proposal {id:?}")))?;
    let read = std::fs::read(&claimed)
        .map_err(CliError::from)
        .and_then(|bytes| {
            serde_json::from_slice(&bytes)
                .map_err(|err| CliError::Runtime(format!("proposal {id} is unreadable: {err}")))
        });
    match read {
        Ok(proposal) => Ok(Claim {
            proposal,
            waiting,
            claimed,
        }),
        Err(err) => {
            let _ = std::fs::rename(&claimed, &waiting);
            Err(err)
        }
    }
}

impl Claim {
    /// The write went through: the proposal is done.
    pub fn finish(self) -> Result<(), CliError> {
        Ok(std::fs::remove_file(&self.claimed)?)
    }

    /// The write failed: the proposal waits again, unchanged.
    pub fn release(self) -> Result<(), CliError> {
        Ok(std::fs::rename(&self.claimed, &self.waiting)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proposals_live_in_the_synced_part_of_the_runtime_directory() {
        use kore_index_schema::{KORE_DIR, SYNCED_SUBDIR};
        assert_eq!(DIR, format!("{KORE_DIR}/{SYNCED_SUBDIR}"));
    }

    #[test]
    fn proposals_round_trip_in_time_order_and_ids_cannot_escape() {
        let dir = tempfile::tempdir().unwrap();
        let grok = AgentIdentity::for_caller(Some("Grok"));
        let call = |tool: &str| ProposedCall {
            tool: tool.to_string(),
            arguments: serde_json::Map::new(),
        };
        let first = Proposal::new(grok.clone(), call("capture"));
        let mut second = Proposal::new(grok, call("edit_note"));
        second.id = format!("{}z", first.id);
        save(dir.path(), &second).unwrap();
        save(dir.path(), &first).unwrap();
        std::fs::write(dir.path().join(DIR).join("broken.json"), "{").unwrap();

        assert_eq!(list(dir.path()), vec![first.clone(), second.clone()]);
        assert_eq!(load(dir.path(), &first.id).unwrap(), first);
        remove(dir.path(), &first.id).unwrap();
        assert_eq!(list(dir.path()), vec![second]);
        assert!(load(dir.path(), "../../etc/passwd").is_err());
    }

    #[test]
    fn only_one_caller_claims_a_proposal_and_a_release_puts_it_back() {
        let dir = tempfile::tempdir().unwrap();
        let proposal = Proposal::new(
            AgentIdentity::for_caller(Some("Grok")),
            ProposedCall {
                tool: "capture".to_string(),
                arguments: serde_json::Map::new(),
            },
        );
        save(dir.path(), &proposal).unwrap();

        let claimed = claim(dir.path(), &proposal.id).unwrap();
        assert_eq!(claimed.proposal, proposal);
        assert!(list(dir.path()).is_empty());
        assert!(claim(dir.path(), &proposal.id).is_err());
        claimed.release().unwrap();
        assert_eq!(list(dir.path()), vec![proposal.clone()]);

        claim(dir.path(), &proposal.id).unwrap().finish().unwrap();
        assert!(list(dir.path()).is_empty());
        assert!(claim(dir.path(), &proposal.id).is_err());
    }
}
