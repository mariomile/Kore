//! Propose mode (Plan 33, A2). A write tool called with a "propose" key is
//! not run: `kore mcp` hands the call to `kore proposals add`, which keeps it
//! for the owner. Accepting it later builds the argv again through the same
//! tool table, so an accepted proposal is checked exactly like a direct call
//! and nothing stored in the vault is ever run as raw argv.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::tools::{invocation_for, tools, Effect, Tool};
use super::{tool_text, Runner, Server};
use crate::agent_identity::AgentIdentity;

/// The tool call `kore mcp` pipes to `kore proposals add`. It never names
/// the agent: the child takes that from its own process
/// ([`crate::write::current_agent`]), so a caller cannot sign as another.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposedCall {
    pub tool: String,
    #[serde(default)]
    pub arguments: Map<String, Value>,
}

/// The argv (from the subcommand on) and stdin that carry out `call` for
/// `agent`: it must name a tool that writes, and its arguments must build.
pub fn invocation(
    call: &ProposedCall,
    agent: &str,
) -> Result<(Vec<String>, Option<String>), String> {
    let tool = tools()
        .into_iter()
        .find(|tool| tool.name == call.tool && tool.effect != Effect::Read)
        .ok_or_else(|| format!("{:?} is not a Kore tool that writes", call.tool))?;
    let invocation = invocation_for(&tool, &call.arguments, Some(agent))?;
    Ok((invocation.args, invocation.stdin))
}

impl<R: Runner> Server<R> {
    /// Keep a write as a proposal for the owner instead of running it.
    pub(super) fn propose(
        &self,
        agent: &AgentIdentity,
        tool: &Tool,
        arguments: &Map<String, Value>,
    ) -> Value {
        let call = ProposedCall {
            tool: tool.name.to_string(),
            arguments: arguments.clone(),
        };
        let json = serde_json::to_string(&call).expect("tool calls serialize");
        let output = self.runner.run_as(
            &["proposals".to_string(), "add".to_string()],
            Some(&json),
            agent,
        );
        if !output.success {
            return tool_text(output.text, true);
        }
        let id = serde_json::from_str::<Value>(&output.text)
            .ok()
            .and_then(|saved| saved["id"].as_str().map(str::to_string))
            .unwrap_or_default();
        tool_text(
            format!(
                "Not written yet: your key proposes changes, so this one waits for the vault's owner to accept it (proposal {id}). Don't retry it."
            ),
            false,
        )
    }
}
