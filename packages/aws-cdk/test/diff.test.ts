/* eslint-disable import/order */
import { Writable } from 'stream';
import { StringDecoder } from 'string_decoder';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
//import { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import { instanceMockFrom, MockCloudExecutable, testStack } from './util';
import { MockToolkitEnvironment } from './util/nested-stack-mocks';
import { Deployments } from '../lib/api/deployments';
import { CdkToolkit } from '../lib/cdk-toolkit';
import * as cfn from '../lib/api/util/cloudformation';
import * as fs from 'fs';
import * as path from 'path';
import * as setup from './api/hotswap/hotswap-test-setup';
import { CloudFormationStackArtifact } from '@aws-cdk/cx-api';

describe('top-level stacks', () => {
  let cloudFormation: jest.Mocked<Deployments>;
  let cloudExecutable: MockCloudExecutable;
  let toolkit: CdkToolkit;

  beforeEach(() => {
    cloudExecutable = new MockCloudExecutable({
      stacks: [{
        stackName: 'A',
        template: { resource: 'A' },
      },
      {
        stackName: 'B',
        depends: ['A'],
        template: { resource: 'B' },
      },
      {
        stackName: 'C',
        depends: ['A'],
        template: { resource: 'C' },
        metadata: {
          '/resource': [
            {
              type: cxschema.ArtifactMetadataEntryType.ERROR,
              data: 'this is an error',
            },
          ],
        },
      },
      {
        stackName: 'D',
        template: { resource: 'D' },
      }],
    });

    cloudFormation = instanceMockFrom(Deployments);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation((stackArtifact: CloudFormationStackArtifact) => {
      if (stackArtifact.stackName === 'D') {
        return Promise.resolve({
          deployedRootTemplate: { resource: 'D' },
          nestedStackCount: 0,
          nestedStacks: {},
        });
      }
      return Promise.resolve({
        deployedRootTemplate: {},
        nestedStackCount: 0,
        nestedStacks: {},
      });
    });
    cloudFormation.deployStack.mockImplementation((options) => Promise.resolve({
      noOp: true,
      outputs: {},
      stackArn: '',
      stackArtifact: options.stack,
    }));
  });

  test('diff can diff multiple stacks', async () => {
    // GIVEN
    const buffer = new StringWritable();

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['B'],
      stream: buffer,
    });

    // THEN
    const plainTextOutput = buffer.data.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    expect(plainTextOutput).toContain('Stack A');
    expect(plainTextOutput).toContain('Stack B');

    expect(buffer.data.trim()).toContain('✨  Number of stacks with differences: 2');
    expect(exitCode).toBe(0);
  });

  test('diff counts stack diffs, not resource diffs', async () => {
    // GIVEN
    cloudExecutable = new MockCloudExecutable({
      stacks: [{
        stackName: 'A',
        template: { resourceA: 'A', resourceB: 'B' },
      },
      {
        stackName: 'B',
        template: { resourceC: 'C' },
      }],
    });

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    const buffer = new StringWritable();

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A', 'B'],
      stream: buffer,
    });

    // THEN
    const plainTextOutput = buffer.data.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    expect(plainTextOutput).toContain('Stack A');
    expect(plainTextOutput).toContain('Stack B');

    expect(buffer.data.trim()).toContain('✨  Number of stacks with differences: 2');
    expect(exitCode).toBe(0);
  });

  test('diff exists with 1 and fail set to `true` when the diff is not empty', async () => {
    // GIVEN
    const buffer = new StringWritable();

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      stream: buffer,
      fail: true,
    });

    // THEN
    expect(buffer.data.trim()).toContain('✨  Number of stacks with differences: 1');
    expect(exitCode).toBe(1);
  });

  test('throws an error if no valid stack names given', async () => {
    const buffer = new StringWritable();

    // WHEN
    await expect(() => toolkit.diff({
      stackNames: ['X', 'Y', 'Z'],
      stream: buffer,
    })).rejects.toThrow('No stacks match the name(s) X,Y,Z');
  });

  test('diff exists with 1 and fail set to `true` with one non-empty diff and one empty diff', async () => {
    // GIVEN
    const buffer = new StringWritable();

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A', 'D'],
      stream: buffer,
      fail: true,
    });

    // THEN
    expect(buffer.data.trim()).toContain('✨  Number of stacks with differences: 1');
    expect(exitCode).toBe(1);
  });

  test('throws an error during diffs on stack with error metadata', async () => {
    const buffer = new StringWritable();

    // WHEN
    await expect(() => toolkit.diff({
      stackNames: ['C'],
      stream: buffer,
    })).rejects.toThrow(/Found errors/);
  });

  test('when quiet mode is enabled, stacks with no diffs should not print stack name & no differences to stdout', async () => {
    // GIVEN
    const buffer = new StringWritable();

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A', 'A'],
      stream: buffer,
      fail: false,
      quiet: true,
    });

    // THEN
    expect(buffer.data.trim()).not.toContain('Stack A');
    expect(buffer.data.trim()).not.toContain('There were no differences');
    expect(exitCode).toBe(0);
  });
});

describe('nested stacks', () => {
  test('diff can diff deeply nested stacks', async () => {
    // GIVEN
    const buffer = new StringWritable();

    const oldRootTemplate = {
      Resources: {
        ChildStack: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.amazon.com',
          },
        },
      },
    };

    const newRootTemplate = JSON.parse(JSON.stringify(oldRootTemplate));
    newRootTemplate.Resources.ChildStack.Properties.TemplateURL = 'https://www.amazoff.com';

    const oldChildTemplate = {
      Resources: {
        GrandChildStack: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.amazin.com',
          },
        },
      },
    };
    const newChildTemplate = JSON.parse(JSON.stringify(oldChildTemplate));
    newChildTemplate.Resources.GrandChildStack.Properties.TemplateURL = 'https://www.amazoing.com';

    const oldGrandChildTemplate = {
      Resources: {
        Grand2ChildStack: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.amazop.com',
          },
        },
      },
    };

    const newGrandChildTemplate = JSON.parse(JSON.stringify(oldGrandChildTemplate));
    newGrandChildTemplate.Resources.Grand2ChildStack.Properties.TemplateURL = 'https://www.amazoop.com';

    const oldGrand2ChildTemplate = {
      Resources: {
        ReInvent: {
          Type: 'AWS::ReInvent::Convention',
          Properties: {
            AttendeeCount: 500000,
          },
        },
      },
    };

    const newGrand2ChildTemplate = JSON.parse(JSON.stringify(oldGrand2ChildTemplate));
    newGrand2ChildTemplate.Resources.ReInvent.Properties.AttendeeCount = 5;

    // WHEN
    const exitCode = await diffStacks({
      stackName: 'Parent',
      oldTemplate: oldRootTemplate,
      newTemplate: newRootTemplate,
      nestedStacks: {
        ChildStack: {
          oldTemplate: oldChildTemplate,
          newTemplate: newChildTemplate,
          stackName: 'ChildStack',
          nestedStacks: {
            GrandChildStack: {
              stackName: 'GrandChildStack',
              oldTemplate: oldGrandChildTemplate,
              newTemplate: newGrandChildTemplate,
              nestedStacks: {
                Grand2ChildStack: {
                  stackName: 'Grand2ChildStack',
                  oldTemplate: oldGrand2ChildTemplate,
                  newTemplate: newGrand2ChildTemplate,
                  nestedStacks: {},
                },
              },
            },
          },
        },
      },
    },
    buffer);

    // THEN
    expect(exitCode).toEqual(0);

    const plainTextOutput = buffer.data.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/[ \t]+$/mg, '');
    expect(plainTextOutput.trim()).toEqual(`Stack Parent
Resources
[~] AWS::CloudFormation::Stack ChildStack
 └─ [~] TemplateURL
     ├─ [-] https://www.amazon.com
     └─ [+] https://www.amazoff.com

Stack ChildStack
Resources
[~] AWS::CloudFormation::Stack GrandChildStack
 └─ [~] TemplateURL
     ├─ [-] https://www.amazin.com
     └─ [+] https://www.amazoing.com

Stack GrandChildStack
Resources
[~] AWS::CloudFormation::Stack Grand2ChildStack
 └─ [~] TemplateURL
     ├─ [-] https://www.amazop.com
     └─ [+] https://www.amazoop.com

Stack Grand2ChildStack
Resources
[~] AWS::ReInvent::Convention ReInvent
 └─ [~] AttendeeCount
     ├─ [-] 500000
     └─ [+] 5


✨  Number of stacks with differences: 4`);
  });

  test('diff can diff nested stacks', async () => {
    // GIVEN
    const buffer = new StringWritable();
    // GIVEN
    const oldRootTemplate = {
      Resources: {
        AdditionChild: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'old-addition-child',
          },
        },
        DeletionChild: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'old-deletion-child',
          },
        },
        ChangedChild: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'old-changed-child',
          },
        },
      },
    };

    const newRootTemplate = JSON.parse(JSON.stringify(oldRootTemplate));
    newRootTemplate.Resources.AdditionChild.Properties.TemplateURL = 'new-addition-child';
    newRootTemplate.Resources.DeletionChild.Properties.TemplateURL = 'new-deletion-child';
    newRootTemplate.Resources.ChangedChild.Properties.TemplateURL = 'new-changed-child';

    const oldAdditionChildTemplate = {
      Resources: {
        SomeResource: {
          Type: 'AWS::SomeService::SomeType',
          Properties: {},
        },
      },
    };
    const newAdditionChildTemplate = JSON.parse(JSON.stringify(oldAdditionChildTemplate));
    newAdditionChildTemplate.Resources.SomeResource.Properties = {
      newProp: 'new-value',
    };

    const oldDeletionChildTemplate = {
      Resources: {
        SomeResource: {
          Type: 'AWS::SomeService::SomeType',
          Properties: {
            PropToBeRemoved: 'value-to-be-removed',
          },
        },
      },
    };
    const newDeletionChildTemplate = JSON.parse(JSON.stringify(oldDeletionChildTemplate));
    newDeletionChildTemplate.Resources.SomeResource.Properties = {};

    const oldChangedChildTemplate = {
      Resources: {
        SomeResource: {
          Type: 'AWS::SomeService::SomeType',
          Properties: {
            PropToBeChanged: 'old-value',
          },
        },
      },
    };
    const newChangedChildTemplate = JSON.parse(JSON.stringify(oldChangedChildTemplate));
    newChangedChildTemplate.Resources.SomeResource.Properties.PropToBeChanged = 'new-value';

    // WHEN
    const exitCode = await diffStacks({
      stackName: 'Parent',
      oldTemplate: oldRootTemplate,
      newTemplate: newRootTemplate,
      nestedStacks: {
        AdditionChild: {
          oldTemplate: oldAdditionChildTemplate,
          newTemplate: newAdditionChildTemplate,
          stackName: 'AdditionChild',
          nestedStacks: {},
        },
        DeletionChild: {
          oldTemplate: oldDeletionChildTemplate,
          newTemplate: newDeletionChildTemplate,
          stackName: 'DeletionChild',
          nestedStacks: {},
        },
        ChangedChild: {
          oldTemplate: oldChangedChildTemplate,
          newTemplate: newChangedChildTemplate,
          stackName: 'ChangedChild',
          nestedStacks: {},
        },
      },
    },
    buffer);

    // THEN
    expect(exitCode).toEqual(0);

    // THEN
    const plainTextOutput = buffer.data.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/[ \t]+$/mg, '');
    expect(plainTextOutput.trim()).toEqual(`Stack Parent
Resources
[~] AWS::CloudFormation::Stack AdditionChild
 └─ [~] TemplateURL
     ├─ [-] old-addition-child
     └─ [+] new-addition-child
[~] AWS::CloudFormation::Stack DeletionChild
 └─ [~] TemplateURL
     ├─ [-] old-deletion-child
     └─ [+] new-deletion-child
[~] AWS::CloudFormation::Stack ChangedChild
 └─ [~] TemplateURL
     ├─ [-] old-changed-child
     └─ [+] new-changed-child

Stack AdditionChild
Resources
[~] AWS::SomeService::SomeType SomeResource
 └─ [+] newProp
     └─ new-value

Stack DeletionChild
Resources
[~] AWS::SomeService::SomeType SomeResource
 └─ [-] PropToBeRemoved
     └─ value-to-be-removed

Stack ChangedChild
Resources
[~] AWS::SomeService::SomeType SomeResource
 └─ [~] PropToBeChanged
     ├─ [-] old-value
     └─ [+] new-value


✨  Number of stacks with differences: 4`);

    expect(exitCode).toBe(0);
  });

  test('diff falls back to non-changeset diff for nested stacks', async () => {
    // GIVEN
    const changeSetSpy = jest.spyOn(cfn, 'waitForChangeSet');
    const buffer = new StringWritable();

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['Parent'],
      stream: buffer,
      changeSet: true,
    });

    // THEN
    const plainTextOutput = buffer.data.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/[ \t]+$/mg, '');
    expect(plainTextOutput.trim()).toEqual(`Stack Parent
Resources
[~] AWS::CloudFormation::Stack AdditionChild
 └─ [~] Resources
     └─ [~] .SomeResource:
         └─ [+] Added: .Properties
[~] AWS::CloudFormation::Stack DeletionChild
 └─ [~] Resources
     └─ [~] .SomeResource:
         └─ [-] Removed: .Properties
[~] AWS::CloudFormation::Stack ChangedChild
 └─ [~] Resources
     └─ [~] .SomeResource:
         └─ [~] .Properties:
             └─ [~] .Prop:
                 ├─ [-] old-value
                 └─ [+] new-value


✨  Number of stacks with differences: 4`);

    expect(exitCode).toBe(0);
    expect(changeSetSpy).not.toHaveBeenCalled();
  });
});

class StringWritable extends Writable {
  public data: string;
  private readonly _decoder: StringDecoder;

  constructor(options: any = {}) {
    super(options);
    this._decoder = new StringDecoder(options && options.defaultEncoding);
    this.data = '';
  }

  public _write(chunk: any, encoding: string, callback: (error?: Error | undefined) => void) {
    if (encoding === 'buffer') {
      chunk = this._decoder.write(chunk);
    }
    this.data += chunk;
    callback();
  }

  public _final(callback: (error?: Error | null) => void) {
    this.data += this._decoder.end();
    callback();
  }
}

interface TemplatesToDiff {
  stackName: string;
  oldTemplate: any;
  newTemplate: any;
  nestedStacks: { [logicalId: string]: TemplatesToDiff };
}

interface StacksToDiff {
  oldStack: CloudFormationStackArtifact;
  newStack: CloudFormationStackArtifact;
  nestedStacks: { [logicalId: string]: StacksToDiff };
}

async function diffStacks(templatesToDiff: TemplatesToDiff, buffer: StringWritable) {
  const sdkProvider = setup.setupHotswapNestedStackTests(templatesToDiff.stackName).mockSdkProvider;
  const stacksToDiff = createStacks(templatesToDiff);
  const mockToolkitEnv = new MockToolkitEnvironment({ stacks: [stacksToDiff.newStack] }, sdkProvider);

  addMetadataToNestedStacks(stacksToDiff);

  setup.addTemplateToCloudFormationLookupMock(stacksToDiff.oldStack);

  const exitCode = await mockToolkitEnv.toolkit.diff({
    stackNames: [templatesToDiff.stackName],
    stream: buffer,
  });

  tearDownNestedStacks(stacksToDiff);

  return exitCode;
}

function createStacks(templatesToDiff: TemplatesToDiff): StacksToDiff {
  const oldStack = testStack({
    stackName: templatesToDiff.stackName,
    template: templatesToDiff.oldTemplate,
  });

  const newStack = testStack({
    stackName: templatesToDiff.stackName,
    template: templatesToDiff.newTemplate,
  });
  const stacksToDiff: StacksToDiff = {
    oldStack,
    newStack,
    nestedStacks: {},
  };

  createStacksHelper(templatesToDiff.nestedStacks, stacksToDiff);

  return stacksToDiff;
}

function createStacksHelper(templatesToDiff: { [key: string]: TemplatesToDiff }, stacksToDiff: StacksToDiff) {
  for (const [nestedStackId, nestedTemplate] of Object.entries(templatesToDiff)) {
    stacksToDiff.nestedStacks[nestedStackId] = {
      oldStack: testStack({
        stackName: nestedTemplate.stackName,
        template: nestedTemplate.oldTemplate,
      }),
      newStack: testStack({
        stackName: nestedTemplate.stackName,
        template: nestedTemplate.newTemplate,
      }),
      nestedStacks: {},
    };

    createStacksHelper(nestedTemplate.nestedStacks, stacksToDiff.nestedStacks[nestedStackId]);
  }
}

function addMetadataToNestedStacks(stacksToDiff: StacksToDiff) {
  for (const nestedStackId of Object.keys(stacksToDiff.nestedStacks)) {
    const nestedStack = stacksToDiff.nestedStacks[nestedStackId];

    const templateFileName = `${nestedStack.oldStack.stackName}.json`;
    stacksToDiff.oldStack.template.Resources[nestedStackId].Metadata = {
      'aws:asset:path': templateFileName,
    };
    stacksToDiff.newStack.template.Resources[nestedStackId].Metadata = stacksToDiff.oldStack.template.Resources[nestedStackId].Metadata;

    setup.pushNestedStackResourceSummaries(stacksToDiff.newStack.stackName,
      setup.stackSummaryOf(nestedStack.newStack.stackName, 'AWS::CloudFormation::Stack',
        `arn:aws:cloudformation:bermuda-triangle-1337:123456789012:stack/${nestedStack.newStack.stackName}/abcd`,
      ),
    );

    addMetadataToNestedStacks(nestedStack);
  }

  placeGeneratedAndDeployedTemplates(stacksToDiff);
}

function placeGeneratedAndDeployedTemplates(stacksToDiff: StacksToDiff) {
  for (const nestedStackId of Object.keys(stacksToDiff.nestedStacks)) {
    const nestedStack = stacksToDiff.nestedStacks[nestedStackId];
    const templateFileName = stacksToDiff.newStack.template.Resources[nestedStackId].Metadata['aws:asset:path'];
    fs.writeFileSync(path.join(__dirname, path.join('nested-stack-templates', `${templateFileName}`)), JSON.stringify(nestedStack.newStack.template));
    setup.addTemplateToCloudFormationLookupMock(nestedStack.oldStack);
  }
}

function tearDownNestedStacks(stacksToDiff: StacksToDiff) {
  for (const nestedStackId of Object.keys(stacksToDiff.nestedStacks)) {
    const nestedStack = stacksToDiff.nestedStacks[nestedStackId];

    fs.rmSync(path.join(__dirname, `nested-stack-templates/${nestedStack.newStack.stackName}.json`));

    tearDownNestedStacks(nestedStack);
  }
}
