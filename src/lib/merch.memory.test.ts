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
