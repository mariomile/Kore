import type { ReactElement } from 'react'
import { CheckboxPropertyEditor } from './checkbox-property-editor'
import { InlineTextPropertyEditor } from './inline-text-property-editor'
import { InputPropertyEditor } from './input-property-editor'
import { MultiRelationPropertyEditor } from './multi-relation-property-editor'
import type { PropertyEditorProps } from './property-editor-shared'
import { RelationPropertyEditor } from './relation-property-editor'
import { SelectPropertyEditor } from './select-property-editor'

export {
  editorSeedList,
  editorSeedText,
  typedValueForText,
  type PropertyEditorProps,
} from './property-editor-shared'

/** The per-type dispatch: one editor component for any schema property. */
export function PropertyValueEditor(props: PropertyEditorProps): ReactElement {
  switch (props.property.type) {
    case 'checkbox':
      return <CheckboxPropertyEditor {...props} />
    case 'select':
    case 'status':
    case 'multiselect':
      return <SelectPropertyEditor {...props} />
    case 'relation':
    case 'person':
      return <RelationPropertyEditor {...props} />
    case 'relations':
      return <MultiRelationPropertyEditor {...props} />
    case 'rollup':
    case 'reverse':
    case 'formula':
    // `created` is a one-time stamp, `updated` a view over the index's
    // mtime — read-only faces, like the derived columns above.
    case 'created':
    case 'updated':
      return props.variant === 'table-cell' ? (
        <span className="flex h-full w-full min-w-0 items-center px-2.5">{props.children}</span>
      ) : (
        <>{props.children}</>
      )
    case 'text':
      // Long text is read and edited in place on property rows; cells and
      // cards keep their one-line input.
      return props.variant === 'panel' ? (
        <InlineTextPropertyEditor {...props} />
      ) : (
        <InputPropertyEditor {...props} />
      )
    default:
      return <InputPropertyEditor {...props} />
  }
}
