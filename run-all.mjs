import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const probeDirs = readdirSync(`${root}probes`).sort((a, b) =>
  a.localeCompare(b, undefined, { numeric: true }),
)
mkdirSync(`${root}results`, { recursive: true })

const matrix = []
for (const probeDir of probeDirs) {
  const packageName = `probe-${probeDir}`
  let report
  try {
    const stdout = execFileSync('pnpm', ['--filter', packageName, '--silent', 'run', '--silent', 'probe'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    report = JSON.parse(stdout.slice(stdout.indexOf('{')))
  } catch (error) {
    matrix.push({ probe: probeDir, error: String(error.message ?? error).slice(0, 500) })
    continue
  }
  writeFileSync(`${root}results/${probeDir}.json`, JSON.stringify(report, undefined, 2) + '\n')
  matrix.push({
    probe: probeDir,
    playwrightVersion: report.playwrightVersion,
    webkitVersion: report.webkitVersion,
    bugReproduced: report.bugReproduced,
    rawCoordsAtPosCorrect: `${report.summary.raw.correct}/${report.summary.raw.total}`,
    patchedSingleRectCorrect: `${report.summary.patchedSingleRect.correct}/${report.summary.patchedSingleRect.total}`,
    validatedStrategyCorrect: `${report.summary.validatedStrategy.correct}/${report.summary.validatedStrategy.total}`,
  })
}

process.stdout.write(
  JSON.stringify({ detailReports: 'results/<probe>.json', matrix }, undefined, 2) + '\n',
)
