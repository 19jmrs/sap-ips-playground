const source = {
  user: {
    mappings: [
      { sourcePath: '$.id', targetPath: '$.id' },
      { sourcePath: '$.userName', targetPath: '$.userName', functions: [{ function: 'toLowerCaseString' }] },
      { sourcePath: '$.name', targetPath: '$.name', optional: true },
      { sourcePath: '$.emails', targetPath: '$.emails', optional: true, preserveArrayWithSingleElement: true },
      { sourcePath: '$.active', targetPath: '$.active', optional: true },
    ],
  },
};
const target = {
  user: {
    mappings: [
      { sourcePath: '$.id', targetPath: '$.externalId' },
      { sourcePath: '$.userName', targetPath: '$.userName' },
      { sourcePath: '$.name', targetPath: '$.name', optional: true },
      { sourcePath: '$.emails', targetPath: '$.emails', optional: true, preserveArrayWithSingleElement: true },
      { sourcePath: '$.active', targetPath: '$.active', optional: true },
      { constant: ['urn:ietf:params:scim:schemas:core:2.0:User'], targetPath: '$.schemas' },
    ],
  },
};
const alex = {
  id: 'u-1001',
  userName: 'Alex.Meyer',
  name: { givenName: 'Alex', familyName: 'Meyer' },
  emails: [{ value: 'alex.meyer@example.com', primary: true }],
  active: true,
};
const sam = { id: 'u-1002', userName: 'Sam.Rivera', name: { givenName: 'Sam', familyName: 'Rivera' }, active: false };
export const examples = [
  {
    id: 'chain',
    label: 'Users · Source to target',
    data: { Resources: [alex, sam] },
    source,
    target,
    mode: 'chain',
    entityType: 'user',
    entityPath: '$.Resources[*]',
    context: {},
  },
  {
    id: 'source',
    label: 'User · Source only',
    data: alex,
    source,
    target,
    mode: 'source',
    entityType: 'user',
    entityPath: '$',
    context: {},
  },
  {
    id: 'target',
    label: 'User · Target only',
    data: { ...alex, userName: 'alex.meyer' },
    source,
    target,
    mode: 'target',
    entityType: 'user',
    entityPath: '$',
    context: {},
  },
  {
    id: 'errors',
    label: 'Batch · Continue after an error',
    data: { Resources: [alex, { id: 'u-missing-name', active: true }, sam] },
    source,
    target,
    mode: 'chain',
    entityType: 'user',
    entityPath: '$.Resources[*]',
    context: {},
  },
  {
    id: 'conditions',
    label: 'User · Conditional mapping',
    data: sam,
    source: {
      user: {
        mappings: [
          { sourcePath: '$.id', targetPath: '$.id' },
          { condition: '$.active == true', constant: 'active-user', targetPath: '$.category' },
        ],
      },
    },
    target,
    mode: 'source',
    entityType: 'user',
    entityPath: '$',
    context: {},
  },
  {
    id: 'group',
    label: 'Group · Source only',
    data: { id: 'g-1001', displayName: 'Consultants', members: [{ value: 'u-1001' }] },
    source: {
      group: {
        mappings: [
          { sourcePath: '$.id', targetPath: '$.id' },
          { sourcePath: '$.displayName', targetPath: '$.displayName' },
          { sourcePath: '$.members', targetPath: '$.members', optional: true, preserveArrayWithSingleElement: true },
        ],
      },
    },
    target: { group: { mappings: [{ sourcePath: '$', targetPath: '$' }] } },
    mode: 'source',
    entityType: 'group',
    entityPath: '$',
    context: {},
  },
];
export const pretty = (value) => JSON.stringify(value, null, 2);
