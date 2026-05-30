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
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevMind</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    h1 {
      color: var(--vscode-textPreformat-foreground);
      margin-bottom: 24px;
    }
    textarea {
      width: 100%;
      height: 100px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 10px;
      margin-bottom: 16px;
      font-family: var(--vscode-font-family);
      resize: vertical;
    }
    button {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    .status {
      margin-top: 16px;
      font-style: italic;
      color: var(--vscode-descriptionForeground);
    }
    .result {
      margin-top: 24px;
      border: 1px solid var(--vscode-widget-border);
      padding: 16px;
      border-radius: 4px;
      background-color: var(--vscode-editorWidget-background);
      display: none;
    }
    .error {
      color: var(--vscode-errorForeground);
      margin-top: 16px;
      display: none;
    }
    .pkg-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .pkg-name {
      font-weight: bold;
    }
    .apply-btn {
      margin-top: 16px;
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .apply-btn:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>DevMind</h1>
    <p>Describe your project idea. Get a perfect, conflict-free pinned stack.</p>
    
    <textarea id="prompt" placeholder="e.g. realtime collaborative notes app with auth and postgres"></textarea>
    <br/>
    <button id="analyzeBtn">Analyze Project</button>
    
    <div id="status" class="status"></div>
    <div id="error" class="error"></div>
    
    <div id="result" class="result">
      <h2 id="resultTitle">Recommended Stack</h2>
      <div id="packages"></div>
      <button id="applyBtn" class="apply-btn" style="display:none;">Apply to Workspace</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const analyzeBtn = document.getElementById('analyzeBtn');
    const promptInput = document.getElementById('prompt');
    const statusDiv = document.getElementById('status');
    const errorDiv = document.getElementById('error');
    const resultDiv = document.getElementById('result');
    const packagesDiv = document.getElementById('packages');
    const applyBtn = document.getElementById('applyBtn');
    
    let currentInstallCommand = '';

    analyzeBtn.addEventListener('click', () => {
      const prompt = promptInput.value.trim();
      if (!prompt) return;
      
      analyzeBtn.disabled = true;
      statusDiv.textContent = 'Starting analysis...';
      errorDiv.style.display = 'none';
      resultDiv.style.display = 'none';
      packagesDiv.innerHTML = '';
      applyBtn.style.display = 'none';
      
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

    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'progress':
          statusDiv.textContent = message.label;
          break;
        case 'error':
          analyzeBtn.disabled = false;
          statusDiv.textContent = '';
          errorDiv.textContent = message.text;
          errorDiv.style.display = 'block';
          break;
        case 'result':
          analyzeBtn.disabled = false;
          statusDiv.textContent = 'Analysis complete!';
          
          const rec = message.result.recommendation;
          let html = '';
          
          rec.categories.forEach(cat => {
            html += '<h3>' + cat.name + '</h3>';
            cat.packages.forEach(pkg => {
              html += '<div class="pkg-row">';
              html += '<div><span class="pkg-name">' + pkg.name + '</span> @' + pkg.version + '</div>';
              html += '<div>' + pkg.reason + '</div>';
              html += '</div>';
            });
          });
          
          if (rec.landmines && rec.landmines.length > 0) {
            html += '<h3 style="color:var(--vscode-editorWarning-foreground);">Landmines</h3>';
            rec.landmines.forEach(mine => {
              html += '<div style="margin-bottom:8px;"><strong>' + mine.trigger + '</strong>: ' + mine.warning + '</div>';
            });
          }
          
          packagesDiv.innerHTML = html;
          resultDiv.style.display = 'block';
          
          if (rec.install_command) {
            currentInstallCommand = rec.install_command;
            applyBtn.style.display = 'inline-block';
            applyBtn.textContent = 'Run: ' + rec.install_command;
          }
          break;
      }
    });
  </script>
</body>
</html>`;
  }
}
