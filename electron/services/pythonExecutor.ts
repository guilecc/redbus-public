/**
 * PythonExecutor — Runs Python scripts in an isolated child process.
 *
 * I/O Standard:
 * - INPUT:  Arguments are passed as a JSON string via sys.argv[1].
 *           Vault secrets are injected as REDBUS_<SERVICE> env vars.
 * - OUTPUT: Script MUST print a JSON object to stdout:
 *           {"status": "success", "data": ...} or {"status": "error", "message": "..."}
 */

import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { getSecretsByServices } from './vaultService';

const PYTHON_TIMEOUT_MS = 30_000; // 30 seconds max

export interface PythonResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  parsedOutput?: { status: string; data?: any; message?: string };
  outputValid: boolean;
}

/**
 * Execute a Python script with args via sys.argv[1] and vault secrets via env vars.
 */
export async function executePython(
  db: any,
  scriptCode: string,
  requiredVaultKeys: string[] = [],
  args: Record<string, string> = {}
): Promise<PythonResult> {
  // Resolve vault secrets into env vars
  const secrets = requiredVaultKeys.length > 0
    ? getSecretsByServices(db, requiredVaultKeys)
    : {};

  const env: Record<string, string> = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    LANG: process.env.LANG || 'en_US.UTF-8',
    REDBUS_DB_PATH: db.name || '',
  };

  for (const [serviceName, token] of Object.entries(secrets)) {
    const envKey = `REDBUS_${serviceName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    env[envKey] = token;
  }

  // Write script to a temp file
  const tmpDir = os.tmpdir();
  const scriptPath = path.join(tmpDir, `redbus_script_${Date.now()}.py`);
  await fsp.writeFile(scriptPath, scriptCode, 'utf-8');

  // Serialize args as JSON for sys.argv[1]
  const argsJson = JSON.stringify(args);

  try {
    const result = await new Promise<Omit<PythonResult, 'parsedOutput' | 'outputValid'>>((resolve) => {
      execFile(
        'python3',
        [scriptPath, argsJson],
        {
          env,
          timeout: PYTHON_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout?.toString() || '',
            stderr: stderr?.toString() || '',
            exitCode: error ? (error as any).code ?? 1 : 0,
          });
        }
      );
    });

    // Validate stdout is valid JSON conforming to the I/O standard
    let parsedOutput: PythonResult['parsedOutput'];
    let outputValid = false;

    if (result.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout.trim());
        if (parsed && typeof parsed === 'object' && 'status' in parsed) {
          parsedOutput = parsed;
          outputValid = true;
        }
      } catch {
        // stdout is not valid JSON — will be flagged as invalid
      }
    }

    return { ...result, parsedOutput, outputValid };
  } finally {
    await fsp.unlink(scriptPath).catch(() => { });
  }
}

