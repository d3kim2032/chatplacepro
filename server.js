const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const spaces = new Map();

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function getSpace(name) {
  return spaces.get(name);
}

function ensureSpace(name, password) {
  if (!spaces.has(name)) {
    spaces.set(name, {
      password,
      clients: new Map(),
      messages: []
    });
  }
  return spaces.get(name);
}

function memberNames(space) {
  return [...space.clients.values()].map((client) => client.userName).filter(Boolean);
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(space, event, data) {
  for (const client of space.clients.values()) {
    sendEvent(client.res, event, data);
  }
}

function staticFile(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8'
    };

    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain; charset=utf-8' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && parsedUrl.pathname === '/api/join') {
    try {
      const raw = await getBody(req);
      const body = JSON.parse(raw || '{}');
      const userName = (body.userName || '').trim();
      const spaceName = (body.spaceName || '').trim();
      const password = (body.password || '').trim();

      if (!userName || !spaceName || !password) {
        return json(res, 400, {
          error: 'Space name, password, and your name are required.'
        });
      }

      const existing = getSpace(spaceName);
      if (existing && existing.password !== password) {
        return json(res, 403, { error: 'Incorrect password for this space.' });
      }

      const space = ensureSpace(spaceName, password);
      const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      space.messages.push({
        type: 'system',
        text: `${userName} joined ${spaceName}`,
        sentAt: new Date().toISOString()
      });

      return json(res, 200, {
        clientId,
        spaceName,
        history: space.messages.slice(-40)
      });
    } catch (error) {
      return json(res, 400, { error: 'Invalid request.' });
    }
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/stream') {
    const clientId = parsedUrl.searchParams.get('clientId');
    const userName = (parsedUrl.searchParams.get('userName') || '').trim();
    const spaceName = (parsedUrl.searchParams.get('spaceName') || '').trim();
    const password = (parsedUrl.searchParams.get('password') || '').trim();

    const space = getSpace(spaceName);
    if (!clientId || !space || space.password !== password || !userName) {
      res.writeHead(401);
      return res.end('Unauthorized');
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    space.clients.set(clientId, { res, userName });

    sendEvent(res, 'joined', { spaceName });
    broadcast(space, 'presence', { users: memberNames(space) });
    broadcast(space, 'system', { text: `${userName} is online.` });

    req.on('close', () => {
      if (!space.clients.has(clientId)) {
        return;
      }
      space.clients.delete(clientId);

      const leaveText = `${userName} left ${spaceName}`;
      space.messages.push({ type: 'system', text: leaveText, sentAt: new Date().toISOString() });
      broadcast(space, 'system', { text: leaveText });
      broadcast(space, 'presence', { users: memberNames(space) });

      if (space.clients.size === 0) {
        spaces.delete(spaceName);
      }
    });

    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/chat') {
    try {
      const raw = await getBody(req);
      const body = JSON.parse(raw || '{}');
      const userName = (body.userName || '').trim();
      const spaceName = (body.spaceName || '').trim();
      const password = (body.password || '').trim();
      const text = (body.text || '').trim();

      const space = getSpace(spaceName);
      if (!space || space.password !== password) {
        return json(res, 401, { error: 'Unauthorized' });
      }

      if (!userName || !text) {
        return json(res, 400, { error: 'Message text is required.' });
      }

      const message = {
        type: 'chat',
        userName,
        text,
        sentAt: new Date().toISOString()
      };

      space.messages.push(message);
      if (space.messages.length > 200) {
        space.messages.shift();
      }

      broadcast(space, 'chat', message);
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: 'Invalid request.' });
    }
  }

  return staticFile(req, res, parsedUrl.pathname);
});

server.listen(PORT, () => {
  console.log(`Chatplace running on http://localhost:${PORT}`);
});
