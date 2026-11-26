import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateObservations } from '../lib/observation-validation.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let dataDirectory
let apiProcess
let baseUrl

before(async () => {
  dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'payout-forensics-test-'))
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: '0',
    DATA_DIR: dataDirectory,
    JWT_SECRET: randomBytes(48).toString('hex'),
    DATA_ENCRYPTION_KEY: randomBytes(48).toString('hex'),
    MOZAIK_MODEL: 'gpt-5.4-mini',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    GEMINI_API_KEY: '',
    DEEPSEEK_API_KEY: '',
  }
  apiProcess = spawn(process.execPath, [path.join(projectRoot, 'server.mjs')], {
    cwd: dataDirectory,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  let errors = ''
  apiProcess.stdout.setEncoding('utf8')
  apiProcess.stderr.setEncoding('utf8')
  apiProcess.stdout.on('data', (chunk) => { output += chunk })
  apiProcess.stderr.on('data', (chunk) => { errors += chunk })

  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`API startup timed out. ${errors}`)), 15000)
    const check = () => {
      const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)
      if (match) {
        clearTimeout(timeout)
        resolve(Number(match[1]))
      }
    }
    apiProcess.stdout.on('data', check)
    apiProcess.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    apiProcess.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`API exited before startup (${code}). ${errors}`))
    })
    check()
  })
  baseUrl = `http://127.0.0.1:${port}`
})

after(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    const exited = once(apiProcess, 'exit')
    apiProcess.kill()
    await exited
  }
  if (dataDirectory) rmSync(dataDirectory, { recursive: true, force: true })
})

async function request(route, { method = 'GET', cookie, json, fileName, fileContents } = {}) {
  const headers = {}
  if (cookie) headers.Cookie = cookie
  let body
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = typeof json === 'string' ? json : JSON.stringify(json)
  } else if (fileName !== undefined) {
    body = new FormData()
    body.append('file', new Blob([fileContents]), fileName)
  }
  const response = await fetch(`${baseUrl}${route}`, { method, headers, body })
  const setCookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: response.status, data, setCookie }
}

function expectStatus(response, status) {
  assert.equal(response.status, status, JSON.stringify(response.data))
  return response.data
}

test('agent observations require non-empty evidence linked to cited records', () => {
  const evidence = [
    { id: 'ev-1', recordId: 'tx-1' },
    { id: 'ev-2', recordId: 'tx-2' },
  ]
  const candidate = {
    category: 'amount_inconsistency',
    recordIds: ['tx-1'],
    evidence: ['ev-1'],
    explanation: 'Source row supports this candidate.',
    confidence: 0.75,
  }
  const accepted = validateObservations([candidate], evidence)
  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].status, 'unverified')
  assert.equal(validateObservations([{ ...candidate, evidence: [] }], evidence).length, 0)
  assert.equal(validateObservations([{ ...candidate, evidence: ['ev-2'] }], evidence).length, 0)
  assert.equal(validateObservations([{ ...candidate, category: 'fraud' }], evidence).length, 0)
  assert.equal(validateObservations([null], evidence).length, 0)
})

test('authenticated API workflows preserve account boundaries and reject invalid inputs', async () => {
  const userA = `test_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const passwordA = 'Temporary-Test-Password-42!'
  const registrationA = await request('/api/auth/register', {
    method: 'POST',
    json: { name: 'Test Account A', username: userA, email: `${userA}@example.invalid`, password: passwordA },
  })
  expectStatus(registrationA, 201)
  let activeCookieA = registrationA.setCookie
  assert.ok(activeCookieA, 'registration should establish a session')

  expectStatus(await request('/api/me', { cookie: activeCookieA }), 200)
  const updatedProfile = expectStatus(await request('/api/me', {
    method: 'PATCH',
    cookie: activeCookieA,
    json: { name: 'Updated Test Account A', username: userA },
  }), 200)
  assert.equal(updatedProfile.user.name, 'Updated Test Account A')
  expectStatus(await request('/api/me/password', {
    method: 'POST',
    cookie: activeCookieA,
    json: { password: 'Temporary-Test-Password-43!' },
  }), 200)
  expectStatus(await request('/api/auth/login', {
    method: 'POST',
    json: { identifier: userA, password: 'Temporary-Test-Password-43!' },
  }), 200)

  const created = expectStatus(await request('/api/investigations', {
    method: 'POST',
    cookie: activeCookieA,
    json: { name: 'Synthetic API test' },
  }), 201)
  const investigationId = created.investigation.id

  const csv = [
    'transaction_id,amount,currency,type,status',
    'TX-API-001,125.40,USD,payout,posted',
    'TX-API-002,-125.40,USD,refund,posted',
    'TX-API-003,12.50,USD,fee,posted',
    'TX-API-004,,USD,payout,posted',
    'TX-API-005,0,USD,adjustment,posted',
  ].join('\n')
  const uploaded = expectStatus(await request(`/api/investigations/${investigationId}/upload`, {
    method: 'POST',
    cookie: activeCookieA,
    fileName: 'synthetic.csv',
    fileContents: csv,
  }), 200)
  assert.equal(uploaded.accepted, 4)
  assert.equal(uploaded.rejected, 1)

  const evidence = expectStatus(await request(`/api/investigations/${investigationId}/evidence`, { cookie: activeCookieA }), 200)
  assert.equal(evidence.evidence.length, 4)
  const dashboard = expectStatus(await request('/api/dashboard', { cookie: activeCookieA }), 200)
  assert.equal(dashboard.evidenceCount, 4)
  const investigations = expectStatus(await request('/api/investigations', { cookie: activeCookieA }), 200)
  assert.equal(investigations.investigations.length, 1)
  const search = expectStatus(await request(`/api/search?q=${encodeURIComponent(investigationId)}`, { cookie: activeCookieA }), 200)
  assert.equal(search.results.length, 1)
  const mozaikStatus = expectStatus(await request('/api/mozaik/status', { cookie: activeCookieA }), 200)
  assert.equal(mozaikStatus.configured, false)
  const runs = expectStatus(await request('/api/mozaik/runs', { cookie: activeCookieA }), 200)
  assert.equal(runs.runs.length, 0)

  expectStatus(await request(`/api/investigations/${investigationId}/upload`, {
    method: 'POST',
    cookie: activeCookieA,
    fileName: 'not-csv.txt',
    fileContents: 'not a CSV',
  }), 400)
  expectStatus(await request(`/api/investigations/${investigationId}/run`, {
    method: 'POST',
    cookie: activeCookieA,
    json: { confirmExternalProcessing: false },
  }), 400)

  expectStatus(await request('/api/notifications/seed', {
    method: 'POST',
    cookie: activeCookieA,
    json: { title: 'Synthetic update', message: 'Test notification' },
  }), 201)
  expectStatus(await request('/api/notifications/read', { method: 'POST', cookie: activeCookieA }), 200)
  const notifications = expectStatus(await request('/api/notifications', { cookie: activeCookieA }), 200)
  assert.ok(notifications.notifications.every((notification) => notification.unread === 0))

  const userB = `test_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const registrationB = await request('/api/auth/register', {
    method: 'POST',
    json: { name: 'Test Account B', username: userB, email: `${userB}@example.invalid`, password: passwordA },
  })
  expectStatus(registrationB, 201)
  const cookieB = registrationB.setCookie
  assert.ok(cookieB)

  const dashboardB = expectStatus(await request('/api/dashboard', { cookie: cookieB }), 200)
  assert.equal(dashboardB.evidenceCount, 0)
  assert.equal(dashboardB.investigations.length, 0)
  expectStatus(await request(`/api/investigations/${investigationId}/evidence`, { cookie: cookieB }), 404)
  expectStatus(await request('/api/auth/login', {
    method: 'POST',
    json: { identifier: userB, password: 'wrong-password-123' },
  }), 401)

  const invalidJson = expectStatus(await request('/api/auth/login', { method: 'POST', json: '{' }), 400)
  assert.equal(invalidJson.error, 'Invalid JSON request body')
  assert.equal(JSON.stringify(invalidJson).includes('server.mjs'), false)

  expectStatus(await request('/api/me'), 401)
})
