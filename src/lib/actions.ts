import { ParsedMerchDoc } from './models';
import { computeHash, normalizeLineEndings } from './utils';
import { IFileSystem } from './fileSystem';

export interface ActionSource {
    start: number;
    endExclusive: number;
}

export type Action = 
    | { type: 'write', path: string, content: string, source?: ActionSource }
    | { type: 'rename', oldPath: string, newPath: string, source?: ActionSource }
    | { type: 'delete', path: string, source?: ActionSource };

export async function runAction(action: Action, fs: IFileSystem): Promise<void> {
    switch (action.type) {
        case 'write':
            await fs.writeFile(action.path, action.content);
            break;
        case 'rename':
            await fs.rename(action.oldPath, action.newPath);
            break;
        case 'delete':
            await fs.delete(action.path);
            break;
    }
}

export function describeAction(action: Action): string {
    switch (action.type) {
        case 'write':
            return `Update "${action.path}"`;
        case 'rename':
            return `Rename "${action.oldPath}" to "${action.newPath}"`;
        case 'delete':
            return `Delete "${action.path}"`;
    }
}

export class HashMismatchError extends Error {
    constructor(public readonly filePath: string) {
        super(`File changed on disk: ${filePath}`);
    }
}

export async function buildActions(doc: ParsedMerchDoc, fs: IFileSystem, checkHash: boolean): Promise<Action[]> {
    const actions: Action[] = [];
    const renames = new Map<string, { newPath: string, source?: ActionSource }>(); // oldPath -> { newPath, source }
    const { basePath, existingFiles, updatedFiles } = doc;

    for (const existingFileInfo of existingFiles) {
        const oldPath = fs.path.resolve(basePath, existingFileInfo.path);
        const hash = existingFileInfo.hash;
        
        const updatedFileInfo = updatedFiles.get(existingFileInfo.idx);
        
        // Determine if we need hash check:
        // - For deletes (no updatedFileInfo): always check hash
        // - For folded renames (updatedFileInfo with null content): skip hash check
        // - For content updates: check hash
        const isFoldedRename = updatedFileInfo && updatedFileInfo.content === null;
        const needsHashCheck = checkHash && !isFoldedRename;
        
        if (needsHashCheck) {
            if (await fs.exists(oldPath) && await fs.isFile(oldPath)) {
                const content = await fs.readFile(oldPath);
                const currentHash = computeHash(Buffer.from(content));
                if (currentHash !== hash) {
                    throw new HashMismatchError(existingFileInfo.path);
                }
            } else {
                // File expected to exist but doesn't
                // We treat this as a mismatch too
                throw new HashMismatchError(existingFileInfo.path);
            }
        }
        
        if (updatedFileInfo) {
            const newPath = fs.path.resolve(basePath, updatedFileInfo.newPath);
            if (oldPath !== newPath) {
                renames.set(oldPath, { 
                    newPath, 
                    source: updatedFileInfo.headerOffsetRange 
                });
            }

            if (updatedFileInfo.content !== null) {
                let contentToWrite = updatedFileInfo.content;
                if (updatedFileInfo.eol) {
                    contentToWrite = normalizeLineEndings(contentToWrite, updatedFileInfo.eol);
                }

                const newContentHash = computeHash(Buffer.from(contentToWrite));
                if (hash !== newContentHash) {
                    // Write to the old path before renaming it
                    actions.push({ 
                        type: 'write', 
                        path: oldPath, 
                        content: contentToWrite,
                        source: updatedFileInfo.headerOffsetRange
                    });
                }
            }
        } else {
            actions.push({ 
                type: 'delete', 
                path: oldPath,
                source: existingFileInfo.headerOffsetRange
            });
        }
    }

    // Handle new files (files in updatedFiles but not in existingFiles)
    for (const [idx, updatedFileInfo] of updatedFiles) {
        const existing = existingFiles.find(e => e.idx === idx);
        if (!existing) {
            const newPath = fs.path.resolve(basePath, updatedFileInfo.newPath);
            if (updatedFileInfo.content !== null) {
                let contentToWrite = updatedFileInfo.content;
                if (updatedFileInfo.eol) {
                    contentToWrite = normalizeLineEndings(contentToWrite, updatedFileInfo.eol);
                }

                actions.push({
                    type: 'write',
                    path: newPath,
                    content: contentToWrite,
                    source: updatedFileInfo.headerOffsetRange
                });
            }
        }
    }

    // Handle new files from newFiles array (files without idx)
    for (const newFileInfo of doc.newFiles) {
        const newPath = fs.path.resolve(basePath, newFileInfo.newPath);
        if (newFileInfo.content !== null) {
            let contentToWrite = newFileInfo.content;
            if (newFileInfo.eol) {
                contentToWrite = normalizeLineEndings(contentToWrite, newFileInfo.eol);
            }

            actions.push({
                type: 'write',
                path: newPath,
                content: contentToWrite,
                source: newFileInfo.headerOffsetRange
            });
        }
    }

    const processRename = (from: string, processed: Set<string>) => {
        const renameInfo = renames.get(from);
        if (!renameInfo) return;
        const { newPath: to, source } = renameInfo;

        if (processed.has(from)) {
             throw new Error("Something is fishy, `from` should not have been processed yet.");
        }
        processed.add(from);

        if (processed.has(to)) {
            // Cycle detected
            const dir = fs.path.dirname(to);
            const ext = fs.path.extname(to);
            const name = fs.path.basename(to, ext);
            const tempPath = fs.path.join(dir, `${name}_temp${ext}`);
            
            // We need to update the map to point to the temp path for the cycle break
            renames.set(tempPath, { newPath: to, source });
            actions.push({ type: 'rename', oldPath: from, newPath: tempPath, source });
        } else {
            // Recurse
            processRename(to, processed);
            actions.push({ type: 'rename', oldPath: from, newPath: to, source });
        }
        
        renames.delete(from);
    };

    while (renames.size > 0) {
        const iterator = renames.keys();
        const first = iterator.next().value;
        if (first) {
            const processed = new Set<string>();
            processRename(first, processed);
        }
    }

    return actions;
}
