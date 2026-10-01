import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AwsResourceType, GraphModel } from '../types';
import { generateCdkProject } from './generateCdkProject';

function node(id: string, type: AwsResourceType, name = id, config: GraphModel['nodes'][number]['config'] = {}): GraphModel['nodes'][number] {
  return { id, type, name, position: { x: 0, y: 0 }, config };
}

describe('generateCdkProject', () => {
  it('includes the files needed to build a Node.js Lambda scaffold', () => {
    const files = generateCdkProject({ nodes: [node('fn', 'lambda', 'Worker', { entry: 'lambdas/worker/index.ts' })], edges: [] });

    assert.ok(files['tsconfig.json'].includes('compilerOptions'));
    assert.ok(files['lambdas/worker/index.ts'].includes('export async function handler'));
    assert.ok(JSON.parse(files['package.json']).devDependencies.esbuild);
    assert.ok(files['lib/infrastructure-stack.ts'].includes('../lambdas/worker/index.ts'));
  });

  it('generates a permission action without adding an API route', () => {
    const files = generateCdkProject({
      nodes: [node('api', 'apiGateway'), node('fn', 'lambda')],
      edges: [{ id: 'edge', source: 'api', target: 'fn', connectionType: 'permission', cdkAction: 'lambdaInvokePermission' }],
    });

    const stack = files['lib/infrastructure-stack.ts'];
    assert.ok(stack.includes("addPermission('AllowApiGatewayInvoke'"));
    assert.ok(!stack.includes('.addMethod('));
  });

  it('keeps distinct and syntactically valid construct identifiers for duplicate or numeric names', () => {
    const stack = generateCdkProject({
      nodes: [node('one', 's3', '123'), node('two', 's3', '123')],
      edges: [],
    })['lib/infrastructure-stack.ts'];

    assert.match(stack, /const resource123 =/);
    assert.match(stack, /const resource1232 =/);
  });

  it('declares referenced buckets before Lambda environments and only imports used modules', () => {
    const stack = generateCdkProject({
      nodes: [
        node('fn', 'lambda', 'Worker', { envVars: JSON.stringify([{ key: 'BUCKET_NAME', value: 'uploadsBucket.bucketName' }]) }),
        node('bucket', 's3', 'Uploads Bucket'),
      ],
      edges: [],
    })['lib/infrastructure-stack.ts'];

    assert.ok(stack.indexOf('const uploadsBucket =') < stack.indexOf('const worker ='));
    assert.ok(stack.includes('"BUCKET_NAME": uploadsBucket.bucketName'));
    assert.ok(!stack.includes('aws-cdk-lib/aws-apigateway'));
  });

  it('creates shared API path segments only once', () => {
    const stack = generateCdkProject({
      nodes: [node('api', 'apiGateway'), node('one', 'lambda', 'One', { apiPath: '/jobs/new', apiMethod: 'POST' }), node('two', 'lambda', 'Two', { apiPath: '/jobs/status', apiMethod: 'GET' })],
      edges: [
        { id: 'first', source: 'api', target: 'one', connectionType: 'integration', cdkAction: 'lambdaIntegration' },
        { id: 'second', source: 'api', target: 'two', connectionType: 'integration', cdkAction: 'lambdaIntegration' },
      ],
    })['lib/infrastructure-stack.ts'];

    assert.equal(stack.match(/\.addResource\("jobs"\)/g)?.length, 1);
    assert.ok(stack.includes(".addMethod('POST'"));
    assert.ok(stack.includes(".addMethod('GET'"));
  });

  it('includes a script file and deployment when BucketDeployment is selected', () => {
    const files = generateCdkProject({
      nodes: [node('script', 'scriptAsset', 'Processor', { localPath: 'scripts/process-input.sh', s3Key: 'scripts/process-input.sh' }), node('bucket', 's3')],
      edges: [{ id: 'deploy', source: 'script', target: 'bucket', connectionType: 'integration', cdkAction: 'bucketDeployment' }],
    });

    assert.ok(files['scripts/process-input.sh'].includes('TODO'));
    assert.ok(files['lib/infrastructure-stack.ts'].includes('new s3deploy.BucketDeployment'));
  });
});
