import { ParsedMerchDoc } from './models';
import { buildActions, Action } from './actions';
import { MemoryFileSystem } from './memoryFileSystem';

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
    
    let actions: Action[] = [];
    try {
        actions = await buildActions(doc, fs, false);
    } catch (e) {
        console.error("Error building actions for analysis", e);
    }

    for (const action of actions) {
        if (!action.source) continue;

        switch (action.type) {
            case 'write':
                let isNewFile = true;
                for (const existing of doc.existingFiles) {
                    const updated = doc.updatedFiles.get(existing.idx);
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
                    const relativeOldPath = fs.path.relative(doc.basePath, action.oldPath);
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
    const { existingFiles, updatedFiles, basePath } = doc;
    for (const existing of existingFiles) {
        const updated = updatedFiles.get(existing.idx);
        if (updated) {
             const p = fs.path;
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
