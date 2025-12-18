export interface ExistingFileInfo {
    idx: number;
    path: string;
    hash: string;
    headerOffsetRange: { start: number, endExclusive: number };
}

export interface UpdatedFileInfo {
    idx: number;
    newPath: string;
    content: string | null;
    headerOffsetRange: { start: number, endExclusive: number };
}

export interface MerchDiagnostic {
    range: { start: number, endExclusive: number };
    message: string;
    severity: 'error' | 'warning';
}

export interface ParsedMerchDoc {
    existingFiles: ExistingFileInfo[];
    updatedFiles: Map<number, UpdatedFileInfo>;
    basePath: string;
    setupHeaderRange?: { start: number, endExclusive: number };
    diagnostics: MerchDiagnostic[];
}

export class LineFormatter {
    constructor(public prefix: string, public suffix: string) {}

    format(content: string): string {
        return `${this.prefix}${content}${this.suffix}`;
    }
}
