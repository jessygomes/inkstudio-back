// Run after preview-emails.ts. Local Chromium checks only; never sends email.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const WebSocket = require('ws');

async function main() {
  const directory = path.resolve('.tmp/email-previews');
  const profile = fs.mkdtempSync(path.resolve('.tmp/email-preview-chrome-'));
  const browser = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((file) => fs.existsSync(file));
  if (!browser)
    throw new Error('Chrome or Edge is required for the visual check.');
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  const keepAlive = setInterval(() => {}, 1000);
  let socket;
  try {
    let port;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        port = Number(
          fs
            .readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8')
            .split('\n')[0],
        );
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!port) throw new Error('Browser debugging endpoint did not start.');
    const targets = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    const target = targets.find((item) => item.type === 'page');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
      const response = JSON.parse(event.data);
      if (pending.has(response.id)) {
        const callback = pending.get(response.id);
        pending.delete(response.id);
        response.error
          ? callback.reject(response.error)
          : callback.resolve(response.result);
      }
    };
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timeout = setTimeout(
          () => reject(new Error(`Timed out: ${method}`)),
          15000,
        );
        pending.set(requestId, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    }
    await send('Page.enable');
    const results = [];
    const files = fs
      .readdirSync(directory)
      .filter((file) => file.endsWith('.html') && file !== 'index.html');
    for (const width of [375, 900]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });
      for (const file of files) {
        await send('Page.navigate', {
          url: pathToFileURL(path.join(directory, file)).href,
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        const result = await send('Runtime.evaluate', {
          expression: `(async()=>{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,1000))]);return {width:innerWidth,scroll:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,buttons:[...document.querySelectorAll('.cta-button')].map(a=>({height:a.getBoundingClientRect().height,width:a.getBoundingClientRect().width})),text:document.body.innerText.includes('Inkera Studio')}})()`,
          awaitPromise: true,
          returnByValue: true,
        });
        const metrics = result.result.value;
        if (
          !metrics ||
          metrics.scroll > width ||
          !metrics.text ||
          metrics.buttons.some(
            (button) => button.height < 44 || button.width > width,
          )
        )
          throw new Error(`${file} at ${width}px: ${JSON.stringify(metrics)}`);
        results.push({ file, viewport: width, ...metrics });
        if (
          [
            'email-verification.html',
            'appointment-confirmation.html',
            'message-notification.html',
          ].includes(file)
        ) {
          const screenshot = await send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height: metrics.height, scale: 1 },
          });
          fs.writeFileSync(
            path.join(directory, `${file.replace('.html', '')}-${width}.png`),
            Buffer.from(screenshot.data, 'base64'),
          );
        }
      }
    }
    fs.writeFileSync(
      path.join(directory, 'browser-checks.json'),
      JSON.stringify(results, null, 2),
    );
    console.log(
      `${results.length} checks passed: ${files.length} emails, mobile 375px and desktop 900px. Screenshots saved in ${directory}`,
    );
    await send('Browser.close');
  } finally {
    clearInterval(keepAlive);
    if (socket) socket.close();
    child.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
