/**
 * A job search folder for the visual vault (`?seed=visual`): a few notes
 * and a pile of loose CVs, cases and sheets, the folder page's files case.
 */

/** A one-page CV as an HTML file, the shape a job search folder fills up with. */
function cvPage(role: string, company: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Alex Rivera - ${role}</title><style>
body{margin:0;padding:48px 56px;font:13px/1.5 -apple-system,Inter,sans-serif;color:#111;background:#fff}
h1{font-size:22px;margin:0}h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:22px 0 6px}
p,li{margin:0 0 6px;color:#333}.role{color:#555;margin:2px 0 14px}
</style></head><body><h1>Alex Rivera</h1><p class="role">${role} · for ${company}</p>
<h2>Profile</h2><p>Product lead who ships agents to production. Eight years across B2B SaaS, two exits, one team grown from three to twenty.</p>
<h2>Experience</h2><ul><li>Head of Product, Northwind: voice and chat agents for 1,200 SMBs, +300% MRR.</li>
<li>Senior PM, Contoso: the only PM from 3M to 12M ARR.</li><li>Consultant, Fabrikam: wealth platform for private bankers.</li></ul>
<h2>Education</h2><p>MSc Management Engineering</p></body></html>
`
}

/** A job search folder as one really looks: a few notes, a pile of CVs and cases. */
export const JOB_SEARCH_FILES: ReadonlyArray<readonly [string, string]> = [
  ['Projects/Job Search/Northwind case - analysis.xlsx', 'PK'.padEnd(255_000, ' ')],
  ['Projects/Job Search/Northwind case - Alex Rivera.pptx', 'PK'.padEnd(1_000_000, ' ')],
  ['Projects/Job Search/Alex_Rivera_CV_DataSense.pdf', '%PDF-1.4\n'.padEnd(89_000, ' ')],
  ['Projects/Job Search/Northwind - Business case.xlsx', 'PK'.padEnd(129_000, ' ')],
  ['Projects/Job Search/CV Langfuse PM.html', cvPage('Product Manager', 'Langfuse')],
  ['Projects/Job Search/CV N26 Senior PM.html', cvPage('Senior PM, Conversational Banking', 'N26')],
  ['Projects/Job Search/CV Retell Senior PM.html', cvPage('Senior Product Manager', 'Retell')],
  ['Projects/Job Search/CV Tecnonidi Head of Product.html', cvPage('Head of Product', 'Tecnonidi')],
  ['Projects/Job Search/Alex Rivera CV - Odin.pdf', '%PDF-1.4\n'.padEnd(90_000, ' ')],
  ['Projects/Job Search/Alex Rivera CV - Artificial.pdf', '%PDF-1.4\n'.padEnd(93_000, ' ')],
  ['Projects/Job Search/Alex Rivera CV - Deepgram.pdf', '%PDF-1.4\n'.padEnd(92_000, ' ')],
  ['Projects/Job Search/Alex Rivera - MAU Growth.xlsx', 'PK'.padEnd(56_000, ' ')],
  ['Projects/Job Search/Alex Rivera - MAU Growth.pdf', '%PDF-1.4\n'.padEnd(357_000, ' ')],
  ['Projects/Job Search/MAU_Growth_case_appendix.xlsx', 'PK'.padEnd(56_000, ' ')],
  ['Projects/Job Search/Northwind case - Alex Rivera.pdf', '%PDF-1.4\n'.padEnd(996_000, ' ')],
  [
    'Projects/Job Search/CV Anthropic Product Lead.html',
    cvPage('Product Lead, Agents', 'Anthropic'),
  ],
  ['Projects/Job Search/CV Mistral PM.html', cvPage('Product Manager, Le Chat', 'Mistral')],
  ['Projects/Job Search/CV ElevenLabs PM.html', cvPage('Product Manager, Agents', 'ElevenLabs')],
]

/** The notes that folder is actually about. */
export const JOB_SEARCH_NOTES: Readonly<Record<string, string>> = {
  'Projects/Job Search/Job Search 2026.md':
    '# Job Search 2026\n\nTier 1 AI companies first. Brand before role.\n\n+ [ ] Shortlist by Friday\n+ [x] CV v3\n#project',
  'Projects/Job Search/Anthropic - Product Lead.md':
    '# Anthropic - Product Lead\n\nApplied 12 Nov. Referral from a former colleague.\n\n+ [ ] Prep the take-home\n#application',
  'Projects/Job Search/ElevenLabs - PM Agents.md':
    '# ElevenLabs - PM Agents\n\nFirst call went well. Second round is a product case on voice agents.\n#application',
  'Projects/Job Search/Mistral - Le Chat.md':
    '# Mistral - Le Chat\n\nParis or remote. Recruiter screen on Tuesday.\n#application',
  'Projects/Job Search/Interview prep.md':
    '# Interview prep\n\n- Story: 11x users at the acquired startup\n- Story: only PM from 3M to 12M\n- Why agents, why now',
  'Projects/Job Search/Salary benchmarks.md':
    '# Salary benchmarks\n\n| Company | Base | Equity |\n| --- | --- | --- |\n| A | 180k | 0.05% |\n| B | 165k | 0.1% |',
  'Projects/Job Search/Northwind case notes.md':
    '# Northwind case notes\n\nThe growth is real, but most of the paid spend earns back less than it costs.',
  'Projects/Job Search/Referrals.md':
    '# Referrals\n\nWho can introduce me where. Ask before the end of the month.',
}
