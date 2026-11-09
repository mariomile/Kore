//! `kore proposals`: the writes agents with a "propose" key asked for and
//! that wait for the owner (Plan 33, A2; store in [`crate::proposals`]).

use crate::commands::output::print_json;
use crate::error::CliError;
use crate::graph::Graph;
use crate::mcp::propose::{self, ProposedCall};
use crate::proposals::{self, Proposal};
use crate::write::{current_agent, read_stdin};

/// What `kore proposals` does.
#[derive(clap::Subcommand, Debug)]
pub enum ProposalsAction {
    /// List the writes waiting for you (the default)
    List,
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
