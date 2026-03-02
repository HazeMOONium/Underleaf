import { WebSocketServer, WebSocket } from 'ws'
// @ts-ignore - no type declarations for y-websocket/bin/utils
import { setupWSConnection, setPersistence, docs } from 'y-websocket/bin/utils'
import * as Y from 'yjs'
import Redis from 'ioredis'
import * as dotenv from 'dotenv'

dotenv.config()

const PORT = parseInt(process.env.PORT || '1234')
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

const redisOpts = {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    return Math.min(times * 50, 2000)
  },
}

// ── Three Redis clients ───────────────────────────────────────────────────────
// 1. persistence: for snapshot read/write (get/set)
// 2. pubClient: for publishing doc updates to other instances
// 3. subClient: for subscribing to updates from other instances
//    (a subscribed client can only call subscribe/unsubscribe/psubscribe, not get/set)
const persistence_redis = new Redis(REDIS_URL, redisOpts)
const pubClient = new Redis(REDIS_URL, redisOpts)
const subClient = new Redis(REDIS_URL, redisOpts)

for (const [name, client] of [['persistence', persistence_redis], ['pub', pubClient], ['sub', subClient]] as const) {
  client.on('connect', () => console.log(`Redis [${name}] connected`))
  client.on('error', (err) => console.error(`Redis [${name}] error:`, err))
}

// ── Horizontal scaling: pub/sub relay ────────────────────────────────────────
// When this instance receives a Yjs update from a client, it:
//   a) applies + broadcasts to local clients (handled by y-websocket internally)
//   b) publishes the raw update bytes to Redis channel yjs:updates:{docName}
// Other instances subscribe to that channel, receive the bytes, and apply
// them to their local in-memory Y.Doc (which then broadcasts to their clients).

const RELAY_ORIGIN = 'redis-relay' // sentinel to avoid re-publishing
const subscribedDocs = new Set<string>()

/** Subscribe this instance to updates from other collab-server instances for docName. */
function ensureDocRelay(docName: string): void {
  if (subscribedDocs.has(docName)) return
  subscribedDocs.add(docName)

  // ioredis requires subscribe before receiving messages on subClient.
  // Use the buffer-aware variant so Yjs binary data round-trips correctly.
  subClient.subscribe(`yjs:updates:${docName}`, (err) => {
    if (err) console.error(`Failed to subscribe to yjs:updates:${docName}:`, err)
    else console.log(`Subscribed to Redis relay for doc: ${docName}`)
  })

  // Add publisher hook to the Y.Doc once it appears in the docs map.
  // setupWSConnection populates docs synchronously, so deferring by one
  // microtask is enough.
  process.nextTick(() => {
    const doc = docs.get(docName) as Y.Doc | undefined
    if (!doc) return

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === RELAY_ORIGIN) return // don't re-publish what we just received
      pubClient
        .publish(`yjs:updates:${docName}`, Buffer.from(update))
        .catch((err) => console.error(`Publish error for ${docName}:`, err))
    })
  })
}

// Receive updates from other instances and apply to local doc
subClient.on('message', (channel: string, message: string | Buffer) => {
  const docName = channel.replace('yjs:updates:', '')
  const doc = docs.get(docName) as Y.Doc | undefined
  if (!doc) return

  const update = typeof message === 'string' ? Buffer.from(message, 'binary') : message
  Y.applyUpdate(doc, new Uint8Array(update), RELAY_ORIGIN)
})

// ── Connection tracking per document ─────────────────────────────────────────
const connectionCounts = new Map<string, number>()

// ── Redis persistence (snapshot save/restore) ─────────────────────────────────
const persistence = {
  async bindState(docName: string, ydoc: Y.Doc): Promise<void> {
    try {
      const state = await persistence_redis.getBuffer(`yjs:doc:${docName}`)
      if (state && state.length > 0) {
        Y.applyUpdate(ydoc, state)
        console.log(`Restored doc ${docName} from Redis (${state.length} B)`)
      } else {
        console.log(`No snapshot for doc ${docName}, starting fresh`)
      }
      connectionCounts.set(docName, (connectionCounts.get(docName) ?? 0) + 1)
    } catch (err) {
      console.error(`Error loading state for ${docName}:`, err)
    }
  },

  async writeState(docName: string, ydoc: Y.Doc): Promise<void> {
    try {
      const state = Y.encodeStateAsUpdate(ydoc)
      await persistence_redis.set(`yjs:doc:${docName}`, Buffer.from(state))
      console.log(`Persisted doc ${docName} (${state.length} B)`)

      const count = (connectionCounts.get(docName) ?? 1) - 1
      if (count <= 0) {
        connectionCounts.delete(docName)
        // Unsubscribe from relay — no local clients left for this doc
        if (subscribedDocs.has(docName)) {
          subscribedDocs.delete(docName)
          subClient.unsubscribe(`yjs:updates:${docName}`).catch(() => {})
          console.log(`Unsubscribed relay for doc: ${docName}`)
        }
      } else {
        connectionCounts.set(docName, count)
      }
    } catch (err) {
      console.error(`Error persisting state for ${docName}:`, err)
    }
  },
}

setPersistence(persistence)
console.log('Redis persistence + pub/sub relay enabled')

// ── Periodic snapshot (survives crashes) ─────────────────────────────────────
const activeDocs = new Map<string, Y.Doc>()

const _origBind = persistence.bindState.bind(persistence)
persistence.bindState = async (docName: string, ydoc: Y.Doc) => {
  await _origBind(docName, ydoc)
  activeDocs.set(docName, ydoc)
}

const _origWrite = persistence.writeState.bind(persistence)
persistence.writeState = async (docName: string, ydoc: Y.Doc) => {
  await _origWrite(docName, ydoc)
  if (!connectionCounts.has(docName)) activeDocs.delete(docName)
}

setInterval(async () => {
  for (const [docName, ydoc] of activeDocs) {
    try {
      const state = Y.encodeStateAsUpdate(ydoc)
      await persistence_redis.set(`yjs:doc:${docName}`, Buffer.from(state))
    } catch (err) {
      console.error(`Periodic snapshot failed for ${docName}:`, err)
    }
  }
}, 60_000)

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (ws: WebSocket, req: any) => {
  // y-websocket uses the URL path (without leading slash) as the document name
  const docName = (req.url as string || '/').replace(/^\//, '').split('?')[0]
  setupWSConnection(ws, req, { gc: true })
  ensureDocRelay(docName)
})

wss.on('listening', () => {
  console.log(`Yjs WebSocket server running on port ${PORT} (Redis pub/sub relay enabled)`)
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const shutdown = async (signal: string) => {
  console.log(`${signal} received, flushing ${activeDocs.size} doc(s) to Redis...`)
  wss.close()

  await Promise.allSettled(
    Array.from(activeDocs.entries()).map(async ([docName, ydoc]) => {
      try {
        const state = Y.encodeStateAsUpdate(ydoc)
        await persistence_redis.set(`yjs:doc:${docName}`, Buffer.from(state))
        console.log(`Flushed ${docName} (${state.length} B)`)
      } catch (err) {
        console.error(`Failed to flush ${docName}:`, err)
      }
    })
  )

  await Promise.allSettled([
    persistence_redis.quit(),
    pubClient.quit(),
    subClient.quit(),
  ])
  console.log('Redis connections closed')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
