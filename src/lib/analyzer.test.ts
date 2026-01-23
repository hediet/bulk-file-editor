import { analyzeMerchDoc } from './analyzer';
import { parseMerchDoc } from './parser';
import { computeHash } from './utils';

describe('Analyzer', () => {
    it('should detect content updates', async () => {
        const originalContent = 'original content';
        const originalHash = computeHash(Buffer.from(originalContent));
        const newContent = 'new content';
        
        const merchContent = `// merch::setup: { "basePath": "." }
// merch::existing-file: { "path": "file1.txt", "idx": 0, "hash": "${originalHash}" }
// merch::file: { "path": "file1.txt", "idx": 0 }:
${newContent}`;

        const doc = parseMerchDoc(merchContent);
        const statuses = await analyzeMerchDoc(merchContent, doc);

        const updateStatus = statuses.find(s => s.message === 'Content updated');
        expect(updateStatus).toBeDefined();
        expect(updateStatus?.type).toBe('success');
    });

    it('should detect renames', async () => {
        const content = 'some content';
        const hash = computeHash(Buffer.from(content));
        
        const merchContent = `// merch::setup: { "basePath": "." }
// merch::existing-file: { "path": "old.txt", "idx": 0, "hash": "${hash}" }
// merch::file: { "path": "new.txt", "idx": 0 }:
${content}`;

        const doc = parseMerchDoc(merchContent);
        const statuses = await analyzeMerchDoc(merchContent, doc);

        const renameTo = statuses.find(s => s.message.startsWith('Renamed to'));
        const renameFrom = statuses.find(s => s.message.startsWith('Renamed from'));

        expect(renameTo).toBeDefined();
        expect(renameTo?.message).toContain('new.txt');
        expect(renameTo?.type).toBe('info');

        expect(renameFrom).toBeDefined();
        expect(renameFrom?.message).toContain('old.txt');
        expect(renameFrom?.type).toBe('info');
    });

    it('should detect deletions', async () => {
        const content = 'content';
        const hash = computeHash(Buffer.from(content));
        
        // File 0 is in existing-file but not in file commands
        const merchContent = `// merch::setup: { "basePath": "." }
// merch::existing-file: { "path": "todelete.txt", "idx": 0, "hash": "${hash}" }
`;

        const doc = parseMerchDoc(merchContent);
        const statuses = await analyzeMerchDoc(merchContent, doc);

        const deleteStatus = statuses.find(s => s.message === 'Deleted');
        expect(deleteStatus).toBeDefined();
        expect(deleteStatus?.type).toBe('warning');
    });

    it('should detect new files', async () => {
        const merchContent = `// merch::setup: { "basePath": "." }
// merch::file: { "path": "newfile.txt", "idx": 0 }:
new content`;

        const doc = parseMerchDoc(merchContent);
        const statuses = await analyzeMerchDoc(merchContent, doc);

        const newFileStatus = statuses.find(s => s.message === 'New File');
        expect(newFileStatus).toBeDefined();
        expect(newFileStatus?.type).toBe('success');
    });

    it('should detect unknown commands', async () => {
        const merchContent = `// merch::setup: { "basePath": "." }
// merch::broken-command: { "what": "ever" }
`;
        const doc = parseMerchDoc(merchContent);
        const statuses = await analyzeMerchDoc(merchContent, doc);

        const errorStatus = statuses.find(s => s.message === 'Unknown command: broken-command');
        expect(errorStatus).toBeDefined();
        expect(errorStatus?.type).toBe('error');
    });

    it('should detect unparsed headers', async () => {
        const merchContent = `// merch::setup: { "basePath": "." }
// merch:: invalid syntax
`;
        const doc = parseMerchDoc(merchContent);
        const statuses = await analyzeMerchDoc(merchContent, doc);

        const errorStatus = statuses.find(s => s.message === 'Could not parse header');
        expect(errorStatus).toBeDefined();
        expect(errorStatus?.type).toBe('error');
    });

    it('should not report changes if content is identical', async () => {
        const content = 'same content';
        const hash = computeHash(Buffer.from(content));
        
        const merchContent = `// merch::setup: { "basePath": "." }
// merch::existing-file: { "path": "file.txt", "idx": 0, "hash": "${hash}" }
// merch::file: { "path": "file.txt", "idx": 0 }:
${content}`;

        const doc = parseMerchDoc(merchContent);
        const statuses = await analyzeMerchDoc(merchContent, doc);

        const updateStatus = statuses.find(s => s.message === 'Content updated');
        expect(updateStatus).toBeUndefined();
    });

    it('should detect conflict when multiple files write to same path', async () => {
        const content1 = 'content 1';
        const content2 = 'content 2';
        const hash1 = computeHash(Buffer.from(content1));
        const hash2 = computeHash(Buffer.from(content2));
        
        const merchContent = `// merch::setup: { "basePath": "." }
// merch::existing-file: { "path": "a.txt", "idx": 0, "hash": "${hash1}" }
// merch::existing-file: { "path": "b.txt", "idx": 1, "hash": "${hash2}" }
// merch::file: { "path": "same.txt", "idx": 0 }:
${content1}
// merch::file: { "path": "same.txt", "idx": 1 }:
${content2}`;

        const doc = parseMerchDoc(merchContent);
        const statuses = await analyzeMerchDoc(merchContent, doc);

        const conflictStatuses = statuses.filter(s => s.message.includes('Conflict'));
        expect(conflictStatuses).toHaveLength(2);
        expect(conflictStatuses[0].type).toBe('error');
        expect(conflictStatuses[1].type).toBe('error');
    });

    it('should detect conflict when rename and new file target same path', async () => {
        const content = 'content';
        const hash = computeHash(Buffer.from(content));
        
        const merchContent = `// merch::setup: { "basePath": "." }
// merch::existing-file: { "path": "old.txt", "idx": 0, "hash": "${hash}" }
// merch::file: { "path": "target.txt", "idx": 0 }:
${content}
// merch::file: { "path": "target.txt" }:
new content`;

        const doc = parseMerchDoc(merchContent);
        const statuses = await analyzeMerchDoc(merchContent, doc);

        const conflictStatuses = statuses.filter(s => s.message.includes('Conflict'));
        expect(conflictStatuses).toHaveLength(2);
    });

    it('should detect noop when delete + new file with identical content', async () => {
        const content = 'identical content';
        const hash = computeHash(Buffer.from(content));
        
        // Delete file at idx 0 by not having a merch::file for it
        // Create a new file at the same path with identical content
        const merchContent = `// merch::setup: { "basePath": "." }
// merch::existing-file: { "path": "file.txt", "idx": 0, "hash": "${hash}" }
// merch::file: { "path": "file.txt" }:
${content}`;

        const doc = parseMerchDoc(merchContent);
        const statuses = await analyzeMerchDoc(merchContent, doc);

        const noopStatuses = statuses.filter(s => s.message.includes('Noop'));
        expect(noopStatuses).toHaveLength(2);
        expect(noopStatuses.every(s => s.type === 'info')).toBe(true);
    });

    it('should not report noop when delete + new file with different content', async () => {
        const originalContent = 'original content';
        const newContent = 'different content';
        const hash = computeHash(Buffer.from(originalContent));
        
        const merchContent = `// merch::setup: { "basePath": "." }
// merch::existing-file: { "path": "file.txt", "idx": 0, "hash": "${hash}" }
// merch::file: { "path": "file.txt" }:
${newContent}`;

        const doc = parseMerchDoc(merchContent);
        const statuses = await analyzeMerchDoc(merchContent, doc);

        const noopStatuses = statuses.filter(s => s.message.includes('Noop'));
        expect(noopStatuses).toHaveLength(0);
        
        // Should have a delete and a new file status
        const deleteStatus = statuses.find(s => s.message === 'Deleted');
        const newFileStatus = statuses.find(s => s.message === 'New File');
        expect(deleteStatus).toBeDefined();
        expect(newFileStatus).toBeDefined();
    });
});
