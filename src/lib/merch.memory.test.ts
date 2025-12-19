import { MemoryFileSystem } from './memoryFileSystem';
import { mergeFiles, IWriter } from './merger';
import { splitContent } from './splitter';
import { LineFormatter } from './models';

class StringWriter implements IWriter {
    public content = '';
    write(chunk: string): void {
        this.content += chunk;
    }
}

const formatter = new LineFormatter('// ', '');

function visualizeLineEndings(content: string): string {
    return content
        .replace(/\r\n/g, '<CRLF>')
        .replace(/\n/g, '<LF>')
        .replace(/<CRLF>/g, '[CRLF]\n')
        .replace(/<LF>/g, '[LF]\n');
}

test('in-memory merge and split', async () => {
    const fs = new MemoryFileSystem({
        '/src/file1.txt': 'content1',
        '/src/file2.txt': 'content2',
    });

    const writer = new StringWriter();
    await mergeFiles(['/src/file1.txt', '/src/file2.txt'], writer, formatter, '/src', false, fs);

    expect(writer.content).toMatchInlineSnapshot(`
"// ====================
// merch::setup: {"basePath":"/src"}
// merch::existing-file: {"path":"file1.txt","idx":0,"hash":"d0b425e00e15a0d36b9b361f02bab63563aed6cb4665083905386c55d5b679fa"}
// merch::existing-file: {"path":"file2.txt","idx":1,"hash":"dab741b6289e7dccc1ed42330cae1accc2b755ce8079c2cd5d4b5366c9f769a6"}
// ====================

// merch::file: {"path":"file1.txt","idx":0}:
content1
// merch::file: {"path":"file2.txt","idx":1}:
content2
"
`);

    const modifiedMerchContent = writer.content.replace('content1', 'content1_modified');
    
    expect(modifiedMerchContent).toMatchInlineSnapshot(`
"// ====================
// merch::setup: {"basePath":"/src"}
// merch::existing-file: {"path":"file1.txt","idx":0,"hash":"d0b425e00e15a0d36b9b361f02bab63563aed6cb4665083905386c55d5b679fa"}
// merch::existing-file: {"path":"file2.txt","idx":1,"hash":"dab741b6289e7dccc1ed42330cae1accc2b755ce8079c2cd5d4b5366c9f769a6"}
// ====================

// merch::file: {"path":"file1.txt","idx":0}:
content1_modified
// merch::file: {"path":"file2.txt","idx":1}:
content2
"
`);

    const logs: string[] = [];
    await splitContent(modifiedMerchContent, false, fs, (msg) => logs.push(msg));

    expect(logs).toMatchInlineSnapshot(`
[
  "Update "/src/file1.txt"",
]
`);
    expect(fs.toJson()).toMatchInlineSnapshot(`
{
  "/src/file1.txt": "content1_modified",
  "/src/file2.txt": "content2",
}
`);
});

test('in-memory rename', async () => {
    const fs = new MemoryFileSystem({
        '/src/old.txt': 'content',
    });

    const writer = new StringWriter();
    await mergeFiles(['/src/old.txt'], writer, formatter, '/src', false, fs);
    
    expect(writer.content).toMatchInlineSnapshot(`
"// ====================
// merch::setup: {"basePath":"/src"}
// merch::existing-file: {"path":"old.txt","idx":0,"hash":"ed7002b439e9ac845f22357d822bac1444730fbdb6016d3ec9432297b9ec9f73"}
// ====================

// merch::file: {"path":"old.txt","idx":0}:
content
"
`);

    const modifiedMerchContent = writer.content.replace('merch::file: {"path":"old.txt","idx":0}', 'merch::file: {"path":"new.txt","idx":0}');
    
    expect(modifiedMerchContent).toMatchInlineSnapshot(`
"// ====================
// merch::setup: {"basePath":"/src"}
// merch::existing-file: {"path":"old.txt","idx":0,"hash":"ed7002b439e9ac845f22357d822bac1444730fbdb6016d3ec9432297b9ec9f73"}
// ====================

// merch::file: {"path":"new.txt","idx":0}:
content
"
`);

    const logs: string[] = [];
    await splitContent(modifiedMerchContent, false, fs, (msg) => logs.push(msg));
    
    expect(logs).toMatchInlineSnapshot(`
[
  "Rename "/src/old.txt" to "/src/new.txt"",
]
`);
    expect(fs.toJson()).toMatchInlineSnapshot(`
{
  "/src/new.txt": "content",
}
`);
});

test('delete file', async () => {
    const fs = new MemoryFileSystem({
        '/src/todelete.txt': 'content',
        '/src/keep.txt': 'keep',
    });

    const writer = new StringWriter();
    await mergeFiles(['/src/todelete.txt', '/src/keep.txt'], writer, formatter, '/src', false, fs);

    // Remove the file block for todelete.txt
    const modifiedMerchContent = writer.content.replace(/\/\/ merch::file: \{"path":"todelete\.txt","idx":0\}[\s\S]*?(?=\/\/ merch::file:|$)/, '');

    expect(modifiedMerchContent).toMatchInlineSnapshot(`
"// ====================
// merch::setup: {"basePath":"/src"}
// merch::existing-file: {"path":"todelete.txt","idx":0,"hash":"ed7002b439e9ac845f22357d822bac1444730fbdb6016d3ec9432297b9ec9f73"}
// merch::existing-file: {"path":"keep.txt","idx":1,"hash":"6ca7ea2feefc88ecb5ed6356ed963f47dc9137f82526fdd25d618ea626d0803f"}
// ====================

// merch::file: {"path":"keep.txt","idx":1}:
keep
"
`);

    const logs: string[] = [];
    await splitContent(modifiedMerchContent, false, fs, (msg) => logs.push(msg));

    expect(logs).toMatchInlineSnapshot(`
[
  "Delete "/src/todelete.txt"",
]
`);
    expect(fs.toJson()).toMatchInlineSnapshot(`
{
  "/src/keep.txt": "keep",
}
`);
});

test('swap files (cycle)', async () => {
    const fs = new MemoryFileSystem({
        '/src/A.txt': 'contentA',
        '/src/B.txt': 'contentB',
    });

    const writer = new StringWriter();
    await mergeFiles(['/src/A.txt', '/src/B.txt'], writer, formatter, '/src', false, fs);

    let content = writer.content;
    content = content.replace(/merch::file: \{"path":"A\.txt","idx":0\}/, 'merch::file: {"path":"TEMP_MARKER","idx":0}');
    content = content.replace(/merch::file: \{"path":"B\.txt","idx":1\}/, 'merch::file: {"path":"A.txt","idx":1}');
    content = content.replace('TEMP_MARKER', 'B.txt');

    expect(content).toMatchInlineSnapshot(`
"// ====================
// merch::setup: {"basePath":"/src"}
// merch::existing-file: {"path":"A.txt","idx":0,"hash":"c5a42c550ff12e5d2a4a198ecf582c3e1a54e3599cc3b13bc8958e9d3fb5d941"}
// merch::existing-file: {"path":"B.txt","idx":1,"hash":"b11bfd2c0388bd86cce1b8ce39dcd97675d9c11fa426de693989d2f033bc79ef"}
// ====================

// merch::file: {"path":"B.txt","idx":0}:
contentA
// merch::file: {"path":"A.txt","idx":1}:
contentB
"
`);

    const logs: string[] = [];
    await splitContent(content, false, fs, (msg) => logs.push(msg));

    expect(logs).toMatchInlineSnapshot(`
[
  "Rename "/src/B.txt" to "/src/A_temp.txt"",
  "Rename "/src/A.txt" to "/src/B.txt"",
  "Rename "/src/A_temp.txt" to "/src/A.txt"",
]
`);
    expect(fs.toJson()).toMatchInlineSnapshot(`
{
  "/src/A.txt": "contentB",
  "/src/B.txt": "contentA",
}
`);
});

test('rename and edit', async () => {
    const fs = new MemoryFileSystem({
        '/src/original.txt': 'original content',
    });

    const writer = new StringWriter();
    await mergeFiles(['/src/original.txt'], writer, formatter, '/src', false, fs);

    let content = writer.content;
    content = content.replace('merch::file: {"path":"original.txt","idx":0}', 'merch::file: {"path":"moved.txt","idx":0}');
    content = content.replace('original content', 'new content');

    expect(content).toMatchInlineSnapshot(`
"// ====================
// merch::setup: {"basePath":"/src"}
// merch::existing-file: {"path":"original.txt","idx":0,"hash":"bf573149b23303cac63c2a359b53760d919770c5d070047e76de42e2184f1046"}
// ====================

// merch::file: {"path":"moved.txt","idx":0}:
new content
"
`);

    const logs: string[] = [];
    await splitContent(content, false, fs, (msg) => logs.push(msg));

    expect(logs).toMatchInlineSnapshot(`
[
  "Update "/src/original.txt"",
  "Rename "/src/original.txt" to "/src/moved.txt"",
]
`);
    expect(fs.toJson()).toMatchInlineSnapshot(`
{
  "/src/moved.txt": "new content",
}
`);
});

test('multiple renames chain A->B->C', async () => {
    const fs = new MemoryFileSystem({
        '/src/A.txt': 'contentA',
        '/src/B.txt': 'contentB',
    });

    const writer = new StringWriter();
    await mergeFiles(['/src/A.txt', '/src/B.txt'], writer, formatter, '/src', false, fs);

    // A -> B
    // B -> C
    let content = writer.content;
    // Replace A.txt with B.txt in the file block for A (idx 0)
    content = content.replace('merch::file: {"path":"A.txt","idx":0}:', 'merch::file: {"path":"B.txt","idx":0}:');
    // Replace B.txt with C.txt in the file block for B (idx 1)
    content = content.replace('merch::file: {"path":"B.txt","idx":1}:', 'merch::file: {"path":"C.txt","idx":1}:');

    expect(content).toMatchInlineSnapshot(`
"// ====================
// merch::setup: {"basePath":"/src"}
// merch::existing-file: {"path":"A.txt","idx":0,"hash":"c5a42c550ff12e5d2a4a198ecf582c3e1a54e3599cc3b13bc8958e9d3fb5d941"}
// merch::existing-file: {"path":"B.txt","idx":1,"hash":"b11bfd2c0388bd86cce1b8ce39dcd97675d9c11fa426de693989d2f033bc79ef"}
// ====================

// merch::file: {"path":"B.txt","idx":0}:
contentA
// merch::file: {"path":"C.txt","idx":1}:
contentB
"
`);

    const logs: string[] = [];
    await splitContent(content, false, fs, (msg) => logs.push(msg));

    expect(logs).toMatchInlineSnapshot(`
[
  "Rename "/src/B.txt" to "/src/C.txt"",
  "Rename "/src/A.txt" to "/src/B.txt"",
]
`);
    expect(fs.toJson()).toMatchInlineSnapshot(`
{
  "/src/B.txt": "contentA",
  "/src/C.txt": "contentB",
}
`);
});

test('all input files use CRLF', async () => {
    const fs = new MemoryFileSystem({
        '/src/file1.txt': 'line1\r\nline2',
        '/src/file2.txt': 'lineA\r\nlineB',
    });

    const writer = new StringWriter();
    await mergeFiles(['/src/file1.txt', '/src/file2.txt'], writer, formatter, '/src', false, fs);

    expect(visualizeLineEndings(writer.content)).toMatchInlineSnapshot(`
"// ====================[CRLF]
// merch::setup: {"basePath":"/src"}[CRLF]
// merch::existing-file: {"path":"file1.txt","idx":0,"hash":"d14a91a6d1c6ee83bf0c774ebecbee6d8b393b395dae29eea839c354d6fba9c0"}[CRLF]
// merch::existing-file: {"path":"file2.txt","idx":1,"hash":"b574185d2521de2ac6ec8ad19a20ad5d53d80db79515210f5f99f3c5b40c500e"}[CRLF]
// ====================[CRLF]
[CRLF]
// merch::file: {"path":"file1.txt","idx":0}:[CRLF]
line1[CRLF]
line2[CRLF]
// merch::file: {"path":"file2.txt","idx":1}:[CRLF]
lineA[CRLF]
lineB[CRLF]
"
`);

    // Simulate editing content (keeping CRLF in merch file)
    const modifiedMerchContent = writer.content.replace('line1', 'line1_mod');
    
    await splitContent(modifiedMerchContent, false, fs, () => {});

    const content1 = await fs.readFile('/src/file1.txt');
    expect(visualizeLineEndings(content1)).toMatchInlineSnapshot(`
"line1_mod[CRLF]
line2"
`);
    
    const content2 = await fs.readFile('/src/file2.txt');
    expect(visualizeLineEndings(content2)).toMatchInlineSnapshot(`
"lineA[CRLF]
lineB"
`);
});

test('all input files use LF', async () => {
    const fs = new MemoryFileSystem({
        '/src/file1.txt': 'line1\nline2',
        '/src/file2.txt': 'lineA\nlineB',
    });

    const writer = new StringWriter();
    await mergeFiles(['/src/file1.txt', '/src/file2.txt'], writer, formatter, '/src', false, fs);

    expect(visualizeLineEndings(writer.content)).toMatchInlineSnapshot(`
"// ====================[LF]
// merch::setup: {"basePath":"/src"}[LF]
// merch::existing-file: {"path":"file1.txt","idx":0,"hash":"683376e290829b482c2655745caffa7a1dccfa10afaa62dac2b42dd6c68d0f83"}[LF]
// merch::existing-file: {"path":"file2.txt","idx":1,"hash":"f87fce3cef9a3a29f9b8ddd29d8e921b90b49021ef6382056200cb7591df9ee4"}[LF]
// ====================[LF]
[LF]
// merch::file: {"path":"file1.txt","idx":0}:[LF]
line1[LF]
line2[LF]
// merch::file: {"path":"file2.txt","idx":1}:[LF]
lineA[LF]
lineB[LF]
"
`);

    const modifiedMerchContent = writer.content.replace('line1', 'line1_mod');
    
    await splitContent(modifiedMerchContent, false, fs, () => {});

    const content1 = await fs.readFile('/src/file1.txt');
    expect(visualizeLineEndings(content1)).toMatchInlineSnapshot(`
"line1_mod[LF]
line2"
`);
});

test('mixed input files (first is CRLF)', async () => {
    const fs = new MemoryFileSystem({
        '/src/crlf.txt': 'line1\r\nline2',
        '/src/lf.txt': 'lineA\nlineB',
    });

    const writer = new StringWriter();
    await mergeFiles(['/src/crlf.txt', '/src/lf.txt'], writer, formatter, '/src', false, fs);

    expect(visualizeLineEndings(writer.content)).toMatchInlineSnapshot(`
"// ====================[CRLF]
// merch::setup: {"basePath":"/src"}[CRLF]
// merch::existing-file: {"path":"crlf.txt","idx":0,"hash":"d14a91a6d1c6ee83bf0c774ebecbee6d8b393b395dae29eea839c354d6fba9c0"}[CRLF]
// merch::existing-file: {"path":"lf.txt","idx":1,"hash":"f87fce3cef9a3a29f9b8ddd29d8e921b90b49021ef6382056200cb7591df9ee4"}[CRLF]
// ====================[CRLF]
[CRLF]
// merch::file: {"path":"crlf.txt","idx":0}:[CRLF]
line1[CRLF]
line2[CRLF]
// merch::file: {"path":"lf.txt","idx":1,"eol":"\\n"}:[CRLF]
lineA[CRLF]
lineB[CRLF]
"
`);

    // Simulate editing content. 
    // Even if we write everything with LF in the merch file string (because it's a JS string),
    // the splitter should respect the eol property.
    
    const merchContent = `// ====================
// merch::setup: {"basePath":"/src"}
// merch::existing-file: {"path":"crlf.txt","idx":0,"hash":"hash1"}
// merch::existing-file: {"path":"lf.txt","idx":1,"hash":"hash2","eol":"\\n"}
// ====================

// merch::file: {"path":"crlf.txt","idx":0}:
line1_mod
line2
// merch::file: {"path":"lf.txt","idx":1,"eol":"\\n"}:
lineA_mod
lineB
`;
    
    await splitContent(merchContent, false, fs, () => {}, false);

    const content1 = await fs.readFile('/src/crlf.txt');
    // First file didn't specify EOL, so it inherits from the merch file style (which is LF in the string above)
    expect(visualizeLineEndings(content1)).toMatchInlineSnapshot(`
"line1_mod[LF]
line2"
`);

    const content2 = await fs.readFile('/src/lf.txt');
    // Second file has `eol: \n`, so it should be LF.
    expect(visualizeLineEndings(content2)).toMatchInlineSnapshot(`
"lineA_mod[LF]
lineB"
`);
});

test('mixed input files (first is LF)', async () => {
    const fs = new MemoryFileSystem({
        '/src/lf.txt': 'lineA\nlineB',
        '/src/crlf.txt': 'line1\r\nline2',
    });

    const writer = new StringWriter();
    await mergeFiles(['/src/lf.txt', '/src/crlf.txt'], writer, formatter, '/src', false, fs);

    expect(visualizeLineEndings(writer.content)).toMatchInlineSnapshot(`
"// ====================[LF]
// merch::setup: {"basePath":"/src"}[LF]
// merch::existing-file: {"path":"lf.txt","idx":0,"hash":"f87fce3cef9a3a29f9b8ddd29d8e921b90b49021ef6382056200cb7591df9ee4"}[LF]
// merch::existing-file: {"path":"crlf.txt","idx":1,"hash":"d14a91a6d1c6ee83bf0c774ebecbee6d8b393b395dae29eea839c354d6fba9c0"}[LF]
// ====================[LF]
[LF]
// merch::file: {"path":"lf.txt","idx":0}:[LF]
lineA[LF]
lineB[LF]
// merch::file: {"path":"crlf.txt","idx":1,"eol":"\\r\\n"}:[LF]
line1[LF]
line2[LF]
"
`);

    // Let's verify that if we apply this back, it preserves CRLF for the second file
    // even if the merch file is all LF.
    const merchContent = writer.content.replace('line1', 'line1_mod');
    // writer.content is already LF based.
    
    await splitContent(merchContent, false, fs, () => {});

    const content1 = await fs.readFile('/src/lf.txt');
    expect(visualizeLineEndings(content1)).toMatchInlineSnapshot(`
"lineA[LF]
lineB"
`);

    const content2 = await fs.readFile('/src/crlf.txt');
    // Should be normalized back to CRLF
    expect(visualizeLineEndings(content2)).toMatchInlineSnapshot(`
"line1_mod[CRLF]
line2"
`);
});

test('respects merch file EOL style when eol property is missing', async () => {
    const fs = new MemoryFileSystem({
        '/src/file.txt': 'line1\nline2',
    });

    // Construct merch content with CRLF
    const merchContentCRLF = [
        '// ====================',
        '// merch::setup: {"basePath":"/src"}',
        '// merch::existing-file: {"path":"file.txt","idx":0,"hash":"683376e290829b482c2655745caffa7a1dccfa10afaa62dac2b42dd6c68d0f83"}',
        '// ====================',
        '',
        '// merch::file: {"path":"file.txt","idx":0}:',
        'line1_mod',
        'line2_mod',
        ''
    ].join('\r\n');

    await splitContent(merchContentCRLF, false, fs, () => {});

    const content = await fs.readFile('/src/file.txt');
    expect(visualizeLineEndings(content)).toMatchInlineSnapshot(`
"line1_mod[CRLF]
line2_mod"
`);

    // Construct merch content with LF
    const merchContentLF = [
        '// ====================',
        '// merch::setup: {"basePath":"/src"}',
        '// merch::existing-file: {"path":"file.txt","idx":0,"hash":"683376e290829b482c2655745caffa7a1dccfa10afaa62dac2b42dd6c68d0f83"}',
        '// ====================',
        '',
        '// merch::file: {"path":"file.txt","idx":0}:',
        'line1_mod2',
        'line2_mod2',
        ''
    ].join('\n');

    // Disable hash check because file on disk changed
    await splitContent(merchContentLF, false, fs, () => {}, false);

    const content2 = await fs.readFile('/src/file.txt');
    expect(visualizeLineEndings(content2)).toMatchInlineSnapshot(`
"line1_mod2[LF]
line2_mod2"
`);
});

test('respects eol property in merch::file header', async () => {
    const fs = new MemoryFileSystem({
        '/src/file.txt': 'line1\nline2',
    });

    // Merch content has LF, but header says CRLF
    const merchContent = [
        '// ====================',
        '// merch::setup: {"basePath":"/src"}',
        '// merch::existing-file: {"path":"file.txt","idx":0,"hash":"683376e290829b482c2655745caffa7a1dccfa10afaa62dac2b42dd6c68d0f83"}',
        '// ====================',
        '',
        '// merch::file: {"path":"file.txt","idx":0,"eol":"\\r\\n"}:',
        'line1_mod',
        'line2_mod',
        ''
    ].join('\n');

    await splitContent(merchContent, false, fs, () => {});

    const content = await fs.readFile('/src/file.txt');
    expect(visualizeLineEndings(content)).toMatchInlineSnapshot(`
"line1_mod[CRLF]
line2_mod"
`);

    // Merch content has CRLF, but header says LF
    const merchContent2 = [
        '// ====================',
        '// merch::setup: {"basePath":"/src"}',
        '// merch::existing-file: {"path":"file.txt","idx":0,"hash":"683376e290829b482c2655745caffa7a1dccfa10afaa62dac2b42dd6c68d0f83"}',
        '// ====================',
        '',
        '// merch::file: {"path":"file.txt","idx":0,"eol":"\\n"}:',
        'line1_mod2',
        'line2_mod2',
        ''
    ].join('\r\n');

    // Disable hash check
    await splitContent(merchContent2, false, fs, () => {}, false);

    const content2 = await fs.readFile('/src/file.txt');
    expect(visualizeLineEndings(content2)).toMatchInlineSnapshot(`
"line1_mod2[LF]
line2_mod2"
`);
});
