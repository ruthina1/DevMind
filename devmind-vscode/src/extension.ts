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
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevMind</title>
  <style>
    /* Linear Design System Tokens */
    :root {
      --colors-primary: #5e6ad2;
      --colors-primary-hover: #828fff;
      --colors-on-primary: #ffffff;
      --colors-ink: #f7f8f8;
      --colors-ink-muted: #d0d6e0;
      --colors-ink-subtle: #8a8f98;
      --colors-canvas: #010102;
      --colors-surface-1: #0f1011;
      --colors-surface-2: #141516;
      --colors-hairline: #23252a;
      --colors-hairline-strong: #34343a;
      --colors-semantic-success: #27a644;
      --colors-semantic-error: #e5484d;
      
      --font-sans: "Inter", -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: "ui-monospace", "SF Mono", "Menlo", monospace;
    }

    body {
      padding: 0;
      margin: 0;
      background-color: var(--colors-canvas);
      color: var(--colors-ink);
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
      line-height: 1.5;
    }
    
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 48px 24px;
    }

    h1, h2, h3 {
      font-family: var(--font-sans);
      color: var(--colors-ink);
      margin: 0;
    }

    .header {
      margin-bottom: 48px;
    }
    .header h1 {
      font-size: 40px;
      font-weight: 600;
      letter-spacing: -1.0px;
      line-height: 1.15;
      margin-bottom: 12px;
    }
    .header p {
      font-size: 18px;
      color: var(--colors-ink-muted);
      letter-spacing: -0.1px;
      margin: 0;
      max-width: 600px;
    }

    .input-section {
      background-color: var(--colors-surface-1);
      border: 1px solid var(--colors-hairline);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 48px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    textarea {
      width: 100%;
      min-height: 80px;
      background-color: var(--colors-surface-2);
      border: 1px solid var(--colors-hairline-strong);
      border-radius: 8px;
      padding: 12px 16px;
      color: var(--colors-ink);
      font-family: var(--font-sans);
      font-size: 16px;
      resize: vertical;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    textarea:focus {
      border-color: var(--colors-primary);
      box-shadow: 0 0 0 2px rgba(94, 106, 210, 0.2);
    }
    textarea::placeholder {
      color: var(--colors-ink-subtle);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background-color: var(--colors-surface-2);
      color: var(--colors-ink);
      border: 1px solid var(--colors-hairline-strong);
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 14px;
      font-weight: 500;
      font-family: var(--font-sans);
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .btn:hover {
      background-color: var(--colors-hairline);
    }
    .btn-primary {
      background-color: var(--colors-primary);
      color: var(--colors-on-primary);
      border: none;
    }
    .btn-primary:hover {
      background-color: var(--colors-primary-hover);
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    #statusContainer {
      display: none;
      align-items: center;
      gap: 12px;
      padding: 16px 24px;
      background-color: var(--colors-surface-1);
      border: 1px solid var(--colors-hairline);
      border-radius: 8px;
      margin-bottom: 48px;
    }
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--colors-hairline-strong);
      border-top-color: var(--colors-primary);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { 100% { transform: rotate(360deg); } }
    #statusText {
      font-size: 14px;
      font-weight: 500;
      color: var(--colors-ink);
    }

    #errorContainer {
      display: none;
      padding: 16px 24px;
      background-color: rgba(229, 72, 77, 0.1);
      border: 1px solid rgba(229, 72, 77, 0.2);
      color: var(--colors-semantic-error);
      border-radius: 8px;
      margin-bottom: 48px;
      font-size: 14px;
    }

    #resultContainer { display: none; }

    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--colors-hairline);
      padding-bottom: 16px;
    }
    .tab {
      background: transparent;
      border: none;
      color: var(--colors-ink-subtle);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      padding: 6px 14px;
      border-radius: 9999px;
      transition: all 0.2s;
    }
    .tab.active {
      background-color: var(--colors-surface-2);
      color: var(--colors-ink);
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .category-card {
      margin-bottom: 32px;
    }
    .category-card h3 {
      font-size: 13px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--colors-ink-subtle);
      margin-bottom: 16px;
    }

    .package-row {
      background-color: var(--colors-surface-1);
      border: 1px solid var(--colors-hairline);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .package-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .package-name {
      font-size: 16px;
      font-weight: 500;
      color: var(--colors-ink);
    }
    .badges {
      display: flex;
      gap: 8px;
    }
    .badge {
      background-color: var(--colors-surface-2);
      color: var(--colors-ink-muted);
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 9999px;
      font-family: var(--font-mono);
    }
    .package-reason {
      font-size: 14px;
      color: var(--colors-ink-muted);
      line-height: 1.5;
    }

    .landmine-card {
      background-color: var(--colors-surface-1);
      border: 1px solid var(--colors-hairline);
      border-left: 3px solid #ff9f0a;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .landmine-trigger {
      font-size: 16px;
      font-weight: 500;
      color: var(--colors-ink);
      margin-bottom: 8px;
    }
    .landmine-warning {
      font-size: 14px;
      color: var(--colors-ink-muted);
    }

    .cta-banner {
      background-color: var(--colors-surface-1);
      border: 1px solid var(--colors-hairline);
      border-radius: 12px;
      padding: 48px;
      text-align: center;
      margin-top: 64px;
    }
    .cta-banner h3 {
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.6px;
      margin-bottom: 16px;
    }
    .cta-banner p {
      color: var(--colors-ink-muted);
      font-size: 16px;
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>DevMind Intelligence</h1>
      <p>Describe your project idea and get a conflict-free, pinned dependency stack generated in seconds.</p>
    </div>

    <div class="input-section">
      <textarea id="prompt" placeholder="e.g. realtime collaborative notes app with auth and postgres"></textarea>
      <div>
        <button id="analyzeBtn" class="btn btn-primary">Generate Stack</button>
      </div>
    </div>

    <div id="statusContainer">
      <div class="spinner"></div>
      <div id="statusText">Starting analysis...</div>
    </div>

    <div id="errorContainer"></div>

    <div id="resultContainer">
      <div class="tabs">
        <button class="tab active" data-target="view-1">Recommended Stack</button>
        <button class="tab" data-target="view-2">Landmines</button>
      </div>
      
      <div id="view-1" class="tab-content active">
        <div id="stackCategories"></div>
        
        <div class="cta-banner">
          <h3>Ready to build?</h3>
          <p>Instantly add these dependencies to your active workspace.</p>
          <button id="applyBtn" class="btn btn-primary" style="display:none;">Apply to Workspace</button>
        </div>
      </div>
      
      <div id="view-2" class="tab-content">
        <div id="landminesContainer">
          <p style="color: var(--colors-ink-subtle);">No landmines detected for this stack.</p>
        </div>
      </div>
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
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    let currentInstallCommand = '';

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.target).classList.add('active');
      });
    });

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
              html += '<div class="package-name">' + pkg.name + '</div>';
              html += '<div class="badges">';
              html += '<span class="badge">v' + pkg.version + '</span>';
              if (pkg.weekly_downloads) {
                html += '<span class="badge">' + formatDownloads(pkg.weekly_downloads) + '</span>';
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
              lmHtml += '<div class="landmine-trigger">' + mine.trigger + '</div>';
              lmHtml += '<div class="landmine-warning">' + mine.warning + '</div>';
              lmHtml += '</div>';
            });
            landminesContainer.innerHTML = lmHtml;
          } else {
            landminesContainer.innerHTML = '<p style="color: var(--colors-ink-subtle);">No landmines detected for this stack.</p>';
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
