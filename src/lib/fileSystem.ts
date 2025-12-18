import * as fs from 'fs';
import * as path from 'path';

export interface IPath {
    resolve(...paths: string[]): string;
    dirname(p: string): string;
    extname(p: string): string;
    basename(p: string, ext?: string): string;
    join(...paths: string[]): string;
    sep: string;
}

export interface IFileSystem {
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, content: string): Promise<void>;
    exists(filePath: string): Promise<boolean>;
    isFile(filePath: string): Promise<boolean>;
    delete(filePath: string): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    mkdir(dirPath: string): Promise<void>;
    readonly path: IPath;
}

export class NodeFileSystem implements IFileSystem {
    readonly path = path;

    async readFile(filePath: string): Promise<string> {
        return fs.promises.readFile(filePath, 'utf-8');
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        await fs.promises.writeFile(filePath, content);
    }

    async exists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async isFile(filePath: string): Promise<boolean> {
        try {
            const stat = await fs.promises.stat(filePath);
            return stat.isFile();
        } catch {
            return false;
        }
    }

    async delete(filePath: string): Promise<void> {
        if (await this.exists(filePath)) {
            await fs.promises.unlink(filePath);
        }
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        const dir = path.dirname(newPath);
        if (!(await this.exists(dir))) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        await fs.promises.rename(oldPath, newPath);
    }

    async mkdir(dirPath: string): Promise<void> {
        await fs.promises.mkdir(dirPath, { recursive: true });
    }
}
