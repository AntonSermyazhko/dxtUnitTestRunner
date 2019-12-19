'use strict';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as isReachable from 'is-reachable';
import * as browserTools from 'testcafe-browser-tools';
import { BrowserInfo, TestInfo } from '../infos';
import QUnitHelper from './qUnitHelper';

export default class QUnitTestController {
    parser = new TestParser();
    runner = new TestRunner();

    runTests(browserInfo: BrowserInfo) {
        var editor = vscode.window.activeTextEditor,
            document = editor && editor.document
        if(!editor || !document) {
            return;
        }
        if(document.languageId === "javascript" || document.languageId === "typescript") {
            let selection = editor.selection;
            if(selection && selection.active) {
                let textLine = document.lineAt(selection.active.line).text,
                    cursorPosition = document.getText(new vscode.Range(0, 0, selection.active.line, selection.active.character)).length,
                    textBeforeSelection = document.getText(new vscode.Range(0, 0, selection.end.line + 1, 0)),
                    testInfo = this.parser.findTest(textBeforeSelection, textLine, cursorPosition);

                this.runTest(browserInfo, document.fileName, testInfo);
            }
        }
    }

    runTest(browserInfo: BrowserInfo, filePath: string, testInfo: TestInfo) {
        if(!testInfo.type) {
            vscode.window.showErrorMessage(`No tests found. Position the cursor on the test caption.`);
            return;
        }

        filePath = this.parser.normalizeFilePath(filePath);
        if(!filePath) {
            vscode.window.showErrorMessage(`Test runner: Error parse test file path`);
            return;
        }

        const rootPathMatch = /.+?(?=testing)/.exec(filePath);
        if(!rootPathMatch) {
            vscode.window.showErrorMessage(`Test runner: Error parse test file root path`);
            return;
        }

        const rootPath = rootPathMatch[0].replace(/\\/g, '/');
        fs.readFile(`${rootPath}/ports.json`, "utf8", (err, data) => {
            if(err) {
                vscode.window.showErrorMessage(`Test runner: Error read 'ports.json'`);
                return;
            }

            if(testInfo.type === "test") {
                console.log(`Running test: module=${testInfo.module}, test=${testInfo.name}`);
            } else if(testInfo.type === "module") {
                console.log(`Running tests: module=${testInfo.module}`);
            } else if(testInfo.type === "file") {
                console.log(`Running tests: file=${filePath}`);
            }

            const ports = JSON.parse(data);
            this.runner.runTest(browserInfo, filePath, testInfo, ports.qunit);
        });
    }

    dispose() {
    }
}

class TestRunner {
    runTest(browserInfo: BrowserInfo, filePath: string, testInfo: TestInfo, qunitPort: number) {
        if(testInfo.type === "test") {
            console.log(`Running test: module=${testInfo.module}, test=${testInfo.name}`);
        } else if(testInfo.type === "module") {
            console.log(`Running tests: module=${testInfo.module}`);
        } else if(testInfo.type === "file") {
            console.log(`Running tests: file=${filePath}`);
        }

        const qunitUrl = `http://localhost:${qunitPort}`;
        isReachable(qunitUrl, { timeout: 5000 }).then(result => {
            if(!result) {
                this.restartQUnitTestService(qunitUrl, browserInfo, qunitPort, filePath, testInfo);
            } else {
                this.runTestCore(browserInfo, qunitPort, filePath, testInfo);
            }
        });
    }

    private runTestCore(browserInfo: BrowserInfo, qunitPort: number, filePath: string, testInfo: TestInfo) {
        const relativeFilePathMatch = /(?:testing(?:\\|\/)tests(?:\\|\/))(.*)/.exec(filePath);
        const isWin32 = process.platform === "win32";
        if(relativeFilePathMatch) {
            const relativeFilePath = relativeFilePathMatch[1].replace(/\\/g, '/');
            let testUrl = `http://localhost:${qunitPort}/run/${relativeFilePath}?notimers=true&nojquery=true`;
            if(testInfo.type === "module") {
                testUrl = encodeURI(`${testUrl}&module=${testInfo.module}`);
            } else if(testInfo.type === "test") {
                if(testInfo.hasInterpolation) {
                    testUrl = encodeURI(`${testUrl}&module=${testInfo.module}&filter=${testInfo.name}`);
                } else {
                    let testId = QUnitHelper.generateQunitTestHash(testInfo.module, testInfo.name);
                    testUrl = encodeURI(`${testUrl}&testId=${testId}`);
                }
            }

            if(isWin32) {
                testUrl = testUrl.replace(/&/g, '^&');
            } else {
                testUrl = `'${testUrl}'`;
            }

            browserTools.getBrowserInfo(browserInfo.name).then((info: any) => {
                if(browserInfo.cmdArgs) {
                    info.cmd += ` ${browserInfo.cmdArgs}`;
                }
                browserTools.open(info, testUrl);
            });
        } else {
            vscode.window.showErrorMessage('Test runner: Wrong relative test file path');
        }
    }

    private restartQUnitTestService(qunitUrl: string, browserInfo: BrowserInfo, qunitPort: number, filePath: string, testInfo: TestInfo) {
        if(this.runQUnitTestService()) {
            isReachable(qunitUrl, { timeout: 20000 }).then(result => {
                if(!result) {
                    vscode.window.showWarningMessage('Test runner: Error start testing service');
                }
                setTimeout(
                    () => this.runTestCore(browserInfo, qunitPort, filePath, testInfo),
                    3000);
            });
        }
    }

    private runQUnitTestService(): boolean {
        var terminal = vscode.window.createTerminal("qunit test runner");
        if(terminal) {
            terminal.show(true);
            terminal.sendText("cd ./testing");
            terminal.sendText("node launch");
            return true;
        }
        vscode.window.showErrorMessage(`Test runner: Error run QUnit test service`);
        return false;
    }
}

class TestParser {
    findTest(textBeforeSelection: string, textLine: string, cursorPosition: number): TestInfo {
        const QUNIT_TEST_RE = /(^|;|\s+|\/\/|\/\*|QUnit\.)(test\w*)\s*(?:\.[a-zA-Z]+\([^\)]*\))*\s*\(\s*('|"|`)(.+?\s*(?:[^\\]\3))\s*,/gm;

        var testMatch = QUNIT_TEST_RE.exec(textLine),
            matches = [],
            moduleInfo = this.findModule(textBeforeSelection),
            lastOneTest = null;

        if(testMatch) {
            return this.prepareTestInfo(testMatch[4], moduleInfo.name);
        } else {
            testMatch = QUNIT_TEST_RE.exec(textBeforeSelection);
            while(testMatch !== null) {
                if(this.isTest(testMatch[0]) && testMatch.index > moduleInfo.index) {
                    const testInfo = this.prepareTestInfo(testMatch[4], moduleInfo.name);
                    const realIndex = testMatch.index + testMatch[0].length - this.cropMatchString(testMatch[0]).length;
                    matches.push({
                        type: 'test',
                        module: moduleInfo.name,
                        name: testInfo.name,
                        index: realIndex
                    });
                }

                testMatch = QUNIT_TEST_RE.exec(textBeforeSelection);
            }

            if(matches.length) {
                for(var i = matches.length - 1; i >= 0; i--){
                    if(cursorPosition >=  matches[i].index){
                        lastOneTest = matches[i];
                        break;
                    }
                }
            } else {
                return new TestInfo('module', moduleInfo.name, '');
            }

            if(lastOneTest) {
                return new TestInfo(
                    lastOneTest.type,
                    lastOneTest.module,
                    lastOneTest.name);
            }
        }

        return new TestInfo('', '', '');
    }

    private prepareTestInfo(testName: string, moduleName: string): TestInfo {
        const CLEANUP_TEST_OR_FIXTURE_NAME_RE = /(^\(?\s*(\'|"|`))|((\'|"|`|[$]\{)\s*\)?$)/g;
        const CLEANUP_ESCAPE_RE = /\\('|"|`{1})/g;
        const INTERPOLATION_RE = /(.*\${)|.*/g;

        const match = testName.match(INTERPOLATION_RE);
        const hasInterpolation = !!match[1];

        let name = hasInterpolation ? match[1] : match[0];
        name = name.replace(CLEANUP_TEST_OR_FIXTURE_NAME_RE, '')
                    .replace(CLEANUP_ESCAPE_RE, '$1');

        return new TestInfo('test', moduleName, name, hasInterpolation);
    }

    normalizeFilePath(filePath: string): string {
        const partsMatch = /.+?(\\\w+Parts\\.*)/.exec(filePath);
        if(!partsMatch || !partsMatch.length) {
            return filePath;
        }

        const partsWithFileName = partsMatch[1].replace(/\\/g, '/'),
            testsPathMatch = /.+?(?=\\\w+Parts\\)/.exec(filePath);
        if(testsPathMatch && testsPathMatch.length) {
            const testsPath = testsPathMatch[0],
                fileNames = fs.readdirSync(testsPath).filter(item => {
                    const lowerCaseItem = item.toLowerCase();
                    return lowerCaseItem.endsWith(".js") || lowerCaseItem.endsWith(".ts");
                });

            for(let i = 0; i < fileNames.length; ++i) {
                const fileName = fileNames[i],
                    testFilePath = `${testsPath}/${fileName}`,
                    fileContent = fs.readFileSync(testFilePath, "utf8");

                if(fileContent.indexOf(partsWithFileName) >= 0) {
                    return testFilePath;
                }
            }
        }
    }

    private findModule(textBeforeSelection: string) {
        const QUNIT_MODULE_RE = /(^|;|\s+|\/\/|\/\*|QUnit\.)module\s*\(\s*('|")(.+?\s*)('|")\s*(,|\)|\n)/gm;
        var moduleMatch = QUNIT_MODULE_RE.exec(textBeforeSelection),
            index = -1,
            moduleName = "";

        while(moduleMatch !== null) {
            index = moduleMatch.index;
            moduleName = moduleMatch.length > 4 ? moduleMatch[3] : moduleMatch[2];
            moduleMatch = QUNIT_MODULE_RE.exec(textBeforeSelection);
        }

        if(!moduleName) {
            vscode.window.showWarningMessage(`Test runner: Test module not found`);
        }

        return { name: moduleName, index: index };
    }

    private isTest(matchString) {
        var validPrefixes = ['test', 'testInActiveWindow', 'testInDesktop'],
            cropedString = this.cropMatchString(matchString);
        return !!validPrefixes.find(item => cropedString.indexOf(item) >= 0);
    }

    private cropMatchString(matchString){
        matchString = matchString.trim().replace(/;|\/\/|\/\*/, '');

        return matchString.trim();
    }
}
