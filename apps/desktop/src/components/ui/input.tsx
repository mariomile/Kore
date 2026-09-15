import * as React from 'react'

import { cn } from '@/lib/utils'

// Shared with inputs that must render the same field without this wrapper
// (e.g. a cmdk-driven combobox input, which has to be `CommandPrimitive.Input`).
// Focus is the border stepping to `--border-focus` and nothing else — text
// entry never gets a ring (docs/design.md § States).
const INPUT_CLASS_NAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-border-focus disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-input/30 dark:disabled:bg-input/80'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input type={type} data-slot="input" className={cn(INPUT_CLASS_NAME, className)} {...props} />
  )
}

export { Input, INPUT_CLASS_NAME }
