import * as crypto from 'crypto';
import { glob } from 'glob';
import { spawnSync, execSync } from 'child_process';
import * as path from 'path';

export function computeHash(content: string | Buffer): string {
    const hash = crypto.createHash('sha256');
    hash.update(content);
    return hash.digest('hex');
}

export function normalizeGlob(patterns: string[], cwd: string): string[] {
    const files: string[] = [];
    for (const pattern of patterns) {
        const matches = glob.sync(pattern, { cwd, absolute: true });
        files.push(...matches);
    }
    return files;
}

export function getMerchFileExtension(files: string[]): string {
    if (files.length === 0) {
        return '.txt';
    }
    const ext = path.extname(files[0]);
    return ext || '.txt';
}

export function launchDefaultEditor(filePath: string): void {
    let editorCommand: string;
    try {
        editorCommand = execSync('git config --get core.editor', { encoding: 'utf-8' }).trim();
    } catch (e) {
        // Fallback if git is not configured or fails
        editorCommand = process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
    }

    if (!editorCommand) {
        throw new Error("No editor configured. Set core.editor in git config or EDITOR env var.");
    }

    // Simple splitting by space, might not handle quotes correctly like shlex
    // But for now it's a start.
    // If we want better parsing we can use a library like `shell-quote`.
    // But let's try to just spawn it.
    
    // Actually, `spawnSync` with `shell: true` might be easier if we pass the whole command string.
    // But we need to append the file path.
    
    const result = spawnSync(`${editorCommand} "${filePath}"`, { shell: true, stdio: 'inherit' });
    
    if (result.error) {
        throw result.error;
    }
    
    if (result.status !== 0) {
        throw new Error(`Editor exited with status ${result.status}`);
    }
}

export type LineEnding = '\n' | '\r\n';

export function detectLineEnding(content: string): LineEnding | undefined {
    const crlf = content.indexOf('\r\n');
    const lf = content.indexOf('\n');

    if (crlf !== -1) {
        // Simple heuristic: if we find CRLF, we assume CRLF unless it's very mixed.
        // But for now let's just check if CRLF is present.
        return '\r\n';
    }
    if (lf !== -1) return '\n';
    return undefined;
}

export function normalizeLineEndings(content: string, lineEnding: string): string {
    if (lineEnding === '\r\n') {
        return content.replace(/\r?\n/g, '\r\n');
    } else if (lineEnding === '\n') {
        return content.replace(/\r\n/g, '\n');
    }
    return content;
}
