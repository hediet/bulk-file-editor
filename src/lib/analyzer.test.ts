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
});
