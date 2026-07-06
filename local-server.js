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

            // Route to appropriate serverless function file
            let apiFile = '';
            if (pathname === '/api/login') apiFile = './api/login.js';
            else if (pathname === '/api/data') apiFile = './api/data.js';
            else if (pathname === '/api/admin/login') apiFile = './api/admin/login.js';
            else if (pathname === '/api/admin/get') apiFile = './api/admin/get.js';
            else if (pathname === '/api/admin/save') apiFile = './api/admin/save.js';
            else if (pathname === '/api/admin/logout') apiFile = './api/admin/logout.js';

            if (apiFile) {
                try {
                    const resolvedPath = path.resolve(apiFile);
                    // Clear require cache for easy hot reloading on local edits
                    delete require.cache[resolvedPath];
                    const handler = require(apiFile);
                    await handler(req, res);
                } catch (err) {
                    console.error("Local API Handler Error:", err);
                    res.status(500).json({ error: 'Internal Server Error' });
                }
            } else {
                res.status(404).json({ error: 'API Endpoint Not Found' });
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
