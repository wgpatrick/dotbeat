#!/usr/bin/env node
// Freesound OAuth2 flow — unlocks ORIGINAL-QUALITY downloads (token auth only reaches 128kbps
// previews; the /download/ endpoint requires OAuth2 per Freesound's API docs).
//
// One-time setup (requires a human click):
//   1. FREESOUND_CLIENT_ID=... FREESOUND_API_KEY=... node scripts/freesound-oauth.mjs authorize
//      -> prints a URL; the account owner opens it, clicks "Authorize", and Freesound displays
//         an authorization code (the default redirect shows it on-screen for copy/paste).
//   2. node scripts/freesound-oauth.mjs exchange <pasted-code>
//      -> exchanges it for an access token (~24h) + refresh token, saved to .freesound-tokens.json
//         (gitignored — tokens are machine-local secrets, never committed).
// After that, everything is automatic:
//   node scripts/freesound-oauth.mjs token   -> prints a valid access token, refreshing if needed
//   (freesound-cc0.mjs --original uses this to fetch full-quality files.)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOKEN_FILE = join(root, '.freesound-tokens.json')

const clientId = process.env.FREESOUND_CLIENT_ID
const clientSecret = process.env.FREESOUND_API_KEY

function needCreds() {
  if (!clientId || !clientSecret) {
    console.error('set FREESOUND_CLIENT_ID and FREESOUND_API_KEY (both shown at freesound.org/apiv2/apply)')
    process.exit(2)
  }
}

async function exchange(params) {
  needCreds()
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params })
  const res = await fetch('https://freesound.org/apiv2/oauth2/access_token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json()
  if (!res.ok || !data.access_token) {
    console.error(`token exchange failed (${res.status}): ${JSON.stringify(data)}`)
    process.exit(1)
  }
  const record = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + (data.expires_in - 300) * 1000).toISOString(), // 5 min safety margin
  }
  writeFileSync(TOKEN_FILE, JSON.stringify(record, null, 2) + '\n')
  return record
}

/** Returns a valid access token, refreshing transparently. Exported-by-convention for
 * freesound-cc0.mjs (imported as a module) and usable as a CLI (`token` subcommand). */
export async function getAccessToken() {
  if (!existsSync(TOKEN_FILE)) return null
  const t = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'))
  if (new Date(t.expires_at) > new Date()) return t.access_token
  const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: t.refresh_token })
  return refreshed.access_token
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'authorize') {
  needCreds()
  console.log('Open this URL, log in to Freesound, click "Authorize", then copy the code it shows:\n')
  console.log(`  https://freesound.org/apiv2/oauth2/authorize/?client_id=${clientId}&response_type=code\n`)
  console.log('Then run: node scripts/freesound-oauth.mjs exchange <code>')
} else if (cmd === 'exchange') {
  if (!arg) {
    console.error('usage: freesound-oauth.mjs exchange <authorization-code>')
    process.exit(2)
  }
  const rec = await exchange({ grant_type: 'authorization_code', code: arg })
  console.log(`authorized — access token saved to ${TOKEN_FILE} (valid until ${rec.expires_at}; auto-refreshes)`)
} else if (cmd === 'token') {
  const token = await getAccessToken()
  if (!token) {
    console.error('no tokens yet — run the authorize + exchange steps first')
    process.exit(1)
  }
  console.log(token)
} else if (cmd !== undefined) {
  console.error('usage: freesound-oauth.mjs authorize | exchange <code> | token')
  process.exit(2)
}
