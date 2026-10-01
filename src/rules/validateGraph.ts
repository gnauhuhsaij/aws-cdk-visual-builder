import { findRule } from './awsRules';
import { getCdkActionOptions, getDefaultConnectionType } from './cdkActions';
import type { GraphModel, ValidationIssue } from '../types';

export function validateGraph(graph: GraphModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  function roleGrantForEc2Resource(ec2Id: string, resourceId: string, requestedAction?: string) {
    const resourceType = nodesById.get(resourceId)?.type;
    const requested = resourceType === 's3'
      ? ({
          grantReadWriteToInstanceRole: ['read', 'write'],
          grantReadToInstanceRole: ['read'],
          grantPutToInstanceRole: ['write'],
          grantWriteToInstanceRole: ['write'],
        } as Record<string, string[]>)[requestedAction || 'grantReadWriteToInstanceRole']
      : ({
          grantReadWriteDataToInstanceRole: ['read', 'write'],
          grantReadDataToInstanceRole: ['read'],
          grantWriteDataToInstanceRole: ['write'],
        } as Record<string, string[]>)[requestedAction || 'grantReadWriteDataToInstanceRole'];
    if (!requested) return undefined;

    const attachedRoleEdges = graph.edges.filter((edge) => {
      const source = nodesById.get(edge.source);
      return source?.type === 'iamRole' && source.config.includeInstanceProfile !== 'false' && edge.target === ec2Id
        && edge.connectionType === 'permission' && (!edge.cdkAction || edge.cdkAction === 'instanceProfile');
    });

    const grantEdge = attachedRoleEdges
      .map((roleEdge) => {
        const role = nodesById.get(roleEdge.source);
        const grants = graph.edges.filter(
          (edge) => edge.source === roleEdge.source && edge.target === resourceId && edge.connectionType === 'permission',
        );
        const covered = new Set<string>();
        grants.forEach((grant) => {
          const action = grant.cdkAction || (resourceType === 's3' ? 'grantReadWriteToRole' : 'grantReadWriteDataToRole');
          if (action === 'grantReadWriteToRole' || action === 'grantReadWriteDataToRole') {
            covered.add('read');
            covered.add('write');
          } else if (action === 'grantReadToRole' || action === 'grantReadDataToRole') {
            covered.add('read');
          } else if (action === 'grantPutToRole' || action === 'grantWriteToRole' || action === 'grantWriteDataToRole') {
            covered.add('write');
          }
        });
        return role && requested.every((permission) => covered.has(permission)) ? { role } : undefined;
      })
      .find(Boolean);

    return grantEdge;
  }

  function hasAttachedEc2Role(ec2Id: string) {
    return graph.edges.some((edge) => {
      const source = nodesById.get(edge.source);
      return source?.type === 'iamRole' && source.config.includeInstanceProfile !== 'false'
        && edge.target === ec2Id && edge.connectionType === 'permission'
        && (!edge.cdkAction || edge.cdkAction === 'instanceProfile');
    });
  }

  graph.edges.forEach((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);

    if (source?.type === 'textBoard' || target?.type === 'textBoard') return;

    if (!source || !target) {
      issues.push({
        id: `missing-${edge.id}`,
        edgeId: edge.id,
        severity: 'error',
        valid: false,
        message: 'Connection references a resource that no longer exists.',
      });
      return;
    }

    const rule = findRule(source.type, target.type);

    if (rule?.valid) {
      const pairActions = getCdkActionOptions(source.type, target.type);
      const allowedActions = getCdkActionOptions(source.type, target.type, edge.connectionType);
      const supportedType = pairActions.length ? allowedActions.length > 0
        : edge.connectionType === getDefaultConnectionType(source.type, target.type);
      if (!supportedType || (edge.cdkAction && !allowedActions.some((action) => action.value === edge.cdkAction))) {
        issues.push({
          id: `unsupported-action-${edge.id}`,
          edgeId: edge.id,
          sourceId: source.id,
          targetId: target.id,
          severity: 'warning',
          valid: false,
          message: `${source.name} -> ${target.name}: this connection type or CDK action is not modeled for these resources.`,
          cdkHint: rule.cdkHint,
        });
        return;
      }
      if (['executeApiInvokePolicy', 'restApiDefaultIntegration', 'passRoleTarget', 'dynamoEventSourceWithFilter'].includes(edge.cdkAction || '')) {
        issues.push({
          id: `manual-action-${edge.id}`,
          edgeId: edge.id,
          sourceId: source.id,
          targetId: target.id,
          severity: 'warning',
          valid: true,
          message: `${source.name} -> ${target.name}: this CDK action needs additional inputs or manual code after export.`,
          cdkHint: rule.cdkHint,
        });
        return;
      }
    }

    if (source.type === 'dynamodb' && target.type === 'lambda' && source.config.stream === 'DISABLED') {
      issues.push({
        id: `disabled-stream-${edge.id}`,
        edgeId: edge.id,
        sourceId: source.id,
        targetId: target.id,
        severity: 'error',
        valid: false,
        message: `${source.name} cannot trigger ${target.name} because DynamoDB Streams are disabled.`,
        cdkHint: 'Enable NEW_IMAGE or NEW_AND_OLD_IMAGES on the table.',
      });
      return;
    }

    if (source.type === 'ec2' && (target.type === 's3' || target.type === 'dynamodb')) {
      const satisfiedGrant = roleGrantForEc2Resource(source.id, target.id, edge.cdkAction);
      if (satisfiedGrant) {
        const cdkHint = target.type === 's3' ? 'bucket.grantReadWrite(role)' : 'table.grantReadWriteData(role)';
        issues.push({
          id: `role-satisfied-${edge.id}`,
          edgeId: edge.id,
          sourceId: source.id,
          targetId: target.id,
          severity: 'info',
          valid: true,
          message: `${source.name} -> ${target.name}: access is satisfied by ${satisfiedGrant.role.name}'s permission grant to ${target.name}.`,
          cdkHint,
        });
        return;
      }
    }

    if (((source.type === 'ec2' && target.type === 'lambda') || (source.type === 'lambda' && target.type === 'ec2')) && edge.connectionType === 'permission') {
      const ec2Node = source.type === 'ec2' ? source : target;
      if (!hasAttachedEc2Role(ec2Node.id)) {
        issues.push({
          id: `missing-ec2-role-${edge.id}`,
          edgeId: edge.id,
          sourceId: source.id,
          targetId: target.id,
          severity: 'warning',
          valid: true,
          message: `${ec2Node.name} is launched or managed by Lambda, but no IAM Role/Profile is attached to the EC2 node. Add IAM Role/Profile -> ${ec2Node.name} so the VM can receive runtime permissions.`,
          cdkHint: 'new iam.InstanceProfile(this, "Profile", { role })',
          requiredPermission: 'EC2 needs an instance profile for S3/DynamoDB access and other runtime permissions.',
        });
      }
    }

    if (!rule) {
      issues.push({
        id: `unsupported-${edge.id}`,
        edgeId: edge.id,
        sourceId: source.id,
        targetId: target.id,
        severity: 'warning',
        valid: false,
        message: `${source.name} to ${target.name} is not modeled by the current rules engine.`,
        cdkHint: 'Add a custom rule or insert an intermediate service.',
      });
      return;
    }

    issues.push({
      id: `rule-${edge.id}`,
      edgeId: edge.id,
      sourceId: source.id,
      targetId: target.id,
      severity: rule.severity,
      valid: rule.valid,
      message: `${source.name} -> ${target.name}: ${rule.message}`,
      cdkHint: rule.cdkHint,
      requiredPermission: rule.requiredPermission,
    });
  });

  const apiRoutes = new Set<string>();
  graph.edges.forEach((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (source?.type !== 'apiGateway' || target?.type !== 'lambda' || edge.connectionType !== 'integration') return;
    const path = `/${String(target.config.apiPath || '/').split('/').filter(Boolean).join('/')}`;
    const method = String(target.config.apiMethod || 'POST').toUpperCase();
    const routeKey = `${source.id}:${method}:${path}`;
    if (apiRoutes.has(routeKey)) {
      issues.push({
        id: `duplicate-route-${edge.id}`,
        edgeId: edge.id,
        sourceId: source.id,
        targetId: target.id,
        severity: 'error',
        valid: false,
        message: `${source.name} already has a ${method} ${path} integration. Give this Lambda a different method or path.`,
      });
    }
    apiRoutes.add(routeKey);
  });

  graph.nodes.forEach((node) => {
    const outgoing = graph.edges.some((edge) => edge.source === node.id);
    const incoming = graph.edges.some((edge) => edge.target === node.id);

    if (node.type === 'apiGateway' && !graph.edges.some((edge) => edge.source === node.id && edge.connectionType === 'integration')) {
      issues.push({
        id: `api-${node.id}`,
        sourceId: node.id,
        severity: 'warning',
        valid: false,
        message: `${node.name} is not connected to a backend integration.`,
        cdkHint: 'Connect API Gateway to a Lambda function.',
      });
    }

    if (node.type === 'lambda' && !incoming && !outgoing) {
      issues.push({
        id: `lambda-${node.id}`,
        sourceId: node.id,
        severity: 'info',
        valid: true,
        message: `${node.name} has no triggers or permissions yet.`,
        cdkHint: 'Connect a trigger source or grant this function access to another resource.',
      });
    }

    if (node.type === 'lambda' && node.config.runtime && !String(node.config.runtime).startsWith('nodejs')) {
      issues.push({
        id: `runtime-${node.id}`,
        sourceId: node.id,
        severity: 'warning',
        valid: false,
        message: `${node.name} uses ${node.config.runtime}; this scaffold generates NodejsFunction handlers only.`,
        cdkHint: 'Use a Node.js runtime or replace the generated Lambda construct and handler yourself.',
      });
    }

    if (node.type === 'apiGateway' && node.config.apiType === 'HTTP') {
      issues.push({
        id: `api-type-${node.id}`,
        sourceId: node.id,
        severity: 'warning',
        valid: false,
        message: `${node.name} is configured as an HTTP API, but the generator currently emits a REST API.`,
        cdkHint: 'Use REST or replace the generated construct with aws-apigatewayv2.',
      });
    }
  });

  if (graph.nodes.length === 0) {
    issues.push({
      id: 'empty-canvas',
      severity: 'info',
      valid: true,
      message: 'Drag AWS resources onto the canvas to start modeling infrastructure.',
    });
  }

  return issues;
}
