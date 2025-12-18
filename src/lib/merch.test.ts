import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { mergeFiles } from './merger';
import { splitFile } from './splitter';
import { LineFormatter } from './models';
import { NodeFileSystem } from './fileSystem';

const tmpDir = path.join(os.tmpdir(), 'merch-test-' + Date.now());
const nodeFs = new NodeFileSystem();

beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('merge and split simple files', () => {
    const file1 = path.join(tmpDir, 'file1.txt');
    const file2 = path.join(tmpDir, 'file2.txt');
    fs.writeFileSync(file1, 'content1');
    fs.writeFileSync(file2, 'content2');

    const merchFile = path.join(tmpDir, 'merch.txt');
    const outStream = fs.createWriteStream(merchFile);
    
    const formatter = new LineFormatter('// ', '');
    
    return new Promise<void>(async (resolve, reject) => {
        outStream.on('finish', async () => {
            try {
                // Verify merch file content
                const content = fs.readFileSync(merchFile, 'utf-8');
                expect(content).toContain('merch::setup:');
                expect(content).toContain('merch::existing-file:');
                expect(content).toContain('merch::file:');
                expect(content).toContain('content1');
                expect(content).toContain('content2');

                // Now modify merch file to change content
                const newContent = content.replace('content1', 'content1_modified');
                fs.writeFileSync(merchFile, newContent);

                // Split
                await splitFile(merchFile, false, nodeFs);

                // Verify changes
                expect(fs.readFileSync(file1, 'utf-8')).toBe('content1_modified');
                expect(fs.readFileSync(file2, 'utf-8')).toBe('content2');
                resolve();
            } catch (e) {
                reject(e);
            }
        });

        await mergeFiles([file1, file2], outStream, formatter, tmpDir, false, nodeFs);
        outStream.end();
    });
});
