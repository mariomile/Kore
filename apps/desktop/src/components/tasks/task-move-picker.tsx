import { useState, type ReactElement } from "react";
import type { OpenTask, TaskProject } from "@reflect/core";
import { Folder, Hash } from "@/components/icons";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { projectSections, type TaskMoveTarget } from "@/lib/tasks/task-move";

interface TaskMovePickerProps {
  /** The tasks to move; null keeps the picker closed. */
  tasks: readonly OpenTask[] | null;
  projects: readonly TaskProject[];
  onClose: () => void;
  /** Move the tasks to `target`; `label` names it in the confirmation. */
  onMove: (tasks: OpenTask[], target: TaskMoveTarget, label: string) => void;
}

/**
 * "Move to…" (Todoist's `m`): pick a project, then, when its note has
 * headings, one of its sections. A project without headings moves at once, to
 * the end of its note. The sections are read when the project is picked, so
 * the list stays one cheap query however many projects the graph has.
 */
export function TaskMovePicker({
  tasks,
  projects,
  onClose,
  onMove,
}: TaskMovePickerProps): ReactElement | null {
  const [project, setProject] = useState<TaskProject | null>(null);
  const [sections, setSections] = useState<readonly string[]>([]);

  if (tasks === null) {
    return null;
  }

  const close = (): void => {
    setProject(null);
    setSections([]);
    onClose();
  };
  const finish = (target: TaskProject, section: string | null): void => {
    close();
    onMove(
      [...tasks],
      { notePath: target.path, section },
      section === null ? target.title : `${target.title} / ${section}`,
    );
  };
  const pickProject = (picked: TaskProject): void => {
    void projectSections(picked.path).then((names) => {
      if (names.length === 0) {
        finish(picked, null);
        return;
      }
      setProject(picked);
      setSections(names);
    });
  };

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      title="Move to"
      description="Choose the project or section to move the selected tasks to"
    >
      <Command label="Move to">
        <CommandInput
          // A fresh input per page, so the project query doesn't filter the sections.
          key={project?.path ?? "projects"}
          placeholder={
            project === null
              ? "Move to project…"
              : `Section in ${project.title}…`
          }
        />
        <CommandList>
          <CommandEmpty>
            {project === null ? "No projects" : "No sections"}
          </CommandEmpty>
          {project === null ? (
            <CommandGroup>
              {projects.map((candidate) => (
                <CommandItem
                  key={candidate.path}
                  value={`${candidate.title} ${candidate.path}`}
                  onSelect={() => pickProject(candidate)}
                >
                  <Folder aria-hidden className="text-text-muted" />
                  <span className="truncate">{candidate.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : (
            <CommandGroup heading={project.title}>
              <CommandItem
                value="(no section)"
                onSelect={() => finish(project, null)}
              >
                <Folder aria-hidden className="text-text-muted" />
                No section
              </CommandItem>
              {sections.map((section) => (
                <CommandItem
                  key={section}
                  value={section}
                  onSelect={() => finish(project, section)}
                >
                  <Hash aria-hidden className="text-text-muted" />
                  <span className="truncate">{section}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
