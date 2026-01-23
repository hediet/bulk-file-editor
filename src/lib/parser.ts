import { ExistingFileInfo, ParsedMerchDoc, UpdatedFileInfo, MerchDiagnostic, NewFileInfo } from './models';

export interface MerchLine {
    command: string;
    data: any;
    hasColon: boolean;
}

export function tryParseMerchLine(line: string): MerchLine | null {
    const regex = /^.*? merch::([a-zA-Z0-9-]+):\s*(\{.*\})\s*(:)?$/;
    const match = regex.exec(line);
    if (!match) return null;

    const command = match[1];
    const jsonStr = match[2];
    const hasColon = !!match[3];

    try {
        const data = JSON.parse(jsonStr);
        return { command, data, hasColon };
    } catch (e) {
        return null;
    }
}

export function parseMerchDoc(content: string): ParsedMerchDoc {
    // We look for lines that contain " merch::"
    // The regex needs to be loose enough to catch potential headers so we can report errors
    // But strict enough to identify them.
    // Let's iterate line by line or use a global regex that finds lines with " merch::"
    
    const merchHeaderRegex = /^.*? merch::.*$/gm;

    const existingFiles: ExistingFileInfo[] = [];
    const updatedFiles = new Map<number, UpdatedFileInfo>();
    const newFiles: NewFileInfo[] = [];
    let basePath: string | null = null;
    let setupHeaderRange: { start: number, endExclusive: number } | undefined;
    const diagnostics: MerchDiagnostic[] = [];

    /**
     * Tracks which file should receive the content block that follows a `merch::file:` header.
     * - `updated`: An existing file being modified (identified by its `idx` from the merch doc)
     * - `new`: A newly created file (identified by its position in the `newFiles` array)
     */
    type PendingContent = {
        contentStart: number;
        target:
            | { type: 'updated'; idx: number }
            | { type: 'new'; arrayIndex: number };
    };

    let pendingContent: PendingContent | null = null;

    function assignContent(content: string, target: PendingContent['target']): void {
        if (target.type === 'updated') {
            const fileInfo = updatedFiles.get(target.idx);
            if (fileInfo) {
                fileInfo.content = content;
            }
        } else {
            const newFileInfo = newFiles[target.arrayIndex];
            if (newFileInfo) {
                newFileInfo.content = content;
            }
        }
    }

    let match: RegExpExecArray | null;
    while ((match = merchHeaderRegex.exec(content)) !== null) {
        const fullLine = match[0];
        const matchStart = match.index;
        const matchEnd = match.index + fullLine.length;

        // Assign content to the previous file if we were expecting it
        if (pendingContent) {
            let end = matchStart;
            // Trim trailing newline of the previous block if it exists right before this instruction
            if (content[end - 1] === '\n') end--;
            if (content[end - 1] === '\r') end--;

            const textInBetween = content.substring(pendingContent.contentStart, end);
            assignContent(textInBetween, pendingContent.target);
        }

        pendingContent = null;

        const parsed = tryParseMerchLine(fullLine);

        if (parsed) {
            const { command, data, hasColon } = parsed;

            switch (command) {
                case 'setup':
                    if (data.basePath) {
                        basePath = data.basePath;
                        setupHeaderRange = { start: matchStart, endExclusive: matchEnd };
                    } else {
                         diagnostics.push({
                            range: { start: matchStart, endExclusive: matchEnd },
                            message: "Missing basePath in setup",
                            severity: 'error'
                        });
                    }
                    break;
                case 'existing-file':
                    if (typeof data.idx === 'number' && data.path && data.hash) {
                        existingFiles.push({
                            path: data.path,
                            idx: data.idx,
                            hash: data.hash,
                            headerOffsetRange: { start: matchStart, endExclusive: matchEnd }
                        });
                    } else {
                        diagnostics.push({
                            range: { start: matchStart, endExclusive: matchEnd },
                            message: "Invalid existing-file data",
                            severity: 'error'
                        });
                    }
                    break;
                case 'file':
                    if (data.path) {
                        if (typeof data.idx === 'number') {
                            // Existing file update
                            const idx = data.idx;
                            updatedFiles.set(idx, {
                                idx,
                                newPath: data.path,
                                content: null,
                                headerOffsetRange: { start: matchStart, endExclusive: matchEnd },
                                eol: data.eol
                            });

                            if (hasColon) {
                                let contentStart = matchEnd;
                                if (content[contentStart] === '\r') contentStart++;
                                if (content[contentStart] === '\n') contentStart++;

                                pendingContent = {
                                    contentStart,
                                    target: { type: 'updated', idx },
                                };
                            }
                        } else {
                            // New file (no idx)
                            const newFileInfo: NewFileInfo = {
                                newPath: data.path,
                                content: null,
                                headerOffsetRange: { start: matchStart, endExclusive: matchEnd },
                                eol: data.eol
                            };
                            const arrayIndex = newFiles.length;
                            newFiles.push(newFileInfo);

                            if (hasColon) {
                                let contentStart = matchEnd;
                                if (content[contentStart] === '\r') contentStart++;
                                if (content[contentStart] === '\n') contentStart++;

                                pendingContent = {
                                    contentStart,
                                    target: { type: 'new', arrayIndex },
                                };
                            }
                        }
                    } else {
                        diagnostics.push({
                            range: { start: matchStart, endExclusive: matchEnd },
                            message: "Invalid file data: missing path",
                            severity: 'error'
                        });
                    }
                    break;
                default:
                    diagnostics.push({
                        range: { start: matchStart, endExclusive: matchEnd },
                        message: `Unknown command: ${command}`,
                        severity: 'error'
                    });
                    break;
            }
        } else {
            // If it matched " merch::" but failed tryParseMerchLine
            // We check if it looks like a command but failed JSON parsing
            const commandMatch = /merch::([a-zA-Z0-9-]+):/.exec(fullLine);
            if (commandMatch) {
                 diagnostics.push({
                    range: { start: matchStart, endExclusive: matchEnd },
                    message: "Invalid JSON in header",
                    severity: 'error'
                });
            } else {
                diagnostics.push({
                    range: { start: matchStart, endExclusive: matchEnd },
                    message: "Could not parse header",
                    severity: 'error'
                });
            }
        }
    }

    // Handle the last file content if it goes until the end of the string
    if (pendingContent) {
        let end = content.length;
        if (content[end - 1] === '\n') end--;
        if (content[end - 1] === '\r') end--;

        const textInBetween = content.substring(pendingContent.contentStart, end);
        assignContent(textInBetween, pendingContent.target);
    }

    // Warn about idx values that don't have a corresponding existing-file
    const existingIdxSet = new Set(existingFiles.map(f => f.idx));
    for (const [idx, fileInfo] of updatedFiles) {
        if (!existingIdxSet.has(idx)) {
            diagnostics.push({
                range: fileInfo.headerOffsetRange,
                message: `No existing-file found with idx ${idx}`,
                severity: 'warning'
            });
        }
    }

    if (!basePath) {
        // If we have diagnostics, maybe we don't throw? 
        // But the return type expects basePath.
        // Let's throw if we really can't find it, or return a dummy one if we have errors?
        // The original code threw.
        if (diagnostics.length > 0) {
             // If we have errors, maybe we can't proceed.
             // But for the analyzer, we might want to return what we have.
             // Let's return empty/dummy if missing.
             // But existing code might rely on it.
             // Let's throw for now to be safe, or handle it.
             // If I throw, the analyzer catches it and shows nothing (or fallback).
             // But I want to show diagnostics.
             
             // Let's return a dummy basePath if not found but we have diagnostics.
             return {
                existingFiles,
                updatedFiles,
                newFiles,
                basePath: basePath || ".",
                setupHeaderRange,
                diagnostics,
            };
        }
        throw new Error("No base path found in merch document");
    }

    return {
        existingFiles,
        updatedFiles,
        newFiles,
        basePath,
        setupHeaderRange,
        diagnostics,
    };
}
