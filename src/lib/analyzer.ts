import { ParsedMerchDoc } from './models';
import { buildActions, Action } from './actions';
import { MemoryFileSystem } from './memoryFileSystem';
import { computeHash, normalizeLineEndings } from './utils';

export interface FileStatus {
    range: { start: number, endExclusive: number };
    message: string;
    type: 'info' | 'warning' | 'error' | 'success';
}

export async function analyzeMerchDoc(content: string, doc: ParsedMerchDoc): Promise<FileStatus[]> {
    const statuses: FileStatus[] = [];
    
    // Use MemoryFileSystem to simulate the environment for buildActions
    // We pass checkHash=false to analyze purely based on the doc content
    const fs = new MemoryFileSystem(); 
    const p = fs.path;
    const { existingFiles, updatedFiles, basePath, newFiles } = doc;
    
    // Build a map of target paths to their sources (for conflict detection)
    const targetPaths = new Map<string, { source: { start: number, endExclusive: number }, type: 'write' | 'rename', isNew: boolean }[]>();
    
    // Track deletes by path
    const deletedPaths = new Map<string, { source: { start: number, endExclusive: number }, hash: string }>();
    
    // Collect all target paths from updated files
    for (const existing of existingFiles) {
        const updated = updatedFiles.get(existing.idx);
        const oldPath = p.resolve(basePath, existing.path);
        
        if (!updated) {
            // This file is being deleted
            deletedPaths.set(oldPath, { 
                source: existing.headerOffsetRange,
                hash: existing.hash 
            });
        } else {
            const newPath = p.resolve(basePath, updated.newPath);
            
            const entry = targetPaths.get(newPath) || [];
            if (updated.content !== null) {
                entry.push({ source: updated.headerOffsetRange, type: 'write', isNew: false });
            } else if (oldPath !== newPath) {
                entry.push({ source: updated.headerOffsetRange, type: 'rename', isNew: false });
            }
            targetPaths.set(newPath, entry);
        }
    }
    
    // Collect target paths from new files (without idx)
    for (const newFile of newFiles) {
        const newPath = p.resolve(basePath, newFile.newPath);
        const entry = targetPaths.get(newPath) || [];
        if (newFile.content !== null) {
            entry.push({ source: newFile.headerOffsetRange, type: 'write', isNew: true });
        }
        targetPaths.set(newPath, entry);
    }
    
    // Check for conflicts and delete+write noop
    for (const [targetPath, entries] of targetPaths) {
        if (entries.length > 1) {
            // Multiple entries writing to the same path - conflict
            for (const entry of entries) {
                statuses.push({
                    range: entry.source,
                    message: `Conflict: multiple files write to "${p.relative(basePath, targetPath)}"`,
                    type: 'error'
                });
            }
        } else if (entries.length === 1) {
            const entry = entries[0];
            const deleted = deletedPaths.get(targetPath);
            
            if (deleted && entry.isNew && entry.type === 'write') {
                // A new file is writing to a path that an existing file occupied (and is being deleted)
                // Check if this is a noop (same content)
                const newFileInfo = newFiles.find(f => 
                    f.headerOffsetRange.start === entry.source.start && 
                    f.headerOffsetRange.endExclusive === entry.source.endExclusive
                );
                
                if (newFileInfo && newFileInfo.content !== null) {
                    let contentToCheck = newFileInfo.content;
                    if (newFileInfo.eol) {
                        contentToCheck = normalizeLineEndings(contentToCheck, newFileInfo.eol);
                    }
                    const newHash = computeHash(Buffer.from(contentToCheck));
                    
                    if (newHash === deleted.hash) {
                        statuses.push({
                            range: entry.source,
                            message: `Noop: replaces deleted file with identical content`,
                            type: 'info'
                        });
                        statuses.push({
                            range: deleted.source,
                            message: `Noop: replaced by new file with identical content`,
                            type: 'info'
                        });
                    }
                }
            }
        }
    }
    
    let actions: Action[] = [];
    try {
        actions = await buildActions(doc, fs, false);
    } catch (e) {
        console.error("Error building actions for analysis", e);
    }

    for (const action of actions) {
        if (!action.source) continue;
        
        // Skip if we already added a status for this range (conflict, noop, etc.)
        const alreadyHasStatus = statuses.some(s => 
            s.range.start === action.source!.start && 
            s.range.endExclusive === action.source!.endExclusive
        );
        if (alreadyHasStatus) continue;

        switch (action.type) {
            case 'write':
                let isNewFile = true;
                for (const existing of existingFiles) {
                    const updated = updatedFiles.get(existing.idx);
                    if (updated && 
                        updated.headerOffsetRange.start === action.source.start && 
                        updated.headerOffsetRange.endExclusive === action.source.endExclusive) {
                        isNewFile = false;
                        break;
                    }
                }
                
                statuses.push({
                    range: action.source,
                    message: isNewFile ? "New File" : "Content updated",
                    type: 'success'
                });
                break;
                
            case 'rename':
                if (action.type === 'rename') {
                    const relativeOldPath = p.relative(basePath, action.oldPath);
                    statuses.push({
                        range: action.source,
                        message: `Renamed from ${relativeOldPath}`,
                        type: 'info'
                    });
                }
                break;
                
            case 'delete':
                statuses.push({
                    range: action.source,
                    message: "Deleted",
                    type: 'warning'
                });
                break;
        }
    }
    
    // Add "Renamed to" status on existing files
    for (const existing of existingFiles) {
        const updated = updatedFiles.get(existing.idx);
        if (updated) {
             const oldPath = p.resolve(basePath, existing.path);
             const newPath = p.resolve(basePath, updated.newPath);
             
             if (oldPath !== newPath) {
                 statuses.push({
                    range: existing.headerOffsetRange,
                    message: `Renamed to ${updated.newPath}`,
                    type: 'info'
                });
             }
        }
    }

    // Check for diagnostics (unparsed headers, unknown commands)
    if (doc.diagnostics) {
        for (const diagnostic of doc.diagnostics) {
            statuses.push({
                range: diagnostic.range,
                message: diagnostic.message,
                type: diagnostic.severity
            });
        }
    }

    return statuses;
}
