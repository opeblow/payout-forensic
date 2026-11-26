import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import Database from 'better-sqlite3'
import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'csv-parse/sync'
import { Agent, Loop, initAgentModule, resolveAgentModule, supportedModels } from '@mozaik-ai/core'
import { validateObservations } from './lib/observation-validation.mjs'
import { findDuplicateGroups } from './lib/duplicate-check.mjs'
import { resolveBatchStatus, displayVariance } from './lib/batch-status.mjs'

const app = express()
const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '127.0.0.1'
const dataDirectory = path.resolve(process.env.DATA_DIR || './data')
const uploadDirectory = path.join(dataDirectory, 'uploads')
function readBoundedInt(name, fallback, min, max) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}
const maxAgentSteps = readBoundedInt('MOZAIK_MAX_STEPS', 3, 1, 10)
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || !process.env.DATA_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY.length < 32)) {
  throw new Error('Production requires JWT_SECRET and DATA_ENCRYPTION_KEY values of at least 32 characters.')
}
const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex')
const encryptionKey = crypto.createHash('sha256').update(process.env.DATA_ENCRYPTION_KEY || 'development-only-change-me').digest()

fs.mkdirSync(uploadDirectory, { recursive: true })
const db = new Database(path.join(dataDirectory, 'payout.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS investigations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    status TEXT NOT NULL, variance TEXT NOT NULL DEFAULT 'Not calculated', created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL, record_id TEXT NOT NULL,
    status TEXT NOT NULL, amount TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL,
    row_number INTEGER, currency TEXT, type TEXT, original_status TEXT, reference TEXT,
    FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
    message TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS mozaik_agents (
    id TEXT PRIMARY KEY, record TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mozaik_loop_owners (
    agent_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, investigation_id TEXT NOT NULL,
    agent_name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mozaik_loops (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, investigation_id TEXT NOT NULL,
    agent_name TEXT NOT NULL, record TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, user_id TEXT NOT NULL, investigation_id TEXT NOT NULL,
    agent_name TEXT NOT NULL, loop_id TEXT NOT NULL, status TEXT NOT NULL,
    summary TEXT, error_code TEXT, started_at TEXT NOT NULL, finished_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS mozaik_batches (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, investigation_id TEXT NOT NULL,
    model TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
  );
`)

const evidenceColumns = new Set(db.prepare('PRAGMA table_info(evidence)').all().map((column) => column.name))
for (const [column, definition] of Object.entries({
  row_number: 'INTEGER',
  currency: 'TEXT',
  type: 'TEXT',
  original_status: 'TEXT',
  reference: 'TEXT',
})) {
  if (!evidenceColumns.has(column)) db.exec(`ALTER TABLE evidence ADD COLUMN ${column} ${definition}`)
}
const recoveredAt = new Date().toISOString()
db.prepare("UPDATE mozaik_batches SET status = 'interrupted', finished_at = ? WHERE status IN ('queued', 'running')").run(recoveredAt)
db.prepare("UPDATE agent_runs SET status = 'interrupted', error_code = 'SERVER_RESTARTED', finished_at = ? WHERE status IN ('queued', 'running')").run(recoveredAt)

const emptyMemory = {
  async remember() {},
  async recall() { return [] },
}
const memoryFactory = { create: () => emptyMemory }
const agentRepository = {
  async save(agent) {
    const record = { id: agent.id, name: agent.name, instruction: agent.instruction, tools: agent.tools }
    db.prepare('INSERT OR REPLACE INTO mozaik_agents (id, record) VALUES (?, ?)').run(agent.id, encrypt(JSON.stringify(record)))
  },
  async exists(id) {
    return Boolean(db.prepare('SELECT 1 FROM mozaik_agents WHERE id = ?').get(id))
  },
  async findById(id) {
    const row = db.prepare('SELECT record FROM mozaik_agents WHERE id = ?').get(id)
    if (!row) return undefined
    return Agent.rehydrate({ ...JSON.parse(decrypt(row.record)), memory: memoryFactory.create() })
  },
  async findAll() {
    return db.prepare('SELECT record FROM mozaik_agents').all()
      .map((row) => Agent.rehydrate({ ...JSON.parse(decrypt(row.record)), memory: memoryFactory.create() }))
  },
}
const loopRepository = {
  async save(loop) {
    const record = {
      id: loop.id,
      assignee: loop.assignee,
      goal: loop.goal,
      state: loop.state,
      message: loop.message,
      pendingInstruction: loop.pendingInstruction,
      completedInstructions: loop.completedInstructions,
    }
    const owner = db.prepare('SELECT user_id, investigation_id, agent_name FROM mozaik_loop_owners WHERE agent_id = ?').get(loop.assignee)
    if (!owner) throw new Error('Mozaik loop owner must be registered before saving')
    db.prepare(`INSERT INTO mozaik_loops (id, user_id, investigation_id, agent_name, record, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at`)
      .run(loop.id, owner.user_id, owner.investigation_id, owner.agent_name, encrypt(JSON.stringify(record)), new Date().toISOString())
  },
  async findById(id) {
    const row = db.prepare('SELECT record FROM mozaik_loops WHERE id = ?').get(id)
    return row ? Loop.rehydrate(JSON.parse(decrypt(row.record))) : undefined
  },
}
const selectedModel = process.env.MOZAIK_MODEL || 'gpt-5.4-mini'
const configuredModel = supportedModels.find((model) => model.specification.name === selectedModel)
if (!configuredModel) throw new Error(`Unsupported MOZAIK_MODEL: ${selectedModel}`)
initAgentModule({
  agentRepository,
  loopRepository,
  memoryFactory,
  inferenceRunnerConfig: { supportedModels: [configuredModel] },
})
const mozaik = resolveAgentModule()

const specialistAgents = [
  { name: 'Transaction Investigator', focus: 'Compare transaction identifiers and amounts; point out duplicate or unmatched references.' },
  { name: 'Fee Auditor', focus: 'Review amount patterns for possible repeated or inconsistent fees; do not infer a fee schedule that was not provided.' },
  { name: 'Refund Investigator', focus: 'Identify records that are explicitly refund-related and possible duplicate references.' },
  { name: 'Settlement Investigator', focus: 'Review records explicitly identified as settlements and identify potential unmatched records.' },
  { name: 'FX Investigator', focus: 'Review currency fields if present. Never infer historical rates or make cross-currency comparisons without a supplied rate.' },
  { name: 'Adversarial Auditor', focus: 'Challenge the candidate observations from the specialists. Flag unsupported evidence, duplicates, contradictions, and claims that exceed the input.' },
]
const observationSchema = {
  type: 'object',
  properties: {
    observations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['duplicate_reference', 'unmatched_reference', 'amount_inconsistency', 'fee_review', 'refund_review', 'settlement_review', 'fx_review', 'unsupported_claim'] },
          recordIds: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'array', items: { type: 'string' } },
          explanation: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['category', 'recordIds', 'evidence', 'explanation', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['observations'],
  additionalProperties: false,
}

function providerKeyAvailable() {
  const provider = configuredModel.specification.provider
  if (provider === 'openai') return Boolean(process.env.OPENAI_API_KEY)
  if (provider === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY)
  if (provider === 'google') return Boolean(process.env.GEMINI_API_KEY)
  if (provider === 'deepseek') return Boolean(process.env.DEEPSEEK_API_KEY)
  return false
}

function readModelText(loop) {
  const instruction = [...loop.completedInstructions].reverse().find((item) => item.type === 'inference')
  const items = instruction?.result?.items || []
  const text = items.filter((item) => item.type === 'model_message').map((item) => item.text).join('\n').trim()
  if (!text) throw new Error('Mozaik returned no structured message')
  return JSON.parse(text)
}

async function runMozaikAgent({ batchId, userId, investigationId, definition, evidence, priorObservations, reviewedCount = 0 }) {
  const runId = crypto.randomUUID()
  const accessToken = crypto.randomBytes(24).toString('hex')
  mozaikAccessTokens.set(accessToken, userId)
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO agent_runs
    (id, batch_id, user_id, investigation_id, agent_name, loop_id, status, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(runId, batchId, userId, investigationId, definition.name, 'pending', 'queued', now)
  try {
    const agent = await mozaik.createAgent({
      name: definition.name,
      instruction: `You are a specialist financial evidence analyst. ${definition.focus}
Only report candidate observations supported by the supplied source records. Do not invent records, amounts, rates, fee schedules, relationships, or transaction activity. Every observation must identify actual recordIds and evidence IDs. Candidate observations are not verified findings. Return only the required structured output. Never expose private reasoning.`,
      tools: [evidenceToolDefinition],
    })
    db.prepare('INSERT OR REPLACE INTO mozaik_loop_owners (agent_id, user_id, investigation_id, agent_name) VALUES (?, ?, ?, ?)')
      .run(agent.id, userId, investigationId, definition.name)
    const prompt = {
      investigationId,
      evidenceAccessToken: accessToken,
      evidence: evidence.slice(0, 100),
      evidenceLimit: Math.min(evidence.length, 100),
      evidenceTotal: evidence.length,
      instruction: 'Rows include rowNumber, currency, type, originalStatus and reference when the source CSV supplied them. Use only fields actually present in a row. If evidenceTotal is larger than evidence.length, use get_investigation_evidence to inspect every remaining page before making observations. Request offsets in order, using limits no larger than 500. Only cite returned recordIds and evidence IDs.',
      priorCandidateObservations: priorObservations || [],
    }
    const loop = await mozaik.createLoop({
      agentId: agent.id,
      goal: `Investigate user-owned financial records for ${definition.name}. Return evidence-linked candidate observations only.`,
    })
    db.prepare('UPDATE agent_runs SET loop_id = ?, status = ? WHERE id = ?').run(loop.id, 'running', runId)
    const context = [
      { type: 'system_message', text: agent.instruction },
      { type: 'user_message', text: JSON.stringify(prompt) },
    ]
    let responseLoop = loop
    let parsed
    for (let step = 0; step < maxAgentSteps; step++) {
      await mozaik.setBreakpoint({
        loopId: loop.id,
        instruction: {
          type: 'inference',
          parameters: {
            model: selectedModel,
            maxOutputTokens: 1800,
            tools: [evidenceToolDefinition],
            structuredOutput: { name: 'evidence_observations', schema: observationSchema, strict: true },
            context: { items: context },
          },
        },
      })
      await mozaik.advanceLoop({ loopId: loop.id })
      responseLoop = await mozaik.getLoop(loop.id)
      const last = responseLoop.completedInstructions[responseLoop.completedInstructions.length - 1]
      const requestedTools = last?.result?.items?.filter((item) => item.type === 'tool_call') || []
      if (!requestedTools.length) {
        parsed = readModelText(responseLoop)
        break
      }
      for (const call of requestedTools.slice(0, 3)) {
        const args = JSON.parse(call.toolArguments)
        args.investigationId = investigationId
        args.accessToken = accessToken
        await mozaik.setBreakpoint({
          loopId: loop.id,
          instruction: { type: 'tool_call', parameters: { toolName: call.toolName, toolArguments: JSON.stringify(args) } },
        })
        await mozaik.advanceLoop({ loopId: loop.id })
        responseLoop = await mozaik.getLoop(loop.id)
        const result = responseLoop.completedInstructions[responseLoop.completedInstructions.length - 1]?.result
        context.push(call, {
          type: 'tool_call_result',
          requestId: call.requestId,
          result: { type: 'input_text', text: result?.result || '' },
        })
      }
    }
    if (!parsed) throw new Error('Mozaik agent exceeded the bounded inference steps')
    const checked = validateObservations(parsed.observations, evidence)
    await mozaik.endLoop({ loopId: loop.id, message: 'Candidate observations validated against source record identifiers.' })
    db.prepare('UPDATE agent_runs SET status = ?, summary = ?, finished_at = ? WHERE id = ?')
      .run('completed', encrypt(JSON.stringify({ observations: checked, reviewedCount })), new Date().toISOString(), runId)
    return { runId, name: definition.name, status: 'completed', observations: checked }
  } catch (error) {
    const code = error?.name === 'APIError' ? 'PROVIDER_REQUEST_FAILED' : 'MOZAIK_EXECUTION_FAILED'
    db.prepare('UPDATE agent_runs SET status = ?, error_code = ?, finished_at = ? WHERE id = ?')
      .run('failed', code, new Date().toISOString(), runId)
    return { runId, name: definition.name, status: 'failed', observations: [] }
  } finally {
    mozaikAccessTokens.delete(accessToken)
  }
}

async function runMozaikBatch(batchId, userId, investigationId) {
  db.prepare('UPDATE mozaik_batches SET status = ? WHERE id = ?').run('running', batchId)
  const evidence = db.prepare('SELECT * FROM evidence WHERE investigation_id = ? ORDER BY row_number, created_at LIMIT 1000')
    .all(investigationId)
    .map(mapEvidence)
  const specialists = specialistAgents.filter((agent) => agent.name !== 'Adversarial Auditor')
  const results = await Promise.all(specialists.map((definition) => runMozaikAgent({
    batchId, userId, investigationId, definition, evidence, priorObservations: [],
  })))
  const priorObservations = results.flatMap((result) => result.observations.map((observation) => ({ agent: result.name, ...observation })))
  if (results.some((result) => result.status === 'completed')) {
    results.push(await runMozaikAgent({
      batchId, userId, investigationId,
      definition: specialistAgents.find((agent) => agent.name === 'Adversarial Auditor'),
      evidence, priorObservations, reviewedCount: priorObservations.length,
    }))
  }
  const status = resolveBatchStatus(results)
  db.prepare('UPDATE mozaik_batches SET status = ?, finished_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), batchId)
}

const evidenceToolDefinition = {
  name: 'get_investigation_evidence',
  description: 'Read source evidence rows belonging to the current user and investigation. This tool is read-only.',
  parameters: {
    type: 'object',
    properties: {
      investigationId: { type: 'string' },
      accessToken: { type: 'string' },
      offset: { type: 'number' },
      limit: { type: 'number' },
    },
    required: ['investigationId', 'accessToken', 'offset', 'limit'],
    additionalProperties: false,
  },
  strict: true,
}
const mozaikAccessTokens = new Map()
mozaik.registerTool('get_investigation_evidence', {
  invoke: ({ investigationId, accessToken, offset: offsetValue, limit: limitValue }) => {
    if (typeof investigationId !== 'string' || typeof accessToken !== 'string') throw new Error('Invalid evidence request')
    const userId = mozaikAccessTokens.get(accessToken)
    if (!userId) throw new Error('Evidence access token expired')
    const investigation = db.prepare('SELECT id FROM investigations WHERE id = ? AND user_id = ?').get(investigationId, userId)
    if (!investigation) throw new Error('Investigation not found')
    const offset = Number.isInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0
    const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 500) : 100
    return db.prepare('SELECT * FROM evidence WHERE investigation_id = ? ORDER BY row_number, created_at LIMIT ? OFFSET ?')
      .all(investigationId, limit, offset)
      .map(mapEvidence)
  },
})

app.use(cors({ origin: ['http://127.0.0.1:5173', 'http://localhost:5173'], credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

const upload = multer({
  dest: uploadDirectory,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, file.originalname.toLowerCase().endsWith('.csv'))
  },
})

function encrypt(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`
}

function decrypt(value) {
  const [ivHex, tagHex, dataHex] = String(value).split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}

function optionalField(value) {
  const text = String(value ?? '').trim()
  return text ? text : null
}

function mapEvidence(row) {
  return {
    id: row.id,
    recordId: decrypt(row.record_id),
    rowNumber: row.row_number ?? null,
    amount: decrypt(row.amount),
    currency: row.currency ? decrypt(row.currency) : '',
    type: row.type ? decrypt(row.type) : '',
    status: row.status,
    originalStatus: row.original_status ? decrypt(row.original_status) : '',
    reference: row.reference ? decrypt(row.reference) : '',
    source: decrypt(row.source),
  }
}

function mapRun(row) {
  return {
    ...row,
    summary: row.summary ? JSON.parse(decrypt(row.summary)) : null,
  }
}

function auth(req, res, next) {
  const token = req.cookies.pf_session
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  try {
    req.user = jwt.verify(token, jwtSecret)
    next()
  } catch {
    res.status(401).json({ error: 'Session expired' })
  }
}

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id, name: user.name, username: user.username }, jwtSecret, { expiresIn: '12h' })
  res.cookie('pf_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  })
}

function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  return db.prepare('SELECT * FROM users').all().find((candidate) => {
    try { return decrypt(candidate.email) === normalized } catch { return false }
  })
}

const authAttempts = new Map()
function authRateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`
    const now = Date.now()
    const attempts = (authAttempts.get(key) || []).filter((time) => now - time < windowMs)
    if (attempts.length >= max) {
      res.setHeader('Retry-After', Math.ceil((attempts[0] + windowMs - now) / 1000))
      return res.status(429).json({ error: 'Too many authentication attempts. Try again later.' })
    }
    attempts.push(now)
    authAttempts.set(key, attempts)
    next()
  }
}

app.post('/api/auth/register', authRateLimit(10, 15 * 60 * 1000), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim()
    const username = String(req.body.username || '').trim().toLowerCase()
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    if (!name || !/^[a-z0-9_.-]{3,32}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
      return res.status(400).json({ error: 'Use a valid name, username, email, and a password of at least 12 characters.' })
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) || findUserByEmail(email)
    if (existing) return res.status(409).json({ error: 'Username or email is already registered.' })
    const id = crypto.randomUUID()
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 3, parallelism: 1 })
    db.prepare('INSERT INTO users (id, name, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, encrypt(name), username, encrypt(email), passwordHash, new Date().toISOString())
    const user = { id, name, username }
    setSession(res, user)
    res.status(201).json({ user })
  } catch {
    console.error('Registration failed')
    res.status(500).json({ error: 'Registration failed' })
  }
})

app.post('/api/auth/login', authRateLimit(10, 15 * 60 * 1000), async (req, res) => {
  try {
    const identifier = String(req.body.identifier || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(identifier) || findUserByEmail(identifier)
    if (!row) return res.status(401).json({ error: 'Invalid credentials' })
    if (!(await argon2.verify(row.password_hash, password))) return res.status(401).json({ error: 'Invalid credentials' })
    const user = { id: row.id, name: decrypt(row.name), username: row.username }
    setSession(res, user)
    res.json({ user })
  } catch {
    res.status(500).json({ error: 'Login failed' })
  }
})

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('pf_session')
  res.json({ ok: true })
})

app.get('/api/me', auth, (req, res) => {
  const row = db.prepare('SELECT id, name, username, email, created_at FROM users WHERE id = ?').get(req.user.sub)
  if (!row) return res.status(404).json({ error: 'User not found' })
  res.json({ user: { id: row.id, name: decrypt(row.name), username: row.username, email: decrypt(row.email), created_at: row.created_at } })
})

app.patch('/api/me', auth, (req, res) => {
  const name = String(req.body.name || '').trim()
  const username = String(req.body.username || '').trim().toLowerCase()
  if (!name || !/^[a-z0-9_.-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Invalid profile details' })
  try {
    db.prepare('UPDATE users SET name = ?, username = ? WHERE id = ?').run(encrypt(name), username, req.user.sub)
    res.json({ user: { id: req.user.sub, name, username } })
  } catch {
    res.status(409).json({ error: 'Username is already in use' })
  }
})

app.post('/api/me/password', auth, async (req, res) => {
  const password = String(req.body.password || '')
  if (password.length < 12) return res.status(400).json({ error: 'Password must contain at least 12 characters' })
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 3, parallelism: 1 })
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.sub)
  res.json({ ok: true })
})

app.get('/api/investigations', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM investigations WHERE user_id = ? ORDER BY created_at DESC').all(req.user.sub)
  res.json({ investigations: rows.map((row) => ({ ...row, name: decrypt(row.name), variance: displayVariance(row.variance) })) })
})

app.post('/api/investigations', auth, (req, res) => {
  const name = String(req.body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Investigation name is required' })
  const id = `INV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
  db.prepare('INSERT INTO investigations (id, user_id, name, status, variance, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.user.sub, encrypt(name), 'Detected', 'Not calculated', new Date().toISOString())
  res.status(201).json({ investigation: { id, name, status: 'Detected', variance: 'Not calculated' } })
})

app.post('/api/investigations/:id/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A valid CSV file is required' })
  const investigation = db.prepare('SELECT id FROM investigations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.sub)
  if (!investigation) {
    fs.unlinkSync(req.file.path)
    return res.status(404).json({ error: 'Investigation not found' })
  }
  try {
    const content = fs.readFileSync(req.file.path)
    let records
    try {
      records = parse(content, { columns: true, skip_empty_lines: true, bom: true })
    } catch {
      return res.status(400).json({ error: 'CSV could not be parsed safely' })
    }
    const acceptedRecords = []
    let rejected = 0
    records.forEach((record, index) => {
      const recordId = String(record.transaction_id || record.id || `ROW-${index + 2}`).trim()
      const amount = String(record.amount ?? record.gross_amount ?? '').trim()
      if (!recordId || !/^[+-]?\d+(?:\.\d+)?$/.test(amount) || !Number.isFinite(Number(amount))) {
        rejected++
        return
      }
      acceptedRecords.push({
        recordId,
        amount,
        rowNumber: index + 2,
        currency: optionalField(record.currency ?? record.currency_code),
        type: optionalField(record.type ?? record.record_type),
        originalStatus: optionalField(record.status),
        reference: optionalField(record.reference ?? record.payout_reference ?? record.refund_reference ?? record.settlement_reference),
      })
    })
    const importedAt = new Date().toISOString()
    const insertEvidence = db.prepare(`INSERT INTO evidence
      (id, investigation_id, record_id, status, amount, source, created_at, row_number, currency, type, original_status, reference)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    db.transaction(() => {
      for (const record of acceptedRecords) {
        insertEvidence.run(
          crypto.randomUUID(), req.params.id, encrypt(record.recordId), 'Unresolved', encrypt(record.amount),
          encrypt(req.file.originalname), importedAt, record.rowNumber,
          record.currency && encrypt(record.currency), record.type && encrypt(record.type),
          record.originalStatus && encrypt(record.originalStatus), record.reference && encrypt(record.reference),
        )
      }
      if (acceptedRecords.length > 0) {
        db.prepare('UPDATE investigations SET status = ? WHERE id = ?').run('Investigating', req.params.id)
      }
    })()
    const accepted = acceptedRecords.length
    res.json({ accepted, rejected, suspicious: 0, source: req.file.originalname })
  } finally {
    fs.rmSync(req.file.path, { force: true })
  }
})

app.get('/api/investigations/:id/evidence', auth, (req, res) => {
  const investigation = db.prepare('SELECT id FROM investigations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.sub)
  if (!investigation) return res.status(404).json({ error: 'Investigation not found' })
  const rows = db.prepare('SELECT * FROM evidence WHERE investigation_id = ? ORDER BY row_number, created_at DESC').all(req.params.id)
  res.json({ evidence: rows.map(mapEvidence) })
})

app.get('/api/investigations/:id/duplicate-check', auth, (req, res) => {
  const investigation = db.prepare('SELECT id FROM investigations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.sub)
  if (!investigation) return res.status(404).json({ error: 'Investigation not found' })
  const evidence = db.prepare('SELECT * FROM evidence WHERE investigation_id = ? ORDER BY row_number, created_at').all(req.params.id).map(mapEvidence)
  res.json({ groups: findDuplicateGroups(evidence) })
})

app.get('/api/dashboard', auth, (req, res) => {
  const investigations = db.prepare('SELECT id, name, status, variance, created_at FROM investigations WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.sub)
    .map((row) => ({ ...row, name: decrypt(row.name), variance: displayVariance(row.variance) }))
  const evidenceCount = db.prepare(`SELECT COUNT(e.id) AS count FROM evidence e
    JOIN investigations i ON i.id = e.investigation_id WHERE i.user_id = ?`).get(req.user.sub).count
  const runCount = db.prepare('SELECT COUNT(*) AS count FROM agent_runs WHERE user_id = ?').get(req.user.sub).count
  res.json({ investigations, evidenceCount, runCount })
})

app.get('/api/mozaik/status', auth, (req, res) => {
  const latest = db.prepare(`SELECT id, investigation_id, model, status, created_at, finished_at
    FROM mozaik_batches WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`).all(req.user.sub)
  res.json({
    sdk: '@mozaik-ai/core',
    configured: providerKeyAvailable(),
    model: selectedModel,
    provider: configuredModel.specification.provider,
    reason: providerKeyAvailable() ? null : `Set the ${configuredModel.specification.provider.toUpperCase()} provider API key to run Mozaik agents.`,
    runs: latest,
  })
})

app.get('/api/mozaik/runs', auth, (req, res) => {
  const rows = db.prepare(`SELECT id, batch_id, investigation_id, agent_name, loop_id, status, summary, error_code, started_at, finished_at
    FROM agent_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 100`).all(req.user.sub)
  res.json({ runs: rows.map(mapRun) })
})

app.get('/api/mozaik/batches/:id', auth, (req, res) => {
  const batch = db.prepare(`SELECT id, investigation_id, model, status, created_at, finished_at
    FROM mozaik_batches WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.sub)
  if (!batch) return res.status(404).json({ error: 'Batch not found' })
  const runs = db.prepare(`SELECT id, batch_id, agent_name, status, error_code, summary, started_at, finished_at
    FROM agent_runs WHERE batch_id = ? AND user_id = ? ORDER BY started_at`).all(batch.id, req.user.sub).map(mapRun)
  const evidence = db.prepare('SELECT * FROM evidence WHERE investigation_id = ? ORDER BY row_number, created_at')
    .all(batch.investigation_id).map(mapEvidence)
  res.json({
    batch: {
      id: batch.id,
      investigationId: batch.investigation_id,
      model: batch.model,
      status: batch.status,
      createdAt: batch.created_at,
      finishedAt: batch.finished_at,
    },
    runs,
    evidence,
    deterministicMatches: findDuplicateGroups(evidence),
  })
})

app.post('/api/investigations/:id/run', auth, (req, res) => {
  const investigation = db.prepare('SELECT id FROM investigations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.sub)
  if (!investigation) return res.status(404).json({ error: 'Investigation not found' })
  if (req.body.confirmExternalProcessing !== true) {
    return res.status(400).json({ error: 'Explicit consent is required before financial records are sent to the configured model provider.' })
  }
  if (!providerKeyAvailable()) {
    return res.status(503).json({ error: `Mozaik is installed but not enabled. Configure the ${configuredModel.specification.provider.toUpperCase()} provider API key.` })
  }
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM evidence WHERE investigation_id = ?').get(req.params.id)
  if (count === 0) return res.status(422).json({ error: 'Upload evidence before starting a Mozaik investigation.' })
  if (count > 1000) return res.status(413).json({ error: 'This Mozaik investigation is limited to 1,000 evidence rows. Narrow the upload before continuing.' })
  const active = db.prepare(`SELECT id FROM mozaik_batches
    WHERE investigation_id = ? AND user_id = ? AND status IN ('queued', 'running')`).get(req.params.id, req.user.sub)
  if (active) return res.status(409).json({ error: 'A Mozaik run is already active for this investigation.' })
  const batchId = crypto.randomUUID()
  db.prepare(`INSERT INTO mozaik_batches (id, user_id, investigation_id, model, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(batchId, req.user.sub, req.params.id, selectedModel, 'queued', new Date().toISOString())
  setImmediate(() => {
    runMozaikBatch(batchId, req.user.sub, req.params.id).catch(() => {
      db.prepare('UPDATE mozaik_batches SET status = ?, finished_at = ? WHERE id = ?')
        .run('failed', new Date().toISOString(), batchId)
    })
  })
  res.status(202).json({ runId: batchId, status: 'queued', model: selectedModel })
})

app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(req.user.sub)
  res.json({ notifications: rows })
})

app.post('/api/notifications/seed', auth, (req, res) => {
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO notifications (id, user_id, title, message, unread, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(id, req.user.sub, req.body.title || 'Investigation update', req.body.message || 'A new evidence record was received.', new Date().toISOString())
  res.status(201).json({ ok: true })
})

app.post('/api/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET unread = 0 WHERE user_id = ?').run(req.user.sub)
  res.json({ ok: true })
})

app.get('/api/search', auth, (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase()
  const investigations = db.prepare('SELECT id, name, status FROM investigations WHERE user_id = ?').all(req.user.sub)
  const results = investigations
    .map((row) => ({ id: row.id, title: decrypt(row.name), status: row.status }))
    .filter((row) => !query || row.id.toLowerCase().includes(query) || row.title.toLowerCase().includes(query))
    .slice(0, 10)
  res.json({ results })
})

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
    ? error.status
    : Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500
  const message = error?.type === 'entity.parse.failed'
    ? 'Invalid JSON request body'
    : error?.code === 'LIMIT_FILE_SIZE'
      ? 'CSV file exceeds the 25 MB upload limit'
      : status < 500
        ? 'Invalid request'
        : 'Internal server error'
  if (status >= 500) console.error('Unhandled API error', { method: req.method, path: req.path })
  res.status(status).json({ error: message })
})

const server = app.listen(port, host, () => {
  const address = server.address()
  const listeningPort = typeof address === 'object' && address ? address.port : port
  console.log(`Payout Forensics API listening on http://${host}:${listeningPort}`)
})
