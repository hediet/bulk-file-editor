import * as path from 'path';
import { LineFormatter } from './models';
import { computeHash, detectLineEnding, LineEnding, normalizeLineEndings } from './utils';
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
    let mainLineEnding: LineEnding = '\n';
    const fileLineEndings = new Map<string, LineEnding | undefined>();

    // Determine main line ending from the first file
    for (const filePath of files) {
        if (await fs.exists(filePath) && await fs.isFile(filePath)) {
            const content = await fs.readFile(filePath);
            const detected = detectLineEnding(content);
            fileLineEndings.set(filePath, detected);
            
            if (detected && mainLineEnding === '\n') {
                 // If we haven't found a specific line ending yet (default is \n), set it.
                 // But wait, if the first file is \n, we set it to \n.
                 // If the first file is \r\n, we set it to \r\n.
                 // We should just take the first file's ending if it has one.
                 mainLineEnding = detected;
                 break; 
            }
        }
    }
    
    // If we broke early, we might not have populated fileLineEndings for all files.
    // But we only need it for the files we process.
    // We should probably populate it as we go or just re-read (it's inefficient but safe).
    // Or just clear it and let the loop handle it.
    fileLineEndings.clear();

    const le = mainLineEnding;

    writer.write(formatter.format('='.repeat(20)) + le);
    writer.write(formatter.format(`merch::setup: ${JSON.stringify({ basePath: normalizePath(baseDir) })}`) + le);

    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        if (!await fs.exists(filePath) || !await fs.isFile(filePath)) {
            continue;
        }
        
        const content = await fs.readFile(filePath);
        const hash = computeHash(Buffer.from(content));
        const fileLineEnding = detectLineEnding(content);
        fileLineEndings.set(filePath, fileLineEnding);
        
        let displayPath = filePath;
        try {
            displayPath = path.relative(baseDir, filePath);
        } catch (e) {
            // ignore
        }
        displayPath = normalizePath(displayPath);

        const info: any = { path: displayPath, idx: i, hash: hash };
        // eol is not needed in existing-file as we only use it for writing back (in merch::file)

        writer.write(formatter.format(`merch::existing-file: ${JSON.stringify(info)}`) + le);
    }

    writer.write(formatter.format('='.repeat(20)) + le);
    writer.write(le);

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

        const info: any = { path: displayPath, idx: i };
        const fileLineEnding = fileLineEndings.get(filePath);
        if (fileLineEnding && fileLineEnding !== mainLineEnding) {
            info.eol = fileLineEnding;
        }

        writer.write(formatter.format(`merch::file: ${JSON.stringify(info)}${colon}`) + le);

        if (!withoutContent) {
            const content = await fs.readFile(filePath);
            writer.write(normalizeLineEndings(content, mainLineEnding));
            writer.write(le);
        }
    }
}
