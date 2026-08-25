import type { ReactElement } from 'react'
import { CheckboxPropertyEditor } from './checkbox-property-editor'
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
      return <RelationPropertyEditor {...props} />
    case 'relations':
      return <MultiRelationPropertyEditor {...props} />
    case 'rollup':
      return <>{props.children}</>
    default:
      return <InputPropertyEditor {...props} />
  }
}
