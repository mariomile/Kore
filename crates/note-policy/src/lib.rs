//! Shared frontmatter and title-derivation policy for Reflect's native
//! surfaces: the desktop shell (backup commit subjects) and the `reflect`
//! CLI (note reads). Both need the same read-only answers to two questions —
//! is this note private, and what should we call it — and both must move
//! together when the policy changes, so the policy lives here once instead
//! of drifting across two hand-rolled copies.

mod frontmatter;
mod heading;

pub use frontmatter::{parse_frontmatter, split_frontmatter, Frontmatter, FrontmatterSplit};
pub use heading::first_h1;
