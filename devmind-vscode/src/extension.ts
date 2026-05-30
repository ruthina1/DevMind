import * as vscode from 'vscode';
import { extractIntent, generateRecommendation } from './core/gemini';
import { fetchAllPackages } from './core/registry';
import { checkCompatibility } from './core/compat';

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('devmind.openPanel', () => {
    DevMindPanel.createOrShow(context.extensionUri);
  });

  context.subscriptions.push(disposable);
}

class DevMindPanel {
  public static currentPanel: DevMindPanel | undefined;
  public static readonly viewType = 'devmind';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DevMindPanel.currentPanel) {
      DevMindPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DevMindPanel.viewType,
      'DevMind',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
      }
    );

    DevMindPanel.currentPanel = new DevMindPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'analyze':
            await this.runAnalysis(message.prompt);
            return;
          case 'apply':
            await this.applyStack(message.installCommand);
            return;
        }
      },
      null,
      this._disposables
    );
  }

  private async runAnalysis(prompt: string) {
    try {
      this._panel.webview.postMessage({ command: 'progress', step: 'intent', label: 'Extracting project intent…' });
      const intent = await extractIntent(prompt);
      
      this._panel.webview.postMessage({ command: 'progress', step: 'registry', label: 'Scanning npm registry…' });
      const candidates = intent.all_candidates ?? [];
      if (candidates.length === 0) {
        throw new Error("No package candidates could be inferred from the description.");
      }
      const packages = await fetchAllPackages(candidates);
      const validPackages = packages.filter((p) => p.version !== "unknown");

      this._panel.webview.postMessage({ command: 'progress', step: 'compat', label: 'Checking peer dependencies…' });
      const compatibility = checkCompatibility(validPackages);

      this._panel.webview.postMessage({ command: 'progress', step: 'recommend', label: 'Generating curated stack…' });
      const recommendation = await generateRecommendation(
        intent,
        validPackages,
        compatibility
      );

      this._panel.webview.postMessage({
        command: 'result',
        result: {
          intent,
          registry: {
            total: packages.length,
            resolved: validPackages.length,
            failed: packages.filter((p) => p.error).map((p) => ({
              name: p.name,
              error: p.error,
            })),
          },
          compatibility,
          recommendation
        }
      });
    } catch (error: any) {
      this._panel.webview.postMessage({ command: 'error', text: error.message });
      vscode.window.showErrorMessage("DevMind Error: " + error.message);
    }
  }

  private async applyStack(installCommand: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("No workspace folder open.");
      return;
    }

    const terminal = vscode.window.createTerminal("DevMind");
    terminal.show();
    terminal.sendText(installCommand);
    vscode.window.showInformationMessage("Running installation command in terminal...");
  }

  public dispose() {
    DevMindPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, this._extensionUri);
  }

  private _getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri) {
    const toolkitUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.min.js')
    );
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevMind</title>
  <link href="${codiconsUri}" rel="stylesheet" />
  <script type="module" src="${toolkitUri}"></script>
  <style>
    body {
      padding: 0;
      margin: 0;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 32px 24px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .header .codicon {
      font-size: 28px;
      color: var(--vscode-textLink-foreground);
    }
    .description {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 24px;
      font-size: 14px;
    }
    .input-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 24px;
    }
    vscode-text-area {
      width: 100%;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    #statusContainer {
      display: none;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background-color: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      margin-bottom: 24px;
    }
    #statusText {
      font-weight: 500;
    }
    #errorContainer {
      display: none;
      padding: 16px;
      background-color: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-editorError-foreground);
      border-radius: 6px;
      margin-bottom: 24px;
    }
    #resultContainer {
      display: none;
    }
    .category-card {
      margin-bottom: 24px;
    }
    .category-card h3 {
      margin-bottom: 12px;
      font-size: 16px;
      font-weight: 600;
      border-bottom: 1px solid var(--vscode-widget-border);
      padding-bottom: 8px;
    }
    .package-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px;
      background-color: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      margin-bottom: 8px;
    }
    .package-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .package-name {
      font-weight: 600;
      font-size: 15px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .package-badges {
      display: flex;
      gap: 8px;
    }
    .package-reason {
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }
    .landmine-card {
      padding: 12px;
      background-color: var(--vscode-editorWarning-background);
      border-left: 4px solid var(--vscode-editorWarning-foreground);
      margin-bottom: 8px;
      color: var(--vscode-editor-foreground);
    }
    .landmine-trigger {
      font-weight: 600;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .install-section {
      margin-top: 32px;
      padding: 24px;
      background-color: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      text-align: center;
    }
    .install-section h3 {
      margin-top: 0;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="codicon codicon-sparkle"></span>
      <h1>DevMind AI Dependency Intelligence</h1>
    </div>
    
    <p class="description">
      Describe your project idea, and DevMind will generate a conflict-free, pinned dependency stack tailored specifically to your needs.
    </p>

    <div class="input-section">
      <vscode-text-area id="prompt" rows="3" placeholder="e.g. realtime collaborative notes app with auth and postgres" resize="vertical"></vscode-text-area>
      <div class="actions">
        <vscode-button id="analyzeBtn" appearance="primary">
          <span slot="start" class="codicon codicon-play"></span>
          Analyze Project
        </vscode-button>
      </div>
    </div>

    <div id="statusContainer">
      <vscode-progress-ring></vscode-progress-ring>
      <div id="statusText">Starting analysis...</div>
    </div>

    <div id="errorContainer"></div>

    <div id="resultContainer">
      <vscode-panels>
        <vscode-panel-tab id="tab-1">RECOMMENDED STACK</vscode-panel-tab>
        <vscode-panel-tab id="tab-2">LANDMINES</vscode-panel-tab>
        <vscode-panel-view id="view-1">
          <div id="stackCategories" style="width: 100%; padding-top: 16px;"></div>
          
          <div class="install-section">
            <h3>Ready to build?</h3>
            <p class="description">Instantly add these dependencies to your active workspace.</p>
            <vscode-button id="applyBtn" appearance="primary">
              <span slot="start" class="codicon codicon-terminal"></span>
              Apply to Workspace
            </vscode-button>
          </div>
        </vscode-panel-view>
        <vscode-panel-view id="view-2">
          <div id="landminesContainer" style="width: 100%; padding-top: 16px;">
            <p class="description">No landmines detected for this stack.</p>
          </div>
        </vscode-panel-view>
      </vscode-panels>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const analyzeBtn = document.getElementById('analyzeBtn');
    const promptInput = document.getElementById('prompt');
    const statusContainer = document.getElementById('statusContainer');
    const statusText = document.getElementById('statusText');
    const errorContainer = document.getElementById('errorContainer');
    const resultContainer = document.getElementById('resultContainer');
    const stackCategories = document.getElementById('stackCategories');
    const landminesContainer = document.getElementById('landminesContainer');
    const applyBtn = document.getElementById('applyBtn');
    
    let currentInstallCommand = '';

    analyzeBtn.addEventListener('click', () => {
      const prompt = promptInput.value.trim();
      if (!prompt) return;
      
      analyzeBtn.disabled = true;
      promptInput.disabled = true;
      
      errorContainer.style.display = 'none';
      resultContainer.style.display = 'none';
      statusContainer.style.display = 'flex';
      statusText.textContent = 'Extracting project intent...';
      
      vscode.postMessage({
        command: 'analyze',
        prompt: prompt
      });
    });

    applyBtn.addEventListener('click', () => {
      if (currentInstallCommand) {
        vscode.postMessage({
          command: 'apply',
          installCommand: currentInstallCommand
        });
      }
    });

    function formatDownloads(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M/wk';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K/wk';
      return n + '/wk';
    }

    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'progress':
          statusText.textContent = message.label;
          break;
        case 'error':
          analyzeBtn.disabled = false;
          promptInput.disabled = false;
          statusContainer.style.display = 'none';
          
          errorContainer.textContent = message.text;
          errorContainer.style.display = 'block';
          break;
        case 'result':
          analyzeBtn.disabled = false;
          promptInput.disabled = false;
          statusContainer.style.display = 'none';
          
          const rec = message.result.recommendation;
          
          // Render Stack
          let html = '';
          rec.categories.forEach(cat => {
            html += '<div class="category-card">';
            html += '<h3>' + cat.name + '</h3>';
            cat.packages.forEach(pkg => {
              html += '<div class="package-row">';
              html += '<div class="package-header">';
              html += '<div class="package-name"><span class="codicon codicon-package"></span> ' + pkg.name + '</div>';
              html += '<div class="package-badges">';
              html += '<vscode-tag>v' + pkg.version + '</vscode-tag>';
              if (pkg.weekly_downloads) {
                html += '<vscode-tag>' + formatDownloads(pkg.weekly_downloads) + '</vscode-tag>';
              }
              html += '</div></div>';
              html += '<div class="package-reason">' + pkg.reason + '</div>';
              html += '</div>';
            });
            html += '</div>';
          });
          stackCategories.innerHTML = html;
          
          // Render Landmines
          if (rec.landmines && rec.landmines.length > 0) {
            let lmHtml = '';
            rec.landmines.forEach(mine => {
              lmHtml += '<div class="landmine-card">';
              lmHtml += '<div class="landmine-trigger"><span class="codicon codicon-warning"></span> ' + mine.trigger + '</div>';
              lmHtml += '<div>' + mine.warning + '</div>';
              lmHtml += '</div>';
            });
            landminesContainer.innerHTML = lmHtml;
          } else {
            landminesContainer.innerHTML = '<p class="description">No landmines detected for this stack.</p>';
          }
          
          resultContainer.style.display = 'block';
          
          if (rec.install_command) {
            currentInstallCommand = rec.install_command;
          }
          break;
      }
    });
  </script>
</body>
</html>`;
  }
}
