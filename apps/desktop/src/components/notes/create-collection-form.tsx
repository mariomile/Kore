import { useRef, useState, type FormEvent, type ReactElement } from 'react'
import { errorMessage, type CollectionDefinition } from '@reflect/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createReusableCollectionDefinition } from '@/lib/tags/reusable-collection-write'
import { useGraph } from '@/providers/graph-provider'

interface CreateCollectionFormProps {
  onCreated: (definition: CollectionDefinition) => void
  onCancel: () => void
}

/** Create an empty collection in place, without assigning tags or properties. */
export function CreateCollectionForm({
  onCreated,
  onCancel,
}: CreateCollectionFormProps): ReactElement {
  const { graph } = useGraph()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (graph === null || name.trim() === '' || submitting.current) return
    submitting.current = true
    setSaving(true)
    setError(null)
    try {
      const definition = await createReusableCollectionDefinition(
        name.trim(),
        { version: 1, sources: { tags: [], include: [], exclude: [] } },
        graph.generation,
      )
      onCreated(definition)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <form
      aria-label="New collection"
      className="space-y-2 py-3"
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !saving) {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          autoFocus
          aria-label="Collection name"
          placeholder="Collection name"
          className="min-w-40 flex-1"
          value={name}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={graph === null || saving || name.trim() === ''}>
          {saving ? 'Creating…' : 'Create collection'}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-text-muted">Bring notes together. No tags required.</p>
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  )
}
