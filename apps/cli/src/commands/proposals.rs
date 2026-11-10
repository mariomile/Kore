//! `kore proposals`: the writes agents with a "propose" key asked for and
//! that wait for the owner (Plan 33, A2; store in [`crate::proposals`]).

use crate::commands::output::print_json;
use crate::error::CliError;
use crate::graph::Graph;
use crate::mcp::propose::{self, ProposedCall};
use crate::mcp::{ProcessRunner, Runner};
use crate::proposals::{self, Proposal};
use crate::write::{current_agent, read_stdin};

/// What `kore proposals` does.
#[derive(clap::Subcommand, Debug)]
pub enum ProposalsAction {
    /// List the writes waiting for you (the default)
    List,
    /// Write the proposal `id` as the agent that proposed it, then drop it
    Accept { id: String },
    /// Drop the proposal `id` without writing anything
    Reject { id: String },
    /// Keep the tool call given as JSON on stdin for the agent this process
    /// runs for (what `kore mcp` runs for a "propose" key)
    #[command(hide = true)]
    Add,
}

pub fn run(graph: &Graph, json: bool, action: Option<&ProposalsAction>) -> Result<(), CliError> {
    match action.unwrap_or(&ProposalsAction::List) {
        ProposalsAction::List => {
            let waiting = proposals::list(&graph.root);
            if json {
                return print_json(&waiting);
            }
            if waiting.is_empty() {
                eprintln!("kore: no proposals waiting");
            }
            for proposal in &waiting {
                println!(
                    "{}\t{}\t{}\t{}",
                    proposal.id,
                    proposal.agent.name,
                    proposal.call.tool,
                    serde_json::Value::Object(proposal.call.arguments.clone())
                );
            }
            Ok(())
        }
        ProposalsAction::Accept { id } => {
            owner_only("accept")?;
            // Claimed first, so a second accept of the same proposal finds
            // nothing and the write never happens twice.
            let claim = proposals::claim(&graph.root, id)?;
            let output = match write_as_agent(graph, &claim.proposal) {
                Ok(output) => output,
                Err(err) => {
                    claim.release()?;
                    return Err(err);
                }
            };
            let agent = claim.proposal.agent.name.clone();
            claim.finish()?;
            if json {
                let result = serde_json::from_str(&output.text)
                    .unwrap_or(serde_json::Value::String(output.text));
                return print_json(
                    &serde_json::json!({ "id": id, "accepted": true, "result": result }),
                );
            }
            println!("Accepted {id} from {agent}");
            Ok(())
        }
        ProposalsAction::Reject { id } => {
            owner_only("reject")?;
            proposals::remove(&graph.root, id)?;
            if json {
                return print_json(&serde_json::json!({ "id": id, "accepted": false }));
            }
            println!("Rejected {id}");
            Ok(())
        }
        ProposalsAction::Add => {
            let agent = current_agent().ok_or_else(|| {
                CliError::Usage("only an agent's tool call can be proposed".to_string())
            })?;
            let call: ProposedCall = serde_json::from_str(&read_stdin()?)
                .map_err(|err| CliError::Usage(format!("not a tool call: {err}")))?;
            propose::invocation(&call, &agent.name).map_err(CliError::Usage)?;
            let proposal = Proposal::new(agent, call);
            proposals::save(&graph.root, &proposal)?;
            if json {
                print_json(&serde_json::json!({ "id": proposal.id }))
            } else {
                println!("{}", proposal.id);
                Ok(())
            }
        }
    }
}

/// Carry out `proposal` through the MCP tool table, signed as its agent so
/// the write lands in that agent's activity.
fn write_as_agent(graph: &Graph, proposal: &Proposal) -> Result<crate::mcp::RunOutput, CliError> {
    let id = &proposal.id;
    let (args, stdin) = propose::invocation(&proposal.call, &proposal.agent.name)
        .map_err(|err| CliError::Usage(format!("proposal {id} no longer applies: {err}")))?;
    let runner = ProcessRunner {
        exe: std::env::current_exe()?,
        graph: graph.root.clone(),
    };
    let output = runner.run_as(&args, stdin.as_deref(), &proposal.agent);
    if !output.success {
        return Err(CliError::Runtime(format!(
            "proposal {id} was not written: {}",
            output.text
        )));
    }
    Ok(output)
}

/// Deciding on a proposal is the owner's: a process running an agent's tool
/// call never accepts or rejects one, its own included.
fn owner_only(verb: &str) -> Result<(), CliError> {
    match current_agent() {
        Some(agent) => Err(CliError::Usage(format!(
            "only the vault's owner can {verb} a proposal, not {}",
            agent.name
        ))),
        None => Ok(()),
    }
}
