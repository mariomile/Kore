/**
 * The app's icon set.
 *
 * One family, one grid, one stroke weight: Solar's `-linear` glyphs
 * (`solar-icons.gen.tsx`, generated from `@iconify-json/solar`) plus the
 * handful Solar does not draw, hand-made to the same spec in
 * `custom-icons.tsx`. Import every glyph from here — a second icon library
 * would be visible on screen the moment its first glyph lands next to one of
 * these.
 *
 * See `readme.md` for how to add or repoint an icon.
 */
export { type Icon, type IconProps } from './create-icon'
export * from './custom-icons'
export * from './solar-icons.gen'
