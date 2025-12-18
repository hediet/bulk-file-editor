import { ExistingFileInfo, ParsedMerchDoc, UpdatedFileInfo, MerchDiagnostic } from './models';

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
    let basePath: string | null = null;
    let setupHeaderRange: { start: number, endExclusive: number } | undefined;
    const diagnostics: MerchDiagnostic[] = [];

    interface ExpectContentInfo {
        contentEnd: number;
        fileIdx: number;
    }

    let lastMatch: ExpectContentInfo | null = null;

    let match: RegExpExecArray | null;
    while ((match = merchHeaderRegex.exec(content)) !== null) {
        const fullLine = match[0];
        const matchStart = match.index;
        const matchEnd = match.index + fullLine.length;

        // Set new content for the previous file if we were expecting it
        if (lastMatch) {
            let end = matchStart;
            // Trim trailing newline of the previous block if it exists right before this instruction
            if (content[end - 1] === '\n') end--;
            if (content[end - 1] === '\r') end--;

            const textInBetween = content.substring(lastMatch.contentEnd, end);
            const fileInfo = updatedFiles.get(lastMatch.fileIdx);
            if (fileInfo) {
                fileInfo.content = textInBetween;
            }
        }

        lastMatch = null;

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
                    if (typeof data.idx === 'number' && data.path) {
                        const idx = data.idx;
                        updatedFiles.set(idx, {
                            idx,
                            newPath: data.path,
                            content: null,
                            headerOffsetRange: { start: matchStart, endExclusive: matchEnd }
                        });

                        if (hasColon) {
                            let contentStart = matchEnd;
                            // Check if next char is newline
                            if (content[contentStart] === '\r') contentStart++;
                            if (content[contentStart] === '\n') contentStart++;

                            lastMatch = {
                                contentEnd: contentStart,
                                fileIdx: idx,
                            };
                        }
                    } else {
                        diagnostics.push({
                            range: { start: matchStart, endExclusive: matchEnd },
                            message: "Invalid file data",
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
    if (lastMatch) {
        let end = content.length;
        if (content[end - 1] === '\n') end--;
        if (content[end - 1] === '\r') end--;

        const textInBetween = content.substring(lastMatch.contentEnd, end);
        const fileInfo = updatedFiles.get(lastMatch.fileIdx);
        if (fileInfo) {
            fileInfo.content = textInBetween;
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
        basePath,
        setupHeaderRange,
        diagnostics,
    };
}
