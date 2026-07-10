#!/usr/bin/env node
// One MCP tool call against a fresh `beat mcp` server, over the real JSON-RPC stdio protocol —
// the same wire format any MCP client uses. Useful for scripting agent sessions and debugging.
//
// Usage: node scripts/mcp-call.mjs <tool_name> '<json arguments>'
//   e.g. node scripts/mcp-call.mjs beat_inspect '{"file":"examples/real-groove.beat"}'

import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const [tool, argsJson] = process.argv.slice(2)
if (!tool) {
  console.error("usage: node scripts/mcp-call.mjs <tool_name> '<json arguments>'")
  process.exit(2)
}
const args = argsJson ? JSON.parse(argsJson) : {}

const proc = spawn(process.execPath, [join(repoRoot, 'cli', 'beat.mjs'), 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] })
let buf = ''
let step = 0
const send = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n')

proc.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8')
  let nl
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    if (!line.trim()) continue
    const msg = JSON.parse(line)
    if (msg.id === 1 && step === 0) {
      step = 1
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } })
    } else if (msg.id === 2) {
      if (msg.error) {
        console.error(`protocol error: ${msg.error.message}`)
        process.exit(2)
      }
      const text = (msg.result.content ?? []).map((c) => c.text).join('')
      process.stdout.write(text.endsWith('\n') ? text : text + '\n')
      proc.kill()
      process.exit(msg.result.isError ? 1 : 0)
    }
  }
})
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-call', version: '0' } } })
setTimeout(() => {
  console.error('timed out')
  proc.kill()
  process.exit(2)
}, 300000)
