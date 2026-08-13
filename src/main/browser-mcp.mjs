#!/usr/bin/env node
/**
 * Stdio MCP for GrokCode BrowserPane.
 * Talks to the loopback HTTP API started by the GrokCode main process.
 */

const BASE = process.env.GROKCODE_BROWSER_URL
const TOKEN = process.env.GROKCODE_BROWSER_TOKEN

if (!BASE || !TOKEN) {
  console.error('GROKCODE_BROWSER_URL and GROKCODE_BROWSER_TOKEN are required')
  process.exit(1)
}

const TOOLS = [
  {
    name: 'get_state',
    description:
      'Get the GrokCode in-app BrowserPane state: url, title, loading, visible, canGoBack, canGoForward, error. Use this after navigate to verify the page loaded.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'navigate',
    description:
      'Open a URL in the GrokCode BrowserPane — the in-app browser. Always use this instead of an external browser. Shows the pane if it is hidden. Use http or https only.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL to load, e.g. http://localhost:3000' }
      },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'back',
    description: 'Go back in the GrokCode BrowserPane history.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'forward',
    description: 'Go forward in the GrokCode BrowserPane history.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'reload',
    description: 'Reload the current GrokCode BrowserPane page.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'stop',
    description: 'Stop loading the current GrokCode BrowserPane page.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
]

async function callApi(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(text || `BrowserPane API ${res.status}`)
  }
  return text ? JSON.parse(text) : {}
}

async function handleTool(name, args) {
  if (name === 'get_state') return callApi('GET', '/state')
  if (name === 'navigate') return callApi('POST', '/navigate', { url: String(args?.url ?? '') })
  if (name === 'back') return callApi('POST', '/back')
  if (name === 'forward') return callApi('POST', '/forward')
  if (name === 'reload') return callApi('POST', '/reload')
  if (name === 'stop') return callApi('POST', '/stop')
  throw new Error(`Unknown tool: ${name}`)
}

function reply(id, result) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, result })
  const buf = Buffer.from(payload, 'utf8')
  process.stdout.write(`Content-Length: ${buf.length}\r\n\r\n`)
  process.stdout.write(buf)
}

function fail(id, message) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code: -32000, message }
  })
  const buf = Buffer.from(payload, 'utf8')
  process.stdout.write(`Content-Length: ${buf.length}\r\n\r\n`)
  process.stdout.write(buf)
}

async function handle(message) {
  const { id, method, params } = message
  if (method === 'initialize') {
    reply(id, {
      protocolVersion: params?.protocolVersion ?? '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'grokcode-browser', version: '0.1.0' }
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'initialized') return
  if (method === 'ping') {
    reply(id, {})
    return
  }
  if (method === 'tools/list') {
    reply(id, { tools: TOOLS })
    return
  }
  if (method === 'tools/call') {
    try {
      const data = await handleTool(params?.name, params?.arguments ?? {})
      reply(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      reply(id, {
        content: [{ type: 'text', text: message }],
        isError: true
      })
    }
    return
  }
  if (id !== undefined) fail(id, `Unknown method: ${method}`)
}

let buffer = Buffer.alloc(0)

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const header = buffer.subarray(0, headerEnd).toString('utf8')
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4)
      continue
    }
    const length = Number(match[1])
    const start = headerEnd + 4
    if (buffer.length < start + length) return
    const body = buffer.subarray(start, start + length).toString('utf8')
    buffer = buffer.subarray(start + length)
    try {
      void handle(JSON.parse(body))
    } catch (error) {
      console.error(error)
    }
  }
})

process.stdin.on('end', () => process.exit(0))
