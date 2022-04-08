import * as vscode from 'vscode';
import { Terminal } from "vscode";
import { getRootPath } from "./pathHelper";

export default class QUnitHelper {
    // Copied from QUnit
    static generateQunitTestHash(module, testName = undefined) {
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
}

export const createTestingTerminal = (
    filePath: string,
    terminalName: string,
    callback: (terminal: Terminal) => void,
    isShow = false,
    isDispose = false,
): Terminal => {
    var terminal = vscode.window.createTerminal(`QUnit test runner - ${terminalName}`);

    if(isShow) {
        terminal.show();
    }

    const rootPath = getRootPath(filePath);
    terminal.sendText(`cd ${rootPath}testing/`);

    callback(terminal);

    if(isDispose) {
        terminal.dispose();
    }

    return terminal;
}