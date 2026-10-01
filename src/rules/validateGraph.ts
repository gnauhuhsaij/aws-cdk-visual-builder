import { findRule } from './awsRules';
import type { GraphModel, ValidationIssue } from '../types';

export function validateGraph(graph: GraphModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  function roleGrantForEc2Resource(ec2Id: string, resourceId: string) {
    const attachedRoleEdges = graph.edges.filter((edge) => {
      const source = nodesById.get(edge.source);
      return source?.type === 'iamRole' && edge.target === ec2Id;
    });

    const grantEdge = attachedRoleEdges
      .map((roleEdge) => {
        const role = nodesById.get(roleEdge.source);
        const grant = graph.edges.find(
          (edge) => edge.source === roleEdge.source && edge.target === resourceId && edge.connectionType === 'permission',
        );
        return grant && role ? { role, grant } : undefined;
      })
      .find(Boolean);

    return grantEdge;
  }

  function hasAttachedEc2Role(ec2Id: string) {
    return graph.edges.some((edge) => {
      const source = nodesById.get(edge.source);
      return source?.type === 'iamRole' && edge.target === ec2Id && edge.connectionType === 'permission';
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

    if (source.type === 'ec2' && (target.type === 's3' || target.type === 'dynamodb')) {
      const satisfiedGrant = roleGrantForEc2Resource(source.id, target.id);
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

  graph.nodes.forEach((node) => {
    const outgoing = graph.edges.some((edge) => edge.source === node.id);
    const incoming = graph.edges.some((edge) => edge.target === node.id);

    if (node.type === 'apiGateway' && !outgoing) {
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
