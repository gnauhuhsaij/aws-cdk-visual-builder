import { findRule } from '../rules/awsRules';
import { getCdkActionOption, getCdkActionOptions, getDefaultConnectionType } from '../rules/cdkActions';
import type { AwsResourceType, GraphModel } from '../types';

type UsedImports = {
  lambda?: boolean;
  lambdaNodejs?: boolean;
  s3?: boolean;
  s3deploy?: boolean;
  dynamodb?: boolean;
  apigateway?: boolean;
  sqs?: boolean;
  ec2?: boolean;
  events?: boolean;
  targets?: boolean;
  s3n?: boolean;
  lambdaEventSources?: boolean;
  iam?: boolean;
  ssm?: boolean;
  path?: boolean;
};

function toPascal(value: string) {
  const result = value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return /^[A-Za-z_$]/.test(result) ? result : `Resource${result}`;
}

function toCamel(value: string) {
  const pascal = toPascal(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function literal(value: unknown) {
  return JSON.stringify(value);
}

function safeLambdaEntry(value: unknown, id: string) {
  const entry = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return entry && !entry.startsWith('/') && !entry.split('/').includes('..') && /^[A-Za-z0-9_./-]+\.[jt]s$/.test(entry)
    ? entry
    : `lambdas/${toCamel(id)}/index.ts`;
}

function safeScriptPath(value: unknown) {
  const file = String(value || 'scripts/process-input.sh').replace(/\\/g, '/').replace(/^\.\//, '');
  return file && !file.startsWith('/') && !file.split('/').includes('..') && /^[A-Za-z0-9_./-]+\.(sh|py)$/.test(file)
    ? file : undefined;
}

function safeHandler(value: unknown) {
  const handler = String(value || 'handler');
  return /^[A-Za-z_$][\w$]*$/.test(handler) ? handler : 'handler';
}

function lambdaRuntime(value: unknown) {
  const runtimes: Record<string, string> = {
    'nodejs24.x': 'NODEJS_24_X',
    'nodejs22.x': 'NODEJS_22_X',
    'nodejs20.x': 'NODEJS_20_X',
    'python3.12': 'PYTHON_3_12',
    java21: 'JAVA_21',
  };
  return runtimes[String(value)] || 'NODEJS_24_X';
}

function stringList(value: unknown, fallback: string[] = []) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEnvVars(value: unknown): Array<{ key: string; value: string }> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value)) as Array<{ key: string; value: string }>;
    return Array.isArray(parsed) ? parsed.filter((item) => item.key.trim() && typeof item.value === 'string') : [];
  } catch {
    return [];
  }
}

function envValue(value: string, knownRefs: Set<string>) {
  const match = value.match(/^([A-Za-z_$][\w$]*)\.(bucketName|tableName|instanceProfileName|roleArn)$/);
  return match && knownRefs.has(match[1]) ? value : literal(value);
}

function synthesizeResource(
  node: GraphModel['nodes'][number], imports: UsedImports, id: string, ref: string,
  knownRefs: Set<string>, lambdaEntry?: string, attachedRoleRef?: string,
) {
  const config = node.config;
  const envVars = parseEnvVars(config.envVars);

  const linesByType: Record<AwsResourceType, string[]> = {
    webClient: [
      `// Web client origin: ${config.origin || 'http://localhost:5173'}`,
      `// Browser flow: call API Gateway for presigned URLs and metadata, then PUT files directly to S3.`,
    ],
    lambda: [
      ...(!String(config.runtime || 'nodejs24.x').startsWith('nodejs')
        ? [`// ${node.name}: requested runtime ${config.runtime} needs a different Lambda construct; using Node.js for this scaffold.`]
        : []),
      `const ${ref} = new lambdaNodejs.NodejsFunction(this, '${id}', {`,
      `  runtime: lambda.Runtime.${lambdaRuntime(String(config.runtime || 'nodejs24.x').startsWith('nodejs') ? config.runtime : 'nodejs24.x')},`,
      `  handler: ${literal(safeHandler(config.handler))},`,
      `  entry: path.join(__dirname, ${literal(`../${lambdaEntry}`)}),`,
      `  memorySize: ${Number(config.memorySize || 128)},`,
      `  environment: {`,
      ...(envVars.length
        ? envVars.map((item) => `    ${literal(item.key)}: ${envValue(item.value, knownRefs)},`)
        : [`    // Add BUCKET_NAME, TABLE_NAME, PROFILE_NAME, or ImageID based on connected resources.`]),
      `  },`,
      `});`,
    ],
    s3: [
      `const ${ref} = new s3.Bucket(this, '${id}', {`,
      `  versioned: ${config.versioned === 'true'},`,
      `  removalPolicy: cdk.RemovalPolicy.${config.removalPolicy || 'DESTROY'},`,
      `  autoDeleteObjects: ${config.removalPolicy !== 'RETAIN'},`,
      `});`,
      ...stringList(config.corsOrigins).map(
        (origin) =>
          `${ref}.addCorsRule({ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: [${literal(origin)}], allowedHeaders: ['*'] });`,
      ),
    ],
    dynamodb: [
      `const ${ref} = new dynamodb.Table(this, '${id}', {`,
      `  partitionKey: { name: ${literal(config.partitionKey || 'id')}, type: dynamodb.AttributeType.STRING },`,
      `  billingMode: dynamodb.BillingMode.${config.billingMode || 'PAY_PER_REQUEST'},`,
      config.stream === 'DISABLED' ? '' : `  stream: dynamodb.StreamViewType.${config.stream || 'NEW_IMAGE'},`,
      `  removalPolicy: cdk.RemovalPolicy.DESTROY,`,
      `});`,
    ].filter(Boolean),
    apiGateway: [
      `const ${ref} = new apigateway.RestApi(this, '${id}', {`,
      `  deployOptions: { stageName: ${literal(config.stageName || 'prod')} },`,
      `  defaultCorsPreflightOptions: {`,
      `    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],`,
      `    allowHeaders: ['Content-Type'],`,
      `    allowOrigins: [${stringList(config.corsOrigins, ['*']).map(literal).join(', ')}],`,
      `  },`,
      `});`,
    ],
    sqs: [
      `const ${ref} = new sqs.Queue(this, '${id}', {`,
      `  visibilityTimeout: cdk.Duration.seconds(${Number(config.visibilityTimeout || 30)}),`,
      `  retentionPeriod: cdk.Duration.days(${Number(config.retentionDays || 4)}),`,
      `});`,
    ],
    ec2: [
      config.launchMode === 'dynamic'
        ? `// ${node.name} is a dynamic VM launched by Lambda at runtime.`
        : `const ${ref}Vpc = new ec2.Vpc(this, '${id}Vpc', { maxAzs: 2 });`,
      config.launchMode === 'dynamic'
        ? `// AMI lookup hint: ssm.StringParameter.valueForStringParameter(this, '/aws/service/ami-amazon-linux-latest/al2023-ami-minimal-kernel-default-x86_64')`
        : `const ${ref} = new ec2.Instance(this, '${id}', {`,
      config.launchMode === 'dynamic' ? `// Instance type hint: ${config.instanceType || 't3.micro'}` : `  vpc: ${ref}Vpc,`,
      config.launchMode === 'dynamic'
        ? `// Auto terminate after script completes: ${config.autoTerminate || 'true'}`
        : `  instanceType: new ec2.InstanceType(${literal(config.instanceType || 't3.micro')}),`,
      config.launchMode === 'dynamic' ? `` : `  machineImage: ec2.MachineImage.latestAmazonLinux2023(),`,
      config.launchMode === 'dynamic' || !attachedRoleRef ? `` : `  role: ${attachedRoleRef},`,
      config.launchMode === 'dynamic' ? `` : `});`,
    ].filter(Boolean),
    eventBridge: [
      `const ${ref} = new events.Rule(this, '${id}', {`,
      `  schedule: events.Schedule.expression(${literal(config.schedule || 'rate(5 minutes)')}),`,
      `});`,
    ],
    iamRole: [
      `const ${ref} = new iam.Role(this, '${id}', {`,
      `  assumedBy: new iam.ServicePrincipal(${literal(config.assumedBy || 'ec2.amazonaws.com')}),`,
      `});`,
      config.includeInstanceProfile === 'true'
        ? `const ${ref}Profile = new iam.InstanceProfile(this, '${id}Profile', { role: ${ref} });`
        : `// Instance profile disabled for ${node.name}.`,
    ],
    scriptAsset: [
      `// Script asset ${node.name}: ${config.localPath || 'scripts/process-input.sh'}`,
      `// Upload to S3 key ${config.s3Key || 'scripts/process-input.sh'} using s3deploy.BucketDeployment or your deployment pipeline.`,
    ],
    textBoard: [`// Note: ${String(config.body || node.name).replace(/\n/g, '\n// ')}`],
  };

  const importKeyByType: Record<AwsResourceType, keyof UsedImports> = {
    webClient: 'apigateway',
    lambda: 'lambda',
    s3: 's3',
    dynamodb: 'dynamodb',
    apiGateway: 'apigateway',
    sqs: 'sqs',
    ec2: 'ec2',
    eventBridge: 'events',
    iamRole: 'iam',
    scriptAsset: 's3deploy',
    textBoard: 'path',
  };
  if (node.type !== 'textBoard' && node.type !== 'webClient' && node.type !== 'scriptAsset'
    && !(node.type === 'ec2' && node.config.launchMode === 'dynamic')) {
    imports[importKeyByType[node.type]] = true;
  }

  if (node.type === 'lambda') {
    imports.lambdaNodejs = true;
    imports.path = true;
  }
  return { ref, lines: linesByType[node.type] };
}

function synthesizeEdge(
  edge: GraphModel['edges'][number],
  graph: GraphModel,
  refs: Map<string, string>,
  imports: UsedImports,
  apiRoutes: Map<string, string>,
) {
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  if (!source || !target) return `// Skipped ${edge.id}: source or target resource was missing.`;
  if (source.type === 'textBoard' || target.type === 'textBoard') return `// Skipped ${edge.id}: text boards do not generate CDK relationships.`;

  const sourceRef = refs.get(source.id);
  const targetRef = refs.get(target.id);
  const rule = findRule(source.type, target.type);
  const selectedAction = getCdkActionOption(source.type, target.type, edge.connectionType, edge.cdkAction);
  if (!sourceRef || !targetRef || !rule) {
    return `// TODO: Review ${source.name} -> ${target.name}. No supported CDK mapping is defined yet.`;
  }

  if (!rule.valid) return `// INVALID: ${rule.message}`;
  const pairActions = getCdkActionOptions(source.type, target.type);
  const allowedActions = getCdkActionOptions(source.type, target.type, edge.connectionType);
  if ((pairActions.length && !allowedActions.length)
    || (!pairActions.length && edge.connectionType !== getDefaultConnectionType(source.type, target.type))
    || (edge.cdkAction && !allowedActions.some((action) => action.value === edge.cdkAction))) {
    return `// TODO: Unsupported ${edge.connectionType} action for ${source.name} -> ${target.name}.`;
  }

  if (source.type === 'webClient' && target.type === 'apiGateway') {
    return `// Frontend calls ${targetRef}.url for presigned URL and DynamoDB submit routes.`;
  }
  if (source.type === 'webClient' && target.type === 's3') {
    if (selectedAction?.value === 'bucketCorsPut') {
      const origin = String(source.config.origin || 'http://localhost:5173');
      if (stringList(target.config.corsOrigins).includes(origin)) {
        return `// ${targetRef} already allows browser PUT from ${origin} through its CORS configuration.`;
      }
      return `${targetRef}.addCorsRule({ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: [${literal(origin)}], allowedHeaders: ['*'] });`;
    }
    return `// Browser uploads directly to ${targetRef} with a presigned PUT URL; file bytes do not pass through Lambda.`;
  }
  if (source.type === 'apiGateway' && target.type === 'lambda') {
    if (selectedAction?.value === 'lambdaInvokePermission') {
      imports.iam = true;
      return `${targetRef}.addPermission('AllowApiGatewayInvoke', { principal: new iam.ServicePrincipal('apigateway.amazonaws.com'), sourceArn: ${sourceRef}.arnForExecuteApi() });`;
    }
    if (selectedAction?.value === 'executeApiInvokePolicy') {
      return `// TODO: Grant the caller execute-api:Invoke on ${sourceRef}.arnForExecuteApi(); the caller is not modeled in this graph.`;
    }
    const route = apiRoutes.get(edge.id) || `${sourceRef}.root`;
    const method = String(target.config.apiMethod || 'POST').toUpperCase();
    if (selectedAction?.value === 'addProxyLambdaIntegration') {
      return `${route}.addProxy({ defaultIntegration: new apigateway.LambdaIntegration(${targetRef}), anyMethod: true });`;
    }
    if (selectedAction?.value === 'restApiDefaultIntegration') {
      return `// TODO: Configure ${sourceRef} defaultIntegration with ${targetRef} in the RestApi constructor.`;
    }
    return `${route}.addMethod('${method}', new apigateway.LambdaIntegration(${targetRef})); // ${target.name}`;
  }
  if (source.type === 'lambda' && target.type === 's3') {
    if (selectedAction?.value === 'grantPut') return `${targetRef}.grantPut(${sourceRef});`;
    if (selectedAction?.value === 'grantRead') return `${targetRef}.grantRead(${sourceRef});`;
    if (selectedAction?.value === 'grantWrite') return `${targetRef}.grantWrite(${sourceRef});`;
    if (selectedAction?.value === 'grantDelete') return `${targetRef}.grantDelete(${sourceRef});`;
    return `${targetRef}.grantReadWrite(${sourceRef});`;
  }
  if (source.type === 'lambda' && target.type === 'dynamodb') {
    if (selectedAction?.value === 'grantWriteData') return `${targetRef}.grantWriteData(${sourceRef}); // Set TABLE_NAME=${targetRef}.tableName in ${sourceRef}.environment.`;
    if (selectedAction?.value === 'grantReadData') return `${targetRef}.grantReadData(${sourceRef}); // Set TABLE_NAME=${targetRef}.tableName in ${sourceRef}.environment.`;
    if (selectedAction?.value === 'grantFullAccess') return `${targetRef}.grantFullAccess(${sourceRef}); // Broad permission; narrow before production.`;
    return `${targetRef}.grantReadWriteData(${sourceRef}); // Set TABLE_NAME=${targetRef}.tableName in ${sourceRef}.environment.`;
  }
  if (source.type === 'lambda' && target.type === 'ec2') {
    if (selectedAction?.value === 'ssmAmiLookup') {
      imports.ssm = true;
      return `const ${sourceRef}AmiId = ssm.StringParameter.valueForStringParameter(this, '/aws/service/ami-amazon-linux-latest/al2023-ami-minimal-kernel-default-x86_64');`;
    }
    if (selectedAction?.value === 'passRolePolicy') {
      const role = graph.nodes.find((node) => node.type === 'iamRole'
        && graph.edges.some((item) => item.source === node.id && item.target === target.id));
      if (!role) return `// TODO: Connect an IAM role to ${target.name} before adding a scoped iam:PassRole policy.`;
      imports.iam = true;
      return `${sourceRef}.addToRolePolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [${refs.get(role.id)}.roleArn] }));`;
    }
    imports.iam = true;
    return `${sourceRef}.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:RunInstances', 'iam:PassRole'], resources: ['*'] })); // Dynamic EC2 launcher.`;
  }
  if (source.type === 'lambda' && target.type === 'sqs') return `${targetRef}.grantSendMessages(${sourceRef});`;
  if (source.type === 'dynamodb' && target.type === 'lambda') {
    if (source.config.stream === 'DISABLED') return `// INVALID: Enable DynamoDB Streams on ${sourceRef} before adding a Lambda event source.`;
    imports.lambdaEventSources = true;
    const batch = selectedAction?.value === 'dynamoEventSourceWithBatch' ? ', batchSize: 10' : '';
    const filterNote = selectedAction?.value === 'dynamoEventSourceWithFilter' ? ' // TODO: Add a DynamoDB event filter pattern.' : '';
    return `${targetRef}.addEventSource(new lambdaEventSources.DynamoEventSource(${sourceRef}, { startingPosition: lambda.StartingPosition.LATEST${batch} }));${filterNote}`;
  }
  if (source.type === 'sqs' && target.type === 'lambda') {
    imports.lambdaEventSources = true;
    const options = selectedAction?.value === 'sqsEventSourceWithBatch' ? ', { batchSize: 10 }'
      : selectedAction?.value === 'sqsEventSourceWithFailures' ? ', { reportBatchItemFailures: true }' : '';
    return `${targetRef}.addEventSource(new lambdaEventSources.SqsEventSource(${sourceRef}${options}));`;
  }
  if (source.type === 's3' && target.type === 'lambda') {
    if (selectedAction?.value === 's3EventSource' || selectedAction?.value === 's3EventSourceWithFilter') {
      imports.lambdaEventSources = true;
      const filters = selectedAction.value === 's3EventSourceWithFilter' ? ", filters: [{ prefix: 'input/' }]" : '';
      return `${targetRef}.addEventSource(new lambdaEventSources.S3EventSource(${sourceRef}, { events: [s3.EventType.OBJECT_CREATED]${filters} }));`;
    }
    imports.s3n = true;
    return `${sourceRef}.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(${targetRef}));`;
  }
  if (source.type === 'ec2' && target.type === 's3') {
    if (selectedAction?.value === 'grantReadToInstanceRole') return `// ${targetRef}.grantRead(instanceRole); // VM can download input or scripts.`;
    if (selectedAction?.value === 'grantPutToInstanceRole') return `// ${targetRef}.grantPut(instanceRole); // VM can upload output files.`;
    if (selectedAction?.value === 'grantWriteToInstanceRole') return `// ${targetRef}.grantWrite(instanceRole); // VM can write objects.`;
    return `// ${targetRef}.grantReadWrite(instanceRole); // VM can download input and upload output.`;
  }
  if (source.type === 'ec2' && target.type === 'dynamodb') {
    if (selectedAction?.value === 'grantReadDataToInstanceRole') return `// ${targetRef}.grantReadData(instanceRole); // VM can read job input.`;
    if (selectedAction?.value === 'grantWriteDataToInstanceRole') return `// ${targetRef}.grantWriteData(instanceRole); // VM can write output metadata.`;
    return `// ${targetRef}.grantReadWriteData(instanceRole); // VM can read job input and write output metadata.`;
  }
  if (source.type === 'iamRole' && target.type === 'ec2') {
    if (selectedAction?.value === 'passRoleTarget') return `// Grant launcher Lambda iam:PassRole on ${sourceRef}.roleArn before RunInstances.`;
    return target.config.launchMode === 'dynamic'
      ? `// Runtime launcher must pass ${sourceRef}Profile.instanceProfileName to RunInstances.`
      : `// ${sourceRef} is attached to ${targetRef} in the ec2.Instance constructor.`;
  }
  if ((source.type === 'iamRole' && target.type === 'lambda') || (source.type === 'lambda' && target.type === 'iamRole')) {
    const roleRef = source.type === 'iamRole' ? sourceRef : targetRef;
    const lambdaRef = source.type === 'lambda' ? sourceRef : targetRef;
    return `// ${lambdaRef} receives PROFILE_NAME=${roleRef}Profile.instanceProfileName through its environment.`;
  }
  if (source.type === 'iamRole' && target.type === 's3') {
    if (selectedAction?.value === 'grantReadToRole') return `${targetRef}.grantRead(${sourceRef});`;
    if (selectedAction?.value === 'grantPutToRole') return `${targetRef}.grantPut(${sourceRef});`;
    if (selectedAction?.value === 'grantWriteToRole') return `${targetRef}.grantWrite(${sourceRef});`;
    return `${targetRef}.grantReadWrite(${sourceRef});`;
  }
  if (source.type === 'iamRole' && target.type === 'dynamodb') {
    if (selectedAction?.value === 'grantReadDataToRole') return `${targetRef}.grantReadData(${sourceRef});`;
    if (selectedAction?.value === 'grantWriteDataToRole') return `${targetRef}.grantWriteData(${sourceRef});`;
    return `${targetRef}.grantReadWriteData(${sourceRef});`;
  }
  if (source.type === 'scriptAsset' && target.type === 's3') {
    if (selectedAction?.value === 'bucketDeployment') {
      const localPath = safeScriptPath(source.config.localPath);
      const s3Key = String(source.config.s3Key || 'scripts/process-input.sh').replace(/\\/g, '/');
      if (!localPath || localPath.split('/').pop() !== s3Key.split('/').pop()) {
        return `// TODO: ${source.name} needs a relative localPath whose filename matches its S3 key for BucketDeployment.`;
      }
      imports.s3deploy = true;
      imports.path = true;
      const localDir = localPath.includes('/') ? localPath.slice(0, localPath.lastIndexOf('/')) : '.';
      const keyPrefix = s3Key.includes('/') ? s3Key.slice(0, s3Key.lastIndexOf('/')) : '';
      return `new s3deploy.BucketDeployment(this, ${literal(`Deploy${toPascal(edge.id)}`)}, { sources: [s3deploy.Source.asset(path.join(__dirname, ${literal(`../${localDir}`)}))], destinationBucket: ${targetRef}, destinationKeyPrefix: ${literal(keyPrefix)} });`;
    }
    return `// Upload script asset to ${targetRef}; EC2 user data should download and execute it.`;
  }
  if (source.type === 'eventBridge' && target.type === 'lambda') {
    imports.targets = true;
    return `${sourceRef}.addTarget(new targets.LambdaFunction(${targetRef}));`;
  }
  if (source.type === 'eventBridge' && target.type === 'sqs') {
    imports.targets = true;
    return `${sourceRef}.addTarget(new targets.SqsQueue(${targetRef}));`;
  }

  return `// TODO: Implement ${rule.cdkHint}`;
}

function renderImports(imports: UsedImports) {
  const lines = [`import * as cdk from 'aws-cdk-lib';`, `import { Construct } from 'constructs';`];
  if (imports.lambda) lines.push(`import * as lambda from 'aws-cdk-lib/aws-lambda';`);
  if (imports.lambdaNodejs) lines.push(`import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';`);
  if (imports.s3) lines.push(`import * as s3 from 'aws-cdk-lib/aws-s3';`);
  if (imports.s3deploy) lines.push(`import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';`);
  if (imports.s3n) lines.push(`import * as s3n from 'aws-cdk-lib/aws-s3-notifications';`);
  if (imports.dynamodb) lines.push(`import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';`);
  if (imports.apigateway) lines.push(`import * as apigateway from 'aws-cdk-lib/aws-apigateway';`);
  if (imports.sqs) lines.push(`import * as sqs from 'aws-cdk-lib/aws-sqs';`);
  if (imports.ec2) lines.push(`import * as ec2 from 'aws-cdk-lib/aws-ec2';`);
  if (imports.events) lines.push(`import * as events from 'aws-cdk-lib/aws-events';`);
  if (imports.targets) lines.push(`import * as targets from 'aws-cdk-lib/aws-events-targets';`);
  if (imports.lambdaEventSources) lines.push(`import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';`);
  if (imports.iam) lines.push(`import * as iam from 'aws-cdk-lib/aws-iam';`);
  if (imports.ssm) lines.push(`import * as ssm from 'aws-cdk-lib/aws-ssm';`);
  if (imports.path) lines.push(`import * as path from 'node:path';`);
  return lines.join('\n');
}

export function generateCdkProject(graph: GraphModel): Record<string, string> {
  const imports: UsedImports = {};
  const refs = new Map<string, string>();
  const constructIds = new Map<string, string>();
  const usedIds = new Set<string>();
  const reservedRefs = new Set(['class', 'const', 'default', 'do', 'else', 'export', 'for', 'function', 'if', 'import', 'let', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'var', 'while']);
  graph.nodes.forEach((node) => {
    const base = toPascal(node.name || node.type);
    let id = base;
    let suffix = 2;
    while (usedIds.has(id) || reservedRefs.has(toCamel(id))) id = `${base}${suffix++}`;
    usedIds.add(id);
    constructIds.set(node.id, id);
    refs.set(node.id, toCamel(id));
  });
  const knownRefs = new Set(refs.values());
  graph.nodes.filter((node) => node.type === 'iamRole' && node.config.includeInstanceProfile !== 'false')
    .forEach((node) => knownRefs.add(`${refs.get(node.id)}Profile`));
  const lambdaEntries = new Map<string, Set<string>>();
  const generationOrder: Record<AwsResourceType, number> = {
    s3: 0, dynamodb: 0, iamRole: 0, sqs: 0, eventBridge: 0, scriptAsset: 0, webClient: 0, textBoard: 0,
    ec2: 1, lambda: 2, apiGateway: 3,
  };
  const resourceBlocks = [...graph.nodes].sort((a, b) => generationOrder[a.type] - generationOrder[b.type]).map((node) => {
    const id = constructIds.get(node.id)!;
    const entry = node.type === 'lambda' ? safeLambdaEntry(node.config.entry, id) : undefined;
    if (entry) {
      const handlers = lambdaEntries.get(entry) || new Set<string>();
      handlers.add(safeHandler(node.config.handler));
      lambdaEntries.set(entry, handlers);
    }
    const attachedRole = node.type === 'ec2' ? graph.edges.find((edge) => edge.target === node.id
      && edge.connectionType === 'permission' && (!edge.cdkAction || edge.cdkAction === 'instanceProfile')
      && graph.nodes.some((candidate) => candidate.id === edge.source && candidate.type === 'iamRole')) : undefined;
    const resource = synthesizeResource(node, imports, id, refs.get(node.id)!, knownRefs, entry,
      attachedRole ? refs.get(attachedRole.source) : undefined);
    return resource.lines.join('\n');
  });
  const apiRoutes = new Map<string, string>();
  const routeRefs = new Map<string, string>();
  const routeLines: string[] = [];
  graph.edges.forEach((edge) => {
    const api = graph.nodes.find((node) => node.id === edge.source && node.type === 'apiGateway');
    const lambda = graph.nodes.find((node) => node.id === edge.target && node.type === 'lambda');
    if (!api || !lambda || edge.connectionType !== 'integration') return;
    let parent = `${refs.get(api.id)}.root`;
    let prefix = '';
    for (const part of String(lambda.config.apiPath || '/').split('/').map((item) => item.trim()).filter(Boolean)) {
      prefix += `/${part}`;
      const key = `${api.id}:${prefix}`;
      if (!routeRefs.has(key)) {
        const routeRef = `apiRoute${routeRefs.size + 1}`;
        routeRefs.set(key, routeRef);
        routeLines.push(`const ${routeRef} = ${parent}.addResource(${literal(part)});`);
      }
      parent = routeRefs.get(key)!;
    }
    apiRoutes.set(edge.id, parent);
  });
  const edgeLines = graph.edges.map((edge) => synthesizeEdge(edge, graph, refs, imports, apiRoutes));

  const stack = `${renderImports(imports)}

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

${resourceBlocks.length ? resourceBlocks.map((block) => block.replace(/^/gm, '    ')).join('\n\n') : '    // Add resources in InfraCanvas to generate constructs here.'}

${routeLines.length ? routeLines.map((line) => `    ${line}`).join('\n') : ''}

${edgeLines.length ? edgeLines.map((line) => `    ${line}`).join('\n') : '    // Connect resources in InfraCanvas to generate permissions, routes, event sources, and IAM hints.'}
  }
}
`;

  const handlerFiles = Object.fromEntries([...lambdaEntries].map(([entry, handlers]) => [
    entry,
    [...handlers].map((handler) => entry.endsWith('.js')
      ? `export async function ${handler}(event) {\n  void event;\n  return { statusCode: 200, body: JSON.stringify({ message: 'TODO: implement handler' }) };\n}\n`
      : `export async function ${handler}(event: unknown): Promise<unknown> {\n  void event;\n  return { statusCode: 200, body: JSON.stringify({ message: 'TODO: implement handler' }) };\n}\n`).join('\n'),
  ]));
  const scriptFiles = Object.fromEntries(graph.nodes.filter((node) => node.type === 'scriptAsset').flatMap((node) => {
    const localPath = safeScriptPath(node.config.localPath);
    if (!localPath) return [];
    const body = localPath.endsWith('.py')
      ? '# TODO: implement the VM processing script.\n'
      : '#!/usr/bin/env bash\nset -euo pipefail\n# TODO: implement the VM processing script.\n';
    return [[localPath, body]];
  }));

  return {
    'package.json': JSON.stringify(
      {
        name: 'infracanvas-generated',
        version: '0.1.0',
        private: true,
        scripts: {
          build: 'tsc',
          synth: 'cdk synth',
          deploy: 'cdk deploy',
        },
        dependencies: {
          'aws-cdk-lib': '^2.272.0',
          constructs: '^10.3.0',
        },
        devDependencies: {
          'aws-cdk': '^2.1122.0',
          typescript: '^5.5.0',
          'ts-node': '^10.9.2',
          '@types/node': '^20.0.0',
          esbuild: '^0.21.0',
        },
      },
      null,
      2,
    ),
    'cdk.json': JSON.stringify({ app: 'npx ts-node --prefer-ts-exts bin/app.ts' }, null, 2),
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'CommonJS',
        moduleResolution: 'Node',
        lib: ['ES2022'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        outDir: 'dist',
      },
      include: ['bin/**/*.ts', 'lib/**/*.ts', 'lambdas/**/*.ts'],
    }, null, 2),
    'bin/app.ts': `#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack } from '../lib/infrastructure-stack';

const app = new cdk.App();
new InfrastructureStack(app, 'InfrastructureStack');
`,
    'lib/infrastructure-stack.ts': stack,
    'README.md': `# InfraCanvas Generated CDK Project

This scaffold was generated from an InfraCanvas graph.

## Workflow Notes

- Browser uploads should use presigned S3 PUT URLs.
- DynamoDB-triggered VM work should flow through DynamoDB Streams -> Lambda -> EC2 RunInstances.
- Review IAM policies and replace wildcard RunInstances/PassRole resources before production.
- Dynamic EC2 jobs still need user data or launch-template code that downloads the script from S3, runs it, uploads output, updates DynamoDB, and terminates the instance.

## Commands

\`\`\`bash
npm install
npm run build
npm run synth
\`\`\`
`,
    ...handlerFiles,
    ...scriptFiles,
  };
}
