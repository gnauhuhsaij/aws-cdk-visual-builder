import { ArrowLeft, ArrowRight, BookOpen, GitBranch, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type GuideModalProps = {
  onClose: () => void;
  onOpenSample: () => void;
};

const steps = [
  {
    label: 'The goal',
    title: 'Build a small file-upload flow',
    intro: 'You know the AWS services. InfraCanvas helps you turn their relationships into a TypeScript CDK starting point.',
    actions: [
      'A browser asks an API for a short-lived S3 upload URL.',
      'The browser uploads the file straight to S3. Lambda never receives the file bytes.',
      'A second API request sends the file path to a Lambda, which can write it to DynamoDB.',
    ],
    note: 'CDK declares AWS resources and permissions in code. The exported Lambda handlers are placeholders; you still implement the request logic.',
  },
  {
    label: 'Workspace',
    title: 'Know where everything lives',
    intro: 'The screen follows a simple path: choose a board, draw the flow, inspect a selection, then check and export.',
    actions: [
      'Left History lists boards saved in this browser. New board starts fresh; Save in the top bar keeps the current board.',
      'The middle canvas is your architecture. Use + to add components, drag to arrange them, and use the minimap or zoom controls to navigate.',
      'The right Inspector edits the selected component or arrow. The bottom Validation panel shows warnings and errors.',
      'The top bar also has Validate, Generate CDK, Load stack.ts, and Sample workflow. Loading a stack imports supported patterns only.',
    ],
    note: 'Saved boards live in this browser\'s local storage. They are not saved to AWS or synced between devices.',
  },
  {
    label: 'Components',
    title: 'Pick the pieces you need',
    intro: 'Click + on the canvas. Each item stands for one service or one design note.',
    actions: [
      'For this task, add Web UI, API Gateway, two Lambdas, S3 Bucket, and DynamoDB Table.',
      'Web UI is the browser; API Gateway receives HTTP requests; Lambda runs your code; S3 stores file bytes; DynamoDB stores the file path and other metadata.',
      'SQS holds messages, EventBridge starts work on a schedule or event, EC2 is a VM, IAM Role/Profile gives a VM permissions, and Script Asset represents a file to upload for a worker.',
      'Text board is for notes. It has no connection handles and does not generate infrastructure.',
    ],
    note: 'One Lambda can create the presigned URL. The other can save the submitted text and S3 path.',
  },
  {
    label: 'Connections',
    title: 'Draw arrows in the direction work happens',
    intro: 'Drag from a handle on the source component to a handle on the destination. Click an arrow to inspect it.',
    actions: [
      'Connect Web UI -> API Gateway, then API Gateway -> each Lambda. These are integrations: a request reaches your Lambda.',
      'Connect the presigned-URL Lambda -> S3 Bucket. Set Connection type to Permission and CDK action to grantPut.',
      'Connect the submit Lambda -> DynamoDB Table. Set Permission and grantWriteData.',
      'Connect Web UI -> S3 Bucket to show the browser\'s direct PUT flow. The browser still needs a URL from your Lambda, and S3 CORS must allow its origin.',
    ],
    note: 'The arrow direction matters. Lambda -> S3 with grantPut means the bucket grants that Lambda permission to upload objects.',
  },
  {
    label: 'Inspector',
    title: 'Give each piece the details CDK needs',
    intro: 'Single-click a component or arrow. The right panel changes to match your selection.',
    actions: [
      'On a Lambda, set its name, handler export, entry file, API path, and HTTP method. For example, POST /get-presigned-url routes to your URL Lambda.',
      'On an S3 bucket, check CORS origins. On a DynamoDB table, choose the partition key used by your records.',
      'On an arrow, Connection type says what relationship it represents. CDK action chooses the exact integration, grant, or trigger method when available.',
      'Use the small info icon beside a field for a plain-language explanation. Double-click a component on the canvas to focus it and its neighbors.',
    ],
    note: 'Connected bucket and table names can appear in Lambda environment variables, so handler code can locate the right resource.',
  },
  {
    label: 'Validation',
    title: 'Check the graph before exporting',
    intro: 'Click Validate in the top bar. The bottom panel calls out missing or unsupported relationships.',
    actions: [
      'A red error means the connection cannot be mapped as drawn. A yellow warning means something needs attention or manual work.',
      'Click a warning about an arrow to select it and see the detailed mapping in the Inspector.',
      'Drag the top edge of the Validation panel to resize it. Use its small chevron to hide or reopen it.',
    ],
    note: 'No validation findings means the modeled relationships passed these checks. It does not prove the generated application is ready to deploy.',
  },
  {
    label: 'Export',
    title: 'Read the CDK files, then finish the code',
    intro: 'Click Generate CDK. Browse the file tabs, then download the ZIP.',
    actions: [
      'lib/infrastructure-stack.ts creates the AWS constructs and the supported relationships you drew.',
      'bin/app.ts starts the CDK app. package.json, cdk.json, and tsconfig.json make the project runnable.',
      'Open the generated Lambda entry files and replace the TODO handlers with your presigned-URL and DynamoDB request code.',
      'In the downloaded project, run npm install, npm run build, and npm run synth. Synth previews CloudFormation; deploy only after reviewing code and permissions.',
    ],
    note: 'InfraCanvas itself is frontend-only and makes no AWS calls. The ZIP is a scaffold, not a finished upload application.',
  },
] as const;

export function GuideModal({ onClose, onOpenSample }: GuideModalProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const step = steps[stepIndex];

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="guide-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <header className="guide-header">
          <div className="guide-heading">
            <BookOpen size={19} aria-hidden="true" />
            <div>
              <p className="eyebrow">Quick guide</p>
              <h2 id="guide-title">Your first CDK workflow</h2>
            </div>
          </div>
          <button ref={closeRef} type="button" className="icon-button" aria-label="Close guide" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="guide-main">
          <nav className="guide-step-list" aria-label="Guide steps">
            {steps.map((item, index) => (
              <button
                key={item.label}
                type="button"
                className={index === stepIndex ? 'active' : ''}
                aria-current={index === stepIndex ? 'step' : undefined}
                onClick={() => setStepIndex(index)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                {item.label}
              </button>
            ))}
          </nav>

          <article className="guide-content" key={step.label}>
            <p className="guide-progress">Step {stepIndex + 1} of {steps.length}</p>
            <h3>{step.title}</h3>
            <p className="guide-intro">{step.intro}</p>
            {stepIndex === 0 && (
              <div className="guide-flow" aria-label="Example upload workflow">
                <div><strong>Get upload URL</strong><span>Browser <ArrowRight size={13} /> API <ArrowRight size={13} /> Lambda</span></div>
                <div><strong>Upload file</strong><span>Browser <ArrowRight size={13} /> S3</span></div>
                <div><strong>Save file path</strong><span>Browser <ArrowRight size={13} /> API <ArrowRight size={13} /> Lambda <ArrowRight size={13} /> DynamoDB</span></div>
              </div>
            )}
            <ol className="guide-actions">
              {step.actions.map((action) => <li key={action}>{action}</li>)}
            </ol>
            <p className="guide-note"><strong>Keep in mind</strong>{step.note}</p>
          </article>
        </div>

        <footer className="guide-footer">
          <button type="button" className="guide-sample" onClick={onOpenSample}>
            <GitBranch size={16} />
            Open advanced sample
          </button>
          <div className="guide-nav">
            <button type="button" onClick={() => setStepIndex((index) => index - 1)} disabled={stepIndex === 0}>
              <ArrowLeft size={16} />
              Back
            </button>
            {stepIndex < steps.length - 1 ? (
              <button type="button" className="primary" onClick={() => setStepIndex((index) => index + 1)}>
                Next <ArrowRight size={16} />
              </button>
            ) : (
              <button type="button" className="primary" onClick={onClose}>Done</button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
