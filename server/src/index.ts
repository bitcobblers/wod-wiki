// server/src/index.ts
import { WebSocketServer, WebSocket } from 'ws';
import { v7 as uuidv7 } from 'uuid';
import dotenv from 'dotenv';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CastMessage {
    type: string;
    messageId: string;
    sessionId?: string;
    timestamp: number;
    payload: any;
}

interface Connection {
  ws: WebSocket;
  deviceId: string;
  deviceType: 'caster' | 'receiver';
  sessionId?: string; // Stick to a specific room
}

const connections = new Map<string, Connection>();

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

// Tailscale TLS Detection
const rootDir = path.resolve(__dirname, '../../');
const certFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.ts.net.crt'));
const keyFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.ts.net.key'));

let wss: WebSocketServer;

if (certFiles.length > 0 && keyFiles.length > 0) {
    const server = https.createServer({
        cert: fs.readFileSync(path.join(rootDir, certFiles[0])),
        key: fs.readFileSync(path.join(rootDir, keyFiles[0]))
    });
    wss = new WebSocketServer({ server, path: '/ws' });
    server.listen(PORT, '0.0.0.0');
    console.log(`\n🚀 WOD Wiki Secure Relay started at wss://0.0.0.0:${PORT}/ws`);
} else {
    wss = new WebSocketServer({ port: PORT, host: '0.0.0.0', path: '/ws' });
    console.log(`\n🚀 WOD Wiki Relay started at ws://0.0.0.0:${PORT}/ws (Insecure)`);
}

wss.on('connection', (ws) => {
  let deviceId: string | null = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString()) as CastMessage;

      switch (message.type) {
        case 'register':
            deviceId = message.payload.clientId;
            connections.set(deviceId!, {
                ws,
                deviceId: deviceId!,
                deviceType: message.payload.clientType,
                sessionId: message.sessionId
            });
            console.log(`✅ Registered ${message.payload.clientType.toUpperCase()}: ${deviceId} [Room: ${message.sessionId || 'Global'}]`);
            if (message.payload.url) {
                console.log(`   🔗 URL: ${message.payload.url}`);
            }
            break;

        case 'discover':
            // Only find receivers in the SAME sessionId if laptop provided one
            connections.forEach((conn) => {
                if (conn.deviceType === 'receiver' && (!message.sessionId || conn.sessionId === message.sessionId)) {
                    ws.send(JSON.stringify({
                        type: 'target-discovered',
                        messageId: uuidv7(),
                        timestamp: Date.now(),
                        payload: { targetId: conn.deviceId, name: 'Chromecast', type: 'web-receiver' }
                    }));
                }
            });
            break;

        case 'state-update':
        case 'cast-request':
        case 'event-from-receiver':
            // Simple broadcast to everyone in the same session
            if (message.sessionId) {
                connections.forEach((conn) => {
                    if (conn.sessionId === message.sessionId && conn.deviceId !== deviceId) {
                        conn.ws.send(JSON.stringify(message));
                    }
                });
            }
            break;

        case 'log':
            console.log(`[Remote Log] ${deviceId}:`, message.payload);
            break;
      }
    } catch (e) {
      console.error('[Relay] Error:', e);
    }
  });

  ws.on('close', () => {
    if (deviceId) connections.delete(deviceId);
  });
});
