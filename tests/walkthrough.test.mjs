import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';

let browser;
let server;
let baseURL;

before(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
  await server.listen();
  baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function step(page, title) {
  await page.locator('.walkthrough-copy').getByRole('heading', { name: title, exact: true }).waitFor();
  // React Flow fits the newly added nodes with a short viewport animation.
  await page.waitForTimeout(400);
}

async function add(page, type) {
  await page.getByRole('button', { name: 'Add component', exact: true }).click();
  await page.locator(`[data-resource="${type}"]`).click();
}

async function drag(page, source, target) {
  const from = await page.locator(source).boundingBox();
  const to = await page.locator(target).boundingBox();
  assert.ok(from && to);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
}

const handle = (id, side) => `.react-flow__node[data-id="practice-${id}"] [data-handleid="${side}-source"]`;

async function buildPractice(page) {
  await page.getByRole('button', { name: 'Default project Guided practice' }).click();
  await step(page, 'Build your first CDK project');
  await page.getByRole('button', { name: 'Start building' }).click();
  await step(page, 'Add an API Gateway');
  await add(page, 'apiGateway');
  await step(page, 'Add the Lambda');
  await add(page, 'lambda');
  await step(page, 'Add an S3 bucket');
  await add(page, 's3');
  await step(page, 'Arrange the board');

  const bucket = await page.locator('.react-flow__node[data-id="practice-bucket"]').boundingBox();
  await page.mouse.move(bucket.x + bucket.width / 2, bucket.y + bucket.height / 2);
  await page.mouse.down();
  await page.mouse.move(bucket.x + bucket.width / 2, bucket.y + bucket.height / 2 + 60, { steps: 12 });
  await page.mouse.up();
  await step(page, 'Send API requests to Lambda');

  await drag(page, handle('api', 'right'), handle('bucket', 'left'));
  assert.equal(await page.locator('.react-flow__edge').count(), 0, 'wrong destination must not create an edge');
  await drag(page, handle('api', 'right'), handle('lambda', 'left'));
  await step(page, 'Inspect the Lambda');
  await page.locator('.react-flow__node[data-id="practice-lambda"]').click();
  await step(page, 'Choose the API route');
  assert.equal(await page.getByRole('button', { name: 'Use this route' }).isDisabled(), true);
  await page.locator('[data-tour="field-apiPath"] input').fill('/upload-url');
  await page.getByRole('button', { name: 'Use this route' }).click();
  await step(page, 'Give Lambda access to S3');
  await drag(page, handle('lambda', 'right'), handle('bucket', 'left'));
  await step(page, 'Inspect the permission');

  const point = await page.locator('[data-id="practice-permission"] .react-flow__edge-interaction').evaluate((path) => {
    const midpoint = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = new DOMPoint(midpoint.x, midpoint.y).matrixTransform(path.getScreenCTM());
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(point.x, point.y);
  await step(page, 'Allow uploads with grantPut');
  // Keep the default untouched: reselecting it does not emit a native change event.
  assert.equal(await page.locator('[data-tour="cdk-action"] select').inputValue(), 'grantPut');
  assert.equal(await page.getByRole('button', { name: 'Use grantPut', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: 'Use grantPut', exact: true }).click();
  await step(page, 'Check the relationships');
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await step(page, 'Read the validation result');
  assert.match(await page.locator('.validation-header').textContent(), /0 errors.*0 warnings/);
  await page.getByRole('button', { name: 'Continue to export' }).click();
  await step(page, 'Generate the CDK files');
  await page.getByRole('button', { name: 'Generate CDK', exact: true }).click();
  await step(page, 'Your first scaffold is ready');
  await page.getByRole('button', { name: 'lib/infrastructure-stack.ts', exact: true }).click();
  const code = await page.locator('.code-view').textContent();
  assert.match(code, /uploadsBucket\.grantPut\(uploadHandler\)/);
  assert.match(code, /LambdaIntegration/);
  assert.match(code, /upload-url/);
}

test('guided project completes, restores the draft, and starts fresh next time', { timeout: 45000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(baseURL);
    await add(page, 'sqs');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('infracanvas.draft.v1')).nodes.length === 1);
    const draft = await page.evaluate(() => localStorage.getItem('infracanvas.draft.v1'));
    await buildPractice(page);
    assert.equal(await page.evaluate(() => localStorage.getItem('infracanvas.draft.v1')), draft);
    await page.getByRole('button', { name: 'Close modal', exact: true }).click();
    assert.equal(await page.locator('.walkthrough-coach').count(), 0);
    assert.equal(await page.locator('.react-flow__node').count(), 1);
    assert.match(await page.locator('.react-flow__node').textContent(), /SQS/);
    await page.getByRole('button', { name: 'Default project Guided practice' }).click();
    await step(page, 'Build your first CDK project');
    assert.equal(await page.locator('.react-flow__node').count(), 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+z');
    assert.equal(await page.locator('.react-flow__node').count(), 0, 'original undo history is preserved');
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: '/tmp/infracanvas-walkthrough-failure.png' });
    throw error;
  } finally { await page.close(); }
});

test('off-step clicks and keyboard actions are blocked; refresh restores the original draft', { timeout: 20000 }, async () => {
  const page = await browser.newPage();
  try {
    await page.goto(baseURL);
    await add(page, 'sqs');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('infracanvas.draft.v1')).nodes.length === 1);
    const draft = await page.evaluate(() => localStorage.getItem('infracanvas.draft.v1'));
    await page.getByRole('button', { name: 'Default project Guided practice' }).click();
    await step(page, 'Build your first CDK project');
    await page.getByRole('button', { name: 'Generate CDK', exact: true }).click();
    await page.getByRole('button', { name: 'New board', exact: true }).click();
    await page.keyboard.press('Meta+z');
    assert.equal(await page.locator('.code-modal').count(), 0);
    await page.getByRole('button', { name: 'Start building' }).click();
    await page.getByRole('button', { name: 'Add component', exact: true }).click();
    assert.equal(await page.locator('[data-resource="lambda"]').isDisabled(), true);
    await page.locator('[data-resource="apiGateway"]').click();
    await step(page, 'Add the Lambda');
    await page.keyboard.press('Delete');
    assert.equal(await page.locator('.react-flow__node').count(), 1);
    await page.reload();
    await page.locator('.react-flow__node').waitFor();
    assert.equal(await page.locator('.walkthrough-coach').count(), 0);
    assert.match(await page.locator('.react-flow__node').textContent(), /SQS/);
    assert.equal(await page.evaluate(() => localStorage.getItem('infracanvas.draft.v1')), draft);
  } finally { await page.close(); }
});

test('walkthrough can be completed on a narrow screen', { timeout: 45000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(baseURL);
    await buildPractice(page);
    assert.equal(await page.evaluate(() => document.body.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Finish & reset' }).click();
    assert.equal(await page.locator('.react-flow__node').count(), 0);
  } catch (error) {
    await page.screenshot({ path: '/tmp/infracanvas-walkthrough-mobile-failure.png' });
    throw error;
  } finally { await page.close(); }
});
