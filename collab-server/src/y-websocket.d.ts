declare module 'y-websocket/bin/utils' {
  import { WebSocket } from 'ws'
  import { Doc } from 'yjs'
  import { IncomingMessage } from 'http'

  interface Persistence {
    bindState: (docName: string, ydoc: Doc) => Promise<void>
    writeState: (docName: string, ydoc: Doc) => Promise<void>
  }

  export function setupWSConnection(
    ws: WebSocket,
    req: IncomingMessage,
    options?: { docName?: string; gc?: boolean }
  ): void

  export function setPersistence(persistence: Persistence | null): void
}
