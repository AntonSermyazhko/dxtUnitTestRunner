import * as vscode from 'vscode';

export const getRootPath = (
    filePath: string
  ): string => {
    const match = /.+?(?=testing)/.exec(filePath);

    if(!match) {
      vscode.window.showErrorMessage(`Test runner: Error parse test file root path`);
      return '';
    }

    return match[0].replace(/\\/g, '/');
  }
