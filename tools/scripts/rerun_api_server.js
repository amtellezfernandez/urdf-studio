#!/usr/bin/env node
/**
 * Simple API server for Rerun visualization
 * Runs the Python rerun_viewer.py script
 */

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import http from 'http';
import { parse } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');
const pythonScript = join(rootDir, 'apps', 'backend', 'scripts', 'rerun_viewer.py');

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

        // Create temporary directory for data files
        const tempDir = mkdtempSync(join(tmpdir(), 'rerun-'));
        const episodeFile = join(tempDir, 'episode.json');
        const urdfFile = join(tempDir, 'urdf.xml');

        // Write data to temporary files to avoid E2BIG error
        writeFileSync(episodeFile, JSON.stringify(episode));
        writeFileSync(urdfFile, urdf);

        // Prepare arguments for Python script
        const args = [
          pythonScript,
          '--episode-file', episodeFile,
          '--urdf-file', urdfFile,
          '--recording', recording || `lerobot/episode_${episode.number || 0}`,
        ];

        if (spawnMode) {
          args.push('--spawn');
        } else if (serve) {
          args.push('--serve');
          args.push('--web-port', String(web_port || 9090));
          args.push('--ws-port', String(ws_port || 9876));
        }

        // Try venv Python first, then system python3/python
        const venvPython = join(rootDir, '.venv', 'bin', 'python3');
        let pythonCmd = 'python3';

        if (existsSync(venvPython)) {
          pythonCmd = venvPython;
        } else {
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
          // Cleanup temp files
          try {
            unlinkSync(episodeFile);
            unlinkSync(urdfFile);
          } catch (e) {
            // Ignore cleanup errors
          }
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
            // Cleanup temp files
            try {
              unlinkSync(episodeFile);
              unlinkSync(urdfFile);
            } catch (e) {
              // Ignore cleanup errors
            }
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
              // Cleanup temp files
              try {
                unlinkSync(episodeFile);
                unlinkSync(urdfFile);
              } catch (e) {
                // Ignore cleanup errors
              }
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
          // For spawn mode, the process will keep running to keep the viewer alive
          // So we respond immediately after a short delay to check for early errors
          let hasError = false;
          const errorTimeout = setTimeout(() => {
            if (hasError) {
              return;
            }
            // Check for early errors in stderr
            if (stderr.includes('ERROR') || stderr.includes('ImportError') || stderr.includes('ModuleNotFoundError')) {
              hasError = true;
              // Cleanup temp files
              try {
                unlinkSync(episodeFile);
                unlinkSync(urdfFile);
              } catch (e) {
                // Ignore cleanup errors
              }
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'Failed to start Rerun viewer',
                  stderr: stderr,
                  stdout: stdout,
                  hint: 'Make sure rerun-sdk is installed and the Rerun viewer application is available',
                }));
              }
              return;
            }
            // Wait a bit longer to see if viewer opens successfully
            setTimeout(() => {
              if (!hasError && !res.headersSent) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  success: true,
                  message: 'Rerun desktop viewer started',
                  mode: 'spawn',
                  stderr: stderr.trim() || undefined,
                  stdout: stdout.trim() || undefined,
                  note: 'The Python process will keep running while the viewer is open',
                }));
              }
            }, 2000);
          }, 1000);

          // Monitor for errors
          pythonProcess.on('error', (error) => {
            hasError = true;
            clearTimeout(errorTimeout);
            // Cleanup temp files
            try {
              unlinkSync(episodeFile);
              unlinkSync(urdfFile);
            } catch (e) {
              // Ignore cleanup errors
            }
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
            if (errorText.includes('ImportError') || errorText.includes('ModuleNotFoundError') || 
                errorText.includes('ERROR') || errorText.includes('rerun-sdk is not installed')) {
              hasError = true;
              clearTimeout(errorTimeout);
              // Cleanup temp files
              try {
                unlinkSync(episodeFile);
                unlinkSync(urdfFile);
              } catch (e) {
                // Ignore cleanup errors
              }
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'Rerun SDK error detected',
                  stderr: stderr + errorText,
                  hint: 'Make sure rerun-sdk is installed: pip install rerun-sdk',
                }));
              }
            }
          });

          // Store process reference for potential cleanup
          // Note: In spawn mode, the process will keep running until the viewer is closed
          pythonProcess.on('close', (code) => {
            // Cleanup temp files when process exits
            try {
              unlinkSync(episodeFile);
              unlinkSync(urdfFile);
            } catch (e) {
              // Ignore cleanup errors
            }
            console.log(`[Rerun] Spawn mode process exited with code ${code}`);
          });
        }

      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  if (pathname === '/api/mix-datasets' && req.method === 'POST') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { repoIds, localPaths } = data;

        // Need at least one source
        if ((!repoIds || repoIds.length === 0) && (!localPaths || localPaths.length === 0)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'At least one repo ID or local path is required' }));
          return;
        }

        // Check if Python script exists
        const datasetMixerScript = join(rootDir, 'apps', 'backend', 'scripts', 'dataset_mixer.py');
        if (!existsSync(datasetMixerScript)) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Dataset mixer script not found' }));
          return;
        }

        // Prepare arguments for Python script
        const args = [datasetMixerScript];
        
        if (repoIds && repoIds.length > 0) {
          args.push('--repo-ids', ...repoIds);
        }
        
        if (localPaths && localPaths.length > 0) {
          args.push('--local-paths', ...localPaths);
        }

        // Try venv Python first, then system python3/python
        const venvPython = join(rootDir, '.venv', 'bin', 'python3');
        let pythonCmd = 'python3';

        if (existsSync(venvPython)) {
          pythonCmd = venvPython;
        } else {
          try {
            execSync('python3 --version', { stdio: 'ignore' });
          } catch (e) {
            try {
              execSync('python --version', { stdio: 'ignore' });
              pythonCmd = 'python';
            } catch (e2) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Python not found. Please install Python 3.' }));
              return;
            }
          }
        }

        console.log(`[Dataset Mixer] Executing: ${pythonCmd} ${args.join(' ')}`);

        // Execute Python script
        const pythonProcess = spawn(pythonCmd, args, {
          cwd: rootDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
          console.error(`[Dataset Mixer Error] ${data.toString().trim()}`);
        });

        pythonProcess.on('close', (code) => {
          if (code !== 0) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false,
              error: `Dataset mixing failed: ${stderr || 'Unknown error'}`,
              stderr: stderr.trim() || undefined,
            }));
            return;
          }

          try {
            const result = JSON.parse(stdout);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (parseError) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false,
              error: `Failed to parse result: ${stdout}`,
              stdout: stdout.trim(),
            }));
          }
        });

        pythonProcess.on('error', (error) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false,
            error: `Failed to start Python process: ${error.message}`,
            hint: 'Make sure Python 3 and robocandywrapper are installed. Try: pip install robocandywrapper',
          }));
        });
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error' 
        }));
      }
    });
    return;
  }

  // 404 handler
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Rerun API server running on http://localhost:${PORT}`);
  console.log(`  Endpoints:`);
  console.log(`    - http://localhost:${PORT}/api/rerun-visualize`);
  console.log(`    - http://localhost:${PORT}/api/mix-datasets`);
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
