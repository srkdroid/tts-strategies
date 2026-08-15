const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const server = http.createServer((req, res) => {
    // Decorate res to mock Vercel serverless helper methods
    res.status = function(code) {
        res.statusCode = code;
        return res;
    };
    
    res.json = function(obj) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
    };

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;
    req.query = Object.fromEntries(url.searchParams.entries());

    if (pathname.startsWith('/api/')) {
        // Collect and parse POST body
        let bodyStr = '';
        req.on('data', chunk => { bodyStr += chunk; });
        req.on('end', async () => {
            if (bodyStr) {
                try {
                    req.body = JSON.parse(bodyStr);
                } catch (e) {
                    req.body = {};
                }
            }

            try {
                const apiFile = './api/index.js';
                const resolvedPath = path.resolve(apiFile);
                delete require.cache[resolvedPath];
                // Also clear sub-module cache for local hot reloading
                Object.keys(require.cache).forEach(k => {
                    if (k.includes('_lib')) delete require.cache[k];
                });
                const handler = require(apiFile);
                await handler(req, res);
            } catch (err) {
                console.error("Local API Handler Error:", err);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });
    } else {
        // Serve static website files
        let filePath = '.' + pathname;
        if (filePath === './') filePath = './index.html';
        
        const extname = String(path.extname(filePath)).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.gif': 'image/gif',
            '.ico': 'image/x-icon',
        };

        const contentType = mimeTypes[extname] || 'application/octet-stream';

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if (error.code == 'ENOENT') {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end('<h1>404 File Not Found</h1>', 'utf-8');
                } else {
                    res.writeHead(500);
                    res.end('Error loading file: ' + error.code);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    }
});

server.listen(PORT, () => {
    console.log(`\n=============================================================`);
    console.log(`TTS Options Strategy Calendar local server running!`);
    console.log(`URL: http://localhost:${PORT}/index.html`);
    console.log(`=============================================================\n`);
});
