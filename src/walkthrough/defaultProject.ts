import type { AwsResourceType, GraphModel } from '../types';

export const practiceNodeIds = { apiGateway: 'practice-api', lambda: 'practice-lambda', s3: 'practice-bucket' } as const;

export const practiceResources = {
  apiGateway: { id: practiceNodeIds.apiGateway, name: 'Upload API', position: { x: 0, y: 0 } },
  lambda: { id: practiceNodeIds.lambda, name: 'Upload Handler', position: { x: 340, y: 0 } },
  s3: { id: practiceNodeIds.s3, name: 'Uploads Bucket', position: { x: 680, y: 0 } },
} as const;

const node = (id: string) => `.react-flow__node[data-id="${id}"]`;
const handle = (id: string, side: string) => `${node(id)} .react-flow__handle[data-handleid="${side}-source"]`;

export const walkthroughSteps = [
  { id: 'welcome', title: 'Build your first CDK project', description: 'Create an API that calls a Lambda with permission to upload to S3. CDK turns these resources and relationships into infrastructure code.', instruction: 'Follow the highlighted controls. Your own board is kept safe; this practice board resets when you close it.', targets: [], nextLabel: 'Start building' },
  { id: 'add-api', title: 'Add an API Gateway', description: 'API Gateway is the HTTP front door. A request to this API will reach your Lambda.', instruction: 'Click +, then choose API Gateway.', targets: ['[data-tour="add-component"]', '[data-resource="apiGateway"]'] },
  { id: 'add-lambda', title: 'Add the Lambda', description: 'Lambda runs your application code when the API receives a request.', instruction: 'Click +, then choose Lambda.', targets: ['[data-tour="add-component"]', '[data-resource="lambda"]'] },
  { id: 'add-bucket', title: 'Add an S3 bucket', description: 'S3 will store uploaded files. Adding a bucket does not automatically give the Lambda access to it.', instruction: 'Click +, then choose S3 Bucket.', targets: ['[data-tour="add-component"]', '[data-resource="s3"]'] },
  { id: 'move-bucket', title: 'Arrange the board', description: 'Positions are just for readability. Moving a resource does not change its AWS configuration.', instruction: 'Drag the Uploads Bucket card down a little, then release it.', targets: [node(practiceNodeIds.s3)] },
  { id: 'connect-api', title: 'Send API requests to Lambda', description: 'An integration forwards incoming HTTP requests to the Lambda handler. CDK creates a LambdaIntegration for this arrow.', instruction: 'Drag from the right dot on Upload API to the left dot on Upload Handler. You can also click the two dots in order.', targets: [handle(practiceNodeIds.apiGateway, 'right'), handle(practiceNodeIds.lambda, 'left')] },
  { id: 'select-lambda', title: 'Inspect the Lambda', description: 'The Inspector on the right shows settings for the resource or connection you select.', instruction: 'Click the Upload Handler card.', targets: [node(practiceNodeIds.lambda)] },
  { id: 'configure-route', title: 'Choose the API route', description: 'The route is the URL path callers use. This Lambda already uses POST; set its path to /upload-url.', instruction: 'Enter /upload-url in API route path, then continue.', targets: ['[data-tour="field-apiPath"] input'], nextLabel: 'Use this route' },
  { id: 'connect-bucket', title: 'Give Lambda access to S3', description: 'This permission arrow gives the Lambda execution role access to the bucket. It does not send a file by itself.', instruction: 'Drag from the right dot on Upload Handler to the left dot on Uploads Bucket, or click the two dots in order.', targets: [handle(practiceNodeIds.lambda, 'right'), handle(practiceNodeIds.s3, 'left')] },
  { id: 'select-permission', title: 'Inspect the permission', description: 'Select an arrow to choose what it does. The new Lambda-to-S3 connection is a Permission relationship.', instruction: 'Click the arrow from Upload Handler to Uploads Bucket.', targets: ['.react-flow__edge[data-id="practice-permission"]'] },
  { id: 'choose-grant', title: 'Allow uploads with grantPut', description: 'grantPut lets the Lambda upload objects. It does not grant read or delete access. CDK adds this permission to the Lambda role.', instruction: 'Check that CDK action is grantPut, then click Use grantPut. If it is already selected, keep it.', targets: ['[data-tour="cdk-action"] select'], nextLabel: 'Use grantPut' },
  { id: 'validate', title: 'Check the relationships', description: 'Validation checks whether the modeled connections have supported mappings and flags missing setup.', instruction: 'Click Validate in the top toolbar.', targets: ['[data-tour="validate"]'] },
  { id: 'review', title: 'Read the validation result', description: 'This small graph has no blocking findings. In your own projects, clicking a connection warning opens its Inspector.', instruction: 'The bottom panel is where errors and warnings appear. Passing these checks does not test your Lambda code.', targets: ['[data-tour="validation"]'], nextLabel: 'Continue to export' },
  { id: 'export', title: 'Generate the CDK files', description: 'Your graph is ready to become a TypeScript project: three resources, an API integration, and an S3 upload grant.', instruction: 'Click Generate CDK in the top toolbar.', targets: ['[data-tour="generate"]'] },
  { id: 'complete', title: 'Your first scaffold is ready', description: 'Browse infrastructure-stack.ts to see the resources and grantPut call. You can download the ZIP before leaving. The Lambda handler is a placeholder for your application code.', instruction: 'Close the files or choose Finish & reset to return to your own board. Default project will start fresh next time.', targets: ['[data-tour="generated-code"]'], nextLabel: 'Finish & reset' },
] as const;

export type WalkthroughStepId = typeof walkthroughSteps[number]['id'];

export function nextWalkthroughStep(step: WalkthroughStepId): WalkthroughStepId {
  return walkthroughSteps[Math.min(walkthroughSteps.findIndex((item) => item.id === step) + 1, walkthroughSteps.length - 1)].id;
}

export function expectedResource(step?: WalkthroughStepId): AwsResourceType | undefined {
  if (step === 'add-api') return 'apiGateway';
  if (step === 'add-lambda') return 'lambda';
  if (step === 'add-bucket') return 's3';
  return undefined;
}

export function allowsPracticeConnection(step: WalkthroughStepId, source: string | null, target: string | null) {
  if (step === 'connect-api') return source === practiceNodeIds.apiGateway && target === practiceNodeIds.lambda;
  if (step === 'connect-bucket') return source === practiceNodeIds.lambda && target === practiceNodeIds.s3;
  return false;
}

export function canContinueWalkthrough(step: WalkthroughStepId, graph: GraphModel) {
  if (step === 'configure-route') return graph.nodes.find((item) => item.id === practiceNodeIds.lambda)?.config.apiPath === '/upload-url';
  if (step === 'choose-grant') return graph.edges.some((edge) => edge.id === 'practice-permission'
    && edge.source === practiceNodeIds.lambda && edge.target === practiceNodeIds.s3
    && edge.connectionType === 'permission' && edge.cdkAction === 'grantPut');
  return step === 'welcome' || step === 'review' || step === 'complete';
}
