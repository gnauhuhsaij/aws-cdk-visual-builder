# CDKCanvas: Visual AWS CDK Builder

InfraCanvas helps you design AWS infrastructure visually and turn it into TypeScript AWS CDK code. It is built for people who know AWS services and want an easier way to understand how those services connect in CDK.

## What You Can Do

- **Design on a canvas:** add resources, move them around, connect them with arrows, and leave comments with text boards.
- **Configure resources and connections:** edit resource settings, Lambda environment variables, connection types, and specific CDK actions such as `grantPut` or `grantRead`.
- **Check your design:** see warnings and errors for unsupported connections or missing setup, then click a finding to inspect its connection.
- **Export CDK code:** preview generated files and download a TypeScript CDK v2 project scaffold, including resource definitions, supported integrations and permissions, and placeholder Lambda handlers.
- **Import an existing stack:** load a `.ts` stack file to visualize supported CDK patterns.
- **Keep multiple boards:** save projects in your browser, switch between them, undo or redo edits, and recover your current board after a refresh.
- **Learn by doing:** open **Default project** for a guided exercise connecting API Gateway, Lambda, and S3. Each step highlights the relevant controls. Closing the walkthrough resets practice and restores your own board.

The palette includes Lambda, S3, DynamoDB, API Gateway, SQS, EC2, EventBridge, IAM Role/Profile, Web UI, Script Asset, and Text board.

The editor runs entirely in the browser. It generates a starting point for your infrastructure; application logic and AWS deployment are completed separately.

## Future Steps

Ideas for making InfraCanvas useful across more application scenarios:

- **Public demo:** publish a hosted version and a short video showing a complete design-to-export workflow.
- **Scenario templates:** offer starting points for REST APIs, file processing, background jobs, scheduled data pipelines, and ML inference workflows.
- **More AWS services:** expand support to Step Functions, ECS/Fargate, RDS, Glue, and SageMaker for orchestration, container applications, databases, data engineering, and ML workloads.
- **Reusable designs:** group resources into reusable components and support multiple stacks and development/production configurations.
- **Broader validation and import support:** check network access and least-privilege permissions, recognize more CDK patterns, and clearly identify code that needs manual completion.
- **Portable projects:** add board import/export and shareable examples so designs can move between browsers and teammates.
