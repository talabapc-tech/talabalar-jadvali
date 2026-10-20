import { execSync } from 'child_process'
import { NextResponse } from 'next/server'
import versionFallback from '@/lib/version.json'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    let commit = versionFallback.commit
    let commitDate = versionFallback.commitDate
    let commitMessage = versionFallback.commitMessage
    let build = versionFallback.build
    let version = versionFallback.version

    try {
      const gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const gitDate = execSync('git log -1 --format=%cI', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const gitMsg = execSync('git log -1 --format=%s', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const gitCount = execSync('git rev-list --count HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

      if (gitHash) commit = gitHash
      if (gitDate) commitDate = gitDate
      if (gitMsg) commitMessage = gitMsg
      if (gitCount) {
        build = Number(gitCount)
        version = `2.0.${build}`
      }
    } catch {
      // Git unavailable at runtime (e.g. standard serverless container), use static fallback
    }

    return NextResponse.json({
      ok: true,
      version,
      build,
      commit,
      commitDate,
      lastPushDate: commitDate,
      commitMessage,
      serverTime: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json({
      ok: true,
      ...versionFallback,
      serverTime: new Date().toISOString(),
    })
  }
}
