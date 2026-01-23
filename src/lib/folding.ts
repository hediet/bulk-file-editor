import { UpdatedFileInfo, NewFileInfo } from './models';
import { parseMerchDoc } from './parser';
import { IFileSystem } from './fileSystem';
import { computeHash, normalizeLineEndings, detectLineEnding } from './utils';

export interface FoldResult {
    newContent: string;
    /** True if the file had modified content that was discarded */
    hadModifiedContent: boolean;
}

export interface UnfoldResult {
    newContent: string;
}

/**
 * Identifies which file block contains a given offset position.
 * Returns the file info if found, or undefined if the position is not in a file block.
 */
export function getFileAtOffset(
    content: string,
    offset: number
): { type: 'updated'; file: UpdatedFileInfo } | { type: 'new'; file: NewFileInfo } | undefined {
    const doc = parseMerchDoc(content);

    for (const file of doc.updatedFiles.values()) {
        if (offset >= file.headerOffsetRange.start && offset <= file.headerOffsetRange.endExclusive) {
            return { type: 'updated', file };
        }
    }

    for (const file of doc.newFiles) {
        if (offset >= file.headerOffsetRange.start && offset <= file.headerOffsetRange.endExclusive) {
            return { type: 'new', file };
        }
    }

    return undefined;
}

/**
 * Checks if a file block is folded (has no content).
 */
export function isFolded(file: UpdatedFileInfo | NewFileInfo): boolean {
    return file.content === null;
}

/**
 * Folds a file block by removing its content.
 * Returns information about whether the content was modified compared to the original file on disk.
 */
export async function foldFile(
    content: string,
    file: UpdatedFileInfo,
    fs: IFileSystem,
    basePath: string
): Promise<FoldResult> {
    if (file.content === null) {
        // Already folded
        return { newContent: content, hadModifiedContent: false };
    }

    const doc = parseMerchDoc(content);
    const existingFile = doc.existingFiles.find(e => e.idx === file.idx);
    
    let hadModifiedContent = false;
    if (existingFile) {
        // Check if content was modified
        let contentToCheck = file.content;
        if (file.eol) {
            contentToCheck = normalizeLineEndings(contentToCheck, file.eol);
        }
        const contentHash = computeHash(Buffer.from(contentToCheck));
        hadModifiedContent = contentHash !== existingFile.hash;
    }

    // Find the end of content for this file
    const contentEnd = findContentEnd(content, file, doc);
    
    // Find the colon at end of header line
    const headerLine = content.substring(file.headerOffsetRange.start, file.headerOffsetRange.endExclusive);
    const colonIndex = headerLine.lastIndexOf(':');
    if (colonIndex === -1) {
        // No colon found - already folded format in header
        return { newContent: content, hadModifiedContent: false };
    }

    // Remove everything from the last colon in header to the end of content
    const colonOffsetInDoc = file.headerOffsetRange.start + colonIndex;
    const newContent = content.substring(0, colonOffsetInDoc) + content.substring(contentEnd);

    return { newContent, hadModifiedContent };
}

/**
 * Unfolds a file block by reading its content from disk.
 */
export async function unfoldFile(
    content: string,
    file: UpdatedFileInfo,
    fs: IFileSystem,
    basePath: string
): Promise<UnfoldResult> {
    if (file.content !== null) {
        // Already unfolded
        return { newContent: content };
    }

    const doc = parseMerchDoc(content);
    const existingFile = doc.existingFiles.find(e => e.idx === file.idx);
    
    if (!existingFile) {
        throw new Error(`Cannot unfold: no existing-file found for idx ${file.idx}`);
    }

    const filePath = fs.path.resolve(basePath, existingFile.path);
    const fileContent = await fs.readFile(filePath);
    
    // Detect line endings
    const merchLineEnding = detectLineEnding(content) || '\n';
    const fileLineEnding = detectLineEnding(fileContent);
    
    // Normalize file content to merch document's line ending
    let normalizedContent = fileContent;
    if (fileLineEnding && fileLineEnding !== merchLineEnding) {
        normalizedContent = normalizeLineEndings(fileContent, merchLineEnding);
    }

    // Insert colon and content after header
    const insertPosition = file.headerOffsetRange.endExclusive;
    
    // Check if the remaining content already starts with a newline
    const remainingContent = content.substring(insertPosition);
    const needsTrailingNewline = !remainingContent.startsWith('\n') && !remainingContent.startsWith('\r\n');
    
    const newContent = 
        content.substring(0, insertPosition) + 
        ':' + merchLineEnding +
        normalizedContent + 
        (needsTrailingNewline ? merchLineEnding : '') +
        remainingContent;

    return { newContent };
}

/**
 * Finds the end offset of a file's content block.
 */
function findContentEnd(
    content: string,
    file: UpdatedFileInfo | NewFileInfo,
    doc: ReturnType<typeof parseMerchDoc>
): number {
    // Collect all header start positions after this file's header
    const allHeaders: number[] = [];
    
    for (const f of doc.updatedFiles.values()) {
        if (f.headerOffsetRange.start > file.headerOffsetRange.start) {
            allHeaders.push(f.headerOffsetRange.start);
        }
    }
    
    for (const f of doc.newFiles) {
        if (f.headerOffsetRange.start > file.headerOffsetRange.start) {
            allHeaders.push(f.headerOffsetRange.start);
        }
    }

    if (allHeaders.length === 0) {
        // This is the last file, content goes to end
        let end = content.length;
        // Trim trailing newline
        if (content[end - 1] === '\n') end--;
        if (content[end - 1] === '\r') end--;
        return end;
    }

    // Find the nearest next header
    const nextHeaderStart = Math.min(...allHeaders);
    
    // Content ends just before the next header (minus trailing newline)
    let end = nextHeaderStart;
    if (content[end - 1] === '\n') end--;
    if (content[end - 1] === '\r') end--;
    
    return end;
}

/**
 * Folds a new file block (one without idx).
 * New files cannot be folded to preserve their content - this just removes them entirely.
 */
export function foldNewFile(
    content: string,
    file: NewFileInfo
): FoldResult {
    if (file.content === null) {
        return { newContent: content, hadModifiedContent: false };
    }

    const doc = parseMerchDoc(content);
    const contentEnd = findContentEnd(content, file, doc);
    
    // Remove entire file block including header
    let start = file.headerOffsetRange.start;
    // Include preceding newline if present
    if (content[start - 1] === '\n') start--;
    if (content[start - 1] === '\r') start--;
    
    const newContent = content.substring(0, start) + content.substring(contentEnd);
    
    return { newContent, hadModifiedContent: true };
}
