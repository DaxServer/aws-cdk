/* eslint-disable import/order */
import { Writable } from 'stream';
import { StringDecoder } from 'string_decoder';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
//import { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import { /*instanceMockFrom,*/ MockCloudExecutable, testStack } from './util';
import { MockToolkitEnvironment } from './util/nested-stack-mocks';
import { Deployments } from '../lib/api/deployments';
import { CdkToolkit } from '../lib/cdk-toolkit';
// import * as cfn from '../lib/api/util/cloudformation';
import * as fs from 'fs';
import * as path from 'path';
import * as setup from './api/hotswap/hotswap-test-setup';
import { CloudFormationStackArtifact } from '@aws-cdk/cx-api';

let cloudExecutable: MockCloudExecutable;
let cloudFormation: Deployments;
let toolkit: CdkToolkit;

describe('top-level stacks', () => {
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

    //cloudFormation = instanceMockFrom(Deployments);
    cloudFormation = new Deployments({
      sdkProvider: cloudExecutable.sdkProvider,
    });

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    /*
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
    */
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
  beforeEach(() => {
    /*
    cloudExecutable = new MockCloudExecutable({
      stacks: [{
        stackName: 'Parent',
        template: {},
      }],
    });

    cloudFormation = new Deployments({
      sdkProvider: cloudExecutable.sdkProvider,
    });

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });
    */

    /*
    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation((stackArtifact: CloudFormationStackArtifact) => {
      if (stackArtifact.stackName === 'Parent') {
        stackArtifact.template.Resources = {
          AdditionChild: {
            Type: 'AWS::CloudFormation::Stack',
            Resources: {
              SomeResource: {
                Type: 'AWS::Something',
                Properties: {
                  Prop: 'added-value',
                },
              },
            },
          },
          DeletionChild: {
            Type: 'AWS::CloudFormation::Stack',
            Resources: {
              SomeResource: {
                Type: 'AWS::Something',
              },
            },
          },
          ChangedChild: {
            Type: 'AWS::CloudFormation::Stack',
            Resources: {
              SomeResource: {
                Type: 'AWS::Something',
                Properties: {
                  Prop: 'new-value',
                },
              },
            },
          },
        };
        return Promise.resolve({
          deployedRootTemplate: {
            Resources: {
              AdditionChild: {
                Type: 'AWS::CloudFormation::Stack',
                Resources: {
                  SomeResource: {
                    Type: 'AWS::Something',
                  },
                },
              },
              DeletionChild: {
                Type: 'AWS::CloudFormation::Stack',
                Resources: {
                  SomeResource: {
                    Type: 'AWS::Something',
                    Properties: {
                      Prop: 'value-to-be-removed',
                    },
                  },
                },
              },
              ChangedChild: {
                Type: 'AWS::CloudFormation::Stack',
                Resources: {
                  SomeResource: {
                    Type: 'AWS::Something',
                    Properties: {
                      Prop: 'old-value',
                    },
                  },
                },
              },
            },
          },
          nestedStackCount: 3,
          nestedStacks: {
            AdditionChild: {
              deployedTemplate: {
                Type: 'AWS::CloudFormation::Stack',
                Resources: {
                  SomeResource: {
                    Type: 'AWS::Something',
                  },
                },
              },
              generatedTemplate: {
                Type: 'AWS::CloudFormation::Stack',
                Resources: {
                  SomeResource: {
                    Type: 'AWS::Something',
                    Properties: {
                      Prop: 'added-value',
                    },
                  },
                },
              },
            },
          },
        });
      }
      return Promise.resolve({
        deployedTemplate: {},
        nestedStackCount: 0,
        nestedStackNames: {},
      });
    });
    */
  });

  test('foo', async () => {
    // GIVEN
    const oldRootTemplate = {
      Resources: {
        NestedStack: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.amazon.com',
          },
        },
      },
    };

    const newRootTemplate = JSON.parse(JSON.stringify(oldRootTemplate));
    newRootTemplate.Resources.NestedStack.Properties.TemplateURL = 'https://www.amazoff.com';

    const oldNestedTemplate = {
      Resources: {
        GrandNestedStack: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.amazin.com',
          },
        },
      },
    };
    const newNestedTemplate = JSON.parse(JSON.stringify(oldNestedTemplate));
    newNestedTemplate.Resources.GrandNestedStack.Properties.TemplateURL = 'https://www.amazoing.com';

    const oldGrandNestedTemplate = {
      Resources: {
        ReInvent: {
          Type: 'AWS::ReInvent::Convention',
          Properties: {
            AttendeeCount: 500000,
          },
        },
      },
    };

    const newGrandNestedTemplate = JSON.parse(JSON.stringify(oldGrandNestedTemplate));
    newGrandNestedTemplate.Resources.ReInvent.Properties.AttendeeCount = 5;

    // WHEN
    const exitCode = await diffStacks({
      stackName: 'Parent',
      oldTemplate: oldRootTemplate,
      newTemplate: newRootTemplate,
      nestedStacks: {
        NestedStack: {
          oldTemplate: oldNestedTemplate,
          newTemplate: newNestedTemplate,
          stackName: 'NestedStack',
          nestedStacks: {
            GrandNestedStack: {
              stackName: 'GrandNestedStack',
              oldTemplate: oldGrandNestedTemplate,
              newTemplate: newGrandNestedTemplate,
              nestedStacks: {},
            },
          },
        },
      },
    },
    process.stderr as any);
    // GIVEN
    //const buffer = new StringWritable();

    expect(exitCode).toEqual(1);
  });

  /*
  test('diff can diff nested stacks', async () => {
    // GIVEN
    const buffer = new StringWritable();

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['Parent'],
      stream: buffer,
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
*/
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

async function diffStacks(templatesToDiff: TemplatesToDiff, _buffer: StringWritable) {
  const sdkProvider = setup.setupHotswapNestedStackTests(templatesToDiff.stackName).mockSdkProvider;
  const stacksToDiff = createStacks(templatesToDiff);
  const mockToolkitEnv = new MockToolkitEnvironment({ stacks: [stacksToDiff.newStack] }, sdkProvider);

  addMetadataToNestedStacks(stacksToDiff);

  setup.addTemplateToCloudFormationLookupMock(stacksToDiff.oldStack);

  const exitCode = await mockToolkitEnv.toolkit.diff({
    stackNames: [templatesToDiff.stackName],
    stream: process.stderr,
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

  // must write the stacks after all the metadata has been updated so the parent stack of each nested stack has the correct metadata
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
