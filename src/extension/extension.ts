import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { splitContent, mergeFiles, IFileSystem, IPath, LineFormatter, IWriter, HashMismatchError, getMerchFileExtension, parseMerchDoc, analyzeMerchDoc, foldFile, unfoldFile, isFolded, getFileAtOffset } from '../lib';

class VSCodeFileSystem implements IFileSystem {
    readonly path: IPath = path;

    async readFile(filePath: string): Promise<string> {
        const uri = vscode.Uri.file(filePath);
        const bytes = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder().decode(bytes);
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        const bytes = new TextEncoder().encode(content);
        await vscode.workspace.fs.writeFile(uri, bytes);
    }

    async exists(filePath: string): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            return true;
        } catch {
            return false;
        }
    }

    async isFile(filePath: string): Promise<boolean> {
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            return stat.type === vscode.FileType.File;
        } catch {
            return false;
        }
    }

    async delete(filePath: string): Promise<void> {
        await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { recursive: false });
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        await vscode.workspace.fs.rename(vscode.Uri.file(oldPath), vscode.Uri.file(newPath));
    }

    async mkdir(dirPath: string): Promise<void> {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
    }
}

class StringWriter implements IWriter {
    public content = '';
    write(chunk: string): void {
        this.content += chunk;
    }
}

export function activate(context: vscode.ExtensionContext) {
    const fs = new VSCodeFileSystem();

    const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 255, 0, 0.1)', // More transparent
        isWholeLine: true,
    });

    const infoDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            color: new vscode.ThemeColor('descriptionForeground'),
            margin: '0 0 0 2em',
            fontStyle: 'italic'
        }
    });

    const warningDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            color: new vscode.ThemeColor('editorWarning.foreground'),
            margin: '0 0 0 2em',
            fontStyle: 'italic'
        }
    });

    const errorDecorationType = vscode.window.createTextEditorDecorationType({
        textDecoration: 'wavy underline',
        after: {
            color: new vscode.ThemeColor('editorError.foreground'),
            margin: '0 0 0 2em',
            fontStyle: 'italic'
        }
    });

    const successDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            color: 'green', // Or a theme color if available
            margin: '0 0 0 2em',
            fontStyle: 'italic'
        }
    });

    const updateDecorations = async (editor: vscode.TextEditor) => {
        if (!editor.document.fileName.includes('.merch.')) {
            return;
        }

        const text = editor.document.getText();
        const ranges: vscode.Range[] = [];
        const infoRanges: vscode.DecorationOptions[] = [];
        const warningRanges: vscode.DecorationOptions[] = [];
        const errorRanges: vscode.DecorationOptions[] = [];
        const successRanges: vscode.DecorationOptions[] = [];

        try {
            const doc = parseMerchDoc(text);
            const statuses = await analyzeMerchDoc(text, doc);

            // Add background for all headers
            if (doc.setupHeaderRange) {
                const startPos = editor.document.positionAt(doc.setupHeaderRange.start);
                const endPos = editor.document.positionAt(doc.setupHeaderRange.endExclusive);
                ranges.push(new vscode.Range(startPos, endPos));
            }

            for (const file of doc.existingFiles) {
                const startPos = editor.document.positionAt(file.headerOffsetRange.start);
                const endPos = editor.document.positionAt(file.headerOffsetRange.endExclusive);
                ranges.push(new vscode.Range(startPos, endPos));
            }

            for (const file of doc.updatedFiles.values()) {
                const startPos = editor.document.positionAt(file.headerOffsetRange.start);
                const endPos = editor.document.positionAt(file.headerOffsetRange.endExclusive);
                ranges.push(new vscode.Range(startPos, endPos));
            }

            for (const diag of doc.diagnostics) {
                const startPos = editor.document.positionAt(diag.range.start);
                const endPos = editor.document.positionAt(diag.range.endExclusive);
                ranges.push(new vscode.Range(startPos, endPos));
            }

            for (const status of statuses) {
                const startPos = editor.document.positionAt(status.range.start);
                const endPos = editor.document.positionAt(status.range.endExclusive);
                const range = new vscode.Range(startPos, endPos);
                const decoration: vscode.DecorationOptions = {
                    range,
                    renderOptions: {
                        after: {
                            contentText: status.message
                        }
                    }
                };

                switch (status.type) {
                    case 'info':
                        infoRanges.push(decoration);
                        break;
                    case 'warning':
                        warningRanges.push(decoration);
                        break;
                    case 'error':
                        errorRanges.push(decoration);
                        break;
                    case 'success':
                        successRanges.push(decoration);
                        break;
                }
            }

        } catch (e) {
            console.error('Error updating decorations:', e);
        }

        editor.setDecorations(decorationType, ranges);
        editor.setDecorations(infoDecorationType, infoRanges);
        editor.setDecorations(warningDecorationType, warningRanges);
        editor.setDecorations(errorDecorationType, errorRanges);
        editor.setDecorations(successDecorationType, successRanges);
    };

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            updateDecorations(editor);
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            updateDecorations(editor);
        }
    }, null, context.subscriptions);

    if (vscode.window.activeTextEditor) {
        updateDecorations(vscode.window.activeTextEditor);
    }

    context.subscriptions.push(vscode.commands.registerCommand('merch.split', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const doc = editor.document;
        if (doc.isDirty) {
            await doc.save();
        }

        const filePath = doc.fileName;
        try {
            await splitContent(doc.getText(), false, fs);
            vscode.window.showInformationMessage('Merch file split successfully');
        } catch (e: any) {
            vscode.window.showErrorMessage(`Error splitting merch file: ${e.message}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('merch.editFolder', async (uri: vscode.Uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('No folder selected');
            return;
        }

        const folderPath = uri.fsPath;
        const folderName = path.basename(folderPath);
        const randomId = Math.random().toString(36).substring(7);

        try {
            // List files recursively
            const files = await listFilesRecursively(uri);
            const filePaths = files.map(f => f.fsPath);

            const ext = getMerchFileExtension(filePaths);
            const tempFileName = `${folderName}-${randomId}.merch${ext}`;
            const tempFilePath = path.join(os.tmpdir(), tempFileName);

            const writer = new StringWriter();
            const formatter = new LineFormatter('// ', '');
            
            await mergeFiles(filePaths, writer, formatter, folderPath, false, fs);
            
            await fs.writeFile(tempFilePath, writer.content);
            
            const doc = await vscode.workspace.openTextDocument(tempFilePath);
            await vscode.window.showTextDocument(doc);
        } catch (e: any) {
            vscode.window.showErrorMessage(`Error creating merch file: ${e.message}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('merch.apply', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const doc = editor.document;
        // We don't necessarily need to save, we can use the content in the editor
        const content = doc.getText();

        const apply = async (checkHash: boolean) => {
            try {
                const actions = await splitContent(content, false, fs, console.log, checkHash);
                
                if (actions.length === 0) {
                    vscode.window.showInformationMessage('No changes applied');
                } else {
                    const updates = actions.filter(a => a.type === 'write').length;
                    const renames = actions.filter(a => a.type === 'rename').length;
                    const deletes = actions.filter(a => a.type === 'delete').length;
                    
                    const parts: string[] = [];
                    if (updates > 0) parts.push(`${updates} Content Update${updates > 1 ? 's' : ''}`);
                    if (renames > 0) parts.push(`${renames} Rename${renames > 1 ? 's' : ''}`);
                    if (deletes > 0) parts.push(`${deletes} Delete${deletes > 1 ? 's' : ''}`);
                    
                    vscode.window.showInformationMessage(`${parts.join(', ')} applied successfully`);
                }

                // Close the editor
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            } catch (e: any) {
                if (e instanceof HashMismatchError) {
                    const selection = await vscode.window.showErrorMessage(
                        `Error applying changes: ${e.message}. The file on disk has changed since the merch file was created.`,
                        'Overwrite changed files'
                    );
                    if (selection === 'Overwrite changed files') {
                        await apply(false);
                    }
                } else {
                    vscode.window.showErrorMessage(`Error applying changes: ${e.message}`);
                }
            }
        };

        await apply(true);
    }));

    // Edit folder paths only (without content)
    context.subscriptions.push(vscode.commands.registerCommand('merch.editFolderPaths', async (uri: vscode.Uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('No folder selected');
            return;
        }

        const folderPath = uri.fsPath;
        const folderName = path.basename(folderPath);
        const randomId = Math.random().toString(36).substring(7);

        try {
            const files = await listFilesRecursively(uri);
            const filePaths = files.map(f => f.fsPath);

            const ext = getMerchFileExtension(filePaths);
            const tempFileName = `${folderName}-${randomId}.merch${ext}`;
            const tempFilePath = path.join(os.tmpdir(), tempFileName);

            const writer = new StringWriter();
            const formatter = new LineFormatter('// ', '');
            
            // withoutContent: true - creates folded file entries
            await mergeFiles(filePaths, writer, formatter, folderPath, true, fs);
            
            await fs.writeFile(tempFilePath, writer.content);
            
            const doc = await vscode.workspace.openTextDocument(tempFilePath);
            await vscode.window.showTextDocument(doc);
        } catch (e: any) {
            vscode.window.showErrorMessage(`Error creating merch file: ${e.message}`);
        }
    }));

    // Code action provider for fold/unfold toggle
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(
        { pattern: '**/*.merch.*' },
        new FoldUnfoldCodeActionProvider(fs),
        { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] }
    ));

    // Fold file command
    context.subscriptions.push(vscode.commands.registerCommand('merch.foldFile', async (uri: vscode.Uri, idx: number) => {
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();
        
        const doc = parseMerchDoc(content);
        const file = doc.updatedFiles.get(idx);
        if (!file) {
            vscode.window.showErrorMessage(`File with idx ${idx} not found`);
            return;
        }

        if (isFolded(file)) {
            return; // Already folded
        }

        const result = await foldFile(content, file, fs, doc.basePath);
        
        if (result.hadModifiedContent) {
            const selection = await vscode.window.showWarningMessage(
                'The file content has been modified. What would you like to do?',
                'Write to disk first',
                'Discard changes'
            );
            
            if (!selection) {
                return; // Cancelled
            }
            
            if (selection === 'Write to disk first') {
                // Apply the current merch content first to write the modified content
                try {
                    await splitContent(content, false, fs);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Error writing file: ${e.message}`);
                    return;
                }
            }
            // If 'Discard changes', we just fold without writing
        }

        // Apply the fold edit
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(content.length)
        );
        edit.replace(uri, fullRange, result.newContent);
        await vscode.workspace.applyEdit(edit);
    }));

    // Unfold file command
    context.subscriptions.push(vscode.commands.registerCommand('merch.unfoldFile', async (uri: vscode.Uri, idx: number) => {
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();
        
        const doc = parseMerchDoc(content);
        const file = doc.updatedFiles.get(idx);
        if (!file) {
            vscode.window.showErrorMessage(`File with idx ${idx} not found`);
            return;
        }

        if (!isFolded(file)) {
            return; // Already unfolded
        }

        try {
            const result = await unfoldFile(content, file, fs, doc.basePath);
            
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(content.length)
            );
            edit.replace(uri, fullRange, result.newContent);
            await vscode.workspace.applyEdit(edit);
        } catch (e: any) {
            vscode.window.showErrorMessage(`Error unfolding file: ${e.message}`);
        }
    }));
}

class FoldUnfoldCodeActionProvider implements vscode.CodeActionProvider {
    constructor(private readonly _fs: IFileSystem) {}

    async provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
    ): Promise<vscode.CodeAction[] | undefined> {
        const content = document.getText();
        const offset = document.offsetAt(range.start);

        const fileAtOffset = getFileAtOffset(content, offset);
        if (!fileAtOffset || fileAtOffset.type !== 'updated') {
            return undefined;
        }

        const file = fileAtOffset.file;
        const actions: vscode.CodeAction[] = [];

        if (isFolded(file)) {
            const action = new vscode.CodeAction('Unfold file', vscode.CodeActionKind.RefactorRewrite);
            action.command = {
                command: 'merch.unfoldFile',
                title: 'Unfold file',
                arguments: [document.uri, file.idx]
            };
            actions.push(action);
        } else {
            const action = new vscode.CodeAction('Fold file', vscode.CodeActionKind.RefactorRewrite);
            action.command = {
                command: 'merch.foldFile',
                title: 'Fold file',
                arguments: [document.uri, file.idx]
            };
            actions.push(action);
        }

        return actions;
    }
}

async function listFilesRecursively(folderUri: vscode.Uri): Promise<vscode.Uri[]> {
    const result: vscode.Uri[] = [];
    const entries = await vscode.workspace.fs.readDirectory(folderUri);
    
    for (const [name, type] of entries) {
        const uri = vscode.Uri.joinPath(folderUri, name);
        if (type === vscode.FileType.File) {
            result.push(uri);
        } else if (type === vscode.FileType.Directory) {
            result.push(...await listFilesRecursively(uri));
        }
    }
    return result;
}

export function deactivate() {}
