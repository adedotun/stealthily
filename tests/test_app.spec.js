const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('GhostMind E2E Tests', () => {
  let electronApp;

  test.beforeEach(async () => {
    // Launch the Electron app
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../src/main/index.js'), '--test'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    // Pipe process streams to console
    electronApp.process().stdout.on('data', data => console.log(`[Electron STDOUT] ${data.toString().trim()}`));
    electronApp.process().stderr.on('data', data => console.error(`[Electron STDERR] ${data.toString().trim()}`));
  });

  test.afterEach(async () => {
    if (electronApp) {
      try {
        electronApp.process().kill('SIGKILL');
      } catch (_) {}
    }
  });

  // Helper function to get the main GhostMind window without race conditions
  async function getMainWindow(app) {
    const windows = app.windows();
    if (windows.length > 0) {
      const win = windows[0];
      await win.waitForLoadState('domcontentloaded');
      return win;
    }
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    return win;
  }

  test('Main window should launch and render the GhostMind UI', async () => {
    const window = await getMainWindow(electronApp);

    // Verify window title
    const title = await window.title();
    expect(title).toBe('GhostMind');

    // Verify logo and version are displayed
    const logoName = window.locator('#logo-name');
    await expect(logoName).toHaveText('GhostMind');

    const logoVersion = window.locator('#logo-version');
    await expect(logoVersion).toHaveText('v2.0');
  });

  test('Preload script should expose the ghostmind API securely', async () => {
    const window = await getMainWindow(electronApp);
    const hasGhostmindAPI = await window.evaluate(() => typeof window.ghostmind !== 'undefined');
    expect(hasGhostmindAPI).toBe(true);

    const apiMethods = await window.evaluate(() => Object.keys(window.ghostmind));
    expect(apiMethods).toContain('getSettings');
    expect(apiMethods).toContain('saveSettings');
    expect(apiMethods).toContain('sendAIRequest');
  });

  test('Should route AI requests through main process and return response', async () => {
    const window = await getMainWindow(electronApp);

    // Mock the main process global.fetch for Anthropic API
    await electronApp.evaluate(() => {
      global.fetch = async (url, options) => {
        if (url.includes('api.anthropic.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'msg_mock123',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'Hello, this is a response from Claude!' }]
            })
          };
        }
        return { ok: false, status: 404, text: async () => 'Not Found' };
      };
    });

    // Configure setting API key
    await window.evaluate(async () => {
      const settings = await window.ghostmind.getSettings();
      settings.apiKey = 'sk-ant-testkey';
      await window.ghostmind.saveSettings(settings);
    });

    // Make an AI request using the exposed preload API
    const response = await window.evaluate(async () => {
      return await window.ghostmind.sendAIRequest({
        messages: [{ role: 'user', content: 'Say hello!' }],
        model: 'claude-sonnet-4-5-20250929',
        systemPrompt: 'Test prompt',
        maxTokens: 50
      });
    });

    expect(response.content[0].text).toBe('Hello, this is a response from Claude!');
  });

  test('Should handle API errors gracefully in the IPC bridge', async () => {
    const window = await getMainWindow(electronApp);

    // Mock the main process global.fetch to return an error
    await electronApp.evaluate(() => {
      global.fetch = async (url, options) => {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: { message: 'Invalid API Key' }
          })
        };
      };
    });

    // Configure setting API key
    await window.evaluate(async () => {
      const settings = await window.ghostmind.getSettings();
      settings.apiKey = 'sk-ant-invalid';
      await window.ghostmind.saveSettings(settings);
    });

    // Verify sendAIRequest propagates the error message properly
    const errorMsg = await window.evaluate(async () => {
      try {
        await window.ghostmind.sendAIRequest({
          messages: [{ role: 'user', content: 'Say hello!' }],
          model: 'claude-sonnet-4-5-20250929'
        });
        return 'success';
      } catch (e) {
        return e.message;
      }
    });

    expect(errorMsg).toContain('Invalid API Key');
  });
});
