const http = require('http');
const fs = require('fs');
const path = require('path');

// Load environment configuration with defaults
const PORT = parseInt(process.env.PORT || '3050', 10);
const ANALYSIS_PROVIDER = process.env.ANALYSIS_PROVIDER || 'demo';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const ANTIGRAVITY_AGENT_PATH = process.env.ANTIGRAVITY_AGENT_PATH || '';
const ANTIGRAVITY_BRAIN_PATH = process.env.ANTIGRAVITY_BRAIN_PATH || '';
const ANALYSIS_TIMEOUT_MS = parseInt(process.env.ANALYSIS_TIMEOUT_MS || '60000', 10);
const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_BYTES || '5242880', 10);
const MAX_SOURCE_TEXT_BYTES = parseInt(process.env.MAX_SOURCE_TEXT_BYTES || '750000', 10);

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const FIXTURES_DIR = path.resolve(__dirname, 'tests', 'fixtures');
const CONFIG_PATH = path.resolve(__dirname, 'config.json');

// Load app config
let appConfig = {};
try {
  appConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  console.error('Failed to load config.json:', err.message);
  process.exit(1);
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const ValidationEngine = require('./lib/validation');

// HTTP Request Handler
const handleRequest = (req, res) => {
  // CORS Headers for API requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Endpoint: GET /api/health
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      activeProvider: ANALYSIS_PROVIDER,
      providerAvailability: {
        demo: true,
        gemini: !!GEMINI_API_KEY,
        antigravity: !!(ANTIGRAVITY_AGENT_PATH && ANTIGRAVITY_BRAIN_PATH)
      },
      version: '1.0.0'
    }));
    return;
  }

  // Endpoint: POST /api/analyze
  if (req.method === 'POST' && req.url === '/api/analyze') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Safety limit check during streaming
      if (body.length > MAX_SOURCE_TEXT_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request payload exceeds maximum source text bytes limit.' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const demoId = payload.demoScenarioId;
        const profile = payload.analysisProfile || 'general';
        const docText = payload.text || '';

        // If configured for demo provider
        if (ANALYSIS_PROVIDER === 'demo') {
          if (!docText || docText.trim() === '') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request payload must contain document text.' }));
            return;
          }

          if (!demoId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'Custom-document analysis becomes available when a live analysis provider is configured. Select one of the included demo scenarios to use deterministic demo mode.' 
            }));
            return;
          }

          const validFixtureIds = ['sales-marketing-conflict', 'ai-support-rollout', 'multi-location-operations'];
          if (!validFixtureIds.includes(demoId)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: `Unsupported demo fixture ID: '${demoId}'. Available fixtures: ${validFixtureIds.join(', ')}` 
            }));
            return;
          }

          const fixturePath = path.join(FIXTURES_DIR, `${demoId}.json`);
          fs.readFile(fixturePath, 'utf8', (err, fileData) => {
            if (err) {
              console.error('Fixture read error:', err.message);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to read the requested demo scenario.' }));
              return;
            }

            try {
              const parsedResult = JSON.parse(fileData);
              // Run the strict domain validator on the fixture data
              ValidationEngine.validateDomainSchema(parsedResult, appConfig);
              
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                analysisId: `demo-${demoId}-${Date.now()}`,
                ...parsedResult
              }));
            } catch (validationErr) {
              console.error('Domain Validation Failed on Fixture:', validationErr.message);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Internal Fixture Validator Failure: ${validationErr.message}` }));
            }
          });
        } else {
          // Placeholder for real providers (Gemini/Antigravity) in Phase 1
          res.writeHead(501, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Provider '${ANALYSIS_PROVIDER}' is not implemented in Phase 1.` }));
        }
      } catch (parseErr) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON request payload.' }));
      }
    });
    return;
  }

  // Serve static files from the public folder
  let reqUrl = req.url.split('?')[0];
  
  // Expose and serve the /lib/ directory static files
  if (reqUrl.startsWith('/lib/')) {
    let filePath = path.join(__dirname, reqUrl);
    // Security check path traversal
    const relative = path.relative(__dirname, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access Denied');
      return;
    }
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  let filePath = path.join(PUBLIC_DIR, reqUrl === '/' ? 'index.html' : reqUrl);

  // Security: Prevent directory traversal
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  });
};

function createAppServer() {
  return http.createServer(handleRequest);
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(PORT, () => {
    console.log(`Implementation Risk Scanner server running on http://localhost:${PORT}`);
    console.log(`Active Provider: ${ANALYSIS_PROVIDER}`);
  });
}

module.exports = { createAppServer, handleRequest };
