import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AwsResourceType, GraphModel } from '../types';
import { validateGraph } from './validateGraph';

function node(id: string, type: AwsResourceType, config: GraphModel['nodes'][number]['config'] = {}): GraphModel['nodes'][number] {
  return { id, type, name: id, position: { x: 0, y: 0 }, config };
}

function edge(id: string, source: string, target: string, connectionType: string, cdkAction?: string): GraphModel['edges'][number] {
  return { id, source, target, connectionType, cdkAction };
}

describe('validateGraph', () => {
  it('rejects a connection type that has no mapping for the resource pair', () => {
    const graph = {
      nodes: [node('api', 'apiGateway'), node('fn', 'lambda')],
      edges: [edge('api-fn', 'api', 'fn', 'network')],
    };

    const issue = validateGraph(graph).find((item) => item.edgeId === 'api-fn');
    assert.equal(issue?.valid, false);
    assert.equal(issue?.severity, 'warning');
  });

  it('rejects a DynamoDB trigger when streams are disabled', () => {
    const graph = {
      nodes: [node('table', 'dynamodb', { stream: 'DISABLED' }), node('fn', 'lambda')],
      edges: [edge('stream', 'table', 'fn', 'trigger', 'dynamoEventSource')],
    };

    const issue = validateGraph(graph).find((item) => item.edgeId === 'stream');
    assert.equal(issue?.valid, false);
    assert.equal(issue?.severity, 'error');
  });

  it('does not count a read-only role grant as read/write access for EC2', () => {
    const graph = {
      nodes: [node('role', 'iamRole'), node('vm', 'ec2'), node('bucket', 's3')],
      edges: [
        edge('attach', 'role', 'vm', 'permission', 'instanceProfile'),
        edge('read', 'role', 'bucket', 'permission', 'grantReadToRole'),
        edge('vm-bucket', 'vm', 'bucket', 'permission', 'grantReadWriteToInstanceRole'),
      ],
    };

    assert.equal(validateGraph(graph).find((issue) => issue.edgeId === 'vm-bucket')?.severity, 'warning');
  });

  it('accepts the same EC2 access when the attached role has a matching grant', () => {
    const graph = {
      nodes: [node('role', 'iamRole'), node('vm', 'ec2'), node('bucket', 's3')],
      edges: [
        edge('attach', 'role', 'vm', 'permission', 'instanceProfile'),
        edge('write', 'role', 'bucket', 'permission', 'grantReadWriteToRole'),
        edge('vm-bucket', 'vm', 'bucket', 'permission', 'grantReadWriteToInstanceRole'),
      ],
    };

    const issue = validateGraph(graph).find((item) => item.edgeId === 'vm-bucket');
    assert.equal(issue?.severity, 'info');
    assert.equal(issue?.valid, true);
  });

  it('warns when a Lambda runtime cannot be scaffolded by NodejsFunction', () => {
    assert.equal(validateGraph({ nodes: [node('fn', 'lambda', { runtime: 'python3.12' })], edges: [] })
      .find((issue) => issue.id === 'runtime-fn')?.severity, 'warning');
  });

  it('warns about duplicate API method and path mappings', () => {
    const graph = {
      nodes: [node('api', 'apiGateway'), node('one', 'lambda', { apiPath: '/submit', apiMethod: 'POST' }), node('two', 'lambda', { apiPath: '/submit', apiMethod: 'POST' })],
      edges: [edge('first', 'api', 'one', 'integration'), edge('second', 'api', 'two', 'integration')],
    };

    const issue = validateGraph(graph).find((item) => item.id === 'duplicate-route-second');
    assert.equal(issue?.severity, 'error');
    assert.equal(issue?.valid, false);
  });

  it('does not treat invoke permission alone as a backend API integration', () => {
    const graph = {
      nodes: [node('api', 'apiGateway'), node('fn', 'lambda')],
      edges: [edge('invoke', 'api', 'fn', 'permission', 'lambdaInvokePermission')],
    };

    assert.equal(validateGraph(graph).find((issue) => issue.id === 'api-api')?.severity, 'warning');
  });
});
