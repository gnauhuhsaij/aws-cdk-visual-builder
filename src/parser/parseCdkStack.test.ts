import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCdkStack } from './parseCdkStack';

describe('parseCdkStack', () => {
  it('keeps the specific grant actions when importing a stack', () => {
    const source = `
      const uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {});
      const role = new iam.Role(this, 'WorkerRole', { assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com') });
      const worker = new lambdaNodejs.NodejsFunction(this, 'Worker', { entry: path.join(__dirname, '../lambdas/worker/index.ts') });
      uploadsBucket.grantRead(role);
      uploadsBucket.grantPut(worker);
    `;
    const graph = parseCdkStack(source);

    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.find((edge) => edge.source === 'role' && edge.target === 'uploadsBucket')?.data?.cdkAction, 'grantReadToRole');
    assert.equal(graph.edges.find((edge) => edge.source === 'worker' && edge.target === 'uploadsBucket')?.data?.cdkAction, 'grantPut');
  });

  it('does not invent a DynamoDB stream when one is absent', () => {
    const graph = parseCdkStack(`const table = new dynamodb.Table(this, 'FileTable', { partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING } });`);
    assert.equal(graph.nodes.find((node) => node.id === 'table')?.data.config.stream, 'DISABLED');
  });

  it('attaches only the role named by an instance profile', () => {
    const source = `
      const workerRole = new iam.Role(this, 'WorkerRole', {});
      const unrelatedRole = new iam.Role(this, 'UnrelatedRole', {});
      const workerProfile = new iam.InstanceProfile(this, 'WorkerProfile', { role: workerRole });
      const launcher = new lambdaNodejs.NodejsFunction(this, 'LaunchInstance', { entry: path.join(__dirname, '../lambdas/launch/index.ts') });
      launcher.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:RunInstances'], resources: ['*'] }));
    `;
    const graph = parseCdkStack(source);
    const vm = graph.nodes.find((node) => node.data.resourceType === 'ec2');

    assert.ok(vm);
    assert.equal(graph.edges.some((edge) => edge.source === 'workerRole' && edge.target === vm.id), true);
    assert.equal(graph.edges.some((edge) => edge.source === 'unrelatedRole' && edge.target === vm.id), false);
  });
});
