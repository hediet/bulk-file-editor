import { IFileSystem } from './fileSystem';
import * as path from 'path';

export class MemoryFileSystem implements IFileSystem {
    readonly path = path.posix;

    // Map of path -> content
    private files = new Map<string, string>();

    private normalize(filePath: string): string {
        return filePath.replace(/\\/g, '/').replace(/^[a-zA-Z]:/, '');
    }

    constructor(initialFiles: Record<string, string> = {}) {
        for (const [p, content] of Object.entries(initialFiles)) {
            this.files.set(this.normalize(p), content);
        }
    }

    async readFile(filePath: string): Promise<string> {
        const content = this.files.get(this.normalize(filePath));
        if (content === undefined) {
            throw new Error(`File not found: ${filePath}`);
        }
        return content;
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        this.files.set(this.normalize(filePath), content);
    }

    async exists(filePath: string): Promise<boolean> {
        return this.files.has(this.normalize(filePath));
    }

    async isFile(filePath: string): Promise<boolean> {
        return this.files.has(this.normalize(filePath));
    }

    async delete(filePath: string): Promise<void> {
        this.files.delete(this.normalize(filePath));
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        const resolvedOld = this.normalize(oldPath);
        const resolvedNew = this.normalize(newPath);
        const content = this.files.get(resolvedOld);
        if (content !== undefined) {
            this.files.delete(resolvedOld);
            this.files.set(resolvedNew, content);
        } else {
            throw new Error(`File not found: ${oldPath}`);
        }
    }

    async mkdir(dirPath: string): Promise<void> {
        // No-op for memory FS as we just store files in a flat map
    }

    // Helper for tests
    toJson(): Record<string, string> {
        const result: Record<string, string> = {};
        // Sort keys for deterministic snapshots
        const sortedKeys = Array.from(this.files.keys()).sort();
        for (const p of sortedKeys) {
            result[p] = this.files.get(p)!;
        }
        return result;
    }

    getFiles(): Record<string, string> {
        return this.toJson();
    }
}
