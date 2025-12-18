import { parseMerchDoc } from './parser';
import { buildActions, describeAction, runAction, Action } from './actions';
import { IFileSystem } from './fileSystem';

export async function splitContent(content: string, dryRun: boolean, fs: IFileSystem, logger: (message: string) => void = console.log, checkHash: boolean = true): Promise<Action[]> {
    const doc = parseMerchDoc(content);
    const actions = await buildActions(doc, fs, checkHash);

    for (const action of actions) {
        const message = describeAction(action);
        logger(message);
        if (!dryRun) {
            await runAction(action, fs);
        }
    }
    return actions;
}

export async function splitFile(filePath: string, dryRun: boolean, fs: IFileSystem, logger: (message: string) => void = console.log, checkHash: boolean = true): Promise<Action[]> {
    const content = await fs.readFile(filePath);
    return await splitContent(content, dryRun, fs, logger, checkHash);
}
