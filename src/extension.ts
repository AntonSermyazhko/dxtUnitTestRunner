'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as browserTools from 'testcafe-browser-tools';
import * as isReachable from 'is-reachable';

const BROWSER_ALIASES = ['ie', 'firefox', 'chrome', 'chrome-canary', 'chromium', 'opera', 'safari', 'edge'];
const HEADLESS_MODE_POSTFIX = ":headless";

let qunitController: QUnitTestController = null;

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
            qunitController.startTestRun("chrome", args.fsPath, "", "file");
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
        let editor = vscode.window.activeTextEditor;
        if(editor) {
            var doc = editor.document;
            if(doc.languageId === "javascript" || doc.languageId === "typescript") {
                let document = editor.document,
                    selection = editor.selection;

                if(selection && selection.active) {
                    let textLine = document.lineAt(selection.active.line).text,
                        textBeforeSelection = document.getText(new vscode.Range(0, 0, selection.end.line + 1, 0)),
                        [type, module, name] = this.findTestOrFixtureName(textBeforeSelection, textLine);

                    this.startTestRun(browser, document.fileName, type, module, name);
                }
            }
        }
    }

    public startTestRun(browser: string, filePath: string, type: string, moduleName: string, testName: string = "") {
        if(!type) {
            vscode.window.showErrorMessage(`No tests found. Position the cursor on the test caption.`);
            return;
        }

        var rootPathMatch = /.+?(?=testing)/.exec(filePath);
        if(!rootPathMatch) {
            return;
        }

        var rootPath = rootPathMatch[0].replace(/\\/g, '/');
        fs.readFile(`${rootPath}/ports.json`, "utf8", (err, data) => {
            if(err) {
                vscode.window.showErrorMessage(`Test runner: Error read 'ports.json'`);
                return;
            }

            var ports = JSON.parse(data),
                qunitPort = ports.qunit,
                qunitUrl: string = `http://localhost:${qunitPort}`;

            isReachable(qunitUrl, { timeout: 200 }).then(result => {
                var relativeFilePathMatch = /(?:testing\\tests\\)(.*)/.exec(filePath);
                if(relativeFilePathMatch) {
                    if(!result) {
                        var terminal = vscode.window.createTerminal("qunit test runner");
                        if(terminal) {
                            terminal.show(true);
                            terminal.sendText("cd ./testing");
                            terminal.sendText("node launch");
                            isReachable(qunitUrl, { timeout: 10000 }).then(result => {
                                if(!result) {
                                    vscode.window.showErrorMessage(`Test runner: Error start testing service`);
                                    return;
                                }
                                setTimeout(() => this.runTest(browser, qunitPort, filePath, moduleName, testName), 2000);
                            });
                        }
                    } else {
                        this.runTest(browser, qunitPort, filePath, moduleName, testName);
                    }
                }
            });
        });
    }

    private findTestOrFixtureName(textBeforeSelection: string, textLine: string): string[] {
        const QUNIT_TEST_RE = /(^|;|\s+|\/\/|\/\*)QUnit\.test\s*(?:\.[a-zA-Z]+\([^\)]*\))*\s*\(\s*(.+?\s*('|"))\s*,/gm;
        const QUNIT_MODULE_RE = /(^|;|\s+|\/\/|\/\*)QUnit\.module\s*\(\s*('|")(.+?\s*)('|")\s*,/gm;
        const CLEANUP_TEST_OR_FIXTURE_NAME_RE = /(^\(?\s*(\'|"|`))|((\'|"|`)\s*\)?$)/g;

        var match = QUNIT_TEST_RE.exec(textLine),
            moduleMatch = QUNIT_MODULE_RE.exec(textBeforeSelection),
            moduleName = "";

        while(moduleMatch !== null) {
            moduleName = moduleMatch.length > 4 ? moduleMatch[3] : moduleMatch[2];
            moduleMatch = QUNIT_MODULE_RE.exec(textBeforeSelection);
        }

        if(match) {
            return ['test', moduleName, match[2].replace(CLEANUP_TEST_OR_FIXTURE_NAME_RE, '')];
        }
        return ['', '', ''];
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
