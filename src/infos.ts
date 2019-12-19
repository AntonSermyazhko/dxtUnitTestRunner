export class TestInfo {
    type: string;
    module: string;
    name: string;
    hasInterpolation: boolean;

    constructor(type: string, module: string, name: string, hasInterpolation = false) {
        this.type = type;
        this.module = module;
        this.name = name;
        this.hasInterpolation = hasInterpolation;
    }
}

export class BrowserInfo {
    name: string;
    cmdArgs: string;

    constructor(name: string, cmdArgs: string = "") {
        this.name = name;
        this.cmdArgs = cmdArgs;
    }
}

export const BrowserInfos = {
    chrome: new BrowserInfo("chrome", "--aggressive-cache-discard --disable-cache --disable-application-cache --disable-offline-load-stale-cache --disk-cache-size=0"),
    fireFox: new BrowserInfo("firefox"),
    edge: new BrowserInfo("edge"),
    ie: new BrowserInfo("ie")
};

export const TestInfoFile = new TestInfo('file', '', '');

export const BROWSER_ALIASES = ['ie', 'firefox', 'chrome', 'chrome-canary', 'chromium', 'opera', 'safari', 'edge'];
