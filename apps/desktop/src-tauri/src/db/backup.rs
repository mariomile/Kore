//! Portable graph backups: a consistent SQLite snapshot plus graph files.
//! Restores always create a new directory; the active graph is never overwritten.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use zip::write::SimpleFileOptions;

use crate::error::{AppError, AppResult};

const MANIFEST: &str = ".reflect/backup.json";
const DATABASE: &str = ".reflect/index.sqlite";
const MAX_FILES: usize = 100_000;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_BYTES: u64 = 20 * 1024 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    automations: Vec<serde_json::Value>,
}

#[derive(Serialize)]
pub struct RestoredBackup {
    root: String,
    automations: Vec<serde_json::Value>,
}

fn zip_error(error: impl std::fmt::Display) -> AppError {
    AppError::io(format!("graph backup: {error}"))
}

/// Export a graph while holding the index lock, so chat deletions cannot remove
/// attachment files between the database snapshot and their archive entries.
#[tauri::command]
pub async fn graph_backup_export<R: tauri::Runtime>(
    archive_path: String,
    generation: u64,
    automations: Vec<serde_json::Value>,
    app: tauri::AppHandle<R>,
) -> AppResult<()> {
    crate::blocking::run_blocking(move || {
        let root =
            crate::fs::root_for_generation(&app.state::<crate::fs::GraphState>(), generation)?;
        let index = app.state::<super::IndexState>();
        let state = super::lock_state(&index)?;
        if state.root.as_deref() != Some(root.as_path()) {
            return Err(AppError::io("the graph index changed before backup"));
        }
        let conn = state.conn.as_ref().ok_or_else(AppError::no_graph)?;
        export_backup(&root, conn, Path::new(&archive_path), automations)
    })
    .await
}

fn export_backup(
    root: &Path,
    conn: &Connection,
    target: &Path,
    automations: Vec<serde_json::Value>,
) -> AppResult<()> {
    let parent = target
        .parent()
        .ok_or_else(|| AppError::io("backup needs a destination folder"))?
        .canonicalize()?;
    if parent.starts_with(root.canonicalize()?) {
        return Err(AppError::io("save the backup outside the graph folder"));
    }
    let staging = tempfile::tempdir()?;
    let snapshot = staging.path().join("index.sqlite");
    conn.execute("VACUUM INTO ?1", [snapshot.to_string_lossy().as_ref()])
        .map_err(zip_error)?;
    let manifest = serde_json::to_vec(&Manifest {
        version: 1,
        automations,
    })
    .map_err(zip_error)?;
    if manifest.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(AppError::io("backup automation metadata exceeds 1 MiB"));
    }
    let mut budget = ArchiveBudget { files: 0, bytes: 0 };
    budget.add(manifest.len() as u64)?;
    budget.add(fs::metadata(&snapshot)?.len())?;
    let mut output = tempfile::NamedTempFile::new_in(parent)?;
    {
        let mut archive = zip::ZipWriter::new(output.as_file_mut());
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        archive.start_file(MANIFEST, options).map_err(zip_error)?;
        archive.write_all(&manifest)?;
        archive.start_file(DATABASE, options).map_err(zip_error)?;
        std::io::copy(&mut File::open(snapshot)?, &mut archive)?;
        append_directory(root, root, &mut archive, &mut budget)?;
        archive.finish().map_err(zip_error)?;
    }
    output.as_file().sync_all()?;
    output.persist(target).map_err(zip_error)?;
    Ok(())
}

fn allowed_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        && path.split('/').next() != Some(".git")
        && (path.split('/').next() != Some(".reflect")
            || path == DATABASE
            || path == MANIFEST
            || path.starts_with(".reflect/chat-attachments/"))
}

struct ArchiveBudget {
    files: usize,
    bytes: u64,
}

impl ArchiveBudget {
    fn add(&mut self, bytes: u64) -> AppResult<()> {
        self.files += 1;
        self.bytes = self
            .bytes
            .checked_add(bytes)
            .ok_or_else(|| AppError::io("backup is too large"))?;
        if self.files > MAX_FILES || self.bytes > MAX_BYTES {
            return Err(AppError::io("backup exceeds 100,000 entries or 20 GiB"));
        }
        Ok(())
    }
}

fn append_directory<W: Write + std::io::Seek>(
    root: &Path,
    directory: &Path,
    archive: &mut zip::ZipWriter<W>,
    budget: &mut ArchiveBudget,
) -> AppResult<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(zip_error)?
            .to_str()
            .ok_or_else(|| AppError::io("backup path is not UTF-8"))?
            .replace('\\', "/");
        if relative == ".git" || relative == DATABASE || relative == MANIFEST {
            continue;
        }
        let kind = entry.file_type()?;
        if relative == ".reflect" {
            if kind.is_symlink() {
                return Err(AppError::io("backup refuses a linked .reflect directory"));
            }
            let attachments = path.join("chat-attachments");
            if fs::symlink_metadata(&attachments).is_ok() {
                if attachments.is_symlink() {
                    return Err(AppError::io("backup refuses linked chat attachments"));
                }
                append_directory(root, &attachments, archive, budget)?;
            }
            continue;
        }
        if !allowed_path(&relative) || kind.is_symlink() {
            return Err(AppError::io(format!(
                "backup cannot include this path: {relative}"
            )));
        }
        if kind.is_dir() {
            budget.add(0)?;
            archive
                .add_directory(format!("{relative}/"), SimpleFileOptions::default())
                .map_err(zip_error)?;
            append_directory(root, &path, archive, budget)?;
        } else if kind.is_file() {
            archive
                .start_file(
                    &relative,
                    SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .map_err(zip_error)?;
            let copied = std::io::copy(
                &mut File::open(path)?.take(MAX_BYTES - budget.bytes + 1),
                archive,
            )?;
            budget.add(copied)?;
        }
    }
    Ok(())
}

/// Extract only into a new temporary directory, keeping it after validation.
#[tauri::command]
pub async fn graph_backup_restore(
    archive_path: String,
    parent_path: String,
) -> AppResult<RestoredBackup> {
    crate::blocking::run_blocking(move || {
        restore_backup(Path::new(&archive_path), Path::new(&parent_path))
    })
    .await
}

fn restore_backup(archive_path: &Path, parent: &Path) -> AppResult<RestoredBackup> {
    let mut archive = zip::ZipArchive::new(File::open(archive_path)?).map_err(zip_error)?;
    if archive.len() > MAX_FILES {
        return Err(AppError::io("backup contains too many files"));
    }
    let staging = tempfile::Builder::new()
        .prefix("Kore restored ")
        .tempdir_in(parent)?;
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_error)?;
        let name = entry.name().trim_end_matches('/').to_owned();
        if !allowed_path(&name)
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(AppError::io(format!("unsafe backup entry: {name}")));
        }
        if name == MANIFEST && entry.size() > MAX_MANIFEST_BYTES {
            return Err(AppError::io("backup automation metadata exceeds 1 MiB"));
        }
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| AppError::io("backup is too large"))?;
        if total > MAX_BYTES {
            return Err(AppError::io("backup exceeds the 20 GiB restore limit"));
        }
        let target = staging.path().join(name);
        if entry.is_dir() {
            fs::create_dir_all(target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)?;
        let size = entry.size();
        let copied = std::io::copy(&mut (&mut entry).take(size + 1), &mut output)?;
        if copied != size {
            return Err(AppError::io("backup entry size mismatch"));
        }
    }
    let manifest: Manifest =
        serde_json::from_slice(&fs::read(staging.path().join(MANIFEST))?).map_err(zip_error)?;
    if manifest.version != 1 {
        return Err(AppError::io("unsupported graph backup version"));
    }
    let conn = Connection::open_with_flags(
        staging.path().join(DATABASE),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(zip_error)?;
    conn.query_row("SELECT count(*) FROM chat_messages", [], |row| {
        row.get::<_, i64>(0)
    })
    .map_err(zip_error)?;
    drop(conn);
    Ok(RestoredBackup {
        root: staging.keep().to_string_lossy().into_owned(),
        automations: manifest.automations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_notes_chats_and_images_into_a_new_graph() {
        let source = tempfile::tempdir().unwrap();
        fs::create_dir_all(source.path().join("notes")).unwrap();
        fs::create_dir_all(source.path().join(".reflect/chat-attachments/conv")).unwrap();
        fs::write(source.path().join("notes/hello.md"), "# Hello").unwrap();
        fs::write(
            source
                .path()
                .join(".reflect/chat-attachments/conv/image.png"),
            b"image",
        )
        .unwrap();
        let conn = reflect_index_schema::open_index_at(source.path()).unwrap();
        conn.execute_batch(
            "INSERT INTO chat_conversations VALUES ('conv', 'Hello', 1, 1);
             INSERT INTO chat_messages VALUES ('turn-1', 'conv', 0, 'Hello', '[]', '[]', '[]', 1);",
        )
        .unwrap();
        let destination = tempfile::tempdir().unwrap();
        let archive = destination.path().join("backup.zip");
        export_backup(source.path(), &conn, &archive, vec![]).unwrap();
        let restored = restore_backup(&archive, destination.path()).unwrap();
        assert_ne!(Path::new(&restored.root), source.path());
        assert_eq!(
            fs::read_to_string(Path::new(&restored.root).join("notes/hello.md")).unwrap(),
            "# Hello"
        );
        assert_eq!(
            fs::read(Path::new(&restored.root).join(".reflect/chat-attachments/conv/image.png"))
                .unwrap(),
            b"image"
        );
        let restored_db = Connection::open(Path::new(&restored.root).join(DATABASE)).unwrap();
        assert_eq!(
            restored_db
                .query_row("SELECT id FROM chat_messages", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "turn-1"
        );
    }

    #[test]
    fn refuses_traversal_and_removes_partial_restore() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("bad.zip");
        let mut writer = zip::ZipWriter::new(File::create(&archive).unwrap());
        writer
            .start_file("../escape.md", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"unsafe").unwrap();
        writer.finish().unwrap();
        assert!(restore_backup(&archive, directory.path()).is_err());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
