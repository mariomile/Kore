import { createIcon, type Icon } from './create-icon'

/**
 * Glyphs Solar's `-linear` family has no equivalent for, drawn to the same
 * spec: a 24×24 grid, a 1.5px stroke inherited from the `<svg>` shell, and
 * rounded terminals on every open path. Borrowing from another Solar family —
 * or from a second icon library — would read as a different hand, so anything
 * missing gets drawn here instead.
 */

/**
 * A bookmark with a plus — Solar's bookmark, scaled to leave room for the
 * modifier. The nested `strokeWidth` cancels the group's scale so the whole
 * glyph still draws at the shell's hairline.
 */
export const BookmarkPlus: Icon = createIcon(
  'BookmarkPlus',
  <>
    <g transform="translate(-1 1.9) scale(0.78)" strokeWidth={1.923}>
      <path d="M21 16.0909V11.0975C21 6.80891 21 4.6646 19.682 3.3323C18.364 2 16.2426 2 12 2C7.75736 2 5.63604 2 4.31802 3.3323C3 4.6646 3 6.80891 3 11.0975V16.0909C3 19.1875 3 20.7358 3.73411 21.4123C4.08421 21.735 4.52615 21.9377 4.99692 21.9915C5.98402 22.1045 7.13673 21.0849 9.44216 19.0458C10.4612 18.1445 10.9708 17.6938 11.5603 17.5751C11.8506 17.5166 12.1494 17.5166 12.4397 17.5751C13.0292 17.6938 13.5388 18.1445 14.5578 19.0458C16.8633 21.0849 18.016 22.1045 19.0031 21.9915C19.4739 21.9377 19.9158 21.735 20.2659 21.4123C21 20.7358 21 19.1875 21 16.0909Z" />
    </g>
    <path strokeLinecap="round" d="M19 4V9M21.5 6.5H16.5" />
  </>,
)

/** A bare checkmark; Solar only ships one inside a circle or a square. */
export const Check: Icon = createIcon(
  'Check',
  <path strokeLinecap="round" strokeLinejoin="round" d="M4 12.5L9.5 18L20 6.5" />,
)

/** The paired chevrons on a combobox or a sortable column. */
export const ChevronUpDown: Icon = createIcon(
  'ChevronUpDown',
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    d="M8 9.5L12 5.5L16 9.5M8 14.5L12 18.5L16 14.5"
  />,
)

/** A half-filled disc: the light/dark split, used for themes and the toggle. */
export const Contrast: Icon = createIcon(
  'Contrast',
  <>
    <circle cx="12" cy="12" r="10" />
    <path fill="currentColor" d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22V2Z" />
  </>,
)

/** An elbow arrow pointing into a nested item. */
export const CornerDownRight: Icon = createIcon(
  'CornerDownRight',
  <>
    <path strokeLinecap="round" d="M6 4V10C6 12.7614 8.23858 15 11 15H18" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12L18 15L15 18" />
  </>,
)

/** Outdent: text lines with the caret pointing back to the margin. */
export const IndentDecrease: Icon = createIcon(
  'IndentDecrease',
  <>
    <path strokeLinecap="round" d="M20.5 6H11M20.5 12H11M20.5 18H11" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 8.5L3.5 12L7 15.5" />
  </>,
)

/** Indent: text lines with the caret pointing away from the margin. */
export const IndentIncrease: Icon = createIcon(
  'IndentIncrease',
  <>
    <path strokeLinecap="round" d="M20.5 6H11M20.5 12H11M20.5 18H11" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 8.5L7 12L3.5 15.5" />
  </>,
)

/** Solar's sidebar panel, mirrored for the right-hand context panel. */
export const PanelRight: Icon = createIcon(
  'PanelRight',
  <>
    <path d="M22 11C22 7.22876 22 5.34315 20.8284 4.17157C19.6569 3 17.7712 3 14 3H10C6.22876 3 4.34315 3 3.17157 4.17157C2 5.34315 2 7.22876 2 11V13C2 16.7712 2 18.6569 3.17157 19.8284C4.34315 21 6.22876 21 10 21H14C17.7712 21 19.6569 21 20.8284 19.8284C22 18.6569 22 16.7712 22 13V11Z" />
    <path strokeLinecap="round" d="M9 21L9 3" />
  </>,
)

/** Solar's pin, struck through for the unpin action. */
export const PinOff: Icon = createIcon(
  'PinOff',
  <>
    <path
      strokeLinecap="round"
      d="M2 22L6.65323 17.342M19.0716 8.03562L15.9894 4.9502C13.8823 2.84101 12.8288 1.78641 11.6973 2.03606C10.5657 2.28571 10.0527 3.68593 9.02665 6.48636L8.3322 8.38177C8.05866 9.12835 7.92189 9.50164 7.67582 9.79038C7.56541 9.91994 7.43978 10.0357 7.30167 10.1351C6.99386 10.3567 6.61092 10.4623 5.84504 10.6735C4.11881 11.1494 3.2557 11.3873 2.93045 11.9521C2.78985 12.1962 2.71668 12.4734 2.71846 12.7552C2.72258 13.4071 3.35561 14.0408 4.62169 15.3081L8.73837 19.429C10.0125 20.7044 10.6496 21.3421 11.3052 21.3431C11.5816 21.3435 11.8532 21.2717 12.0933 21.1347C12.6629 20.8096 12.9021 19.9401 13.3806 18.2012C13.5909 17.4366 13.6961 17.0543 13.9169 16.7466C14.0136 16.6119 14.1257 16.489 14.251 16.3805C14.5372 16.1326 14.9081 15.9933 15.6498 15.7146L17.5669 14.9943C20.3364 13.9537 21.7211 13.4335 21.9652 12.3049C22.2092 11.1764 21.1633 10.1295 19.0716 8.03562Z"
    />
    <path strokeLinecap="round" d="M3 3L21 21" />
  </>,
)

/** A magnifier crossed out: the empty state for a search that found nothing. */
export const SearchOff: Icon = createIcon(
  'SearchOff',
  <>
    <circle cx="11.5" cy="11.5" r="9.5" />
    <path strokeLinecap="round" d="M20 20L22 22" />
    <path strokeLinecap="round" d="M8.5 8.5L14.5 14.5M14.5 8.5L8.5 14.5" />
  </>,
)

/** The `/` that opens the slash menu. */
export const Slash: Icon = createIcon('Slash', <path strokeLinecap="round" d="M15.5 4L8.5 20" />)

/** A three-quarter arc, meant to be paired with `animate-spin`. */
export const Spinner: Icon = createIcon(
  'Spinner',
  <>
    <circle cx="12" cy="12" r="9.25" opacity="0.25" />
    <path strokeLinecap="round" d="M21.25 12C21.25 6.89137 17.1086 2.75 12 2.75" />
  </>,
)

/** The filled square that stops a recording or a streaming response. */
export const Stop: Icon = createIcon(
  'Stop',
  <rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor" stroke="none" />,
)

/** A globe: the in-app browser, which Solar's linear set never draws. */
export const Globe: Icon = createIcon(
  'Globe',
  <>
    <circle cx="12" cy="12" r="9.25" />
    <path strokeLinecap="round" d="M3 12h18" />
    <path d="M12 2.75C14.5 5.4 15.75 8.6 15.75 12S14.5 18.6 12 21.25C9.5 18.6 8.25 15.4 8.25 12S9.5 5.4 12 2.75Z" />
  </>,
)

/**
 * A prompt box. Ghostty cannot run inside the webview; this glyph marks the
 * in-app terminal that drives a local PTY through xterm.js instead.
 */
export const Terminal: Icon = createIcon(
  'Terminal',
  <>
    <rect x="3.25" y="4.75" width="17.5" height="14.5" rx="2.25" />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7.25 9.5L10.25 12L7.25 14.5M12.5 14.5H16.75"
    />
  </>,
)

/** Double square brackets: the `[[wiki link]]` affordance. */
export const WikiLink: Icon = createIcon(
  'WikiLink',
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    d="M6 4.5H3V19.5H6M10.5 4.5H7.5V19.5H10.5M13.5 4.5H16.5V19.5H13.5M18 4.5H21V19.5H18"
  />,
)

/**
 * A database table: a header band over a frozen title column. Solar's grid
 * and widget glyphs read as cards, so the table view needs its own.
 */
export const TableView: Icon = createIcon(
  'TableView',
  <>
    <rect x="2.75" y="4" width="18.5" height="16" rx="3.5" />
    <path strokeLinecap="round" d="M2.75 9.5H21.25M9 9.5V20" />
  </>,
)

/**
 * A kanban board: three lanes of different depth. Solar's widget-5 is a
 * card mosaic that reads as the gallery at phone size.
 */
export const BoardView: Icon = createIcon(
  'BoardView',
  <>
    <rect x="2.75" y="3.75" width="5" height="16.5" rx="2" />
    <rect x="9.5" y="3.75" width="5" height="10.5" rx="2" />
    <rect x="16.25" y="3.75" width="5" height="13.5" rx="2" />
  </>,
)

/**
 * A timeline: three staggered bars on a day axis, the Gantt shape. Solar's
 * chart glyphs read as analytics, so the timeline view draws its own.
 */
export const TimelineView: Icon = createIcon(
  'TimelineView',
  <>
    <rect x="2.75" y="4.75" width="10" height="4" rx="2" />
    <rect x="7.75" y="10" width="13.5" height="4" rx="2" />
    <rect x="5.25" y="15.25" width="7.5" height="4" rx="2" />
  </>,
)

/**
 * GitHub's mark (Octicons `mark-github-24`, MIT): where a vault lives in a
 * GitHub repository. A brand mark, so it is filled rather than drawn in the
 * hairline.
 */
export const GithubMark: Icon = createIcon(
  'GithubMark',
  <path
    fill="currentColor"
    stroke="none"
    d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436.55.096.756-.233.756-.522 0-.262-.013-1.128-.013-2.049-2.764.509-3.479-.674-3.699-1.292-.124-.317-.66-1.293-1.127-1.554-.385-.207-.936-.715-.014-.729.866-.014 1.485.797 1.691 1.128.99 1.663 2.571 1.196 3.204.907.096-.715.385-1.196.701-1.471-2.448-.275-5.005-1.224-5.005-5.432 0-1.196.426-2.186 1.128-2.956-.111-.275-.496-1.402.11-2.915 0 0 .921-.288 3.024 1.128a10.193 10.193 0 0 1 2.75-.371c.936 0 1.871.123 2.75.371 2.104-1.43 3.025-1.128 3.025-1.128.605 1.513.221 2.64.111 2.915.701.77 1.127 1.747 1.127 2.956 0 4.222-2.571 5.157-5.019 5.432.399.344.743 1.004.743 2.035 0 1.471-.014 2.654-.014 3.025 0 .289.206.632.756.522C19.851 20.979 23 16.854 23 12c0-6.077-4.922-11-11-11Z"
  />,
)

/** Six dots in two columns: the handle a row is dragged by. */
export const GripVertical: Icon = createIcon(
  'GripVertical',
  <g fill="currentColor" stroke="none">
    <circle cx="9" cy="6" r="1.5" />
    <circle cx="15" cy="6" r="1.5" />
    <circle cx="9" cy="12" r="1.5" />
    <circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="18" r="1.5" />
    <circle cx="15" cy="18" r="1.5" />
  </g>,
)
