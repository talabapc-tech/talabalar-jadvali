import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function getGitOutput(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

let count = getGitOutput('git rev-list --count HEAD')
let hash = getGitOutput('git rev-parse --short HEAD')
let commitDate = getGitOutput('git log -1 --format=%cI')
let commitMsg = getGitOutput('git log -1 --format=%s')

const fallbackJsonPath = path.join(rootDir, 'lib', 'version.json')
let fallback = { version: '2.0.421', build: 421, commit: '72b69a8', commitDate: new Date().toISOString() }
if (fs.existsSync(fallbackJsonPath)) {
  try {
    fallback = JSON.parse(fs.readFileSync(fallbackJsonPath, 'utf-8'))
  } catch {}
}

const buildNum = count ? Number(count) + 1 : (fallback.build || 421)
const version = `2.0.${buildNum}`
const now = new Date().toISOString()

const data = {
  version,
  build: buildNum,
  commit: hash || fallback.commit || 'dev',
  commitDate: commitDate || fallback.commitDate || now,
  lastPushDate: commitDate || now,
  commitMessage: commitMsg || fallback.commitMessage || 'Automated build',
  generatedAt: now,
}

fs.writeFileSync(fallbackJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
console.log(`[Version] Generated v${data.version} (${data.commit}) -> lib/version.json`)
