# @reflect/utils

Small, dependency-free helpers shared across the workspace. Today that is one
module: calendar arithmetic on ISO `YYYY-MM-DD` date strings, computed in UTC
(`addDaysIso`, `addMonthsIso`, `weekdayIso`, `isIsoDate`, `isCalendarDate`, …).

UTC sidesteps daylight saving entirely, so adding days or months can never
skip or repeat a day. "Today" is intentionally absent — it depends on the
local clock and belongs at the application edge (the desktop app's
`todayIso`).

Consumed by `@reflect/core` and `@reflect/desktop`. Keep this package free of
runtime dependencies; anything that needs Zod, Kysely, or the bridge belongs
in `@reflect/core` instead.
