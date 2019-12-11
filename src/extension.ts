
'use strict';
import * as vscode from 'vscode';
import * as browserTools from 'testcafe-browser-tools';
import { TestInfoFile, BROWSER_ALIASES, BrowserInfos } from './infos';
import QUnitTestController from './helpers/qUnitTestController';

var qunitController: QUnitTestController = null;

function registerRunQUnitTestsCommands (context:vscode.ExtensionContext){
    context.subscriptions.push(
        vscode.commands.registerCommand('qunitrunner.runTestsInChrome', () => qunitController.runTests(BrowserInfos.chrome))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('qunitrunner.runTestsInFirefox', () => qunitController.runTests(BrowserInfos.fireFox))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('qunitrunner.runTestsInEdge', () => qunitController.runTests(BrowserInfos.edge))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('qunitrunner.runTestsInIE', () => qunitController.runTests(BrowserInfos.ie))
    );
}

function registerRunQUnitTestFileCommands (context:vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('qunitrunner.runTestFileInChrome', args => qunitController.runTest(BrowserInfos.chrome, args.fsPath, TestInfoFile))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('qunitrunner.runTestFileInFirefox', args => qunitController.runTest(BrowserInfos.fireFox, args.fsPath, TestInfoFile))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('qunitrunner.runTestFileInEdge', args => qunitController.runTest(BrowserInfos.edge, args.fsPath, TestInfoFile))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('qunitrunner.runTestFileInIE', args => qunitController.runTest(BrowserInfos.ie, args.fsPath, TestInfoFile))
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
