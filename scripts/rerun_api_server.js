#!/usr/bin/env node
/**
 * Simple API server for Rerun visualization
 * Runs the Python rerun_viewer.py script
 */

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import http from 'http';
import { parse } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const pythonScript = join(rootDir, 'scripts', 'rerun_viewer.py');

const PORT = 3001;

const server = http.createServer((req, res) => {
  const { pathname, query } = parse(req.url, true);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (pathname === '/api/rerun-visualize' && req.method === 'POST') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { episode, urdf, recording, spawn: spawnMode, serve, web_port, ws_port } = data;

        if (!episode || !urdf) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing episode or URDF data' }));
          return;
        }

        // Check if Python script exists
        if (!existsSync(pythonScript)) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Rerun Python script not found' }));
          return;
        }

        // Prepare arguments for Python script
        const args = [
          pythonScript,
          '--episode', JSON.stringify(episode),
          '--urdf', urdf,
          '--recording', recording || `lerobot/episode_${episode.number || 0}`,
        ];

        if (spawnMode) {
          args.push('--spawn');
        } else if (serve) {
          args.push('--serve');
          args.push('--web-port', String(web_port || 9090));
          args.push('--ws-port', String(ws_port || 9876));
        }

        // Try python3 first, then python
        let pythonCmd = 'python3';
        try {
          execSync('python3 --version', { stdio: 'ignore' });
        } catch (e) {
          try {
            execSync('python --version', { stdio: 'ignore' });
            pythonCmd = 'python';
          } catch (e2) {
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Python not found. Please install Python 3.',
                hint: 'Install Python 3 or ensure python3/python is in PATH',
              }));
            }
            return;
          }
        }

        console.log(`[Rerun API] Executing: ${pythonCmd} ${args.join(' ')}`);

        // Spawn Python process
        const pythonProcess = spawn(pythonCmd, args, {
          cwd: rootDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
          console.log(`[Rerun] ${data.toString().trim()}`);
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
          console.error(`[Rerun Error] ${data.toString().trim()}`);
        });

        pythonProcess.on('error', (error) => {
          console.error('[Rerun API] Python process error:', error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: `Failed to start Python process: ${error.message}`,
              hint: `Make sure Python 3 and rerun-sdk are installed. Try: pip install rerun-sdk`,
              command: `${pythonCmd} ${args.join(' ')}`,
            }));
          }
        });

        // For serve mode, the process will keep running
        // For spawn mode, it will exit after opening the viewer
        if (serve) {
          // Check for early errors before responding
          let hasError = false;
          const errorTimeout = setTimeout(() => {
            if (hasError) {
              // Error already handled
              return;
            }
            if (!res.headersSent) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: true, 
                message: 'Rerun server starting...',
                mode: 'serve',
                web_port: web_port || 9090,
              }));
            }
          }, 1000);

          // Monitor for errors
          pythonProcess.on('error', (error) => {
            hasError = true;
            clearTimeout(errorTimeout);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: `Failed to start Python process: ${error.message}`,
                hint: `Make sure Python 3 and rerun-sdk are installed. Try: pip install rerun-sdk`,
                command: `${pythonCmd} ${args.join(' ')}`,
              }));
            }
          });

          // Check stderr for import errors
          pythonProcess.stderr.on('data', (data) => {
            const errorText = data.toString();
            if (errorText.includes('ImportError') || errorText.includes('ModuleNotFoundError')) {
              hasError = true;
              clearTimeout(errorTimeout);
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  error: 'Rerun SDK not installed',
                  stderr: errorText,
                  hint: 'Install rerun-sdk with: pip install rerun-sdk',
                }));
              }
            }
          });
        } else {
          // For spawn mode, wait for process to complete
          pythonProcess.on('close', (code) => {
            if (!res.headersSent) {
              if (code === 0) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  success: true, 
                  message: 'Rerun visualization started',
                  mode: 'spawn',
                }));
              } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  error: `Python script failed with code ${code}`,
                  stderr: stderr,
                }));
              }
            }
          });
        }

      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Rerun API server running on http://localhost:${PORT}`);
  console.log(`  Endpoint: http://localhost:${PORT}/api/rerun-visualize`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Another instance might be running.`);
  } else {
    console.error(`Failed to start Rerun API server: ${err.message}`);
  }
  process.exit(1);
});

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down Rerun API server...');
  server.close();
  process.exit(0);
});

