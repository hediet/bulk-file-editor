import * as path from 'path';
import { LineFormatter } from './models';
import { computeHash } from './utils';
import { IFileSystem } from './fileSystem';

export interface IWriter {
    write(chunk: string): void;
}

function normalizePath(p: string): string {
    return p.split('\\').join('/');
}

export async function mergeFiles(
    files: string[],
    writer: IWriter,
    formatter: LineFormatter,
    baseDir: string,
    withoutContent: boolean,
    fs: IFileSystem
): Promise<void> {
    writer.write(formatter.format('='.repeat(20)) + '\n');
    writer.write(formatter.format(`merch::setup: ${JSON.stringify({ basePath: normalizePath(baseDir) })}`) + '\n');

    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        if (!await fs.exists(filePath) || !await fs.isFile(filePath)) {
            continue;
        }
        
        const content = await fs.readFile(filePath);
        const hash = computeHash(Buffer.from(content));
        
        let displayPath = filePath;
        try {
            displayPath = path.relative(baseDir, filePath);
        } catch (e) {
            // ignore
        }
        displayPath = normalizePath(displayPath);

        writer.write(formatter.format(`merch::existing-file: ${JSON.stringify({ path: displayPath, idx: i, hash: hash })}`) + '\n');
    }

    writer.write(formatter.format('='.repeat(20)) + '\n');
    writer.write('\n');

    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        if (!await fs.exists(filePath) || !await fs.isFile(filePath)) {
            continue;
        }

        const colon = withoutContent ? '' : ':';
        let displayPath = filePath;
        try {
            displayPath = path.relative(baseDir, filePath);
        } catch (e) {
            // ignore
        }
        displayPath = normalizePath(displayPath);

        writer.write(formatter.format(`merch::file: ${JSON.stringify({ path: displayPath, idx: i })}${colon}`) + '\n');

        if (!withoutContent) {
            const content = await fs.readFile(filePath);
            writer.write(content);
            writer.write('\n');
        }
    }
}
