import type { ReactElement, ReactNode, Ref, SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  /**
   * Pixel size of the square glyph. Defaults to `24`, which any `size-*`
   * utility on `className` overrides — presentation attributes lose to
   * every class.
   */
  size?: number | string
  /**
   * Stroke weight on the 24px grid. Defaults to Solar's `1.5` hairline; raise
   * it for glyphs that have to hold up against bold text or a filled surface.
   */
  strokeWidth?: number | string
  ref?: Ref<SVGSVGElement>
}

/** Every icon exported from `@/components/icons` has this signature. */
export type Icon = (props: IconProps) => ReactElement

/**
 * Wraps a glyph body in the shared `<svg>` shell.
 *
 * The shell owns `fill`, `stroke`, and `strokeWidth` so a call site can
 * override any of them on the element itself: bodies are generated (and
 * hand-drawn) without those attributes precisely so they inherit.
 *
 * @param name - Component name, used for the debug label and the CSS hook.
 * @param body - The glyph's SVG children, drawn on a 24×24 grid.
 */
export function createIcon(name: string, body: ReactNode): Icon {
  const baseClassName = cssClass(name)
  function IconComponent({ size = 24, className, ...props }: IconProps): ReactElement {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className={className === undefined ? baseClassName : `${baseClassName} ${className}`}
        {...props}
      >
        {body}
      </svg>
    )
  }
  IconComponent.displayName = name
  return IconComponent
}

/**
 * The stable class an icon carries (`icon icon-chevron-right`), so styles and
 * tests can target a glyph without reaching for a test id.
 */
function cssClass(name: string): string {
  return `icon icon-${name.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`
}
