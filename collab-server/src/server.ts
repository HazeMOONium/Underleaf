import { WebSocketServer, WebSocket } from 'ws'
// @ts-ignore - no type declarations for y-websocket/bin/utils
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils'
import * as Y from 'yjs'
import Redis from 'ioredis'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const PORT = parseInt(process.env.PORT || '1234')
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Initialize Redis client
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000)
    return delay
  }
})

redis.on('connect', () => {
  console.log('Redis connected successfully')
})

redis.on('error', (err) => {
  console.error('Redis connection error:', err)
})

// Track active connections per document
const connectionCounts = new Map<string, number>()

// Redis persistence implementation
const persistence = {
  /**
   * Called when a document is loaded (first client connects)
   * Restores state from Redis if available
   */
  async bindState(docName: string, ydoc: Y.Doc): Promise<void> {
    try {
      const key = `yjs:doc:${docName}`
      const state = await redis.getBuffer(key)

      if (state && state.length > 0) {
        Y.applyUpdate(ydoc, state)
        console.log(`Restored document ${docName} from Redis (${state.length} bytes)`)
      } else {
        console.log(`No existing state for document ${docName}, starting fresh`)
      }

      // Track connection
      connectionCounts.set(docName, (connectionCounts.get(docName) || 0) + 1)
      console.log(`Document ${docName} now has ${connectionCounts.get(docName)} connection(s)`)
    } catch (error) {
      console.error(`Error loading state for ${docName}:`, error)
      // Don't throw - allow document to start empty on error
    }
  },

  /**
   * Called when all clients disconnect from a document
   * Saves state to Redis
   */
  async writeState(docName: string, ydoc: Y.Doc): Promise<void> {
    try {
      const key = `yjs:doc:${docName}`
      const state = Y.encodeStateAsUpdate(ydoc)

      await redis.set(key, Buffer.from(state))
      console.log(`Persisted document ${docName} to Redis (${state.length} bytes)`)

      // Update connection count
      const count = (connectionCounts.get(docName) || 1) - 1
      if (count <= 0) {
        connectionCounts.delete(docName)
        console.log(`Document ${docName} has no active connections, state persisted`)
      } else {
        connectionCounts.set(docName, count)
        console.log(`Document ${docName} now has ${count} connection(s)`)
      }
    } catch (error) {
      console.error(`Error persisting state for ${docName}:`, error)
      // Don't throw - failing to persist shouldn't crash the server
    }
  }
}

// Register persistence handler
setPersistence(persistence)
console.log('Redis persistence enabled')

// Periodic snapshot: save all active docs every 60s so state survives server crashes
// (the writeState persistence hook only fires on full disconnect)
const activeDocs = new Map<string, Y.Doc>()

const _origBindState = persistence.bindState.bind(persistence)
persistence.bindState = async (docName: string, ydoc: Y.Doc) => {
  await _origBindState(docName, ydoc)
  activeDocs.set(docName, ydoc)
}

const _origWriteState = persistence.writeState.bind(persistence)
persistence.writeState = async (docName: string, ydoc: Y.Doc) => {
  await _origWriteState(docName, ydoc)
  // Remove from active tracking only when no connections remain
  if (!connectionCounts.has(docName)) {
    activeDocs.delete(docName)
  }
}

setInterval(async () => {
  for (const [docName, ydoc] of activeDocs) {
    try {
      const key = `yjs:doc:${docName}`
      const state = Y.encodeStateAsUpdate(ydoc)
      await redis.set(key, Buffer.from(state))
    } catch (err) {
      console.error(`Periodic snapshot failed for ${docName}:`, err)
    }
  }
}, 60_000)

const wss = new WebSocketServer({ port: PORT })

console.log(`Yjs WebSocket server running on port ${PORT}`)

wss.on('connection', (ws: WebSocket, req: any) => {
  console.log('New connection from:', req.url)
  setupWSConnection(ws, req, { gc: true })
})

wss.on('listening', () => {
  console.log('WebSocket server is ready')
})

// Graceful shutdown handler
const shutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down gracefully...`)

  // Close WebSocket server (stops accepting new connections)
  wss.close(() => {
    console.log('WebSocket server closed')
  })

  // Flush all active docs to Redis before exiting so in-flight changes survive
  // the shutdown. This is a best-effort save — individual failures are logged
  // but don't block the shutdown sequence.
  console.log(`Flushing ${activeDocs.size} active document(s) to Redis...`)
  await Promise.allSettled(
    Array.from(activeDocs.entries()).map(async ([docName, ydoc]) => {
      try {
        const key = `yjs:doc:${docName}`
        const state = Y.encodeStateAsUpdate(ydoc)
        await redis.set(key, Buffer.from(state))
        console.log(`Flushed ${docName} (${state.length} bytes)`)
      } catch (err) {
        console.error(`Failed to flush ${docName} on shutdown:`, err)
      }
    })
  )

  // Close Redis connection
  try {
    await redis.quit()
    console.log('Redis connection closed')
  } catch (error) {
    console.error('Error closing Redis connection:', error)
  }

  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
