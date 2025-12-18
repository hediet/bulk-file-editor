#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LineFormatter, mergeFiles, splitFile, normalizeGlob, launchDefaultEditor, NodeFileSystem, getMerchFileExtension } from '../lib';

const nodeFs = new NodeFileSystem();

yargs(hideBin(process.argv))
    .command('merge [files..]', 'Merge files into a merch document', (yargs) => {
        return yargs
            .positional('files', {
                describe: 'Files to merge (glob patterns)',
                type: 'string',
                array: true,
                default: []
            })
            .option('merch-file', {
                alias: 'm',
                type: 'string',
                describe: 'Output merch file'
            })
            .option('input-file', {
                alias: 'i',
                type: 'string',
                describe: 'Input file containing list of files'
            })
            .option('comment-style', {
                alias: 'c',
                type: 'string',
                default: '// {}',
                describe: 'Comment style (e.g. "// {}" or "# {}")'
            })
            .option('without-content', {
                alias: 'w',
                type: 'boolean',
                default: false,
                describe: 'Do not include file content'
            });
    }, (argv) => {
        const files = argv.files as string[];
        const inputFile = argv['input-file'];
        
        if (inputFile) {
            const content = fs.readFileSync(inputFile, 'utf-8');
            const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
            files.push(...lines);
        }

        const cwd = process.cwd();
        const resolvedFiles = normalizeGlob(files, cwd);
        
        const commentStyle = argv['comment-style'];
        const parts = commentStyle.split('{}');
        if (parts.length !== 2) {
            console.error('Invalid comment style. Must contain "{}"');
            process.exit(1);
        }
        const formatter = new LineFormatter(parts[0], parts[1]);

        const outPath = argv['merch-file'];
        let outStream: fs.WriteStream | NodeJS.WriteStream = process.stdout;
        if (outPath) {
            outStream = fs.createWriteStream(outPath);
        }

        mergeFiles(resolvedFiles, outStream as fs.WriteStream, formatter, cwd, argv['without-content'], nodeFs);
    })
    .command('edit [files..]', 'Edit files in a temporary merch document', (yargs) => {
        return yargs
            .positional('files', {
                describe: 'Files to edit (glob patterns)',
                type: 'string',
                array: true,
                default: []
            })
            .option('comment-style', {
                alias: 'c',
                type: 'string',
                default: '// {}',
                describe: 'Comment style'
            })
            .option('without-content', {
                alias: 'w',
                type: 'boolean',
                default: false,
                describe: 'Do not include file content'
            })
            .option('no-hash-check', {
                type: 'boolean',
                default: false,
                describe: 'Do not check file hashes before modifying'
            });
    }, (argv) => {
        const files = argv.files as string[];
        const cwd = process.cwd();
        const resolvedFiles = normalizeGlob(files, cwd);

        const commentStyle = argv['comment-style'];
        const parts = commentStyle.split('{}');
        const formatter = new LineFormatter(parts[0], parts[1]);

        const tempDir = os.tmpdir();
        const ext = getMerchFileExtension(resolvedFiles);
        const tempFile = path.join(tempDir, `merch_${Date.now()}.merch${ext}`);
        
        const outStream = fs.createWriteStream(tempFile);
        
        // We need to wait for the stream to finish writing before launching editor
        outStream.on('finish', async () => {
            try {
                launchDefaultEditor(tempFile);
                await splitFile(tempFile, false, nodeFs, console.log, !argv['no-hash-check']);
            } catch (e) {
                console.error(e);
                process.exit(1);
            } finally {
                // Cleanup? Maybe keep it if error?
                // fs.unlinkSync(tempFile);
            }
        });

        mergeFiles(resolvedFiles, outStream, formatter, cwd, argv['without-content'], nodeFs);
        outStream.end();
    })
    .command('split <file>', 'Split a merch document back into files', (yargs) => {
        return yargs
            .positional('file', {
                describe: 'Merch file to split',
                type: 'string',
                demandOption: true
            })
            .option('dry', {
                alias: 'd',
                type: 'boolean',
                default: false,
                describe: 'Dry run'
            })
            .option('no-hash-check', {
                type: 'boolean',
                default: false,
                describe: 'Do not check file hashes before modifying'
            });
    }, async (argv) => {
        try {
            await splitFile(argv.file, argv.dry, nodeFs, console.log, !argv['no-hash-check']);
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    })
    .demandCommand(1)
    .help()
    .argv;
