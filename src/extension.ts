'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as browserTools from 'testcafe-browser-tools';
import * as isReachable from 'is-reachable';
import { type } from 'os';

const BROWSER_ALIASES = ['ie', 'firefox', 'chrome', 'chrome-canary', 'chromium', 'opera', 'safari', 'edge'];

var qunitController: QUnitTestController = null;

function registerRunQUnitTestsCommands (context:vscode.ExtensionContext){
    context.subscriptions.push(
        vscode.commands.registerCommand('qunitrunner.runTestsInChrome', () => {
            console.log("qunitrunner.runTestsInChrome");
            qunitController.runTests("chrome");
        })
    );
}

function registerRunQUnitTestFileCommands (context:vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('qunitrunner.runTestFileInChrome', args => {
            console.log("qunitrunner.runTestFileInChrome", args);
            qunitController.startTestRun("chrome", args.fsPath, new TestInfo('file', "", ""));
        })
    );
}

function getBrowserList () {
    return browserTools.getInstallations()
            .then(installations => {
                return Object.keys(installations);
            });
}

function updateInstalledBrowserFlags (){
    return getBrowserList()
        .then(installations => {
            for(var aliase of BROWSER_ALIASES){
                if(installations.indexOf(aliase) !== -1 )
                    vscode.commands.executeCommand('setContext', 'qunitrunner.' + aliase + 'Installed', true);
            }
        });
}

export function activate(context:vscode.ExtensionContext) {
    qunitController = new QUnitTestController();

    updateInstalledBrowserFlags()
        .then(() => {
            registerRunQUnitTestsCommands(context);
            registerRunQUnitTestFileCommands(context);

            context.subscriptions.push(qunitController);

            vscode.commands.executeCommand('setContext', 'qunitrunner.readyForUX', true);
        });
}

// this method is called when your extension is deactivated
export function deactivate() {
}

class QUnitTestController {
    public runTests(browser:string) {
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
                    testInfo = this.findTest(textBeforeSelection, textLine, cursorPosition);

                this.startTestRun(browser, document.fileName, testInfo);
            }
        }
    }

    public startTestRun(browser: string, filePath: string, testInfo: TestInfo) {
        if(!type) {
            vscode.window.showErrorMessage(`No tests found. Position the cursor on the test caption.`);
            return;
        }

        var rootPathMatch = /.+?(?=testing)/.exec(filePath);
        if(!rootPathMatch) {
            vscode.window.showErrorMessage(`Test runner: Error parse test file root path`);
            return;
        }

        var rootPath = rootPathMatch[0].replace(/\\/g, '/');
        fs.readFile(`${rootPath}/ports.json`, "utf8", (err, data) => {
            if(err) {
                vscode.window.showErrorMessage(`Test runner: Error read 'ports.json'`);
                return;
            }

            console.log(`Running test: module=${testInfo.module}, test=${testInfo.name}`);

            var ports = JSON.parse(data),
                qunitPort = ports.qunit,
                qunitUrl: string = `http://localhost:${qunitPort}`;

            isReachable(qunitUrl, { timeout: 400 }).then(result => {
                var relativeFilePathMatch = /(?:testing\\tests\\)(.*)/.exec(filePath);
                if(relativeFilePathMatch) {
                    if(!result) {
                        if(this.runQUnitTestService()) {
                            isReachable(qunitUrl, { timeout: 30000 }).then(result => {
                                if(result) {
                                    setTimeout(() => this.runTest(browser, qunitPort, filePath, testInfo.module, testInfo.name), 2000);
                                } else {
                                    vscode.window.showErrorMessage(`Test runner: Error start testing service`);
                                }
                            });
                        }
                    } else {
                        this.runTest(browser, qunitPort, filePath, testInfo.module, testInfo.name);
                    }
                }
            });
        });
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

    private findModule(textBeforeSelection: string): string {
        const QUNIT_MODULE_RE = /(^|;|\s+|\/\/|\/\*)QUnit\.module\s*\(\s*('|")(.+?\s*)('|")\s*/gm;
        var moduleMatch = QUNIT_MODULE_RE.exec(textBeforeSelection),
            moduleName = "";

        while(moduleMatch !== null) {
            moduleName = moduleMatch.length > 4 ? moduleMatch[3] : moduleMatch[2];
            moduleMatch = QUNIT_MODULE_RE.exec(textBeforeSelection);
        }

        if(!moduleName) {
            vscode.window.showWarningMessage(`Test runner: Test module not found`);
        }

        return moduleName;
    }

    private findTest(textBeforeSelection: string, textLine: string, cursorPosition: number): TestInfo {
        const QUNIT_TEST_RE = /(^|;|\s+|\/\/|\/\*)QUnit\.test\s*(?:\.[a-zA-Z]+\([^\)]*\))*\s*\(\s*(.+?\s*('|"))\s*,/gm;
        const CLEANUP_TEST_OR_FIXTURE_NAME_RE = /(^\(?\s*(\'|"|`))|((\'|"|`)\s*\)?$)/g;

        var testMatch = QUNIT_TEST_RE.exec(textLine),
            matches = [],
            moduleName = this.findModule(textBeforeSelection),
            lastOneTest = null;

        if(testMatch) {
            let testName = testMatch[2].replace(CLEANUP_TEST_OR_FIXTURE_NAME_RE, '');
            return new TestInfo('test', moduleName, testName);
        } else {
            testMatch = QUNIT_TEST_RE.exec(textBeforeSelection);
            while(testMatch !== null) {
                if(this.isTest(testMatch[0])) {
                    let name = testMatch[2],
                        realIndex = testMatch.index + testMatch[0].length - this.cropMatchString(testMatch[0]).length;
                    matches.push({
                        type: 'test',
                        module: moduleName,
                        name: name.replace(CLEANUP_TEST_OR_FIXTURE_NAME_RE, ''),
                        index: realIndex
                    });
                }

                testMatch = QUNIT_TEST_RE.exec(textBeforeSelection);
            }

            if(matches.length){
                for(var i = matches.length - 1; i >= 0; i--){
                    if(cursorPosition >=  matches[i].index){
                        lastOneTest = matches[i];
                        break;
                    }
                }
            }

            if(lastOneTest) {
                return new TestInfo(lastOneTest.type, lastOneTest.module, lastOneTest.name);
            }
        }

        return new TestInfo("", "", "");
    }

    private isTest(matchString) {
        var validPrefixes = ['QUnit.test', 'QUnit.testInActiveWindow'],
            cropedString = this.cropMatchString(matchString);
        return !!validPrefixes.find(item => cropedString.indexOf(item));
    }

    private cropMatchString(matchString){
        matchString = matchString.trim().replace(/;|\/\/|\/\*/, '');

        return matchString.trim();
    }

    private runTest(browser: string, qunitPort: number, filePath: string, moduleName: string, testName: string) {
        var relativeFilePathMatch = /(?:testing\\tests\\)(.*)/.exec(filePath);
        if(relativeFilePathMatch) {
            var testId = this.generateQunitTestHash(moduleName, testName),
                relativeFilePath = relativeFilePathMatch[1].replace(/\\/g, '/'),
                testUri = encodeURI(`http://localhost:${qunitPort}/run/${relativeFilePath}?testId=${testId}`);

            browserTools.getBrowserInfo(browser).then((info: any) => browserTools.open(info, testUri));
        }
    }

    private generateQunitTestHash(module, testName) { // Copied from QUnit
        var str = module + "\x1C" + testName;
        var hash = 0;

        for(var i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }

        var hex = (0x100000000 + hash).toString(16);
        if(hex.length < 8) {
            hex = "0000000" + hex;
        }

        return hex.slice(-8);
    }

    dispose() {
    }
}

class TestInfo {
    type: string;
    module: string;
    name: string;

    constructor(type: string, module: string, name: string) {
        this.type = type;
        this.module = module;
        this.name = name;
    }
}
