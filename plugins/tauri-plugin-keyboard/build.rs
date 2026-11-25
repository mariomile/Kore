const COMMANDS: &[&str] = &["haptic"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
